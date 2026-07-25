"""Google Flow 浏览器公共基座（多能力共享）。

image-to-video 与 text-to-image 两个能力都通过内置浏览器驱动 Google Flow
页面 UI，共享同一套浏览器生命周期、登录/恢复、页面接管与结果等待逻辑。本模块只放
「与结果类型无关」的通用部分；结果类型相关的配置/采集/等待入口由各 provider 自带。

严禁在此调用未公开的生成 API，也不读取或持久化 Google 的 cookie / token / storage。
"""

from __future__ import annotations

import mimetypes
import re
import sys
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

from ops_cli.browser import managed_work_page
from ops_cli.config import get_config


GOOGLE_FLOW_HOME_URL = "https://labs.google/fx/tools/flow?hl=en"
FLOW_FAILURE_MARKERS = (
    # Flow 失败卡通常同时含这两句；用 max(任一命中) 做 OR 判定，兼容 Flow 改写
    # 其中一句。前提假设：这两句只出现在「已失败」的卡片上。若日后确认
    # "taking longer than expected" 也会作为「慢生成进度提示」出现在仍在跑的
    # 任务上，则应改成只认无歧义的第二句，否则会把慢但会成功的生成误判为失败。
    "the generation might be taking longer than expected",
    "you will not be charged for failed generations",
)
# 生成等待期间允许的最大连续「页面读取失败」次数。单次 body/inner_text 抖动或
# DOM 短暂不可读不应重启整个生成（会二次提交、重复扣费/产出重复结果），只有连续
# 多次读取失败才判定页面异常。
MAX_CONSECUTIVE_PAGE_READ_ERRORS = 5


class GoogleFlowError(RuntimeError):
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


def _is_flow_project_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
    except ValueError:
        return False
    return (
        parsed.scheme == "https"
        and (parsed.hostname or "").lower() == "labs.google"
        and parsed.path.startswith("/fx/tools/flow/project/")
    )


def _is_flow_home_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
    except ValueError:
        return False
    return (
        parsed.scheme == "https"
        and (parsed.hostname or "").lower() == "labs.google"
        and parsed.path.rstrip("/") == "/fx/tools/flow"
    )


def _resolve_project_url(context: Any) -> str:
    """解析本次生成使用的 Flow 项目地址。

    本机显式配置优先；其次复用内置浏览器已经打开的 Flow 项目；新账号或
    没有现成项目页时回到 Flow 首页，由 `_ensure_editor` 自动进入或创建项目。
    """
    import os

    configured = os.environ.get("GOOGLE_FLOW_PROJECT_URL", "").strip()
    if configured:
        if not _is_flow_project_url(configured):
            raise GoogleFlowError(
                "PAGE_NAVIGATION_FAILED",
                "GOOGLE_FLOW_PROJECT_URL 不是有效的 Google Flow 项目地址。",
            )
        return configured

    for existing_page in reversed(getattr(context, "pages", [])):
        candidate = str(getattr(existing_page, "url", "") or "")
        if _is_flow_project_url(candidate):
            return candidate
    return GOOGLE_FLOW_HOME_URL


_NEW_PROJECT_LABEL = re.compile(
    r"new\s+project|新建项目|建立新專案|新增專案|新しいプロジェクト|새\s*프로젝트",
    re.IGNORECASE,
)


def _enter_or_create_project(page: Any) -> bool:
    """Enter an existing project or create one from the Flow home page.

    Project URLs are account-specific, so a bundled fixed UUID cannot work for
    a new user's account. Prefer an existing project link; otherwise click the
    localized New Project control. Language matching is only a fallback—the
    resulting `/project/<id>` URL is the authoritative success signal.
    """
    try:
        project_links = page.locator('a[href*="/fx/tools/flow/project/"]')
        for index in range(project_links.count()):
            candidate = project_links.nth(index)
            if candidate.is_visible():
                candidate.click()
                page.wait_for_url(re.compile(r"/fx/tools/flow/project/"), timeout=60_000)
                return True
    except Exception:
        pass

    for role in ("button", "link"):
        try:
            controls = page.get_by_role(role).filter(has_text=_NEW_PROJECT_LABEL)
            for index in range(controls.count()):
                candidate = controls.nth(index)
                if candidate.is_visible():
                    candidate.click()
                    page.wait_for_url(re.compile(r"/fx/tools/flow/project/"), timeout=60_000)
                    return True
        except Exception:
            continue
    return False


def _existing_project_page(context: Any, project_url: str) -> Any | None:
    for page in reversed(list(getattr(context, "pages", []) or [])):
        try:
            if not page.is_closed() and page.url == project_url:
                return page
        except Exception:
            continue
    return None


@contextmanager
def _project_work_page(context: Any, project_url: str, owner: str = "google-flow.generate"):
    """复用长期运行浏览器中的 Flow 项目页；仅在缺失时创建临时页。"""
    existing = _existing_project_page(context, project_url)
    if existing is not None:
        yield existing
        return
    with managed_work_page(context, owner) as page:
        yield page


def _wait_cdp_stable(*, required_consecutive: int = 3, timeout_seconds: float = 25.0, poll_interval: float = 0.5) -> None:
    """连上前确认 19222 CDP 稳定响应，吸收冷启动 / 无头↔有头重启窗口。

    start_chrome 只等 CDP 首次响应即返回；但无头↔有头切换、单例锁重启会让端口
    「先通后断」，此刻若立即 goto，会落在半死的上下文上导致编辑器永远等不到（历史上
    早高峰冷启动被误判成 AUTH_REQUIRED 的元凶之一）。这里要求连续多次 check_cdp 成功
    才放行。**仅 google-flow 能力使用，不改动 start_chrome，不影响其它平台启动路径。**
    就绪探测是加固项：探测本身失败或超时都不在此抛错，交由后续 goto/_ensure_editor
    走可重试错误。
    """
    sessionhub_root = Path(get_config().sessionhub_root).expanduser().resolve()
    if str(sessionhub_root) not in sys.path:
        sys.path.insert(0, str(sessionhub_root))
    try:
        from scene.chrome_cdp import check_cdp  # type: ignore
    except Exception:
        return
    deadline = time.monotonic() + timeout_seconds
    consecutive = 0
    while time.monotonic() < deadline:
        ok = False
        try:
            ok, _ = check_cdp()
        except Exception:
            ok = False
        if ok:
            consecutive += 1
            if consecutive >= required_consecutive:
                return
        else:
            consecutive = 0
        time.sleep(poll_interval)


def _import_browser_runtime():
    sessionhub_root = Path(get_config().sessionhub_root).expanduser().resolve()
    if str(sessionhub_root) not in sys.path:
        sys.path.insert(0, str(sessionhub_root))
    try:
        from scene.chrome_cdp import CDP_URL, start_chrome  # type: ignore
    except Exception as exc:  # pragma: no cover - environment guard
        raise GoogleFlowError("PAGE_NAVIGATION_FAILED", f"无法加载内置浏览器运行时：{exc}", retryable=True) from exc
    # All automated Flow/Jimeng generation runs are explicitly headless. This
    # also replaces a browser that the user previously opened for login/debug
    # with a headless instance using the same persistent profile, so a later
    # generation never reuses a visible window and steals focus.
    ok, message = start_chrome(headless=True)
    if not ok:
        raise GoogleFlowError("PAGE_NAVIGATION_FAILED", message, retryable=True)
    # start_chrome 只保证 CDP 首次响应；冷启动 / 无头↔有头重启期端口会抖动，
    # 连上前再等 CDP 稳定，避免 goto 落在半死上下文。best-effort，不阻断主流程。
    _wait_cdp_stable()
    try:
        from playwright.sync_api import Error as PlaywrightError  # type: ignore
        from playwright.sync_api import TimeoutError as PlaywrightTimeoutError  # type: ignore
        from playwright.sync_api import sync_playwright  # type: ignore
    except ModuleNotFoundError as exc:  # pragma: no cover - environment guard
        raise GoogleFlowError("PAGE_NAVIGATION_FAILED", "缺少 Playwright 依赖。", retryable=False) from exc
    return CDP_URL, PlaywrightError, PlaywrightTimeoutError, sync_playwright


def _exact_count(locator: Any, error_code: str, message: str) -> Any:
    count = locator.count()
    if count == 1:
        return locator
    visible: list[Any] = []
    for index in range(count):
        node = locator.nth(index)
        try:
            if node.is_visible():
                visible.append(node)
        except Exception:
            continue
    if len(visible) == 1:
        return visible[0]
    raise GoogleFlowError(error_code, message)


def _locator_visible(locator: Any) -> bool:
    try:
        count = locator.count()
        for index in range(count):
            node = locator if count == 1 else locator.nth(index)
            try:
                if node.is_visible():
                    return True
            except Exception:
                continue
        return False
    except Exception:
        return False


def _close_settings_menu(page: Any, menu: Any, trigger: Any) -> None:
    """收起 Flow 设置菜单，并验证它不再遮挡 composer。

    第三方页面的菜单在切换模型/比例后可能保留。只发一个 Escape 没有成功判据，
    会把遮挡问题推迟到上传或提交步骤才报一个误导性的 click timeout。
    """
    for _ in range(3):
        if not _locator_visible(menu):
            return
        page.keyboard.press("Escape")
        page.wait_for_timeout(250)

    if _locator_visible(menu):
        try:
            trigger.click(force=True, timeout=3000)
        except Exception:
            trigger.evaluate("(element) => element.click()")
        page.wait_for_timeout(500)

    if _locator_visible(menu):
        raise GoogleFlowError(
            "PAGE_NAVIGATION_FAILED",
            "Google Flow 参数设置菜单未能关闭，已中止提交；请稍后重试。",
            retryable=True,
        )


def _bring_login_browser_to_front() -> None:
    sessionhub_root = Path(get_config().sessionhub_root).expanduser().resolve()
    if str(sessionhub_root) not in sys.path:
        sys.path.insert(0, str(sessionhub_root))
    from scene.chrome_cdp import foreground_allowed, start_chrome  # type: ignore

    # Server/workflow subprocesses have no interactive TTY: report
    # AUTH_REQUIRED to the canvas without surfacing a window. Direct
    # interactive CLI recovery (or an explicit force flag) may still show it.
    # The app's "打开内置浏览器/登录" commands remain explicitly foregrounded.
    if foreground_allowed():
        start_chrome(foreground=True)


def _raise_auth_required(message: str, recovery_hint: str) -> None:
    """Google Flow 登录失效时走 Ops-Cli 统一认证出口。

    交互终端可把同一个 19222 长期浏览器切到前台；workflow、定时任务
    和 Evan 服务端只返回结构化 AUTH_REQUIRED，必须由用户主动点击
    「打开内置浏览器/登录」后才显示窗口。
    """
    try:
        _bring_login_browser_to_front()
    except Exception:
        # 切前台只是辅助动作，不应覆盖真实的认证错误。
        pass
    raise GoogleFlowError(
        "AUTH_REQUIRED",
        message,
        retryable=True,
        recovery_hint=recovery_hint,
    )


def _diagnostics_dir() -> Path:
    """冷启动失败取证目录，可用 GOOGLE_FLOW_DIAG_DIR 覆盖。"""
    import os

    override = os.environ.get("GOOGLE_FLOW_DIAG_DIR", "").strip()
    return Path(override).expanduser() if override else (Path.home() / "Desktop" / "GoogleFlow诊断")


def _capture_editor_diagnostics(page: Any, tag: str) -> None:
    """就绪失败时留现场：URL + 正文前缀 + 截图。best-effort，绝不抛。

    冷启动失败只在生产偶发，过去每次 fix 都对着热浏览器猜页面状态，绿了又坏。
    这里把失败瞬间的真实页面状态落盘，下次冷崩能直接判定是登录页 / 公开介绍页 /
    编辑器渲染慢，不必再靠猜。仅当能真正读到页面正文时才落盘，避免单测里的假页面
    在桌面留下垃圾文件。
    """
    try:
        url = str(getattr(page, "url", "") or "")
    except Exception:
        url = ""
    try:
        body = page.locator("body").inner_text(timeout=3000)[:800]
    except Exception:
        return  # 读不到正文（多为假页面/已死页），不落盘
    stamp = time.strftime("%Y%m%d_%H%M%S")
    diag_dir = _diagnostics_dir()
    try:
        diag_dir.mkdir(parents=True, exist_ok=True)
        (diag_dir / f"{tag}_{stamp}.txt").write_text(
            f"url: {url}\n\nbody_prefix:\n{body}\n", encoding="utf-8"
        )
    except Exception:
        pass
    try:
        page.screenshot(
            path=str(diag_dir / f"{tag}_{stamp}.png"),
            full_page=False,
            timeout=8000,
            animations="disabled",
        )
    except Exception:
        pass


def _ensure_editor(
    page: Any,
    *,
    timeout_ms: int = 30_000,
    poll_interval_ms: int = 500,
    reload_attempts: int = 2,
) -> str:
    """确认页面已进入 Google Flow 项目编辑器。

    goto 用 `wait_until="domcontentloaded"` 只保证 HTML 解析完成，Slate.js 编辑器是
    客户端渲染的，紧接着的固定等待不足以保证它已挂载——尤其冷启动 / 网络慢 / 浏览器
    正忙时，会把「还在渲染」误判成「未登录」。策略：

    - 有限时间内轮询编辑器出现即成功；
    - 期间跳到 accounts.google.com 才是真的需要登录；
    - 单轮超时仍没等到编辑器，就 `reload()` 再等一轮（最多 reload_attempts 轮），
      吸收冷启动首帧渲染慢；
    - 全部轮次仍未就绪时，先落盘取证，再**按 URL 判别**：仍在合法 `/project/` 页 =
      冷启动 / 渲染慢，抛「可重试的非 auth」错误 EDITOR_NOT_READY（不触发交互式登录
      恢复，前端 / 上层直接重试即可）；已跳到登录页 / 公开介绍页才报 AUTH_REQUIRED。
    """
    editor = page.locator('[role="textbox"][contenteditable="true"][data-slate-editor="true"]')
    for attempt in range(reload_attempts + 1):
        project_navigation_attempted = False
        deadline = time.monotonic() + timeout_ms / 1000
        while True:
            host = (urlparse(page.url).hostname or "").lower()
            if host == "accounts.google.com":
                _raise_auth_required(
                    "Google Flow 需要登录。请先在内置浏览器完成 Google 登录。",
                    "请在当前内置浏览器完成 Google Flow 登录，然后点击重新生成。",
                )
            try:
                if editor.count() == 1:
                    return str(page.url)
            except Exception:
                pass
            if _is_flow_home_url(str(getattr(page, "url", "") or "")) and not project_navigation_attempted:
                project_navigation_attempted = True
                if _enter_or_create_project(page):
                    # The editor is client-rendered after project navigation;
                    # keep polling instead of assuming it is ready immediately.
                    continue
            if time.monotonic() >= deadline:
                break
            time.sleep(poll_interval_ms / 1000)
        # 仍在项目页但编辑器没挂载：多为冷启动首帧渲染慢，reload 再等一轮。
        if attempt < reload_attempts:
            try:
                page.reload(wait_until="domcontentloaded", timeout=60_000)
                page.wait_for_timeout(2500)
            except Exception:
                pass

    _capture_editor_diagnostics(page, "editor_not_ready")
    try:
        current_url = page.url
    except Exception:
        current_url = ""
    if _is_flow_project_url(current_url):
        # 仍在合法项目页 = 冷启动 / 渲染慢，不是掉登录。抛可重试的非 auth 错误，
        # 避免误触发交互式登录恢复；上层 / 前端「重新生成」即可，无需重新登录。
        raise GoogleFlowError(
            "EDITOR_NOT_READY",
            "Google Flow 项目编辑器在预期时间内未挂载（多为冷启动或页面渲染慢），"
            "已多次重载仍未就绪，请稍后点击重新生成。",
            retryable=True,
            recovery_hint="通常稍等内置浏览器预热后重试即可，无需重新登录。",
        )
    if _is_flow_home_url(current_url):
        raise GoogleFlowError(
            "PROJECT_CREATION_FAILED",
            "已进入 Google Flow 首页，但未能自动进入或创建项目。",
            retryable=True,
            recovery_hint="请在内置浏览器确认账号已完成 Flow 首次使用引导，然后重试。",
        )
    _raise_auth_required(
        "未进入 Google Flow 项目编辑器；当前是登录页或公开介绍页。",
        "请在内置浏览器登录 Google Flow，进入目标项目后点击重新生成。",
    )


def _generation_failure_count(page: Any) -> int:
    """统计 Flow 页面中已明确失败的生成卡片。

    生成前记录基线，生成后只响应新增失败卡，避免把项目中历史失败记录
    误判为本次任务失败。
    """
    page_text = page.locator("body").inner_text(timeout=5000).lower()
    return max(page_text.count(marker) for marker in FLOW_FAILURE_MARKERS)


def _find_replacement_project_page(
    context: Any, project_url: str, closed_page: Any, created_pages: list[Any]
) -> Any | None:
    """工作标签页中途关闭时找一个可接管的项目页。

    优先复用长期浏览器里已打开的同项目标签；确实没有时才新建一个页面，并把
    新建页登记到 created_pages，交由调用方收尾时关闭，避免每次接管都在长期浏览器里
    堆积孤儿标签页。
    """
    for candidate in reversed(list(getattr(context, "pages", []) or [])):
        if candidate is closed_page:
            continue
        try:
            if not candidate.is_closed() and candidate.url == project_url:
                return candidate
        except Exception:
            continue
    replacement = None
    try:
        replacement = context.new_page()
        created_pages.append(replacement)
        replacement.goto(project_url, wait_until="domcontentloaded", timeout=60_000)
        replacement.wait_for_timeout(3000)
        return replacement
    except Exception:
        try:
            if replacement is not None and not replacement.is_closed():
                replacement.close()
        except Exception:
            pass
        if replacement is not None and replacement in created_pages:
            created_pages.remove(replacement)
        return None


def wait_for_new_media(
    page: Any,
    *,
    context: Any,
    project_url: str,
    collect_urls: Callable[[Any], list[str]],
    previous_urls: set[str],
    previous_failure_count: int,
    timeout_minutes: int,
    created_pages: list[Any] | None = None,
    min_new: int = 1,
) -> tuple[Any, list[str]]:
    """轮询等待生成结果，返回 (结果所在页, 新出现的媒体 URL 列表)。

    - collect_urls(page) 由 provider 提供（视频取 <video> src，生图取 <img> src）。
    - min_new 为需要等到的新结果数量（生图张数 1x~4x；视频为 1）。
    - 内置：credits 不足判定、失败卡判定、瞬时读页容忍、工作页中途关闭接管。
    previous_urls 基线在点击生成前采集；页面接管重载后 blob src 可能变化，属边缘场景。
    """
    if created_pages is None:
        created_pages = []
    deadline = time.monotonic() + timeout_minutes * 60
    active_page = page
    replacement_deadline: float | None = None
    consecutive_read_errors = 0
    while time.monotonic() < deadline:
        try:
            page_text = active_page.locator("body").inner_text(timeout=5000)
            lowered = page_text.lower()
            if "not enough credits" in lowered or "insufficient credits" in lowered or "credits不足" in lowered:
                raise GoogleFlowError("GOOGLE_FLOW_CREDITS_INSUFFICIENT", "Google Flow credits 不足。")
            failure_count = max(lowered.count(marker) for marker in FLOW_FAILURE_MARKERS)
            if failure_count > previous_failure_count:
                raise GoogleFlowError(
                    "GOOGLE_FLOW_GENERATION_FAILED",
                    "Google Flow 已明确返回生成失败，请稍后点击重新生成；失败任务不会扣费。",
                    retryable=True,
                )
            # 同一张结果图可能同时出现在预览卡、历史卡和隐藏的响应式副本中。
            # 去重后再判断数量，避免多图任务把一个 URL 的多个 DOM 副本误当成多张结果。
            new_urls: list[str] = []
            seen_urls: set[str] = set()
            for url in collect_urls(active_page):
                if url in previous_urls or url in seen_urls:
                    continue
                seen_urls.add(url)
                new_urls.append(url)
            if len(new_urls) >= min_new:
                return active_page, new_urls[:min_new]
            consecutive_read_errors = 0
            active_page.wait_for_timeout(2000)
        except GoogleFlowError:
            raise
        except Exception as exc:
            message = str(exc).lower()
            try:
                page_closed = active_page.is_closed()
            except Exception:
                page_closed = True
            if not page_closed and "target page, context or browser has been closed" not in message:
                # 页面仍存活，多半是一次瞬时 DOM 读取超时/抖动，不是真正的页面丢失。
                # 容忍有限次连续失败后再判异常，避免长任务因单次读取抖动被整体重启。
                consecutive_read_errors += 1
                if consecutive_read_errors >= MAX_CONSECUTIVE_PAGE_READ_ERRORS:
                    raise GoogleFlowError(
                        "SUBMISSION_UNKNOWN",
                        f"生成期间连续 {consecutive_read_errors} 次读取 Flow 页面失败：{exc}",
                        retryable=False,
                        recovery_hint=(
                            "生成请求已经提交，状态暂时无法确认。请先到 Google Flow 项目历史中"
                            "确认是否已有结果，避免直接重试造成重复生成和额度消耗。"
                        ),
                    ) from exc
                time.sleep(2)
                continue

            replacement = _find_replacement_project_page(context, project_url, active_page, created_pages)
            if replacement is not None:
                active_page = replacement
                replacement_deadline = None
                consecutive_read_errors = 0
                continue

            replacement_deadline = replacement_deadline or time.monotonic() + 30
            if time.monotonic() >= replacement_deadline:
                raise GoogleFlowError(
                    "SUBMISSION_UNKNOWN",
                    "生成期间 Flow 工作标签页关闭，且 30 秒内未找到可接管的项目页面。",
                    retryable=False,
                    recovery_hint=(
                        "生成请求已经提交，请先到 Google Flow 项目历史中确认结果，"
                        "避免直接重试造成重复生成和额度消耗。"
                    ),
                ) from exc
            time.sleep(1)
    raise GoogleFlowError(
        "SUBMISSION_UNKNOWN",
        f"等待 Google Flow 生成超过 {timeout_minutes} 分钟，无法确认任务最终状态。",
        retryable=False,
        recovery_hint=(
            "生成请求已经提交，请先到 Google Flow 项目历史中确认结果；"
            "确认没有任务后再重新生成，避免重复消耗额度。"
        ),
    )


def _download_media(
    page: Any, media_url: str, output_dir: Path, stamp: str, *, prefix: str, default_ext: str = ""
) -> str | None:
    if not media_url.startswith(("http://", "https://")):
        return None
    try:
        response = page.context.request.get(media_url, timeout=120_000)
        if not response.ok:
            return None
        content_type = (response.headers.get("content-type") or "").split(";", 1)[0]
        extension = mimetypes.guess_extension(content_type) or Path(urlparse(media_url).path).suffix or default_ext
        if extension == ".jpe":
            extension = ".jpg"
        target = output_dir / f"{prefix}{stamp}{extension}"
        target.write_bytes(response.body())
        return str(target)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Composer 参考图上传（text-to-image 参考图 与 image-to-video Ingredients 共用）
#
# Flow 的 composer「+」(add_2 Create) → 媒体选择 dialog → upload Upload media →
# Add to Prompt 是「把本地素材加入提示」的通用机制，文生图参考图与图生视频
# Ingredients 多参考图走的是同一套 UI，故沉到共享基座，两个能力复用同一份实现。
# ---------------------------------------------------------------------------


def _selected_media_matches_reference(option_texts: list[str], filename: str) -> bool:
    return any(filename in str(text) for text in option_texts)


def _first_option_selected(options: Any) -> bool:
    """新上传素材被 Flow 移到网格首位并 aria-selected=true —— 不依赖文件名的稳定信号。

    文件名未必出现在 option 文本里（缩略图无文案），多参考图时旧的「文件名匹配」判据
    会一直等不到，进而超时报 Add to Prompt 未就绪。这里用「首位素材已选中」兜住。
    """
    try:
        first = options.first
        if first.count() == 0:
            return False
        return (first.get_attribute("aria-selected") or "").strip().lower() == "true"
    except Exception:
        return False


def _clear_existing_prompt(page: Any) -> None:
    """清理上一次运行残留的提示词和参考图，避免跨任务累积。"""
    clear = page.get_by_role("button").filter(has_text=re.compile(r"(^|\s)close(\s|$)", re.IGNORECASE))
    if clear.count() == 1 and clear.is_visible():
        clear.click()
        page.wait_for_timeout(500)


def _upload_reference_file(page: Any, ref: Path) -> Any:
    """处理媒体选择框异步重挂载，稳定触发文件选择并返回当前 dialog。"""
    last_error: Exception | None = None
    for _attempt in range(3):
        try:
            dialog = page.get_by_role("dialog")
            if dialog.count() != 1 or not dialog.is_visible():
                add = page.locator('button[aria-haspopup="dialog"]').filter(
                    has_text=re.compile(r"(^|\s)add_2(\s|$)", re.IGNORECASE)
                )
                add = _exact_count(add, "REFERENCE_IMAGE_ADD_FAILED", "未找到添加参考图按钮。")
                add.click()
                dialog = page.get_by_role("dialog")
                dialog.wait_for(state="visible", timeout=10_000)
            page.wait_for_timeout(750)
            upload = dialog.get_by_role("button").filter(
                has_text=re.compile(r"(^|\s)upload(\s|$)", re.IGNORECASE)
            )
            upload = _exact_count(upload, "REFERENCE_IMAGE_ADD_FAILED", "未找到 Upload media 按钮。")
            with page.expect_file_chooser(timeout=10_000) as chooser_info:
                # 媒体网格加载时 dialog 会重挂载；force 避免在 actionability 等待期间丢失节点。
                upload.click(force=True, timeout=10_000)
            chooser_info.value.set_files(str(ref))
            return page.get_by_role("dialog")
        except Exception as exc:
            last_error = exc
            page.wait_for_timeout(1000)
    raise GoogleFlowError(
        "REFERENCE_IMAGE_ADD_FAILED",
        f"上传参考图失败：{last_error}",
        retryable=True,
    )


def _attach_reference_images(page: Any, reference_paths: list[Path]) -> None:
    """通过 composer 的「+」(add_2 Create) 逐张上传本地参考图并 Add to Prompt。

    选择器来自 19222 实时页面探查：composer 「+」= aria-haspopup=dialog 的 add_2 Create
    （与提交用的 arrow_forward Create 同名不同意图，需按 add_2 精确匹配）；打开的媒体
    选择器 dialog 内 upload Upload media 触发文件选择、Add to Prompt 把选中素材加入提示。
    """
    for ref in reference_paths:
        dialog = _upload_reference_file(page, ref)

        # 上传后 Google Flow 会把新素材移到网格首位并设为 aria-selected=true。
        # 多参考图连续上传时，上一次选择可能让 Add to Prompt 始终保持可点，因此不能只
        # 等待「不可点 → 可点」翻转。接受信号（任一即可）：本次文件名命中选中项、或新素材
        # 落到首位且被选中；「翻转」仅作首图兼容兜底。文件名/首位命中要求连续两次稳定后
        # 再点，避免抓到上一次的残留选中态而把旧素材误加入。
        add_to_prompt = dialog.get_by_role("button", name=re.compile(
            r"Add to Prompt|添加到提示词|加入提示词|新增至提示詞",
            re.IGNORECASE,
        ))
        options = dialog.get_by_role("option")
        # set_files 是异步的：先给 Flow 一点时间把新素材落位选中，别抓残留态。
        page.wait_for_timeout(1200)
        deadline = time.monotonic() + 120
        went_disabled = False
        attached = False
        stable_hits = 0
        while time.monotonic() < deadline:
            try:
                enabled = add_to_prompt.count() == 1 and add_to_prompt.is_enabled()
                selected = options.locator('[aria-selected="true"]')
                selected_current = _selected_media_matches_reference(
                    selected.all_inner_texts(),
                    ref.name,
                )
                first_selected = _first_option_selected(options)
            except Exception:
                enabled = False
                selected_current = False
                first_selected = False
            if not enabled:
                went_disabled = True
                stable_hits = 0
            elif selected_current or first_selected:
                stable_hits += 1
                if stable_hits >= 2:
                    add_to_prompt.click()
                    attached = True
                    break
            elif went_disabled:
                # 首图：从「无选中(禁用)」翻到「可点」，说明本次上传已被选中。
                add_to_prompt.click()
                attached = True
                break
            else:
                stable_hits = 0
            page.wait_for_timeout(1000)
        if not attached:
            raise GoogleFlowError(
                "REFERENCE_IMAGE_ADD_FAILED",
                "参考图上传后 Add to Prompt 未就绪，未能加入提示。",
                retryable=True,
            )
        try:
            dialog.wait_for(state="hidden", timeout=15_000)
        except Exception:
            pass
