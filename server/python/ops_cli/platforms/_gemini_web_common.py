"""Gemini Apps 网页自动化公共 Provider。

只驱动 gemini.google.com 的公开 UI；不读取 Cookie/Token，不调用内部生成 API。
选择器、登录探针、上传、提交、等待和下载都集中在这里，React 不包含第三方 DOM 逻辑。
"""

from __future__ import annotations

import re
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


def _single_visible(candidates: list[Any], code: str, message: str) -> Any:
    for locator in candidates:
        try:
            visible = [locator.nth(index) for index in range(locator.count()) if locator.nth(index).is_visible()]
            if len(visible) == 1:
                return visible[0]
        except Exception:
            continue
    raise GeminiWebError(code, message)


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


def _upload_references(page: Any, paths: list[Path]) -> None:
    if not paths:
        return
    inputs = page.locator('input[type="file"]')
    if inputs.count():
        inputs.nth(inputs.count() - 1).set_input_files([str(path) for path in paths])
    else:
        upload = _single_visible([
            page.get_by_role("button", name=re.compile(r"上传和工具|upload and tools|add files?|upload", re.I)),
            page.locator('button[aria-label*="上传"],button[aria-label*="upload" i]'),
        ], "REFERENCE_UPLOAD_FAILED", "未找到 Gemini 上传入口")
        upload.click()
        page.wait_for_timeout(350)
        file_item = _single_visible([
            page.get_by_role("menuitem", name=re.compile(r"上传文件|upload files?", re.I)),
            page.get_by_text(re.compile(r"上传文件|upload files?", re.I)),
        ], "REFERENCE_UPLOAD_FAILED", "未找到 Gemini 上传文件菜单")
        with page.expect_file_chooser(timeout=10_000) as chooser:
            file_item.click()
        chooser.value.set_files([str(path) for path in paths])
    page.wait_for_timeout(1000)


def _composer(page: Any) -> Any:
    return _single_visible([
        page.locator('[role="textbox"][contenteditable="true"][aria-label]'),
        page.locator('[role="textbox"][contenteditable="true"]'),
        page.locator('textarea[placeholder]'),
    ], "PROMPT_INPUT_NOT_FOUND", "未找到 Gemini 提示词输入框")


def _submit(page: Any, prompt: str) -> None:
    box = _composer(page)
    box.fill(prompt)
    submit = None
    for locator in (
        page.get_by_role("button", name=re.compile(r"提交|发送|submit|send", re.I)),
        page.locator('button[aria-label*="提交"],button[aria-label*="发送"],button[aria-label*="submit" i],button[aria-label*="send" i]'),
    ):
        try:
            visible = [locator.nth(index) for index in range(locator.count()) if locator.nth(index).is_visible() and locator.nth(index).is_enabled()]
            if len(visible) == 1:
                submit = visible[0]
                break
        except Exception:
            continue
    if submit is not None:
        submit.click()
    else:
        box.press("Enter")


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


def _wait_new_media(page: Any, kind: str, previous: set[str], timeout_minutes: int) -> str:
    deadline = time.monotonic() + timeout_minutes * 60
    page_errors = 0
    while time.monotonic() < deadline:
        if page.is_closed():
            raise GeminiWebError("BROWSER_CLOSED", "Gemini 生成期间浏览器已关闭", submitted=True)
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
                _upload_references(page, references)
                responses = page.locator('[data-message-author-role="model"],model-response,message-content')
                previous_count = responses.count()
                _submit(page, str(prompt).strip())
                submitted = True
                deadline = time.monotonic() + timeout_minutes * 60
                while time.monotonic() < deadline:
                    count = responses.count()
                    if count > previous_count:
                        text = responses.nth(count - 1).inner_text().strip()
                        if text:
                            return text
                    failure = _page_failure_text(page)
                    if failure:
                        raise GeminiWebError("GENERATION_FAILED", f"Gemini 文本任务失败：{failure}", submitted=True)
                    page.wait_for_timeout(1000)
                raise GeminiWebError("GENERATION_TIMEOUT", "Gemini 文本回答超时", submitted=True)
    except GeminiWebError as exc:
        if submitted:
            exc.submitted = True
        raise
    except Exception as exc:
        raise GeminiWebError("PAGE_NAVIGATION_FAILED", f"Gemini 文本任务页面异常：{exc}", retryable=not submitted, submitted=submitted) from exc
