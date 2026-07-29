from __future__ import annotations

import atexit
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any


class BrowserHubError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def hub_home() -> Path:
    override = os.environ.get("AI_BROWSER_HUB_HOME", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "SankaiAI" / "AI Browser Hub"
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
        return base / "SankaiAI" / "AI Browser Hub"
    base = Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share"))
    return base / "sankaiai" / "ai-browser-hub"


def profile_dir() -> Path:
    return hub_home() / "data" / "profile-v1"


def _state_path() -> Path:
    return hub_home() / "runtime" / "hub-state.json"


def _read_state() -> dict[str, Any]:
    try:
        payload = json.loads(_state_path().read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise BrowserHubError(
            "HUB_NOT_RUNNING",
            "共享浏览器服务尚未启动，请重新打开应用。",
        ) from exc
    if not isinstance(payload, dict) or not payload.get("port") or not payload.get("token"):
        raise BrowserHubError("HUB_STATE_INVALID", "共享浏览器状态无效，请重新打开应用。")
    return payload


def _request_json(url: str, *, token: str | None = None, body: dict[str, Any] | None = None, timeout: float = 35.0) -> dict[str, Any]:
    headers = {"accept": "application/json"}
    data = None
    method = "GET"
    if token:
        headers["authorization"] = f"Bearer {token}"
    if body is not None:
        headers["content-type"] = "application/json"
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        method = "POST"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (OSError, urllib.error.URLError, ValueError) as exc:
        raise BrowserHubError("HUB_UNAVAILABLE", "无法连接共享浏览器服务，请重新打开应用。") from exc
    return payload if isinstance(payload, dict) else {}


def rpc(method: str, params: dict[str, Any] | None = None) -> Any:
    state = _read_state()
    payload = _request_json(
        f"http://127.0.0.1:{int(state['port'])}/rpc",
        token=str(state["token"]),
        body={"method": method, "params": params or {}},
    )
    if payload.get("ok") is not True:
        error = payload.get("error") if isinstance(payload.get("error"), dict) else {}
        raise BrowserHubError(
            str(error.get("code") or "HUB_ERROR"),
            str(error.get("message") or "共享浏览器请求失败。"),
        )
    return payload.get("result")


def status() -> dict[str, Any]:
    try:
        result = rpc("browser.status")
        return result if isinstance(result, dict) else {}
    except BrowserHubError:
        return {}


_lease_lock = threading.Lock()
_lease_id: str | None = None
_cdp_endpoint: str | None = None
_heartbeat_stop: threading.Event | None = None
_heartbeat_thread: threading.Thread | None = None


def _heartbeat(lease_id: str, stop: threading.Event) -> None:
    while not stop.wait(25.0):
        try:
            rpc("browser.heartbeat", {"leaseId": lease_id})
        except BrowserHubError:
            return


def _provider_for_url(url: str) -> str:
    lowered = str(url or "").lower()
    if "gemini.google.com" in lowered:
        return "gemini-web"
    if "jimeng.jianying.com" in lowered:
        return "jimeng"
    if "labs.google" in lowered:
        return "google-flow"
    return "browser"


def acquire_browser(initial_url: str = "about:blank") -> tuple[str, int | None]:
    global _lease_id, _cdp_endpoint, _heartbeat_stop, _heartbeat_thread
    with _lease_lock:
        if _lease_id and _cdp_endpoint:
            port = int(_cdp_endpoint.rsplit(":", 1)[1])
            browser = status().get("browser") or {}
            return _cdp_endpoint, int(browser.get("pid")) if browser.get("pid") else None
        result = rpc(
            "browser.acquire",
            {
                "appId": "com.evan.aivideocanvas",
                "taskId": str(uuid.uuid4()),
                "provider": _provider_for_url(initial_url),
                "pageKey": f"ai-video-canvas:{_provider_for_url(initial_url)}",
                "clientPid": os.getpid(),
                "url": initial_url,
                "ttlMs": 120_000,
            },
        )
        if not isinstance(result, dict):
            raise BrowserHubError("HUB_RESPONSE_INVALID", "共享浏览器没有返回有效租约。")
        lease = result.get("lease") if isinstance(result.get("lease"), dict) else {}
        browser = result.get("browser") if isinstance(result.get("browser"), dict) else {}
        endpoint = str(browser.get("cdpEndpoint") or "")
        lease_id = str(lease.get("leaseId") or "")
        if not endpoint or not lease_id:
            raise BrowserHubError("HUB_RESPONSE_INVALID", "共享浏览器没有返回调试连接。")
        _lease_id = lease_id
        _cdp_endpoint = endpoint
        _heartbeat_stop = threading.Event()
        _heartbeat_thread = threading.Thread(
            target=_heartbeat,
            args=(lease_id, _heartbeat_stop),
            name="ai-browser-hub-heartbeat",
            daemon=True,
        )
        _heartbeat_thread.start()
        return endpoint, int(browser.get("pid")) if browser.get("pid") else None


def release_browser() -> bool:
    global _lease_id, _cdp_endpoint, _heartbeat_stop, _heartbeat_thread
    with _lease_lock:
        lease_id = _lease_id
        stop = _heartbeat_stop
        _lease_id = None
        _cdp_endpoint = None
        _heartbeat_stop = None
        _heartbeat_thread = None
    if stop:
        stop.set()
    if not lease_id:
        return False
    try:
        rpc("browser.release", {"leaseId": lease_id})
        return True
    except BrowserHubError:
        return False


def open_login(url: str) -> dict[str, Any]:
    release_browser()
    result = rpc("auth.openLogin", {"url": url})
    return result if isinstance(result, dict) else {}


def current_endpoint() -> str | None:
    return _cdp_endpoint


atexit.register(release_browser)
