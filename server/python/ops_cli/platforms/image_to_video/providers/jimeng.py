"""即梦（jimeng.jianying.com）Seedance 视频生成 provider（image-to-video 能力）。

通过可见的 9222 浏览器驱动即梦「视频生成」页面 UI，不调用未公开 API，也不读取或
持久化即梦的 cookie / token / storage。9222 浏览器运行时与产物下载复用
`ops_cli.platforms._google_flow_common` 中与站点无关的基座函数；页面 selector 与
交互流程全部是即梦自己的，不与 Google Flow 共用。

与 google-flow provider 的差异（决定了本文件不能照抄 Flow）：
- 即梦是「文字为主、参考素材可选」：可纯文生视频，也可挂最多 12 个参考素材。
- 比例 / 分辨率 / 生成数量在同一个弹层里，时长是滑杆 + 数字输入框。
- 生成数量只有会员模型（VIP 档）提供，非 VIP 模型该字段不存在。
- 一次可产出多条视频，故输出契约在 video_path/video_url 之外补 videos: [...]。
"""

from __future__ import annotations

import os
import re
import shutil
import tempfile
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from ops_cli.output import CommandResponse
from ops_cli.platforms._google_flow_common import (
    _bring_login_browser_to_front,
    _download_media,
    _import_browser_runtime,
)


JIMENG_SCENE = "jimeng/video_generate"
DEFAULT_GENERATE_URL = "https://jimeng.jianying.com/ai-tool/generate?type=video"
JIMENG_HOST = "jimeng.jianying.com"

# 默认走 VIP 通道：非 VIP 通道高峰期排队可到数小时，自动化任务几乎必然撞 timeout。
# 想省积分可显式传 --model "即梦 Seedance 2.0" 并调大 --timeout-minutes。
DEFAULT_MODEL = "即梦 Seedance 2.0 VIP"
SUPPORTED_ASPECT_RATIOS = ("21:9", "16:9", "4:3", "1:1", "3:4", "9:16")
SUPPORTED_RESOLUTIONS = ("720P", "1080P", "4K")
MIN_DURATION = 1
MAX_DURATION = 15
MIN_COUNT = 1
MAX_COUNT = 4
MAX_REFERENCE_IMAGES = 12
# 参考素材在即梦页面上的名字 = **上传文件的文件名**（实测：上传 图片1.png 后，
# 编辑器里 @ 出来的候选就叫「图片1」）。所以要让提示词里的 @xxx 指对素材，
# 唯一可靠的做法是把每个参考素材按调用方给的名字重命名后再上传。
DEFAULT_REFERENCE_NAME_PREFIX = "图片"
_UNSAFE_NAME_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')

# 页面 selector：即梦是 CSS Modules，类名带构建 hash（toolbar-button-sLXUh9），
# 因此一律用「稳定前缀 + arco(lv-) 基础类 + 文案」定位，不写死 hash 后缀。
PROMPT_EDITOR = 'div.tiptap[contenteditable="true"]'
TOOLBAR_SELECT = ".lv-select[class*='toolbar-select']"
TOOLBAR_BUTTON = "button[class*='toolbar-button']"
SUBMIT_BUTTON = "button[class*='submit-button']"
FILE_INPUT = "input[type=file]"

CREATION_TYPE_VIDEO = "视频生成"
REFERENCE_MODE_OMNI = "全能参考"
FIELD_ASPECT_RATIO = "选择比例"
FIELD_RESOLUTION = "选择分辨率"
FIELD_COUNT = "选择生成数量"

# 页面明确判负的文案；命中即不再空等到超时。
FAILURE_MARKERS = ("生成失败", "审核不通过", "内容不合规", "内容风险")
CREDITS_MARKERS = ("积分不足", "余额不足", "积分已用完")
# 生成中的占位卡片里也挂着 <video>（loading 动画是一个真实的静态 mp4），
# 不排掉的话等待循环会把它当成结果、秒「成功」并下载一段动画。真结果走 VOD 域名。
IGNORED_VIDEO_URL_PATTERNS = ("vlabstatic.com", "/static/", "loading", "placeholder")
# 排队提示：非 VIP 通道高峰期能排到数小时，超时报错时要把它带出去，
# 否则用户只会看到「超时」而不知道该换 VIP 模型还是稍后再来。
QUEUE_MARKERS = ("排队", "预计剩余")
MAX_CONSECUTIVE_PAGE_READ_ERRORS = 5


class JimengError(RuntimeError):
    """与 GoogleFlowError 同构；Ops-Cli 的错误分类按属性鸭子类型读取。"""

    def __init__(
        self,
        error_code: str,
        message: str,
        *,
        retryable: bool = False,
        recovery_hint: str | None = None,
    ) -> None:
        super().__init__(f"{error_code}：{message}")
        self.error_code = error_code
        self.retryable = retryable
        self.recovery_hint = recovery_hint


def _default_output_dir() -> Path:
    return Path.home() / "Desktop" / "即梦视频生成"


def _generate_url() -> str:
    return os.environ.get("JIMENG_GENERATE_URL", "").strip() or DEFAULT_GENERATE_URL


# ---------------------------------------------------------------------------
# 参数校验
# ---------------------------------------------------------------------------


def _validate_inputs(
    *,
    prompt: str,
    reference_images: list[str],
    duration: int,
    aspect_ratio: str,
    resolution: str,
    count: int,
    model: str,
    timeout_minutes: int,
) -> tuple[str, list[Path], str, str]:
    normalized_prompt = str(prompt or "").strip()
    if not normalized_prompt:
        raise JimengError("PROMPT_INPUT_NOT_FOUND", "--prompt 不能为空。")
    if not MIN_DURATION <= duration <= MAX_DURATION:
        raise JimengError("DURATION_NOT_SUPPORTED", f"--duration 只支持 {MIN_DURATION}-{MAX_DURATION} 秒。")
    if aspect_ratio not in SUPPORTED_ASPECT_RATIOS:
        raise JimengError(
            "ASPECT_RATIO_NOT_SUPPORTED", f"--aspect-ratio 只支持 {'、'.join(SUPPORTED_ASPECT_RATIOS)}。"
        )
    normalized_resolution = str(resolution or "").strip().upper()
    if normalized_resolution not in SUPPORTED_RESOLUTIONS:
        raise JimengError("RESOLUTION_NOT_SUPPORTED", f"--resolution 只支持 {'、'.join(SUPPORTED_RESOLUTIONS)}。")
    if not MIN_COUNT <= count <= MAX_COUNT:
        raise JimengError("COUNT_NOT_SUPPORTED", f"--count 只支持 {MIN_COUNT}-{MAX_COUNT}。")
    normalized_model = str(model or "").strip()
    if not normalized_model:
        raise JimengError("MODEL_NOT_FOUND", "--model 不能为空。")
    if timeout_minutes <= 0:
        raise JimengError("GENERATION_TIMEOUT", "--timeout-minutes 必须大于 0。")

    reference_paths: list[Path] = []
    for raw in reference_images or []:
        ref = Path(str(raw)).expanduser().resolve()
        if not ref.is_file():
            raise JimengError("REFERENCE_IMAGE_NOT_FOUND", f"参考素材不存在：{ref}")
        reference_paths.append(ref)
    if len(reference_paths) > MAX_REFERENCE_IMAGES:
        raise JimengError(
            "REFERENCE_IMAGE_ADD_FAILED", f"即梦最多支持 {MAX_REFERENCE_IMAGES} 个参考素材，当前 {len(reference_paths)} 个。"
        )
    return normalized_prompt, reference_paths, normalized_resolution, normalized_model


def _response_data(
    *,
    prompt: str,
    reference_images: list[Path],
    reference_names: list[str],
    mode: str,
    duration: int,
    aspect_ratio: str,
    resolution: str,
    count: int,
    model: str,
    output_dir: Path,
    dry_run: bool,
    execute: bool,
    videos: list[dict[str, Any]] | None = None,
    screenshot_path: str | None = None,
) -> dict[str, Any]:
    videos = videos or []
    primary = videos[0] if videos else {}
    video_path = primary.get("path")
    video_url = primary.get("url")
    return {
        "prompt": prompt,
        # 兼容能力级统一契约：图生视频消费者（ai画布 TwitCanva）只读 video_path /
        # video_url / screenshot_path，多条产出额外放在 videos 里，不改老字段语义。
        "first_frame": "",
        "reference_images": [str(ref) for ref in reference_images],
        # 每个参考素材在即梦页面上的名字（= 提示词里 @ 它时该写的字）。
        "reference_names": list(reference_names),
        "mode": mode,
        "duration": duration,
        "aspect_ratio": aspect_ratio,
        "resolution": resolution,
        "count": count,
        "model": model,
        "output_dir": str(output_dir),
        "dry_run": dry_run,
        "executed": execute and not dry_run,
        "video_path": video_path,
        "video_url": video_url,
        "videos": videos,
        "screenshot_path": screenshot_path,
        "source": "preview" if dry_run or not execute else "page",
        "scene": JIMENG_SCENE,
        "artifacts": [path for path in ([v.get("path") for v in videos] + [screenshot_path]) if path],
    }


# ---------------------------------------------------------------------------
# 页面交互
# ---------------------------------------------------------------------------


def _raise_auth_required(message: str) -> None:
    """登录失效走 Ops-Cli 统一 AUTH_REQUIRED 出口，并把 9222 浏览器切到前台。"""
    try:
        _bring_login_browser_to_front()
    except Exception:
        # 切前台只是辅助动作，不应覆盖真实的认证错误。
        pass
    raise JimengError(
        "AUTH_REQUIRED",
        message,
        retryable=True,
        recovery_hint="请在 9222 浏览器中登录 jimeng.jianying.com 后重试。",
    )


def _ensure_composer(page: Any, *, timeout_seconds: int = 90) -> None:
    """等待 composer（提示词输入框 + 工具条）挂载。

    冷启动时即梦前端要拉一大堆 chunk，编辑器迟迟不挂载并不等于掉登录——这正是
    google-flow 早高峰被误判 AUTH_REQUIRED 的老坑。因此只有 URL 明确跳到登录页
    才判 AUTH_REQUIRED，其余一律 EDITOR_NOT_READY（可重试）。
    """
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        current = (page.url or "").lower()
        if "login" in current or "passport" in current:
            _raise_auth_required("即梦已跳转到登录页，当前 9222 浏览器未登录即梦。")
        if JIMENG_HOST not in current:
            raise JimengError("PAGE_NAVIGATION_FAILED", f"页面已离开即梦域名：{page.url}", retryable=True)
        try:
            editor = page.locator(PROMPT_EDITOR)
            toolbar = page.locator(TOOLBAR_SELECT)
            if editor.count() >= 1 and editor.first.is_visible() and toolbar.count() >= 1:
                _dismiss_overlays(page)
                return
            # 编辑器没挂上、同时页面弹着登录框：这才是真掉登录（即梦有时不跳 URL，
            # 只弹扫码框）。其余情况仍按冷启动处理，宁可误判「加载慢」也不误报掉登录。
            if _login_dialog_visible(page):
                _raise_auth_required("即梦弹出了登录框，当前 9222 浏览器未登录即梦。")
        except JimengError:
            raise
        except Exception:
            pass
        page.wait_for_timeout(2000)
    raise JimengError(
        "EDITOR_NOT_READY",
        f"{timeout_seconds} 秒内即梦创作编辑器未挂载（多为冷启动加载慢），请稍后重试。",
        retryable=True,
    )


def _login_dialog_visible(page: Any) -> bool:
    try:
        dialog = page.locator(".lv-modal, [role=dialog]").filter(has_text="登录")
        return dialog.count() > 0 and dialog.first.is_visible()
    except Exception:
        return False


def _dismiss_overlays(page: Any) -> None:
    """关掉可能挡住 composer 的公告 / 引导弹层。

    长期跑的最大隐性杀手不是 selector 变了，而是某天页面弹了个活动公告，
    所有点击都落在遮罩上。best-effort：按一次 Escape，再点掉可见的关闭按钮。
    """
    try:
        if page.locator(".lv-modal, [role=dialog]").count() == 0:
            return
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
        close = page.locator(".lv-modal-close, [aria-label='Close'], [aria-label='关闭']")
        for index in range(min(close.count(), 3)):
            node = close.nth(index)
            if node.is_visible():
                node.click(timeout=3000)
                page.wait_for_timeout(400)
    except Exception:
        # 弹层清理是加固动作，失败不应影响主流程（真挡住了后续点击会自己报错）。
        pass


def _visible_select(page: Any, keyword: str, *, error_code: str, message: str) -> Any:
    """工具条上三个 lv-select（创作类型 / 模型 / 参考模式）按当前文案区分。"""
    selects = page.locator(TOOLBAR_SELECT)
    for index in range(selects.count()):
        node = selects.nth(index)
        try:
            if keyword in (node.inner_text() or ""):
                return node
        except Exception:
            continue
    raise JimengError(error_code, message)


def _option_entries(page: Any) -> list[dict[str, Any]]:
    """读取当前展开下拉里每个 option 的主标题、是否禁用，以及它在 li 列表中的下标。

    模型项是多行卡片（标题 + 描述），只取标题行；下标随后用于 Playwright 点击，
    因此必须与 `li.lv-select-option` 的 DOM 顺序一一对应。
    """
    return page.evaluate(
        """() => [...document.querySelectorAll('li.lv-select-option')].map((el, index) => {
             const label = el.querySelector('[class*="option-label-text"], [class*="option-label"]');
             const text = ((label ? label.innerText : el.innerText) || '').split('\\n')[0].trim();
             return {
               index,
               label: text,
               disabled: el.className.includes('disabled'),
               visible: el.getBoundingClientRect().height > 0,
             };
           })"""
    )


def _choose_option(page: Any, label: str, *, error_code: str) -> None:
    entries = [entry for entry in _option_entries(page) if entry["visible"]]
    match = next((entry for entry in entries if entry["label"] == label), None)
    if match is None:
        page.keyboard.press("Escape")
        available = "、".join(entry["label"] for entry in entries)
        raise JimengError(error_code, f"即梦页面未提供选项「{label}」，当前可选：{available}")
    if match["disabled"]:
        page.keyboard.press("Escape")
        raise JimengError(error_code, f"即梦页面上的「{label}」当前不可用（可能需要会员或已下线）。")
    page.locator("li.lv-select-option").nth(match["index"]).click()
    page.wait_for_timeout(600)


def _select_value(page: Any, *, keyword: str, label: str, error_code: str, message: str) -> None:
    node = _visible_select(page, keyword, error_code=error_code, message=message)
    if (node.inner_text() or "").strip() == label:
        return
    node.click()
    page.wait_for_timeout(700)
    _choose_option(page, label, error_code=error_code)


def _toolbar_button(page: Any, predicate) -> Any | None:
    buttons = page.locator(TOOLBAR_BUTTON)
    for index in range(buttons.count()):
        node = buttons.nth(index)
        try:
            if predicate((node.inner_text() or "").strip()):
                return node
        except Exception:
            continue
    return None


def _duration_button(page: Any) -> Any | None:
    return _toolbar_button(page, lambda text: text.endswith("s") and text[:-1].isdigit())


def _ratio_button(page: Any) -> Any | None:
    return _toolbar_button(page, lambda text: ":" in text)


def _pick_radio(page: Any, *, title: str, value: str, error_code: str, required: bool) -> None:
    """在比例/分辨率/数量弹层的某个分组里选中指定单选项。

    分组是否存在与模型档位有关（生成数量只有 VIP 档模型提供），因此 required=False
    时允许整组缺失。
    """
    field = page.locator(f".lv-popover [class*='field-']:has([class*='title-']:text-is('{title}'))")
    if field.count() == 0:
        if required:
            raise JimengError(error_code, f"即梦设置弹层里没有「{title}」分组。")
        raise JimengError(
            error_code,
            f"当前模型不提供「{title}」，无法设置为 {value}；请换用支持该项的模型（如 VIP 档）。",
        )
    radios = field.first.locator("label.lv-radio")
    labels = [(radios.nth(i).inner_text() or "").strip() for i in range(radios.count())]
    if value not in labels:
        raise JimengError(error_code, f"当前模型的「{title}」不提供 {value}，可选：{'、'.join(labels)}")
    radios.nth(labels.index(value)).click()
    page.wait_for_timeout(400)


def _configure_output(page: Any, *, aspect_ratio: str, resolution: str, count: int) -> None:
    button = _ratio_button(page)
    if button is None:
        raise JimengError("PAGE_NAVIGATION_FAILED", "未找到比例/分辨率/数量设置按钮。")
    button.click()
    page.wait_for_timeout(800)
    try:
        _pick_radio(page, title=FIELD_ASPECT_RATIO, value=aspect_ratio, error_code="ASPECT_RATIO_NOT_SUPPORTED", required=True)
        _pick_radio(page, title=FIELD_RESOLUTION, value=resolution, error_code="RESOLUTION_NOT_SUPPORTED", required=True)
        # 数量必须**显式写**，不能因为 count==1 就不管：即梦会记住上一次的选择，
        # 页面留着 2 而我们只等 1 条，结果是多扣一份积分、还漏收一条产出。
        # 只有「该模型根本没有数量选项」（非 VIP 档）且我们要的就是 1 条时才允许跳过。
        count_field = page.locator(f".lv-popover [class*='field-']:has([class*='title-']:text-is('{FIELD_COUNT}'))")
        if count_field.count() > 0 or count > 1:
            _pick_radio(page, title=FIELD_COUNT, value=str(count), error_code="COUNT_NOT_SUPPORTED", required=False)
    finally:
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)


def _configure_duration(page: Any, duration: int) -> None:
    button = _duration_button(page)
    if button is None:
        raise JimengError("DURATION_NOT_SUPPORTED", "未找到时长设置按钮。")
    button.click()
    page.wait_for_timeout(800)
    box = page.locator(".lv-popover input.lv-input")
    if box.count() == 0:
        page.keyboard.press("Escape")
        raise JimengError("DURATION_NOT_SUPPORTED", "未找到时长输入框。")
    allowed = box.first.get_attribute("placeholder") or ""
    box.first.fill(str(duration))
    page.keyboard.press("Enter")
    page.wait_for_timeout(800)
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    # 页面会把越界值夹回可用区间，因此必须回读确认，不能只管写。
    applied = _duration_button(page)
    applied_text = (applied.inner_text() or "").strip() if applied is not None else ""
    if applied_text != f"{duration}s":
        raise JimengError(
            "DURATION_NOT_SUPPORTED",
            f"当前模型未接受时长 {duration}s（页面回读为 {applied_text or '未知'}，允许范围 {allowed or '见页面'}）。",
        )


# composer 根节点 = 提示词编辑器往上第一个「含有文件上传 input」的祖先。
# 用它把参考素材缩略图的统计范围锁死在输入框内，避免把左侧会话列表 / 历史记录卡片
# 里的图算进来。
_COMPOSER_IMAGE_COUNT_JS = """() => {
  const editor = document.querySelector('div.tiptap[contenteditable="true"]');
  if (!editor) return -1;
  let node = editor;
  while (node && !(node.querySelector && node.querySelector('input[type=file]'))) {
    node = node.parentElement;
  }
  if (!node) return -1;
  return [...node.querySelectorAll('img')]
    .filter(el => el.getBoundingClientRect().height > 0).length;
}"""


def _composer_image_count(page: Any) -> int:
    try:
        return int(page.evaluate(_COMPOSER_IMAGE_COUNT_JS))
    except Exception:
        return -1


def _safe_reference_name(raw: str, fallback: str) -> str:
    """把调用方给的素材名收敛成一个安全文件名（它会成为页面上的素材标签）。"""
    name = _UNSAFE_NAME_CHARS.sub("", str(raw or "").strip()).strip(". ")
    name = re.sub(r"\s+", "", name)
    return name[:40] or fallback


def _resolve_reference_names(reference_paths: list[Path], reference_names: list[str] | None) -> list[str]:
    """产出与参考素材一一对应、且互不重名的页面标签。

    没给名字就退回即梦自己的约定「图片1、图片2…」（页面占位符写的就是 @图片1）。
    重名会让 @ 指代歧义，这里加数字后缀强制区分，并把最终标签回传给调用方校验。
    """
    names = list(reference_names or [])
    if names and len(names) != len(reference_paths):
        raise JimengError(
            "REFERENCE_IMAGE_ADD_FAILED",
            f"--reference-name 数量（{len(names)}）与 --reference-image 数量（{len(reference_paths)}）不一致。",
        )
    resolved: list[str] = []
    used: dict[str, int] = {}
    for index in range(len(reference_paths)):
        fallback = f"{DEFAULT_REFERENCE_NAME_PREFIX}{index + 1}"
        name = _safe_reference_name(names[index] if names else "", fallback)
        if name in used:
            used[name] += 1
            name = f"{name}_{used[name]}"
        else:
            used[name] = 1
        resolved.append(name)
    return resolved


def _reference_option_labels(page: Any) -> list[str]:
    """打开 @ 浮层，读出页面当前认得的参考素材名（顺序即编号顺序）。"""
    editor = page.locator(PROMPT_EDITOR).first
    editor.click()
    page.keyboard.type("@")
    page.wait_for_timeout(2500)
    options = page.locator("li.lv-select-option")
    labels: list[str] = []
    for index in range(options.count()):
        node = options.nth(index)
        try:
            if not node.is_visible():
                continue
            text = (node.inner_text() or "").strip()
        except Exception:
            continue
        # 「创建主体」是浮层里的操作项，不是素材。
        if text and text != "创建主体":
            labels.append(text)
    # 清掉刚输入的 @，否则它会留在提示词里。
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    page.keyboard.press("Backspace")
    page.wait_for_timeout(500)
    return labels


def _attach_reference_images(page: Any, reference_paths: list[Path], reference_names: list[str]) -> None:
    """逐个上传参考素材，并在提交前核对页面上的素材名与顺序。

    必须**逐个**上传而不是一次 set_input_files 多文件：素材编号取决于页面收到它们的
    先后，一次多传的完成顺序不受控，一旦错位，提示词里的 @参考图2 就会指到别的图。
    """
    if not reference_paths:
        return
    file_input = page.locator(FILE_INPUT)
    if file_input.count() == 0:
        raise JimengError("REFERENCE_IMAGE_ADD_FAILED", "未找到参考素材上传入口。")

    with tempfile.TemporaryDirectory(prefix="jimeng_refs_") as staging_root:
        staging = Path(staging_root)
        for index, (path, name) in enumerate(zip(reference_paths, reference_names), start=1):
            # 页面用文件名当素材标签，所以按调用方的命名复制一份再传。
            staged = staging / f"{name}{path.suffix.lower()}"
            shutil.copyfile(path, staged)
            baseline = max(_composer_image_count(page), 0)
            try:
                file_input.first.set_input_files(str(staged))
            except Exception as exc:
                raise JimengError(
                    "REFERENCE_IMAGE_ADD_FAILED", f"上传参考素材「{name}」失败：{exc}", retryable=True
                ) from exc
            deadline = time.monotonic() + 180
            while time.monotonic() < deadline:
                if _composer_image_count(page) > baseline:
                    break
                page.wait_for_timeout(2000)
            else:
                raise JimengError(
                    "REFERENCE_IMAGE_ADD_FAILED",
                    f"参考素材「{name}」（第 {index} 个）3 分钟内未上传完成。",
                    retryable=True,
                )

    labels = _reference_option_labels(page)
    if labels != reference_names:
        raise JimengError(
            "REFERENCE_NAME_MISMATCH",
            "参考素材在即梦页面上的名字/顺序与预期不一致，已中止提交（未消耗积分）。"
            f"预期 {reference_names}，页面实际 {labels}；提示词里的 @xxx 会指错素材。",
            retryable=True,
        )


def _fill_prompt(page: Any, prompt: str) -> None:
    editor = page.locator(PROMPT_EDITOR).first
    if editor.count() == 0:
        raise JimengError("PROMPT_INPUT_NOT_FOUND", "未找到提示词输入框。")
    editor.click()
    # tiptap/ProseMirror 富文本不接受 fill()。也**不能**用 keyboard.type：提示词里
    # 一个 @ 就会触发即梦的「参考内容」mention 浮层，后面的字会被浮层吞掉或变成
    # 一个错误的引用。insert_text 直接走 CDP 文本插入，不产生按键事件。
    page.keyboard.press("ControlOrMeta+a")
    page.keyboard.press("Backspace")
    page.keyboard.insert_text(prompt)
    page.wait_for_timeout(800)
    # 回读校验：提示词没完整落进编辑器就提交，等于花积分生成一个错的视频。
    typed = (editor.inner_text() or "").replace("\n", "").strip()
    expected = prompt.replace("\n", "").strip()
    if expected not in typed:
        raise JimengError(
            "PROMPT_INPUT_NOT_FOUND",
            f"提示词未能完整写入编辑器（页面回读：{typed[:60]}…），已中止提交，未消耗积分。",
            retryable=True,
        )


def _submit(page: Any) -> None:
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        buttons = page.locator(SUBMIT_BUTTON)
        for index in range(buttons.count()):
            node = buttons.nth(index)
            try:
                if node.is_visible() and node.is_enabled():
                    node.click()
                    return
            except Exception:
                continue
        page.wait_for_timeout(2000)
    raise JimengError("GENERATE_BUTTON_NOT_FOUND", "生成按钮长时间不可用，请检查提示词与参考素材。")


def _video_urls(page: Any) -> list[str]:
    """只收 http(s) 的**结果**地址。

    过滤两类非结果：播放过程中的 blob: 地址，以及生成中占位卡片里的 loading 动画
    静态 mp4（域名 vlabstatic.com / 路径含 /static/）。
    """
    urls = page.locator("video").evaluate_all(
        "els => els.map(el => el.currentSrc || el.src || '').filter(src => src.startsWith('http'))"
    )
    return [url for url in urls if not any(pattern in url for pattern in IGNORED_VIDEO_URL_PATTERNS)]


def _result_area_text(page: Any) -> str:
    """读结果区文案用于判负 / 判排队。

    刻意不读整个 body：左侧会话列表里全是用户自己起的会话标题，一个叫
    「生成失败复盘」的历史会话就能让整轮等待被误判成生成失败。
    """
    area = page.locator("[class*='record-list']")
    if area.count() > 0:
        return area.first.inner_text(timeout=5000)
    return page.locator("body").inner_text(timeout=5000)


def _queue_hint(page_text: str) -> str:
    """从页面里摘出排队提示行，用于超时报错时给出可执行的下一步。"""
    if not all(marker in page_text for marker in QUEUE_MARKERS):
        return ""
    for line in page_text.splitlines():
        if "排队" in line or "预计剩余" in line:
            return line.strip()
    return "页面显示正在排队"


def _wait_for_videos(
    page: Any, *, previous_urls: set[str], expected: int, timeout_minutes: int
) -> list[str]:
    deadline = time.monotonic() + timeout_minutes * 60
    consecutive_read_errors = 0
    queue_hint = ""
    # 结果区是虚拟滚动列表，早出的结果可能在后面的结果渲染时被卸载出 DOM。
    # 因此必须**跨轮累积**，不能要求 N 条同时在场，否则多条任务会空等到超时。
    collected: list[str] = []
    while time.monotonic() < deadline:
        try:
            page_text = _result_area_text(page)
            queue_hint = _queue_hint(page_text) or queue_hint
            for marker in CREDITS_MARKERS:
                if marker in page_text:
                    raise JimengError("JIMENG_CREDITS_INSUFFICIENT", f"即梦积分不足（页面提示：{marker}）。")
            for marker in FAILURE_MARKERS:
                if marker in page_text:
                    raise JimengError(
                        "JIMENG_GENERATION_FAILED",
                        f"即梦已明确返回生成失败（页面提示：{marker}），请调整提示词后重试。",
                        retryable=True,
                    )
            for url in _video_urls(page):
                if url not in previous_urls and url not in collected:
                    collected.append(url)
            if len(collected) >= expected:
                return collected[:expected]
            consecutive_read_errors = 0
            page.wait_for_timeout(3000)
        except JimengError:
            raise
        except Exception as exc:
            # 单次 DOM 读取抖动不应中断长任务（中断会导致重复提交、重复扣积分）。
            consecutive_read_errors += 1
            if consecutive_read_errors >= MAX_CONSECUTIVE_PAGE_READ_ERRORS:
                raise JimengError(
                    "PAGE_NAVIGATION_FAILED",
                    f"生成期间连续 {consecutive_read_errors} 次读取即梦页面失败：{exc}",
                    retryable=True,
                ) from exc
            time.sleep(2)
    message = f"等待即梦生成超过 {timeout_minutes} 分钟。"
    if queue_hint:
        message += (
            f"页面提示：{queue_hint}。非 VIP 通道高峰期排队可达数小时，"
            "可改用 VIP 档模型（--model \"即梦 Seedance 2.0 VIP\"）或调大 --timeout-minutes；"
            "任务已提交，稍后可在即梦历史会话里取回结果。"
        )
    raise JimengError("GENERATION_TIMEOUT", message, retryable=True)


def _execute_generation(
    *,
    prompt: str,
    reference_paths: list[Path],
    reference_names: list[str],
    duration: int,
    aspect_ratio: str,
    resolution: str,
    count: int,
    model: str,
    output_dir: Path,
    timeout_minutes: int,
) -> tuple[list[dict[str, Any]], str]:
    cdp_url, PlaywrightError, PlaywrightTimeoutError, sync_playwright = _import_browser_runtime()
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.connect_over_cdp(cdp_url)
            context = browser.contexts[0] if browser.contexts else browser.new_context()
            # 每次生成独占一个新标签页（= 一个新对话），不抢用户正在编辑的会话；
            # 会话本身由即梦服务端保存，关掉标签页不丢结果。
            page = context.new_page()
            try:
                try:
                    page.goto(_generate_url(), wait_until="domcontentloaded", timeout=60_000)
                except (PlaywrightError, PlaywrightTimeoutError) as exc:
                    raise JimengError("PAGE_NAVIGATION_FAILED", f"打开即梦创作页失败：{exc}", retryable=True) from exc
                _ensure_composer(page)

                _select_value(
                    page,
                    keyword="生成",
                    label=CREATION_TYPE_VIDEO,
                    error_code="PAGE_NAVIGATION_FAILED",
                    message="未找到创作类型下拉框。",
                )
                _select_value(
                    page,
                    keyword="即梦",
                    label=model,
                    error_code="MODEL_NOT_FOUND",
                    message="未找到模型下拉框。",
                )
                _select_value(
                    page,
                    keyword="参考",
                    label=REFERENCE_MODE_OMNI,
                    error_code="PAGE_NAVIGATION_FAILED",
                    message="未找到参考模式下拉框。",
                )
                _configure_output(page, aspect_ratio=aspect_ratio, resolution=resolution, count=count)
                _configure_duration(page, duration)
                _attach_reference_images(page, reference_paths, reference_names)
                _fill_prompt(page, prompt)

                previous_urls = set(_video_urls(page))
                _submit(page)
                video_urls = _wait_for_videos(
                    page, previous_urls=previous_urls, expected=count, timeout_minutes=timeout_minutes
                )

                stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                screenshot_path = output_dir / f"jimeng_{stamp}.png"
                page.screenshot(path=str(screenshot_path), full_page=False, timeout=30_000)
                videos: list[dict[str, Any]] = []
                for index, url in enumerate(video_urls, start=1):
                    saved = _download_media(
                        page, url, output_dir, f"{stamp}_{index}", prefix="jimeng_", default_ext=".mp4"
                    )
                    videos.append({"path": saved, "url": url})
                if not any(item["path"] for item in videos):
                    raise JimengError(
                        "VIDEO_DOWNLOAD_FAILED",
                        "生成完成，但视频均未能保存到本地；请检查输出目录权限或稍后重试。",
                        retryable=True,
                    )
                return videos, str(screenshot_path)
            finally:
                try:
                    if not page.is_closed():
                        page.close()
                except Exception:
                    pass
    except JimengError:
        raise
    except Exception as exc:
        raise JimengError("PAGE_NAVIGATION_FAILED", f"即梦页面自动化失败：{exc}", retryable=True) from exc


def run_video_generate(
    *,
    prompt: str,
    reference_images: list[str] | None = None,
    reference_names: list[str] | None = None,
    duration: int = 5,
    aspect_ratio: str = "16:9",
    resolution: str = "720P",
    count: int = 1,
    model: str = DEFAULT_MODEL,
    output_dir: str | None = None,
    timeout_minutes: int = 15,
    dry_run: bool = False,
    execute: bool = False,
) -> CommandResponse:
    normalized_prompt, reference_paths, normalized_resolution, normalized_model = _validate_inputs(
        prompt=prompt,
        reference_images=reference_images or [],
        duration=duration,
        aspect_ratio=aspect_ratio,
        resolution=resolution,
        count=count,
        model=model,
        timeout_minutes=timeout_minutes,
    )
    resolved_names = _resolve_reference_names(reference_paths, reference_names)
    mode = "reference" if reference_paths else "text"
    resolved_output_dir = Path(output_dir).expanduser().resolve() if output_dir else _default_output_dir()

    if dry_run or not execute:
        return CommandResponse(
            success=True,
            platform="jimeng",
            command="image-to-video generate",
            data=_response_data(
                prompt=normalized_prompt,
                reference_images=reference_paths,
                reference_names=resolved_names,
                mode=mode,
                duration=duration,
                aspect_ratio=aspect_ratio,
                resolution=normalized_resolution,
                count=count,
                model=normalized_model,
                output_dir=resolved_output_dir,
                dry_run=dry_run,
                execute=False,
            ),
        )

    videos, screenshot_path = _execute_generation(
        prompt=normalized_prompt,
        reference_paths=reference_paths,
        reference_names=resolved_names,
        duration=duration,
        aspect_ratio=aspect_ratio,
        resolution=normalized_resolution,
        count=count,
        model=normalized_model,
        output_dir=resolved_output_dir,
        timeout_minutes=timeout_minutes,
    )
    return CommandResponse(
        success=True,
        platform="jimeng",
        command="image-to-video generate",
        data=_response_data(
            prompt=normalized_prompt,
            reference_images=reference_paths,
            reference_names=resolved_names,
            mode=mode,
            duration=duration,
            aspect_ratio=aspect_ratio,
            resolution=normalized_resolution,
            count=count,
            model=normalized_model,
            output_dir=resolved_output_dir,
            dry_run=False,
            execute=True,
            videos=videos,
            screenshot_path=screenshot_path,
        ),
    )
