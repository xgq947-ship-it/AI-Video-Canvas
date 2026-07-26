"""Gemini Apps 网页自动化公共 Provider。

只驱动 gemini.google.com 的公开 UI；不读取 Cookie/Token，不调用内部生成 API。
选择器、登录探针、上传、提交、等待和下载都集中在这里，React 不包含第三方 DOM 逻辑。
"""

from __future__ import annotations

import re
import sys
import time
import base64
from datetime import datetime
from pathlib import Path
from typing import Any

from ops_cli.browser import managed_work_page
from ops_cli.platforms._google_flow_common import _import_browser_runtime


GEMINI_HOME_URL = "https://gemini.google.com/app"
IMAGE_ASPECT_RATIOS = ("16:9", "9:16", "1:1", "3:2", "4:3")
VIDEO_ASPECT_RATIOS = ("16:9", "9:16")
VIDEO_DURATIONS = (8,)
MAX_IMAGE_REFERENCES = 5
MAX_VIDEO_REFERENCES = 3

# 上传后附件进入服务端处理，期间发送按钮已渲染但 disabled；实测两张 512×512 小图约 2 秒，
# 真实产品图会更久。这里给足余量，真正的放行信号是「发送按钮可用」而不是这个上限。
ATTACHMENT_READY_TIMEOUT_SECONDS = 90
SEND_ENABLED_TIMEOUT_SECONDS = 20
# 点击发送后确认请求真的落地（输入框清空 / 出现新回答 / 停止按钮出现）的观察窗口。
SUBMISSION_CONFIRM_TIMEOUT_SECONDS = 12
# 回答被判定为「写完了」需要的静默时长：文本连续不变且停止按钮消失。
RESPONSE_STABLE_SECONDS = 2.8

# Gemini DOM 变化时只维护这张表，其余函数不得内联选择器。
# 候选按优先级排列，取第一个真的命中的那组（不是逗号并集 —— 并集会让 count() 混进
# 用户消息，也无法分辨到底命中了哪一层包装）。
SELECTORS: dict[str, tuple[str, ...]] = {
    "prompt_input": (
        '[contenteditable="true"][role="textbox"]',
        'rich-textarea [contenteditable="true"]',
        'textarea[aria-label*="prompt" i]',
    ),
    "file_input": (
        'input[type="file"]',
        'input[accept*="image"]',
    ),
    "upload_button": (
        'button[aria-label*="upload" i]',
        'button[aria-label*="上传"]',
        'button[aria-label*="Add files" i]',
    ),
    "upload_menu_item": (
        '[role="menuitem"][aria-label^="Upload files" i]',
        '[role="menuitem"][aria-label*="上传文件"]',
    ),
    "send_button": (
        'button[aria-label*="send" i]',
        'button[aria-label*="发送"]',
        'button[aria-label*="提交"]',
    ),
    "stop_button": (
        'button[aria-label*="stop" i]',
        'button[aria-label*="停止"]',
    ),
    # 只匹配模型回答的容器。绝不能放进 message-content 这类同时包住用户提问的选择器，
    # 否则「新增消息」会先命中我们自己刚发出去的提示词，把提示词当成识别结果返回。
    "assistant_messages": (
        'model-response',
        '[data-message-author-role="assistant"]',
        '[data-message-author-role="model"]',
        '.model-response-text',
        'assistant-messages-primary message-content',
    ),
    "attachment": (
        'gem-media-attachment',
        'uploader-file-preview-container uploader-file-preview',
        '[aria-label*="close attachment" i]',
    ),
}


class GeminiWebError(RuntimeError):
    def __init__(
        self,
        error_code: str,
        message: str,
        *,
        retryable: bool = False,
        recovery_hint: str | None = None,
        submitted: bool = False,
    ) -> None:
        super().__init__(f"{error_code}：{message}")
        self.error_code = error_code
        self.retryable = retryable
        self.recovery_hint = recovery_hint
        self.submitted = submitted


def build_image_prompt(prompt: str, aspect_ratio: str, reference_count: int) -> str:
    return "\n".join((
        "【任务类型】：生成图片",
        "",
        "【画面描述 (Prompt)】：",
        str(prompt).strip(),
        "",
        "【图片生成参数标准】：",
        f"- 画面比例 (Aspect Ratio)：{aspect_ratio}",
        "- 风格/质感：严格服从画面描述",
        f"- 参考图数量 (Reference Images)：{reference_count}",
        "请直接生成图片，不要只返回文字说明。",
    ))


def build_video_prompt(
    prompt: str,
    aspect_ratio: str,
    duration: int,
    reference_count: int,
    *,
    camera_movement: str = "",
    native_audio: bool = True,
) -> str:
    mode = "图生视频" if reference_count else "文生视频"
    return "\n".join((
        "【任务类型】：生成视频",
        "",
        "【画面描述 (Prompt)】：",
        str(prompt).strip(),
        "",
        "【视频生成参数标准】：",
        f"- 生成模式：{mode}",
        f"- 视频尺寸比例：{aspect_ratio}",
        f"- 单次生成时长：{duration} 秒",
        f"- 参考图：{reference_count} 张",
        f"- Camera Movement：{camera_movement.strip() or '按画面描述执行'}",
        f"- Native Audio：{'生成环境音、音效与提示词中的人物语音' if native_audio else '关闭'}",
        "请直接生成视频，不要只返回文字说明。",
    ))


def probe_gemini_login(page: Any) -> dict[str, Any]:
    """Gemini 的登录态就是 Google 账号登录态，按重定向判定。

    早期实现靠 gemini.google.com 的 DOM 判定：要求「输入框」与「账号态控件」同时可见。
    但账号头像由 One Google Bar 以 iframe 注入，主文档里根本选不到 —— 已登录用户也永远
    落到 unconfirmed 分支，界面上就是那句「Gemini 页面结构异常，未获得可用登录证据」。
    Gemini 没有独立于 Google 账号的授权步骤，因此直接复用 Flow 那条已验证的重定向信号；
    页面 DOM 的形状不再参与判定，unconfirmed 只可能来自探针超时。
    """
    from ops_cli.browser import probe_google_account_login

    result = dict(probe_google_account_login(page))
    if result["authenticated"]:
        result["message"] = "已确认 Google 账号登录，Gemini 可用"
    elif result["reason"] == "not-authenticated":
        result["message"] = "Gemini 需要 Google 账号，当前未登录，请在 Evan 专属 Chrome 中登录"
    else:
        result["message"] = "暂时无法确认 Google 账号登录状态，请稍后重试"
    return result


def _ensure_authenticated(page: Any) -> None:
    """确认登录，并把页面留在 Gemini 上。

    探针最后停在 myaccount.google.com；后续 _select_creation_surface / _upload_references /
    _composer 全都在这个页面上找 Gemini 的控件，必须显式导航回来，否则会在错误的站点上
    找不到输入框。
    """
    result = probe_gemini_login(page)
    if not result["authenticated"]:
        raise GeminiWebError(
            "AUTH_REQUIRED",
            result["message"],
            recovery_hint="请在设置中打开 Gemini 登录窗口，登录后重新检查状态。",
        )
    page.goto(GEMINI_HOME_URL, wait_until="domcontentloaded", timeout=60_000)
    page.wait_for_timeout(1500)


def _visible_nodes(locator: Any) -> list[Any]:
    try:
        return [locator.nth(index) for index in range(locator.count()) if locator.nth(index).is_visible()]
    except Exception:
        return []


def _single_visible(candidates: list[Any], code: str, message: str) -> Any:
    for locator in candidates:
        visible = _visible_nodes(locator)
        if len(visible) == 1:
            return visible[0]
    raise GeminiWebError(code, message)


def _candidates(page: Any, group: str, *, require_enabled: bool = False) -> list[Any]:
    """第一个有命中的候选选择器下的全部可见节点（可选再筛掉 disabled 的）。

    刻意不要求「恰好一个命中」：Gemini 的输入区经常同时存在隐藏镜像节点，
    原来的唯一性判定会因此整组作废，把发送退化成 Enter —— 而 Enter 在附件
    仍在处理时会被页面吞掉，最终表现为「提交成功但一直等不到结果」。

    require_enabled 用于工具栏按钮：页面水合期间 Gemini 会先渲染一个 disabled 的
    占位按钮（aria-label="Add files"，class 含 menu-placeholder-button），随后整个
    替换成真正的「Upload & tools」。点占位按钮只会卡满 30 秒再报元素已从 DOM 脱离。
    """
    for value in SELECTORS[group]:
        nodes = _visible_nodes(page.locator(value))
        if not require_enabled:
            if nodes:
                return nodes
            continue
        enabled = []
        for node in nodes:
            try:
                if node.is_enabled():
                    enabled.append(node)
            except Exception:
                continue
        if enabled:
            return enabled
    return []


def _first_visible(page: Any, group: str, *, require_enabled: bool = False) -> Any | None:
    """按 SELECTORS 的优先级取第一个可见（可选可用）的节点。

    取「第一个」而不是最后一个：视频界面上 button[aria-label*="upload"] 同时匹配 3 个
    按钮，末尾那个 aria-label="File upload" 虽然可见可用，却被 input-container 盖住，
    点它只会 intercepts pointer events 卡满 30 秒。
    """
    nodes = _candidates(page, group, require_enabled=require_enabled)
    return nodes[0] if nodes else None


def _click_any(page: Any, group: str, confirm: Any, timeout_seconds: int = 30) -> bool:
    """依次尝试点击组内每个可用节点，直到 confirm() 成立。

    单点一个节点是不够的：真正的入口可能排在后面，而排在前面的同名按钮会被浮层
    盖住。逐个试 + 用结果确认，比猜哪一个是「正确的那一个」稳。
    """
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        for node in _candidates(page, group, require_enabled=True):
            try:
                node.click(timeout=3000)
            except Exception:
                continue
            page.wait_for_timeout(500)
            if confirm():
                return True
        page.wait_for_timeout(400)
    return False


def _count_visible(page: Any, group: str) -> int:
    for value in SELECTORS[group]:
        visible = _visible_nodes(page.locator(value))
        if visible:
            return len(visible)
    return 0


def _assistant_messages(page: Any) -> Any | None:
    """首个命中的模型回答容器（整组返回，用于计数与取最后一条）。"""
    for value in SELECTORS["assistant_messages"]:
        locator = page.locator(value)
        try:
            if locator.count() > 0:
                return locator
        except Exception:
            continue
    return None


def _assistant_message_count(page: Any) -> int:
    locator = _assistant_messages(page)
    try:
        return locator.count() if locator is not None else 0
    except Exception:
        return 0


def _enabled_send_button(page: Any) -> Any | None:
    return _first_visible(page, "send_button", require_enabled=True)


def _throw_if_human_verification(page: Any, *, scan_body: bool = True) -> None:
    """Google 弹身份验证或用量见底时页面永远等不到回答，必须立刻停下让用户去处理。

    scan_body=False 用于「已经拿到输出之后」的轮询：正文里出现「额度」「quota」完全
    可能只是模型回答的内容，拿它去中断一次成功的生成是得不偿失的。URL 判定没有这个
    风险，任何时候都查。
    """
    url = str(getattr(page, "url", "") or "")
    if re.search(r"accounts\.google\.com|/challenge|captcha", url, re.I):
        raise GeminiWebError(
            "HUMAN_VERIFICATION",
            "Gemini 要求人工验证身份",
            recovery_hint="请在设置中打开 Gemini 登录窗口完成验证后重试。",
        )
    if not scan_body:
        return
    try:
        text = page.locator("body").inner_text(timeout=1200)
    except Exception:
        return
    if re.search(r"verify it.?s you|two-step verification|验证一下是你本人|请完成验证|验证码", text, re.I):
        raise GeminiWebError(
            "HUMAN_VERIFICATION",
            "Gemini 要求人工验证身份",
            recovery_hint="请在设置中打开 Gemini 登录窗口完成验证后重试。",
        )
    if re.search(r"quota|limit reached|额度|请求次数已达|已达到上限", text, re.I):
        raise GeminiWebError(
            "QUOTA_EXCEEDED",
            "Gemini 账号用量已达上限",
            recovery_hint="请稍后再试，或更换 Gemini 账号。",
        )


def _wait_composer_ready(page: Any) -> Any:
    """等 Angular 把输入框挂上来再动手；页面没水合完时上传入口也不存在。"""
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        composer = _first_visible(page, "prompt_input")
        if composer is not None:
            return composer
        _throw_if_human_verification(page)
        page.wait_for_timeout(500)
    raise GeminiWebError(
        "PROMPT_INPUT_NOT_FOUND",
        "未找到 Gemini 提示词输入框",
        retryable=True,
    )


def _select_creation_surface(page: Any, kind: str) -> None:
    """优先进入官方 Images/Create video 页面；找不到时仍可由结构化 Prompt 触发能力。"""
    sidebar = [
        page.get_by_role("button", name=re.compile(r"打开边栏|open sidebar", re.I)),
        page.locator('button[aria-label*="边栏"],button[aria-label*="sidebar" i]'),
    ]
    try:
        control = _single_visible(sidebar, "PAGE_NAVIGATION_FAILED", "未找到 Gemini 边栏按钮")
        control.click()
        page.wait_for_timeout(400)
    except GeminiWebError:
        pass

    label = re.compile(r"图片|images?" if kind == "image" else r"创建视频|create video|videos?", re.I)
    candidates = [page.get_by_role("link", name=label), page.get_by_role("button", name=label)]
    for locator in candidates:
        try:
            visible = [locator.nth(index) for index in range(locator.count()) if locator.nth(index).is_visible()]
            if len(visible) == 1:
                visible[0].click()
                page.wait_for_timeout(800)
                return
        except Exception:
            continue


def _hidden_file_input(page: Any) -> Any | None:
    for value in SELECTORS["file_input"]:
        inputs = page.locator(value)
        try:
            if inputs.count():
                return inputs.nth(inputs.count() - 1)
        except Exception:
            continue
    return None


def _upload_menu_item(page: Any) -> Any | None:
    item = _first_visible(page, "upload_menu_item")
    if item is not None:
        return item
    for locator in (
        page.get_by_role("menuitem", name=re.compile(r"上传文件|upload files?", re.I)),
        page.get_by_text(re.compile(r"上传文件|upload files?", re.I)),
    ):
        visible = _visible_nodes(locator)
        if visible:
            return visible[0]
    return None


def _upload_references(page: Any, paths: list[Path], *, timeout_seconds: int = ATTACHMENT_READY_TIMEOUT_SECONDS) -> None:
    if not paths:
        return
    files = [str(path) for path in paths]
    file_input = _hidden_file_input(page)
    if file_input is not None:
        file_input.set_input_files(files)
    else:
        # 实测当前 Gemini 主文档里根本没有 input[type=file]，上传只能走
        # 「Upload & tools」→「Upload files」→ file chooser 这条路。
        opened = _click_any(page, "upload_button", lambda: _upload_menu_item(page) is not None or _hidden_file_input(page) is not None)
        if not opened:
            raise GeminiWebError("REFERENCE_UPLOAD_FAILED", "无法打开 Gemini 上传入口", retryable=True)
        file_input = _hidden_file_input(page)
        if file_input is not None:
            file_input.set_input_files(files)
        else:
            item = _upload_menu_item(page)
            if item is None:
                raise GeminiWebError("REFERENCE_UPLOAD_FAILED", "未找到 Gemini 上传文件菜单", retryable=True)
            with page.expect_file_chooser(timeout=10_000) as chooser:
                item.click()
            chooser.value.set_files(files)

    _wait_attachments_ready(page, len(paths), timeout_seconds)


def _wait_attachments_ready(page: Any, expected: int, timeout_seconds: int) -> None:
    """等到附件真的被 Gemini 收下为止。

    这是原来最致命的一处：上传后只 wait_for_timeout(1000) 就去提交。附件处理期间
    发送按钮已经渲染但是 disabled，于是提交逻辑找不到可用按钮、退回 Enter，而 Enter
    在这个状态下会被页面直接吞掉 —— 请求从未发出，却要等满整个超时才报错。
    页面上没有稳定的 loading 标记，可用的放行信号就是「附件已出现且发送按钮变为可用」。
    """
    deadline = time.monotonic() + timeout_seconds
    seen = 0
    while time.monotonic() < deadline:
        _throw_if_human_verification(page)
        seen = max(seen, _count_visible(page, "attachment"))
        if seen >= expected and _enabled_send_button(page) is not None:
            return
        page.wait_for_timeout(500)
    raise GeminiWebError(
        "REFERENCE_UPLOAD_TIMEOUT",
        f"Gemini 参考图上传未在 {timeout_seconds} 秒内就绪（已识别 {seen}/{expected} 张）",
        retryable=True,
    )


def _composer(page: Any) -> Any:
    composer = _first_visible(page, "prompt_input")
    if composer is None:
        raise GeminiWebError("PROMPT_INPUT_NOT_FOUND", "未找到 Gemini 提示词输入框", retryable=True)
    return composer


def _fill_prompt(page: Any, prompt: str) -> Any:
    box = _composer(page)
    box.click()
    try:
        box.fill(prompt)
    except Exception:
        box.press("Meta+A" if sys.platform == "darwin" else "Control+A")
        box.press_sequentially(prompt, delay=0)
    page.wait_for_timeout(300)
    try:
        if not box.inner_text().strip():
            box.press_sequentially(prompt, delay=0)
            page.wait_for_timeout(300)
    except Exception:
        pass
    return box


def _submit(page: Any, prompt: str) -> None:
    """填入提示词并确认请求真的发出去了。

    确认才是重点：只有观察到输入框被清空（Gemini 发送后的固定行为）或模型回答条数
    增加，才认为提交成功。没确认就抛 SUBMIT_FAILED —— 十几秒内可重试的明确错误，
    好过空等到超时再报一个与真实原因无关的 GENERATION_TIMEOUT。
    """
    before = _assistant_message_count(page)
    box = _fill_prompt(page, prompt)

    deadline = time.monotonic() + SEND_ENABLED_TIMEOUT_SECONDS
    send = None
    while time.monotonic() < deadline:
        send = _enabled_send_button(page)
        if send is not None:
            break
        _throw_if_human_verification(page)
        page.wait_for_timeout(400)

    if send is not None:
        send.click()
    else:
        box.press("Enter")

    if _submission_landed(page, before):
        return
    # 按钮点击偶尔会被浮层吃掉，再补一次 Enter；仍未落地才判定失败。
    try:
        box.press("Enter")
    except Exception:
        pass
    if _submission_landed(page, before):
        return
    raise GeminiWebError(
        "SUBMIT_FAILED",
        "Gemini 未接受本次提交（输入框未清空，也没有新的回答）",
        retryable=True,
    )


def _submission_landed(page: Any, previous_messages: int, timeout_seconds: int | None = None) -> bool:
    deadline = time.monotonic() + (SUBMISSION_CONFIRM_TIMEOUT_SECONDS if timeout_seconds is None else timeout_seconds)
    while time.monotonic() < deadline:
        try:
            composer = _first_visible(page, "prompt_input")
            if composer is not None and not composer.inner_text().strip():
                return True
        except Exception:
            pass
        if _assistant_message_count(page) > previous_messages:
            return True
        if _first_visible(page, "stop_button") is not None:
            return True
        page.wait_for_timeout(400)
    return False


def _media_urls(page: Any, kind: str) -> list[str]:
    selector = "video" if kind == "video" else "img"
    return page.locator(selector).evaluate_all(
        "els => els.map(el => el.currentSrc || el.src || '')"
        ".filter(u => u && !u.startsWith('data:image/svg') && !u.includes('profile'))"
    )


def _page_failure_text(page: Any) -> str | None:
    try:
        text = page.locator("body").inner_text(timeout=2000).lower()
    except Exception:
        return None
    markers = (
        "couldn't generate", "unable to generate", "something went wrong", "try again",
        "无法生成", "生成失败", "出了点问题", "已达到上限", "quota",
    )
    return next((marker for marker in markers if marker in text), None)


# model-response 容器的第一行是无障碍标签（实测为「Gemini said」），不是回答内容。
# 不剥掉它，这行会被当成识别结果的一部分继续喂给下游生图提示词。
_RESPONSE_LABEL = re.compile(r"^\s*(gemini\s*said|gemini\s*说|gemini\s*回答)\s*[:：]?\s*", re.I)


def _latest_response_text(page: Any) -> str:
    locator = _assistant_messages(page)
    if locator is None:
        return ""
    try:
        return _RESPONSE_LABEL.sub("", str(locator.last.inner_text() or "")).strip()
    except Exception:
        return ""


def _wait_text_response(page: Any, previous_count: int, timeout_minutes: int) -> str:
    """等回答写完，而不是抓到第一个字就走。

    识图这类任务的价值全在完整段落里，取到流式输出的前几个字等于把结果截断。
    判定「写完了」用两个信号：正文连续 RESPONSE_STABLE_SECONDS 不变，且停止按钮消失。
    """
    deadline = time.monotonic() + timeout_minutes * 60
    last_text = ""
    stable_since = 0.0
    while time.monotonic() < deadline:
        if page.is_closed():
            raise GeminiWebError("BROWSER_CLOSED", "Gemini 回答期间浏览器已关闭", submitted=True)
        _throw_if_human_verification(page, scan_body=not last_text)
        text = _latest_response_text(page) if _assistant_message_count(page) > previous_count else ""
        if text and text != last_text:
            last_text = text
            stable_since = time.monotonic()
        streaming = _first_visible(page, "stop_button") is not None
        if last_text and not streaming and stable_since and time.monotonic() - stable_since >= RESPONSE_STABLE_SECONDS:
            return last_text
        if not last_text:
            failure = _page_failure_text(page)
            if failure:
                raise GeminiWebError("GENERATION_FAILED", f"Gemini 文本任务失败：{failure}", submitted=True)
        page.wait_for_timeout(450)
    # 超时就是超时：拿到一半的回答同样不能当结果返回。识图结论会被直接拼进下游生图
    # 提示词，截断的版本比明确失败更难排查 —— 上层还可以「从失败阶段重试」。
    raise GeminiWebError(
        "GENERATION_TIMEOUT",
        "Gemini 文本回答超时（回答已开始但迟迟没有写完）" if last_text else "Gemini 文本回答超时",
        submitted=True,
    )


def _wait_new_media(page: Any, kind: str, previous: set[str], timeout_minutes: int) -> str:
    deadline = time.monotonic() + timeout_minutes * 60
    page_errors = 0
    while time.monotonic() < deadline:
        if page.is_closed():
            raise GeminiWebError("BROWSER_CLOSED", "Gemini 生成期间浏览器已关闭", submitted=True)
        _throw_if_human_verification(page)
        try:
            urls = [url for url in _media_urls(page, kind) if url not in previous]
            page_errors = 0
        except Exception:
            page_errors += 1
            if page_errors >= 5:
                raise GeminiWebError("PAGE_NAVIGATION_FAILED", "Gemini 页面连续不可读", submitted=True)
            page.wait_for_timeout(1000)
            continue
        if urls:
            return urls[-1]
        failure = _page_failure_text(page)
        if failure:
            raise GeminiWebError("GENERATION_FAILED", f"Gemini 页面报告生成失败：{failure}", submitted=True)
        page.wait_for_timeout(1500)
    raise GeminiWebError("GENERATION_TIMEOUT", f"Gemini {kind} 生成超时", submitted=True)


def _download_media(page: Any, url: str, output_dir: Path, kind: str) -> str:
    output_dir.mkdir(parents=True, exist_ok=True)
    download_buttons = page.get_by_role(
        "button",
        name=re.compile(r"下载完整尺寸|下载原图|下载视频|download full size|download video|download", re.I),
    )
    try:
        visible_buttons = [
            download_buttons.nth(index)
            for index in range(download_buttons.count())
            if download_buttons.nth(index).is_visible()
        ]
        if visible_buttons:
            with page.expect_download(timeout=15_000) as download_info:
                visible_buttons[-1].click()
            download = download_info.value
            suffix = Path(download.suggested_filename or "").suffix
            extension = suffix if suffix else (".mp4" if kind == "video" else ".png")
            destination = output_dir / f"gemini_web_{kind}_{datetime.now().strftime('%Y%m%d_%H%M%S')}{extension}"
            download.save_as(str(destination))
            if destination.is_file() and destination.stat().st_size > 0:
                return str(destination)
    except Exception:
        # 页面没有可用下载按钮时回退到媒体原地址；下载按钮结构变化不能抹掉已生成结果。
        pass

    if url.startswith(("blob:", "data:")):
        data_url = page.evaluate(
            """async mediaUrl => {
                const response = await fetch(mediaUrl);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const blob = await response.blob();
                return await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = () => reject(reader.error);
                    reader.readAsDataURL(blob);
                });
            }""",
            url,
        )
        header, encoded = str(data_url).split(",", 1)
        content_type = header.split(";", 1)[0].replace("data:", "").lower()
        body = base64.b64decode(encoded)
        extension = ".webm" if "webm" in content_type else ".mp4" if kind == "video" else ".jpg" if "jpeg" in content_type else ".webp" if "webp" in content_type else ".png"
        destination = output_dir / f"gemini_web_{kind}_{datetime.now().strftime('%Y%m%d_%H%M%S')}{extension}"
        destination.write_bytes(body)
        if destination.stat().st_size == 0:
            raise GeminiWebError("DOWNLOAD_FAILED", "Gemini 下载结果为空", submitted=True)
        return str(destination)

    response = page.context.request.get(url, timeout=120_000)
    if not response.ok:
        raise GeminiWebError("DOWNLOAD_FAILED", f"Gemini 结果下载失败：HTTP {response.status}", submitted=True)
    content_type = str(response.headers.get("content-type", "")).lower()
    if kind == "video":
        extension = ".webm" if "webm" in content_type else ".mp4"
    else:
        extension = ".jpg" if "jpeg" in content_type else ".webp" if "webp" in content_type else ".png"
    destination = output_dir / f"gemini_web_{kind}_{datetime.now().strftime('%Y%m%d_%H%M%S')}{extension}"
    destination.write_bytes(response.body())
    if destination.stat().st_size == 0:
        raise GeminiWebError("DOWNLOAD_FAILED", "Gemini 下载结果为空", submitted=True)
    return str(destination)


def run_media_generation(
    *, kind: str, prompt: str, aspect_ratio: str, duration: int = 8,
    reference_images: list[str] | None = None, output_dir: str, timeout_minutes: int,
    camera_movement: str = "", native_audio: bool = True,
) -> tuple[str, str]:
    references = [Path(value).expanduser().resolve() for value in (reference_images or [])]
    maximum = MAX_VIDEO_REFERENCES if kind == "video" else MAX_IMAGE_REFERENCES
    if len(references) > maximum:
        raise GeminiWebError("REFERENCE_LIMIT_EXCEEDED", f"Gemini Web 当前最多支持 {maximum} 张参考图")
    if any(not path.is_file() for path in references):
        raise GeminiWebError("REFERENCE_IMAGE_NOT_FOUND", "Gemini 参考图不存在")
    final_prompt = build_video_prompt(prompt, aspect_ratio, duration, len(references), camera_movement=camera_movement, native_audio=native_audio) if kind == "video" else build_image_prompt(prompt, aspect_ratio, len(references))
    cdp_url, _, _, sync_playwright = _import_browser_runtime()
    submitted = False
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(cdp_url)
            context = browser.contexts[0] if browser.contexts else browser.new_context()
            with managed_work_page(context, f"gemini-web.{kind}", cleanup_before=True) as page:
                _ensure_authenticated(page)
                _select_creation_surface(page, kind)
                _wait_composer_ready(page)
                _upload_references(page, references)
                previous = set(_media_urls(page, kind))
                _submit(page, final_prompt)
                submitted = True
                url = _wait_new_media(page, kind, previous, timeout_minutes)
                return _download_media(page, url, Path(output_dir), kind), url
    except GeminiWebError as exc:
        if submitted:
            exc.submitted = True
        raise
    except Exception as exc:
        raise GeminiWebError("PAGE_NAVIGATION_FAILED", f"Gemini Web 页面自动化失败：{exc}", retryable=not submitted, submitted=submitted) from exc


def run_text_task(*, prompt: str, reference_images: list[str] | None = None, timeout_minutes: int = 5) -> str:
    references = [Path(value).expanduser().resolve() for value in (reference_images or [])]
    if len(references) > MAX_IMAGE_REFERENCES or any(not path.is_file() for path in references):
        raise GeminiWebError("REFERENCE_UPLOAD_FAILED", "Gemini 文本任务参考图无效或超过限制")
    cdp_url, _, _, sync_playwright = _import_browser_runtime()
    submitted = False
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(cdp_url)
            context = browser.contexts[0] if browser.contexts else browser.new_context()
            with managed_work_page(context, "gemini-web.text", cleanup_before=True) as page:
                _ensure_authenticated(page)
                _wait_composer_ready(page)
                _upload_references(page, references)
                previous_count = _assistant_message_count(page)
                _submit(page, str(prompt).strip())
                submitted = True
                return _wait_text_response(page, previous_count, timeout_minutes)
    except GeminiWebError as exc:
        if submitted:
            exc.submitted = True
        raise
    except Exception as exc:
        raise GeminiWebError("PAGE_NAVIGATION_FAILED", f"Gemini 文本任务页面异常：{exc}", retryable=not submitted, submitted=submitted) from exc
