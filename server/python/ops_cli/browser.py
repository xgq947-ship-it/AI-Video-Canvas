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
# HTTP 通道的常驻页（见 ops_cli/webhttp.py）。它和普通任务页不同：没有"任务结束"
# 这个时刻，寿命跨越多次请求，所以不能按 managed 残留的时间戳规则回收。
# 名字里没有时间戳段，_managed_marker_timestamp 会返回 None，而 None 一律判定为
# 陈旧 —— 不豁免的话，任意一次浏览器任务或 browser cleanup 都会把正在发请求的
# 桥接页直接关掉。
WEBHTTP_WINDOW_PREFIX = f"{MANAGED_WINDOW_PREFIX}webhttp:"
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


def browser_status() -> CommandResponse:
    return CommandResponse(
        success=True,
        platform="browser",
        command="status",
        data={"message": "browser integration is intentionally disabled in this phase"},
    )


def _flush_tabs_before_close(port: int) -> int:
    """Close every real tab through the raw CDP HTTP endpoint before killing Chrome.

    实测：Chrome 被 SIGTERM/SIGKILL 掉之后，同一个 profile 下次启动会把上次的标签页
    全部恢复回来（哪怕是无头实例）。也就是说残留的标签页会跨重启复活，一直吃内存。
    退出前先把它们关掉，恢复列表自然就是空的。

    走 /json 而不是 Playwright：退出路径上不能依赖 Playwright 装好，也不能被它的
    连接握手拖住；任何失败都只是少清一次，直接交给后面的 stop_chrome。
    """
    try:
        with urlopen(f"http://127.0.0.1:{port}/json/list", timeout=2) as response:
            targets: Any = json.loads(response.read().decode("utf-8"))
    except (OSError, URLError, json.JSONDecodeError):
        return 0
    if not isinstance(targets, list):
        return 0

    closed = 0
    for target in targets:
        if not isinstance(target, dict) or target.get("type") != "page":
            continue
        target_id = target.get("id")
        if not target_id or _is_blank_url(str(target.get("url") or "")):
            continue
        try:
            with urlopen(f"http://127.0.0.1:{port}/json/close/{target_id}", timeout=2):
                closed += 1
        except (OSError, URLError):
            continue
    return closed


def close_browser() -> CommandResponse:
    sessionhub_root = Path(get_config().sessionhub_root).expanduser().resolve()
    if str(sessionhub_root) not in sys.path:
        sys.path.insert(0, str(sessionhub_root))
    from scene.chrome_cdp import CDP_PORT, stop_chrome  # type: ignore

    flushed = _flush_tabs_before_close(CDP_PORT)
    ok, message = stop_chrome()
    return CommandResponse(
        success=ok,
        platform="browser",
        command="close",
        data={"message": message, "closed": ok, "tabs_flushed": flushed},
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

        if window_name.startswith(WEBHTTP_WINDOW_PREFIX):
            # 常驻桥接页：始终保留，并占住它所在业务域名的去重位，
            # 这样重复的普通标签页仍会被清掉，被关的不会是它。
            keep.append(item)
            if dedup_key is not None:
                seen_dedup_keys.add(dedup_key)
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
