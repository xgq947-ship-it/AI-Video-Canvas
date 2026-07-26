from __future__ import annotations

import json
import sys
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import urlopen

from ops_cli.output import CommandResponse
from ops_cli.config import get_config


MANAGED_WINDOW_PREFIX = "ops-cli:"
KEEPALIVE_WINDOW_NAME = f"{MANAGED_WINDOW_PREFIX}keepalive"
# 正常任务会在 finally 立即关闭自己的页面。这里只兜底清理由异常崩溃留下的旧 marker；
# 设为两小时，避免用户在另一个 10~30 分钟生成任务进行中打开登录页时误关活跃任务。
MANAGED_RESIDUE_MIN_AGE_SECONDS = 2 * 60 * 60
PAGE_SNAPSHOT_TIMEOUT_MS = 2000
PAGE_DEFAULT_TIMEOUT_MS = 30000

_DEDUP_HOSTS: set[str] = {"labs.google", "jimeng.jianying.com", "gemini.google.com"}
LOGIN_URLS = {
    "google-flow": "https://labs.google/fx/tools/flow",
    "jimeng": "https://jimeng.jianying.com/ai-tool/generate?type=video",
    "gemini-web": "https://gemini.google.com/app",
}

LOGIN_PROBE_TIMEOUT_SECONDS = 25


def _visible(locator: Any) -> bool:
    try:
        return any(locator.nth(index).is_visible() for index in range(locator.count()))
    except Exception:
        return False


# Google 账号登录态探针地址。
#
# 为什么不用 labs.google/fx/tools/flow 判断登录：实测该地址是**公开营销落地页**
# （Overview / Models / Pricing / "Create with Google Flow"），对已登录和未登录用户
# 渲染的 DOM 完全相同 —— 原来找的 editor / account / sign-in 三个选择器一个都不命中，
# 探针只能空等到 25 秒超时后报「未发现足够的登录证据」。这正是「Flow 检查不出来」的根因。
# Slate 编辑器只存在于 /fx/tools/flow/project/<id> 应用页，首页上永远没有。
#
# myaccount.google.com 的重定向行为则是稳定信号：未登录必定被重定向离开该域名。
GOOGLE_ACCOUNT_PROBE_URL = "https://myaccount.google.com/"
_GOOGLE_SIGNED_OUT_HOSTS = {"accounts.google.com", "www.google.com", "google.com"}


def _probe_flow_login(page: Any) -> dict[str, Any]:
    """只读确认 Google 账号登录态（Flow 的前提），按重定向判定。"""
    return probe_google_account_login(page)


def probe_google_account_login(page: Any) -> dict[str, Any]:
    """按 myaccount.google.com 的重定向判定 Google 账号登录态。

    Flow 与 Gemini 都没有独立于 Google 账号的授权步骤，登录态判定共用这一个信号：
    未登录必定被重定向离开 myaccount.google.com。只有探针超时才会返回 unconfirmed，
    页面 DOM 的形状永远不参与判定。
    """
    page.goto(GOOGLE_ACCOUNT_PROBE_URL, wait_until="domcontentloaded", timeout=60_000)
    deadline = time.monotonic() + LOGIN_PROBE_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        host = (urlparse(str(getattr(page, "url", "") or "")).hostname or "").lower()
        if host == "myaccount.google.com":
            return {
                "authenticated": True,
                "reason": "authenticated",
                "evidence": "google-account-page",
                "message": "已确认 Google 账号登录",
            }
        if host in _GOOGLE_SIGNED_OUT_HOSTS:
            return {
                "authenticated": False,
                "reason": "not-authenticated",
                "evidence": "redirected-to-signin",
                "message": "Google 账号当前未登录，请在 Evan 专属 Chrome 中登录",
            }
        page.wait_for_timeout(500)
    return {
        "authenticated": False,
        "reason": "unconfirmed",
        "evidence": "no-auth-evidence",
        "message": "无法确认 Google 账号登录状态",
    }


def _probe_jimeng_login(page: Any) -> dict[str, Any]:
    """用即梦官方账号接口只读确认登录，游客编辑器不能作为成功证据。"""
    from ops_cli.platforms.image_to_video.providers.jimeng import (  # type: ignore
        _account_login_state,
    )

    page.goto(LOGIN_URLS["jimeng"], wait_until="domcontentloaded", timeout=60_000)
    account_state = _account_login_state(page)
    if account_state is True:
        return {
            "authenticated": True,
            "reason": "authenticated",
            "evidence": "account-api-user-id",
            "message": "已通过即梦账号接口确认登录",
        }
    if account_state is False:
        return {
            "authenticated": False,
            "reason": "not-authenticated",
            "evidence": "account-api-guest",
            "message": "即梦账号接口确认当前未登录",
        }
    return {
        "authenticated": False,
        "reason": "unconfirmed",
        "evidence": "account-api-unconfirmed",
        "message": "即梦账号接口暂时无法确认登录状态",
    }


def _probe_gemini_login(page: Any) -> dict[str, Any]:
    from ops_cli.platforms._gemini_web_common import probe_gemini_login

    return probe_gemini_login(page)


def check_browser_logins(providers: list[str] | None = None) -> CommandResponse:
    """关闭登录窗口并用同一 Profile 无头做真实页面只读探针。"""
    selected = providers or list(LOGIN_URLS)
    invalid = [provider for provider in selected if provider not in LOGIN_URLS]
    if invalid:
        return CommandResponse(
            success=False,
            platform="browser",
            command="check-login",
            data={"error": f"不支持的浏览器登录平台：{', '.join(invalid)}"},
        )

    sessionhub_root = Path(get_config().sessionhub_root).expanduser().resolve()
    if str(sessionhub_root) not in sys.path:
        sys.path.insert(0, str(sessionhub_root))
    from scene.chrome_cdp import (  # type: ignore
        CDP_PORT,
        PROFILE_DIR,
        _instance_is_headless,
        _instance_pid,
        _instance_supports_playwright,
        start_chrome,
        stop_chrome,
    )

    if not PROFILE_DIR.exists():
        results = {
            provider: {
                "authenticated": False,
                "reason": "not-authenticated",
                "evidence": "profile-missing",
                "message": "尚未创建 Evan 专属 Chrome 登录资料",
            }
            for provider in selected
        }
        return CommandResponse(
            success=True,
            platform="browser",
            command="check-login",
            data={"providers": results},
        )

    # 只在**必要时**重启浏览器。
    #
    # 这里原来无条件 stop_chrome()，而 start_chrome 本身就有复用分支 ——
    # 等于每次检查都主动摧毁复用，付一次完整冷启动（SIGTERM 等待 ≤5s +
    # Chrome 启动 + _wait_cdp_stable ≤25s），这是「检查登录态很久」的主因。
    #
    # 但不能直接删：可见登录实例没有 CDP，且用户刚登录完的 Cookie 要等它优雅退出
    # 才落盘。跳过 stop 会读到还没写盘的状态，报出「刚登录成功却显示未登录」。
    # 所以按实例种类判断：已经是无头 + 可被 Playwright 接管的实例才直接复用。
    pid = _instance_pid()
    reusable = (
        pid is not None
        and _instance_is_headless(pid)
        and _instance_supports_playwright(pid)
    )
    if not reusable:
        stop_chrome()
    ok, message = start_chrome(headless=True)
    if not ok:
        return CommandResponse(
            success=False,
            platform="browser",
            command="check-login",
            data={"error": message, "error_code": "BROWSER_CLOSED"},
        )

    def _check(context: Any) -> dict[str, Any]:
        cleanup_playwright_context(context)
        results: dict[str, Any] = {}
        for provider in selected:
            page = context.new_page()
            try:
                if provider == "google-flow":
                    results[provider] = _probe_flow_login(page)
                elif provider == "jimeng":
                    results[provider] = _probe_jimeng_login(page)
                else:
                    results[provider] = _probe_gemini_login(page)
            except Exception as exc:
                results[provider] = {
                    "authenticated": False,
                    "reason": "unconfirmed",
                    "evidence": "probe-error",
                    "message": f"登录探针执行失败：{exc}",
                }
            finally:
                try:
                    page.close()
                except Exception:
                    pass
        ensure_keepalive_page(context)
        return results

    try:
        results = _with_cdp_context(CDP_PORT, _check)
    except Exception as exc:
        return CommandResponse(
            success=False,
            platform="browser",
            command="check-login",
            data={"error": str(exc), "error_code": "BROWSER_CLOSED"},
        )
    return CommandResponse(
        success=True,
        platform="browser",
        command="check-login",
        data={"providers": results},
    )


def browser_status() -> CommandResponse:
    return CommandResponse(
        success=True,
        platform="browser",
        command="status",
        data={"message": "browser integration is intentionally disabled in this phase"},
    )


def close_browser() -> CommandResponse:
    sessionhub_root = Path(get_config().sessionhub_root).expanduser().resolve()
    if str(sessionhub_root) not in sys.path:
        sys.path.insert(0, str(sessionhub_root))
    from scene.chrome_cdp import stop_chrome  # type: ignore

    ok, message = stop_chrome()
    return CommandResponse(
        success=ok,
        platform="browser",
        command="close",
        data={"message": message, "closed": ok},
    )


def check_browser_port(port: int) -> CommandResponse:
    url = f"http://127.0.0.1:{port}/json/version"
    try:
        with urlopen(url, timeout=2) as response:
            payload: Any = json.loads(response.read().decode("utf-8"))
    except (OSError, URLError, json.JSONDecodeError) as exc:
        return CommandResponse(
            success=False,
            platform="browser",
            command="check",
            data={"port": port, "available": False, "error": str(exc)},
        )
    return CommandResponse(
        success=True,
        platform="browser",
        command="check",
        data={
            "port": port,
            "available": True,
            "browser": payload.get("Browser"),
            "websocket": payload.get("webSocketDebuggerUrl"),
        },
    )


def open_browser_login(provider: str) -> CommandResponse:
    login_url = LOGIN_URLS.get(provider)
    if not login_url:
        return CommandResponse(
            success=False,
            platform="browser",
            command="login",
            data={"provider": provider, "error": "不支持的浏览器登录平台"},
        )

    sessionhub_root = Path(get_config().sessionhub_root).expanduser().resolve()
    if str(sessionhub_root) not in sys.path:
        sys.path.insert(0, str(sessionhub_root))
    from scene.chrome_cdp import CDP_PORT, start_login_chrome  # type: ignore

    ok, message = start_login_chrome(login_url)
    if not ok:
        return CommandResponse(
            success=False,
            platform="browser",
            command="login",
            data={"provider": provider, "error": message},
        )

    data = {
        "provider": provider,
        "url": login_url,
        "port": CDP_PORT,
        # 登录模式刻意不开放 CDP，避免 Google 把凭据输入识别成自动化登录。
        # 登录态在用户重试真实任务时由 provider 页面重新验证。
        "authenticated": False,
        "message": "Evan 专属 Chrome 已打开。完成登录后回到 Evan 重试任务。",
    }
    return CommandResponse(success=True, platform="browser", command="login", data=data)


def open_browser() -> CommandResponse:
    """Open or foreground Evan's dedicated browser without choosing a provider."""
    sessionhub_root = Path(get_config().sessionhub_root).expanduser().resolve()
    if str(sessionhub_root) not in sys.path:
        sys.path.insert(0, str(sessionhub_root))
    from scene.chrome_cdp import start_login_chrome  # type: ignore

    # 用户主动打开时同样使用无自动化参数的普通 Chrome，保证可以安全手动登录。
    ok, message = start_login_chrome("about:blank")
    if not ok:
        return CommandResponse(
            success=False,
            platform="browser",
            command="open",
            data={"error": message},
        )
    return CommandResponse(
        success=True,
        platform="browser",
        command="open",
        data={
            "message": "Evan 专属 Chrome 已打开。",
        },
    )


def _is_blank_url(url: str) -> bool:
    return not url or url == "about:blank"


def _dedup_key(url: str) -> tuple[str, str] | None:
    if _is_blank_url(url):
        return None
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    if host not in _DEDUP_HOSTS:
        return None
    return host, parsed.path or "/"


def _with_page_snapshot_timeout(page: Any, callback: Any) -> Any:
    has_timeout = hasattr(page, "set_default_timeout")
    if has_timeout:
        try:
            page.set_default_timeout(PAGE_SNAPSHOT_TIMEOUT_MS)
        except Exception:
            has_timeout = False
    try:
        return callback()
    finally:
        if has_timeout:
            try:
                page.set_default_timeout(PAGE_DEFAULT_TIMEOUT_MS)
            except Exception:
                pass


def _page_is_closed(page: Any) -> bool:
    try:
        return bool(page.is_closed())
    except Exception:
        return False


def _page_title(page: Any) -> str:
    try:
        title = _with_page_snapshot_timeout(page, lambda: page.title())
    except Exception:
        title = ""
    return str(title or "")


def _page_window_name(page: Any) -> str:
    try:
        value = _with_page_snapshot_timeout(page, lambda: page.evaluate("() => window.name || ''"))
    except Exception:
        value = ""
    return str(value or "")


def _set_page_window_name(page: Any, window_name: str) -> None:
    try:
        page.evaluate("(name) => { window.name = name; return window.name; }", window_name)
    except Exception:
        pass


def _snapshot_playwright_context(context: Any) -> tuple[list[Any], list[dict[str, Any]]]:
    pages = list(getattr(context, "pages", []) or [])
    snapshots: list[dict[str, Any]] = []
    for index, page in enumerate(pages):
        if _page_is_closed(page):
            continue
        snapshots.append(
            {
                "index": index,
                "url": str(getattr(page, "url", "") or ""),
                "title": _page_title(page),
                "window_name": _page_window_name(page),
            }
        )
    return pages, snapshots


def _managed_marker_timestamp(window_name: str) -> int | None:
    if not window_name.startswith(MANAGED_WINDOW_PREFIX) or window_name == KEEPALIVE_WINDOW_NAME:
        return None
    # 兼容两种 marker 格式：
    #   Python managed_work_page: ops-cli:<owner>:<秒>:<uuid8>  → 时间戳在倒数第二段
    #   JS raw-CDP（旧）:         ops-cli:<owner>:<毫秒>        → 时间戳在最后一段
    # owner 形如 jst.order.stats（含点不含冒号），故先试倒数第二段、再退回最后一段。
    segments = window_name.split(":")
    if len(segments) < 3:
        return None
    for candidate in (segments[-2], segments[-1]):
        try:
            value = int(candidate)
        except (TypeError, ValueError):
            continue
        if value >= 10**12:  # 毫秒级时间戳归一到秒
            value //= 1000
        return value
    return None


def _managed_marker_is_stale(window_name: str, *, now: float, min_age_seconds: int) -> bool:
    timestamp = _managed_marker_timestamp(window_name)
    if timestamp is None:
        return True
    return timestamp < now - min_age_seconds


def build_tab_cleanup_plan(
    snapshots: list[dict[str, Any]],
    *,
    now: float | None = None,
    managed_residue_min_age_seconds: int = MANAGED_RESIDUE_MIN_AGE_SECONDS,
) -> dict[str, list[dict[str, Any]]]:
    """Build a conservative cleanup plan for the dedicated 19222 browser.

    Rules are intentionally narrow:
    - keep one about:blank page as a Chrome window anchor;
    - close stale pages created by Ops-Cli markers;
    - close exact duplicate tabs for known business hosts.
    """
    keep: list[dict[str, Any]] = []
    close: list[dict[str, Any]] = []
    effective_now = time.time() if now is None else now
    seen_dedup_keys: set[tuple[str, str]] = set()
    normalized: list[dict[str, Any]] = []
    marked_keepalive_index: int | None = None
    first_blank_index: int | None = None

    for fallback_index, raw in enumerate(snapshots):
        item = dict(raw)
        item["index"] = int(item.get("index", fallback_index))
        normalized.append(item)
        url = str(item.get("url") or "")
        window_name = str(item.get("window_name") or "")
        if window_name == KEEPALIVE_WINDOW_NAME and _is_blank_url(url) and marked_keepalive_index is None:
            marked_keepalive_index = int(item["index"])
        if first_blank_index is None and _is_blank_url(url):
            first_blank_index = int(item["index"])

    blank_keeper_index = marked_keepalive_index if marked_keepalive_index is not None else first_blank_index

    for item in normalized:
        url = str(item.get("url") or "")
        window_name = str(item.get("window_name") or "")
        dedup_key = _dedup_key(url)

        if window_name == KEEPALIVE_WINDOW_NAME:
            if not _is_blank_url(url):
                keep.append(item)
                if dedup_key is not None:
                    seen_dedup_keys.add(dedup_key)
            elif int(item["index"]) == blank_keeper_index:
                keep.append(item)
            else:
                close.append({**item, "reason": "extra_blank"})
            continue

        if window_name.startswith(MANAGED_WINDOW_PREFIX):
            if _managed_marker_is_stale(
                window_name,
                now=effective_now,
                min_age_seconds=managed_residue_min_age_seconds,
            ):
                close.append({**item, "reason": "managed_residue"})
            else:
                keep.append(item)
            continue

        if _is_blank_url(url):
            if int(item["index"]) == blank_keeper_index:
                keep.append(item)
            else:
                close.append({**item, "reason": "extra_blank"})
            continue

        if dedup_key is not None:
            if dedup_key in seen_dedup_keys:
                close.append({**item, "reason": "duplicate_url"})
            else:
                keep.append(item)
                seen_dedup_keys.add(dedup_key)
            continue

        keep.append(item)

    return {"keep": keep, "close": close}


def cleanup_playwright_context(
    context: Any,
    *,
    dry_run: bool = False,
    now: float | None = None,
    managed_residue_min_age_seconds: int = MANAGED_RESIDUE_MIN_AGE_SECONDS,
) -> dict[str, Any]:
    pages, snapshots = _snapshot_playwright_context(context)
    plan = build_tab_cleanup_plan(
        snapshots,
        now=now,
        managed_residue_min_age_seconds=managed_residue_min_age_seconds,
    )
    errors: list[dict[str, Any]] = []
    closed: list[dict[str, Any]] = []

    for item in plan["close"]:
        if dry_run:
            continue
        index = int(item["index"])
        if index < 0 or index >= len(pages):
            errors.append({**item, "error": "page_index_out_of_range"})
            continue
        page = pages[index]
        try:
            if not _page_is_closed(page):
                page.close()
            closed.append(item)
        except Exception as exc:
            errors.append({**item, "error": str(exc)})

    return {
        "total_pages": len(snapshots),
        "dry_run": dry_run,
        "close_count": len(plan["close"]),
        "closed_count": 0 if dry_run else len(closed),
        "kept": plan["keep"],
        "close": plan["close"],
        "closed": closed,
        "errors": errors,
    }


def ensure_keepalive_page(context: Any) -> Any:
    pages = list(getattr(context, "pages", []) or [])
    for page in pages:
        if _page_is_closed(page):
            continue
        if _page_window_name(page) == KEEPALIVE_WINDOW_NAME:
            return page

    # Chromium 启动时自带一个 about:blank。直接把它提升为锚点，避免每次任务
    # 再额外创建一个空白标签页。
    for page in pages:
        if not _page_is_closed(page) and _is_blank_url(str(getattr(page, "url", "") or "")):
            _set_page_window_name(page, KEEPALIVE_WINDOW_NAME)
            return page

    page = context.new_page()
    try:
        if getattr(page, "url", "") != "about:blank":
            page.goto("about:blank", timeout=3000)
    except Exception:
        pass
    _set_page_window_name(page, KEEPALIVE_WINDOW_NAME)
    return page


@contextmanager
def managed_work_page(context: Any, owner: str, *, cleanup_before: bool = False) -> Iterator[Any]:
    if cleanup_before:
        cleanup_playwright_context(context)
    ensure_keepalive_page(context)
    page = context.new_page()
    marker = f"{MANAGED_WINDOW_PREFIX}{owner}:{int(time.time())}:{uuid.uuid4().hex[:8]}"
    _set_page_window_name(page, marker)
    try:
        yield page
    finally:
        try:
            if not _page_is_closed(page):
                page.close()
        finally:
            cleanup_playwright_context(
                context,
            )
            ensure_keepalive_page(context)


def _with_cdp_context(port: int, handler: Any) -> Any:
    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except ModuleNotFoundError as exc:
        raise RuntimeError("缺少 Playwright，请先运行：npm run setup:automation-runtime") from exc

    cdp_url = f"http://127.0.0.1:{port}"
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(cdp_url)
        context = browser.contexts[0] if browser.contexts else browser.new_context()
        return handler(context)


def list_browser_tabs(port: int) -> CommandResponse:
    try:
        result = _with_cdp_context(
            port,
            lambda context: {
                "port": port,
                "tabs": _snapshot_playwright_context(context)[1],
            },
        )
    except Exception as exc:
        return CommandResponse(
            success=False,
            platform="browser",
            command="tabs",
            data={"port": port, "available": False, "error": str(exc)},
        )
    result["page_count"] = len(result["tabs"])
    return CommandResponse(success=True, platform="browser", command="tabs", data=result)


def cleanup_browser_tabs(
    port: int,
    *,
    dry_run: bool = False,
    managed_residue_min_age_seconds: int = MANAGED_RESIDUE_MIN_AGE_SECONDS,
    now: float | None = None,
) -> CommandResponse:
    try:
        def _cleanup(context: Any) -> dict[str, Any]:
            if not dry_run:
                ensure_keepalive_page(context)
            result = cleanup_playwright_context(
                context,
                dry_run=dry_run,
                now=now,
                managed_residue_min_age_seconds=managed_residue_min_age_seconds,
            )
            if not dry_run:
                ensure_keepalive_page(context)
            result["port"] = port
            return result

        result = _with_cdp_context(port, _cleanup)
    except Exception as exc:
        return CommandResponse(
            success=False,
            platform="browser",
            command="cleanup",
            data={"port": port, "available": False, "dry_run": dry_run, "error": str(exc)},
        )
    return CommandResponse(success=True, platform="browser", command="cleanup", data=result)
