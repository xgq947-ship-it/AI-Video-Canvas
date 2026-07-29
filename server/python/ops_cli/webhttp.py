"""Page-context HTTP bridge for the Gemini Web / 即梦 / Flow HTTP channels.

Why this exists
---------------
The three web platforms all sign or authenticate their business requests from
inside the logged-in page:

- 即梦 appends ``msToken`` / ``a_bogus`` and the ``sign`` header from its own
  secsdk wrapper around ``window.fetch`` / ``XMLHttpRequest``.
- Flow needs a short-lived Bearer plus a per-action reCAPTCHA token.
- Gemini needs the Google login cookies plus the per-page ``at`` / ``bl`` /
  ``f.sid`` bootstrap values.

Reimplementing any of that in Node is either impossible (``a_bogus``) or
guaranteed to rot. So this module keeps exactly one job in Python: **run one
fetch from inside the already-logged-in page and hand the raw bytes back**.
All protocol construction, polling, result parsing and final media downloading
live in Node (``server/services/webhttp/``).

This is *not* DOM automation: nothing here looks for a button, an editor or a
result tile. The page is only a signed, authenticated network context.

Secret handling
---------------
``ops_cli.cli_helpers._execute`` writes the command ``params`` **and** the
response ``data`` into ``logs/app.log`` and into the runtime context JSON that
``deriveRunId`` reads. Cookies, tokens and request bodies therefore must never
travel through either. They are exchanged over caller-owned temp files instead,
and only the file paths appear in ``params`` / ``data``.
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from urllib.request import urlopen

from ops_cli.config import get_config
from ops_cli.output import CommandResponse


# Origin each provider's requests must be issued from. The business APIs are
# either same-origin with these, or CORS-allow only these origins
# (imagex.bytedanceapi.com for 即梦, aisandbox-pa.googleapis.com for Flow,
# push.clients6.google.com for Gemini).
PROVIDER_ORIGINS = {
    "gemini-web": "https://gemini.google.com/app",
    "jimeng": "https://jimeng.jianying.com/ai-tool/generate?type=video",
    "google-flow": "https://labs.google/fx/tools/flow",
}

PROVIDER_HOSTS = {
    "gemini-web": "gemini.google.com",
    "jimeng": "jimeng.jianying.com",
    "google-flow": "labs.google",
}

# Hosts whose cookies Node needs in order to download finished media directly
# (the CDNs do not CORS-allow reading a response body from the page).
PROVIDER_COOKIE_URLS = {
    "gemini-web": ["https://gemini.google.com/", "https://google.com/", "https://lh3.googleusercontent.com/"],
    "jimeng": ["https://jimeng.jianying.com/"],
    "google-flow": ["https://labs.google/", "https://google.com/"],
}

WEBHTTP_WINDOW_PREFIX = "ops-cli:webhttp:"
WEBHTTP_HASH_KEY = "evan-ai-video-canvas"
WEBHTTP_SESSION_KEY = "__evan_ai_video_canvas_webhttp__"

# 两个独立 ops_cli 进程可能同时发现「没有桥接页」并各开一个标签。Node 侧已有
# provider 级队列，但 CLI 也可能被直接调用，所以页面选择/创建仍需跨进程互斥。
PAGE_LOCK_TIMEOUT_SECONDS = 4 * 60
PAGE_LOCK_STALE_SECONDS = 10 * 60
PAGE_LOCK_POLL_SECONDS = 0.05
INVALID_LOCK_OWNER_GRACE_SECONDS = 1

# 快照类调用（读 window.name）遇到卡死的页面不能一直等：桥接页每次请求都要遍历
# 全部标签页，默认 30 秒超时乘以标签数会把整个请求拖垮。
PAGE_SNAPSHOT_TIMEOUT_MS = 2000
PAGE_DEFAULT_TIMEOUT_MS = 30000

# Base64 round-trips through page.evaluate as a JSON string. Multi-MB payloads
# get slow and fragile long before they get impossible, so refuse early and let
# Node fall back to the browser workflow instead of hanging.
MAX_BRIDGE_BODY_BYTES = 24 * 1024 * 1024

DEFAULT_FETCH_TIMEOUT_SECONDS = 120
PAGE_READY_TIMEOUT_MS = 90_000


class WebHttpBridgeError(RuntimeError):
    """Bridge-level failure. ``submitted`` stays False: nothing reached the API."""

    def __init__(self, message: str, *, error_code: str = "WEB_HTTP_BRIDGE_FAILED") -> None:
        super().__init__(message)
        self.error_code = error_code
        self.retryable = True
        self.submitted = False


# The single in-page request.
#
# Transport matters, and not for style: 即梦's security SDK adds the `sign` /
# `device-time` / `x-secsdk-web-signature` headers by hooking
# `XMLHttpRequest`, **not** `window.fetch`. Measured against the live API, the
# identical body sent via fetch is rejected with `ret=3018 permission denied`
# while the XHR path gets past the entitlement check. `window.fetch` still gets
# the BDMS query signing (msToken / a_bogus), which is why the lighter
# endpoints work either way — but anything on the protected-path list has to go
# out over XHR.
#
# Both branches deliberately use the live globals rather than captured
# references, so whatever the page has wrapped stays wrapped.
_FETCH_SCRIPT = """
async (spec) => {
  if (spec.transport === 'xhr') {
    return await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open(spec.method || 'GET', spec.url, true);
      xhr.withCredentials = (spec.credentials || 'include') !== 'omit';
      xhr.responseType = 'arraybuffer';
      xhr.timeout = spec.timeoutMs;
      for (const [key, value] of Object.entries(spec.headers || {})) {
        try { xhr.setRequestHeader(key, value); } catch (error) { /* forbidden header */ }
      }
      const encodeBuffer = (buffer) => {
        const bytes = new Uint8Array(buffer || new ArrayBuffer(0));
        let binary = '';
        const chunk = 0x8000;
        for (let index = 0; index < bytes.length; index += chunk) {
          binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
        }
        return btoa(binary);
      };
      const headersOf = () => {
        const out = {};
        String(xhr.getAllResponseHeaders() || '').trim().split(/[\\r\\n]+/).forEach((line) => {
          const at = line.indexOf(':');
          if (at > 0) out[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
        });
        return out;
      };
      xhr.onload = () => resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        statusText: xhr.statusText || '',
        url: xhr.responseURL || spec.url,
        redirected: false,
        headers: headersOf(),
        bodyBase64: encodeBuffer(xhr.response)
      });
      const fail = (reason) => resolve({
        ok: false, status: 0, statusText: reason, url: spec.url,
        networkError: true, headers: {}, bodyBase64: ''
      });
      xhr.onerror = () => fail('xhr network error');
      xhr.ontimeout = () => fail('xhr timeout');
      xhr.onabort = () => fail('xhr aborted');

      let body = null;
      if (spec.bodyBase64) {
        const binary = atob(spec.bodyBase64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        body = bytes;
      } else if (typeof spec.bodyText === 'string') {
        body = spec.bodyText;
      }
      xhr.send(body);
    });
  }
  return await (async (spec) => {
  const decode = (value) => {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  };
  const encode = (bytes) => {
    let binary = '';
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
    }
    return btoa(binary);
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), spec.timeoutMs);
  try {
    const init = {
      method: spec.method || 'GET',
      headers: spec.headers || {},
      credentials: spec.credentials || 'include',
      redirect: spec.redirect || 'follow',
      signal: controller.signal
    };
    if (spec.bodyBase64) init.body = decode(spec.bodyBase64);
    else if (typeof spec.bodyText === 'string') init.body = spec.bodyText;

    const response = await fetch(spec.url, init);
    const buffer = new Uint8Array(await response.arrayBuffer());
    const headers = {};
    response.headers.forEach((value, key) => { headers[key] = value; });
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText || '',
      url: response.url || spec.url,
      redirected: Boolean(response.redirected),
      headers,
      bodyBase64: encode(buffer)
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: String((error && error.message) || error || 'fetch failed'),
      url: spec.url,
      networkError: true,
      headers: {},
      bodyBase64: ''
    };
  } finally {
    clearTimeout(timer);
  }
  })(spec);
}
"""


# Provider auth/bootstrap context. Everything here is read at runtime; no value
# is ever persisted by this module.
_CONTEXT_SCRIPTS = {
    # Gemini's bootstrap lives in the app document itself. Re-fetching the app
    # page is only a fallback: current Gemini can reject an HTML fetch while the
    # already-loaded app and its generation RPCs remain valid.
    "gemini-web": """
    async () => {
      const wiz = window.WIZ_global_data || {};
      let html = document.documentElement ? document.documentElement.innerHTML : '';
      let status = 200;
      if (!wiz.SNlM0e || !wiz.cfb2h || !wiz.FdrFJe || !wiz.S06Grb) {
        try {
          const response = await fetch('https://gemini.google.com/app', {
            credentials: 'include',
            headers: { 'cache-control': 'no-cache' }
          });
          status = response.status;
          html = await response.text();
        } catch (error) {
          status = 0;
        }
      }
      const pick = (key) => {
        if (wiz[key] !== undefined && wiz[key] !== null) return String(wiz[key]);
        const patterns = [
          new RegExp('"' + key + '"\\\\s*:\\\\s*"([^"]+)"'),
          new RegExp("'" + key + "'\\\\s*:\\\\s*'([^']+)'"),
          new RegExp(key + '\\\\\\\\":\\\\\\\\"([^\\\\\\\\"]+)')
        ];
        for (const pattern of patterns) {
          const match = html.match(pattern);
          if (match && match[1]) return match[1];
        }
        return '';
      };
      const at = pick('SNlM0e');
      const bl = pick('cfb2h');
      const fSid = pick('FdrFJe');
      const userId = pick('S06Grb');
      // Scotty 上传要求 push-id（Feed name），缺了它一律 400
      // "Request without ClientId (Feed name)"。feed id 随 Gemini build 变化，
      // 所以从页面里读，不写死。
      const feedIds = Array.from(new Set(
        (html.match(/feeds\\/[a-zA-Z0-9]{6,}/g) || [])
      )).slice(0, 5);
      return {
        status,
        at,
        bl,
        fSid,
        feedIds,
        userId,
        // 登录判定 = S06Grb（Google 账号标识）+ SNlM0e（bootstrap token）。
        // FdrFJe 刻意不参与：未登录页面同样带它，按它判断会把访客判成已登录。
        signedIn: Boolean(userId && at)
      };
    }
    """,
    # Flow: NextAuth session carries the aisandbox Bearer; projectId comes from
    # the current /project/<id> route or the app's own storage; the reCAPTCHA
    # token is minted per call from the site key the page already loaded.
    "google-flow": """
    async (options) => {
      const result = { projectId: '', accessToken: '', recaptchaToken: '', sessionId: '', email: '' };
      const recaptchaAction = String(options && options.recaptchaAction || '');
      try {
        const response = await fetch('/fx/api/auth/session', { credentials: 'include' });
        if (response.ok) {
          const session = await response.json();
          result.accessToken = session?.access_token || session?.accessToken
            || session?.user?.access_token || '';
          result.email = session?.user?.email || '';
          result.userName = session?.user?.name || '';
          result.expires = session?.expires || '';
        }
      } catch (error) { result.sessionError = String(error && error.message || error); }

      // Flow exposes the account's currently healthy video families through
      // the same authenticated endpoint used by the model picker. Keep the
      // response raw: Node normalizes only reviewed protocol families.
      if (result.accessToken) {
        try {
          const response = await fetch('https://aisandbox-pa.googleapis.com/v1/flow/models/statuses', {
            credentials: 'include',
            headers: {
              authorization: 'Bearer ' + result.accessToken,
              'cache-control': 'no-cache'
            }
          });
          result.modelStatusHttpStatus = response.status;
          if (response.ok) result.modelConfig = await response.json();
        } catch (error) {
          result.modelConfigError = String(error && error.message || error);
        }
      }

      // projectId 只能从已登录会话里读，不能猜。按可靠度依次尝试：
      // 当前路由 → 页面上的项目链接 → 本地存储。项目列表是客户端渲染的，
      // 所以这里读的是**已 hydrate 的页面**，raw fetch 拿到的营销页里没有。
      const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
      const fromPath = location.pathname.match(new RegExp('/project/(' + UUID.source + ')', 'i'));
      if (fromPath) result.projectId = fromPath[1];

      if (!result.projectId) {
        for (const anchor of document.querySelectorAll('a[href*="/project/"]')) {
          const match = String(anchor.getAttribute('href') || '').match(UUID);
          if (match) { result.projectId = match[0]; break; }
        }
      }
      if (!result.projectId) {
        for (const storage of [window.localStorage, window.sessionStorage]) {
          if (!storage) continue;
          for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);
            if (!key || !/project|flow|pinhole/i.test(key)) continue;
            const match = String(storage.getItem(key) || '').match(UUID);
            if (match) { result.projectId = match[0]; break; }
          }
          if (result.projectId) break;
        }
      }
      if (!result.projectId) {
        // 最后兜底：hydrate 后的 DOM 里通常仍带着项目 id（Next.js flight 数据）。
        const match = document.documentElement.innerHTML.match(
          new RegExp('project[^0-9a-f]{0,12}(' + UUID.source + ')', 'i')
        );
        if (match) result.projectId = match[1];
      }

      result.sessionId = ';' + Date.now();

      const siteKeyFrom = () => {
        const scripts = Array.from(document.querySelectorAll('script[src*="recaptcha"]'));
        for (const script of scripts) {
          const match = String(script.src).match(/[?&]render=([^&]+)/);
          if (match && match[1] && match[1] !== 'explicit') return decodeURIComponent(match[1]);
        }
        const inline = document.documentElement.innerHTML.match(/6L[0-9A-Za-z_-]{30,}/);
        return inline ? inline[0] : '';
      };
      const siteKey = siteKeyFrom();
      result.recaptchaSiteKey = siteKey ? 'present' : '';
      const grecaptcha = window.grecaptcha && (window.grecaptcha.enterprise || window.grecaptcha);
      // reCAPTCHA enterprise tokens are action-bound and single-use. Auth probes
      // deliberately do not mint one; generation asks for the exact current
      // Flow action immediately before its billable request.
      if (recaptchaAction && siteKey && grecaptcha && typeof grecaptcha.execute === 'function') {
        try {
          await new Promise((resolve) => {
            if (typeof grecaptcha.ready === 'function') grecaptcha.ready(resolve);
            else resolve();
          });
          result.recaptchaToken = await grecaptcha.execute(siteKey, { action: recaptchaAction });
        } catch (error) {
          result.recaptchaError = String(error && error.message || error);
        }
      }
      return result;
    }
    """,
    # 即梦 signs from the page, so Node needs no secret here — only the account
    # / model configuration used for dynamic model discovery.
    "jimeng": """
    async () => {
      const result = { webId: '', aid: 513695, appVersion: '', signedIn: false };
      // 整页文档只拉一次：登录判定与模型表解析共用，避免多一次几百 KB 的请求。
      let html = '';
      // 诊断用：即梦的 secsdk 是否包装了 window.fetch / XHR。
      // 整个 HTTP 通道之所以把请求放进页面里发，就是为了让站点自己的包装去补
      // sign / msToken / a_bogus。若两者都是原生实现，说明当前这批接口只靠 Cookie
      // 鉴权；一旦平台恢复强制签名，这个字段能第一时间指出问题在哪。
      try {
        result.fetchWrapped = !/\\[native code\\]/.test(String(window.fetch));
        result.xhrWrapped = !/\\[native code\\]/.test(String(window.XMLHttpRequest.prototype.open));
      } catch (error) { result.wrapProbeError = String(error && error.message || error); }
      // 登录判定读 /ai-tool/generate 的**原始文档**里的 window.__isLogined：
      // 不需要签名、不消耗积分、不建 Workspace。不能读 hydrate 后的页面，
      // 应用启动后可能把这个全局变量改掉或删掉。
      try {
        const response = await fetch('https://jimeng.jianying.com/ai-tool/generate', {
          credentials: 'include',
          headers: { 'cache-control': 'no-cache' }
        });
        html = await response.text();
        const match = html.match(/window\\.__isLogined\\s*=\\s*(true|false)/);
        result.loginFlag = match ? match[1] : '';
        result.hasUserInfo = html.indexOf('__userInfoStringify') >= 0;
        result.signedIn = result.loginFlag === 'true' && result.hasUserInfo;
      } catch (error) { result.userError = String(error && error.message || error); }
      // webId 是生成请求必带的查询参数，来源是 _tea_web_id Cookie。
      // 缺它时 aigc_draft/generate 直接 permission denied。
      try {
        const match = String(document.cookie || '').match(/(?:^|;\\s*)_tea_web_id=([^;]+)/);
        result.webId = match ? decodeURIComponent(match[1]) : '';
      } catch (error) { /* cookie may be blocked */ }
      try {
        const raw = window.localStorage ? window.localStorage.getItem('web_version') : '';
        if (raw) result.appVersion = String(raw).slice(0, 32);
      } catch (error) { /* storage may be blocked */ }
      // 模型表由服务端随页面下发，是当前账号**真实可用**的那一份。
      // 之前去猜 /get_model_list 之类的接口名，一个都没猜中。
      try {
        const pick = (name) => {
          const key = 'window.' + name + '=';
          const at = html.indexOf(key);
          if (at < 0) return null;
          let start = html.indexOf('{', at), depth = 0, inStr = false, esc = false;
          for (let i = start; i < html.length; i += 1) {
            const c = html[i];
            if (inStr) { if (esc) esc = false; else if (c === '\\\\') esc = true; else if (c === '"') inStr = false; continue; }
            if (c === '"') inStr = true;
            else if (c === '{') depth += 1;
            else if (c === '}') { depth -= 1; if (depth === 0) { try { return JSON.parse(html.slice(start, i + 1)); } catch (e) { return null; } } }
          }
          return null;
        };
        result.modelConfig = {
          image: pick('__image_generate_model_config__'),
          video: pick('__video_generate_model_config__')
        };
      } catch (error) { result.modelConfigError = String(error && error.message || error); }
      return result;
    }
    """
}


def _require_provider(provider: str) -> str:
    if provider not in PROVIDER_ORIGINS:
        raise WebHttpBridgeError(
            f"不支持的 HTTP 通道平台：{provider}",
            error_code="WEB_HTTP_UNSUPPORTED_PROVIDER",
        )
    return provider


def _load_sessionhub() -> Any:
    sessionhub_root = Path(get_config().sessionhub_root).expanduser().resolve()
    if str(sessionhub_root) not in sys.path:
        sys.path.insert(0, str(sessionhub_root))
    from scene import chrome_cdp  # type: ignore

    return chrome_cdp


def _connect(
    handler: Any,
    *,
    provider: str,
    initial_url: str | None = None,
) -> Any:
    """Attach for one request, then disconnect without closing Chrome or its page."""
    chrome_cdp = _load_sessionhub()

    # 只在**必要时**重启浏览器。
    #
    # start_chrome 自带复用分支，所以无条件 stop_chrome() 等于每次都主动摧毁复用、
    # 付一次完整冷启动。但也不能一律跳过：用户点「重新登录」打开的是可见实例，
    # 它没有 CDP（刻意的，避免 Google 判定成自动化登录），而且刚输入的 Cookie
    # 要等它优雅退出才落盘 —— 直接连过去会读到还没写盘的状态，
    # 表现就是「刚登录成功却显示未登录」。
    # 因此按实例种类判断：已经是无头且可被 Playwright 接管的才直接复用。
    pid = chrome_cdp._instance_pid()
    reusable = (
        pid is not None
        and chrome_cdp._instance_is_headless(pid)
        and chrome_cdp._instance_supports_playwright(pid)
    )
    if not reusable:
        chrome_cdp.stop_chrome()

    ok, message = chrome_cdp.start_chrome(
        headless=True,
        # On a cold start Chrome creates its first tab at the final marked URL.
        # It must not create an about:blank anchor and then a second provider tab.
        initial_url=_tagged_provider_url(provider, initial_url or PROVIDER_ORIGINS[provider]),
    )
    if not ok:
        raise WebHttpBridgeError(message or "无法启动 Evan 专属 Chrome", error_code="BROWSER_CLOSED")
    if not reusable:
        _remember_launched_project_target(chrome_cdp.CDP_PORT, provider)

    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except ModuleNotFoundError as exc:  # pragma: no cover - environment guard
        raise WebHttpBridgeError(
            "缺少 Playwright，请先运行：npm run setup:automation-runtime",
            error_code="BROWSER_MODELS_NOT_READY",
        ) from exc

    with sync_playwright() as playwright:
        browser = playwright.chromium.connect_over_cdp(f"http://127.0.0.1:{chrome_cdp.CDP_PORT}")
        context = browser.contexts[0] if browser.contexts else browser.new_context()
        return handler(context)


def _page_window_name(page: Any) -> str:
    has_timeout = hasattr(page, "set_default_timeout")
    if has_timeout:
        try:
            page.set_default_timeout(PAGE_SNAPSHOT_TIMEOUT_MS)
        except Exception:
            has_timeout = False
    try:
        return str(page.evaluate("() => window.name || ''") or "")
    except Exception:
        return ""
    finally:
        if has_timeout:
            try:
                page.set_default_timeout(PAGE_DEFAULT_TIMEOUT_MS)
            except Exception:
                pass


def _bridge_state_path() -> Path:
    return Path(get_config().runtime_dir) / "webhttp_bridge_pages.json"


def _runtime_lock_path(name: str) -> Path:
    return Path(get_config().runtime_dir) / f"{name}.lock"


def _pid_is_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def _read_lock_owner(path: Path) -> tuple[str, int, float]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        try:
            return "", 0, path.stat().st_mtime
        except OSError:
            return "", 0, 0.0
    if not isinstance(payload, dict):
        return "", 0, 0.0
    try:
        pid = int(payload.get("pid") or 0)
        created_at = float(payload.get("createdAt") or 0)
    except (TypeError, ValueError):
        pid, created_at = 0, 0.0
    return str(payload.get("token") or ""), pid, created_at


@contextmanager
def _exclusive_runtime_lock(
    name: str,
    *,
    timeout_seconds: float = PAGE_LOCK_TIMEOUT_SECONDS,
    stale_seconds: float = PAGE_LOCK_STALE_SECONDS,
) -> Iterator[None]:
    """Small stdlib-only inter-process lock scoped to Evan's runtime directory.

    ``bridge.js`` serialises the normal Node call path, but direct CLI calls and
    two Electron utility processes can still overlap. ``O_EXCL`` gives us one
    creator on macOS and Windows without adding a runtime dependency.
    """
    path = _runtime_lock_path(name)
    path.parent.mkdir(parents=True, exist_ok=True)
    token = f"{os.getpid()}-{uuid.uuid4().hex}"
    deadline = time.monotonic() + max(0.1, timeout_seconds)

    while True:
        try:
            fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            _, owner_pid, created_at = _read_lock_owner(path)
            age = max(0.0, time.time() - created_at) if created_at else stale_seconds + 1
            owner_is_dead = owner_pid > 0 and not _pid_is_alive(owner_pid)
            invalid_owner_is_stale = (
                owner_pid <= 0 and age > INVALID_LOCK_OWNER_GRACE_SECONDS
            )
            valid_owner_is_stale = owner_pid > 0 and age > stale_seconds
            if owner_is_dead or invalid_owner_is_stale or valid_owner_is_stale:
                try:
                    path.unlink()
                except FileNotFoundError:
                    pass
                except OSError:
                    pass
                continue
            if time.monotonic() >= deadline:
                raise WebHttpBridgeError(
                    "等待 Evan 项目标签复用锁超时，请稍后重试",
                    error_code="WEB_HTTP_PAGE_LOCK_TIMEOUT",
                )
            time.sleep(PAGE_LOCK_POLL_SECONDS)
            continue

        try:
            payload = json.dumps(
                {"token": token, "pid": os.getpid(), "createdAt": time.time()},
                ensure_ascii=False,
            )
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(payload)
        except Exception:
            try:
                path.unlink()
            except OSError:
                pass
            raise
        break

    try:
        yield
    finally:
        owner_token, _, _ = _read_lock_owner(path)
        if owner_token == token:
            try:
                path.unlink()
            except FileNotFoundError:
                pass
            except OSError:
                pass


def _page_target_id(context: Any, page: Any) -> str | None:
    """CDP targetId：跨进程、跨导航都不变的标签页身份。

    ``window.name`` 会在跨站导航时被 Chrome 清空（labs.google → google.com/sorry
    就是一次跨站导航），一旦清空，旧实现既认不出这个页面、也不肯复用别的 host 上的
    页面，于是每次请求都 ``new_page()``，标签页无上限增长。targetId 不受此影响。
    """
    hinted = getattr(page, "target_id", None)
    if hinted:
        return str(hinted)
    try:
        session = context.new_cdp_session(page)
    except Exception:
        return None
    try:
        info = session.send("Target.getTargetInfo") or {}
        target_id = ((info.get("targetInfo") or {}).get("targetId")) or None
        return str(target_id) if target_id else None
    except Exception:
        return None
    finally:
        try:
            session.detach()
        except Exception:
            pass


def _read_bridge_state_unlocked() -> dict[str, str]:
    try:
        payload = json.loads(_bridge_state_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(payload, dict):
        return {}
    return {str(key): str(value) for key, value in payload.items() if value}


def _read_bridge_target_id(provider: str) -> str | None:
    with _exclusive_runtime_lock("webhttp-bridge-state"):
        return _read_bridge_state_unlocked().get(provider)


def _write_bridge_target_id(provider: str, target_id: str | None) -> None:
    if not target_id:
        return
    path = _bridge_state_path()
    with _exclusive_runtime_lock("webhttp-bridge-state"):
        payload = _read_bridge_state_unlocked()
        if payload.get(provider) == target_id:
            return
        payload[provider] = target_id
        temp_path = path.with_name(f".{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp")
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            temp_path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            os.replace(temp_path, path)
        except OSError:
            try:
                temp_path.unlink()
            except OSError:
                pass


def _project_marker(provider: str) -> str:
    return f"{WEBHTTP_WINDOW_PREFIX}{provider}"


def _tagged_provider_url(provider: str, url: str | None = None) -> str:
    """Attach Evan's exact project marker without changing host/path/query."""
    target = str(url or PROVIDER_ORIGINS[provider])
    parsed = urlparse(target)
    pairs = [
        (key, value)
        for key, value in parse_qsl(parsed.fragment, keep_blank_values=True)
        if key != WEBHTTP_HASH_KEY
    ]
    pairs.append((WEBHTTP_HASH_KEY, provider))
    return urlunparse(parsed._replace(fragment=urlencode(pairs)))


def _url_has_project_marker(url: str, provider: str) -> bool:
    try:
        fragment = urlparse(url).fragment
        return any(
            key == WEBHTTP_HASH_KEY and value == provider
            for key, value in parse_qsl(fragment, keep_blank_values=True)
        )
    except (TypeError, ValueError):
        return False


def _remember_launched_project_target(port: int, provider: str) -> str | None:
    """Capture the direct cold-start target before a fast SPA can drop its hash."""
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        try:
            with urlopen(f"http://127.0.0.1:{port}/json/list", timeout=0.5) as response:
                targets = json.loads(response.read().decode("utf-8"))
        except (OSError, ValueError):
            targets = []
        if isinstance(targets, list):
            for target in targets:
                if not isinstance(target, dict) or target.get("type") != "page":
                    continue
                if not _url_has_project_marker(str(target.get("url") or ""), provider):
                    continue
                target_id = str(target.get("id") or "")
                if target_id:
                    _write_bridge_target_id(provider, target_id)
                    return target_id
        time.sleep(0.05)
    return None


_PROJECT_IDENTITY_SCRIPT = """
(spec) => {
  let sessionMarker = '';
  let hashMarker = '';
  try {
    sessionMarker = String(window.sessionStorage.getItem(spec.sessionKey) || '');
  } catch (error) { /* storage may be unavailable on an interstitial */ }
  try {
    const params = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
    hashMarker = String(params.get(spec.hashKey) || '');
  } catch (error) { /* malformed/opaque URL */ }
  return {
    windowName: String(window.name || ''),
    sessionMarker,
    hashMarker,
    href: String(window.location.href || '')
  };
}
"""

_MARK_PROJECT_PAGE_SCRIPT = """
(spec) => {
  window.name = spec.windowName;
  try {
    window.sessionStorage.setItem(spec.sessionKey, spec.provider);
  } catch (error) { /* storage may be unavailable on an interstitial */ }
  try {
    const currentHash = String(window.location.hash || '').replace(/^#/, '');
    const params = new URLSearchParams(currentHash);
    // Provider pages in this project are path-routed. Preserve any unexpected
    // third-party hash route instead of rewriting it; window.name/targetId still
    // retain identity in that edge case.
    if (!currentHash || params.has(spec.hashKey)) {
      params.set(spec.hashKey, spec.provider);
      const suffix = params.toString();
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + window.location.search + (suffix ? '#' + suffix : '')
      );
    }
  } catch (error) { /* history may be blocked on an interstitial */ }
  return {
    windowName: String(window.name || ''),
    href: String(window.location.href || '')
  };
}
"""


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


def _project_page_identity(page: Any, provider: str) -> dict[str, str] | None:
    spec = {
        "windowName": _project_marker(provider),
        "sessionKey": WEBHTTP_SESSION_KEY,
        "hashKey": WEBHTTP_HASH_KEY,
        "provider": provider,
    }
    try:
        raw = _with_page_snapshot_timeout(
            page,
            lambda: page.evaluate(_PROJECT_IDENTITY_SCRIPT, spec),
        )
    except Exception:
        return None
    if not isinstance(raw, dict):
        return None
    return {
        "window_name": str(raw.get("windowName") or ""),
        "session_marker": str(raw.get("sessionMarker") or ""),
        "hash_marker": str(raw.get("hashMarker") or ""),
        "href": str(raw.get("href") or ""),
    }


def _mark_project_page(page: Any, provider: str) -> bool:
    spec = {
        "windowName": _project_marker(provider),
        "sessionKey": WEBHTTP_SESSION_KEY,
        "hashKey": WEBHTTP_HASH_KEY,
        "provider": provider,
    }
    try:
        raw = _with_page_snapshot_timeout(
            page,
            lambda: page.evaluate(_MARK_PROJECT_PAGE_SCRIPT, spec),
        )
        return bool(
            isinstance(raw, dict)
            and str(raw.get("windowName") or "") == _project_marker(provider)
        )
    except Exception:
        return False


def _inspect_project_page(
    context: Any,
    page: Any,
    provider: str,
    known_target_id: str | None,
) -> dict[str, Any] | None:
    try:
        if page.is_closed():
            return None
    except Exception:
        return None
    try:
        url = str(getattr(page, "url", "") or "")
    except Exception:
        url = ""
    target_id = _page_target_id(context, page)
    identity = _project_page_identity(page, provider)
    marker = _project_marker(provider)
    explicit_reasons: list[str] = []
    if known_target_id and target_id == known_target_id:
        explicit_reasons.append("target_id")
    if _url_has_project_marker(url, provider):
        explicit_reasons.append("url_hash")
    if identity:
        if identity["window_name"] == marker:
            explicit_reasons.append("window_name")
        if identity["session_marker"] == provider:
            explicit_reasons.append("session_storage")
        if identity["hash_marker"] == provider:
            explicit_reasons.append("page_hash")
    current_url = identity["href"] if identity and identity["href"] else url
    return {
        "page": page,
        "url": current_url,
        "host": (urlparse(current_url).hostname or "").lower(),
        "target_id": target_id,
        "responsive": identity is not None,
        "explicit": bool(explicit_reasons),
        "explicit_reasons": explicit_reasons,
        "identity": identity,
    }


def _snapshot_project_pages(
    context: Any,
    provider: str,
    known_target_id: str | None,
) -> list[dict[str, Any]]:
    snapshots: list[dict[str, Any]] = []
    for page in list(getattr(context, "pages", []) or []):
        item = _inspect_project_page(context, page, provider, known_target_id)
        if item is not None:
            snapshots.append(item)
    return snapshots


def _create_page_at_url(context: Any, target_url: str) -> Any:
    """Create a target at its final URL; never leave a helper about:blank tab."""
    browser = getattr(context, "browser", None)
    if browser is not None and hasattr(browser, "new_browser_cdp_session"):
        session = None
        target_id = None
        try:
            session = browser.new_browser_cdp_session()
            created = session.send("Target.createTarget", {"url": target_url}) or {}
            target_id = str(created.get("targetId") or "") or None
            if target_id:
                deadline = time.monotonic() + 8
                while time.monotonic() < deadline:
                    for candidate in list(getattr(context, "pages", []) or []):
                        if _page_target_id(context, candidate) == target_id:
                            return candidate
                    time.sleep(0.05)
                try:
                    session.send("Target.closeTarget", {"targetId": target_id})
                except Exception:
                    pass
        except Exception:
            pass
        finally:
            if session is not None:
                try:
                    session.detach()
                except Exception:
                    pass

    page = context.new_page()
    try:
        page.goto(target_url, wait_until="domcontentloaded", timeout=PAGE_READY_TIMEOUT_MS)
    except Exception:
        # Return the one target we created so the caller can mark it and apply
        # the normal crash/navigation retry without creating another page.
        pass
    return page


def _close_explicit_project_duplicates(
    context: Any,
    provider: str,
    keep_page: Any,
    initial_snapshots: list[dict[str, Any]],
) -> int:
    """Close only pages carrying this provider's exact Evan identity."""
    keep_target_id = _page_target_id(context, keep_page)
    snapshots = list(initial_snapshots)
    snapshots.extend(_snapshot_project_pages(context, provider, keep_target_id))
    seen_pages: set[int] = set()
    closed = 0
    for item in snapshots:
        page = item["page"]
        page_key = id(page)
        if page_key in seen_pages:
            continue
        seen_pages.add(page_key)
        if page is keep_page or not item.get("explicit"):
            continue
        try:
            if not page.is_closed():
                page.close()
                closed += 1
        except Exception:
            pass
    return closed


def _same_page_target(current: str, desired: str) -> bool:
    """Is the page already on the requested tool page?

    Compared by host + path + the `type` query parameter only. The app rewrites
    its own URL (appending `workspace=...`), so a strict string comparison would
    force a reload before every request.
    """
    a, b = urlparse(current), urlparse(desired)
    if (a.hostname or "").lower() != (b.hostname or "").lower():
        return False
    if (a.path or "/").rstrip("/") != (b.path or "/").rstrip("/"):
        return False
    from urllib.parse import parse_qs

    return parse_qs(a.query).get("type") == parse_qs(b.query).get("type")


def _park_provider_page(
    page: Any,
    provider: str,
    desired_url: str | None,
    *,
    settle_existing_hash_only: bool = False,
) -> Any:
    """Navigate one already-selected Evan page to the required provider tool."""
    expected_host = PROVIDER_HOSTS[provider]
    target = _tagged_provider_url(provider, desired_url or PROVIDER_ORIGINS[provider])
    current = str(getattr(page, "url", "") or "")
    host = (urlparse(current).hostname or "").lower()

    if host == expected_host and (not desired_url or _same_page_target(current, desired_url)):
        if hasattr(page, "wait_for_load_state"):
            try:
                page.wait_for_load_state("domcontentloaded", timeout=PAGE_READY_TIMEOUT_MS)
            except Exception:
                # A timeout can happen while the SPA keeps background requests
                # alive. Responsiveness is checked again by the caller.
                pass
        if settle_existing_hash_only:
            page.wait_for_timeout(9000)
        if not _mark_project_page(page, provider):
            raise RuntimeError("Evan 项目标签在标记时失去响应")
        return page

    # A single redirect is not proof of a logout: these apps intermittently bounce
    # through a consent/interstitial page and land correctly on a second attempt.
    for attempt in range(2):
        if attempt:
            page.wait_for_timeout(2_000)
        page.goto(
            target,
            wait_until="domcontentloaded",
            timeout=PAGE_READY_TIMEOUT_MS,
        )
        host = (urlparse(str(getattr(page, "url", "") or "")).hostname or "").lower()
        if host == expected_host:
            # 即梦的安全 SDK / Flow 的页面上下文要在 DOM ready 后继续初始化。
            page.wait_for_timeout(9000)
            if not _mark_project_page(page, provider):
                raise RuntimeError("Evan 项目标签在导航后失去响应")
            return page

    raise WebHttpBridgeError(
        f"{provider} 页面被重定向到 {host or '未知地址'}，通常表示登录已失效或平台暂时不可用",
        error_code="AUTH_REQUIRED",
    )


def _provider_page(context: Any, provider: str, desired_url: str | None = None) -> Any:
    """Return a long-lived page parked on the provider's origin.

    Identity is positive-only: exact URL hash, ``window.name``,
    ``sessionStorage`` or the persisted CDP targetId. Same-host pages without
    one of those markers are user pages and are never selected or closed.
    """
    expected_host = PROVIDER_HOSTS[provider]
    lock_name = f"webhttp-page-{provider}"
    with _exclusive_runtime_lock(lock_name):
        known_target_id = _read_bridge_target_id(provider)
        snapshots = _snapshot_project_pages(context, provider, known_target_id)
        responsive = [item for item in snapshots if item["explicit"] and item["responsive"]]

        def score(item: dict[str, Any]) -> tuple[int, int, int, int]:
            identity = item.get("identity") or {}
            return (
                int(bool(known_target_id and item.get("target_id") == known_target_id)),
                int(item.get("host") == expected_host),
                int(bool(desired_url and _same_page_target(item.get("url") or "", desired_url))),
                int(
                    identity.get("window_name") == _project_marker(provider)
                    or identity.get("session_marker") == provider
                ),
            )

        page = max(responsive, key=score)["page"] if responsive else None
        selected_snapshot = next((item for item in responsive if item["page"] is page), None)
        created = page is None
        if created:
            page = _create_page_at_url(
                context,
                _tagged_provider_url(provider, desired_url or PROVIDER_ORIGINS[provider]),
            )

        # Persist before navigation: if Chrome crashes or a platform redirects
        # cross-site and clears JS markers, the next request can still identify
        # this exact target instead of opening another one.
        _write_bridge_target_id(provider, _page_target_id(context, page))
        if not _mark_project_page(page, provider):
            # A direct cold-start URL can still be loading; _park_provider_page
            # waits for DOM readiness and marks it again.
            pass

        for recovery_attempt in range(2):
            selected_identity = (
                (selected_snapshot or {}).get("identity")
                if selected_snapshot
                else {}
            ) or {}
            marker_only = bool(
                selected_snapshot
                and selected_identity.get("window_name") != _project_marker(provider)
                and selected_identity.get("session_marker") != provider
            )
            try:
                _park_provider_page(
                    page,
                    provider,
                    desired_url,
                    settle_existing_hash_only=created or marker_only,
                )
                if _project_page_identity(page, provider) is None:
                    raise RuntimeError("Evan 项目标签没有响应")
                target_id = _page_target_id(context, page)
                _write_bridge_target_id(provider, target_id)
                _close_explicit_project_duplicates(context, provider, page, snapshots)
                return page
            except WebHttpBridgeError:
                # AUTH_REQUIRED still leaves one healthy fixed project page.
                if _project_page_identity(page, provider) is not None:
                    _mark_project_page(page, provider)
                    _write_bridge_target_id(provider, _page_target_id(context, page))
                    _close_explicit_project_duplicates(context, provider, page, snapshots)
                raise
            except Exception as exc:
                # Only a non-responsive/crashed target is replaced. A healthy
                # timeout/error is surfaced instead of silently multiplying tabs.
                if _project_page_identity(page, provider) is not None:
                    raise
                try:
                    page.close()
                except Exception:
                    pass
                if recovery_attempt:
                    raise WebHttpBridgeError(
                        f"{provider} 项目标签崩溃且自动恢复失败：{exc}",
                        error_code="BROWSER_PAGE_CRASHED",
                    ) from exc
                page = _create_page_at_url(
                    context,
                    _tagged_provider_url(provider, desired_url or PROVIDER_ORIGINS[provider]),
                )
                created = True
                selected_snapshot = None
                _write_bridge_target_id(provider, _page_target_id(context, page))

    raise WebHttpBridgeError(
        f"{provider} 项目标签不可用",
        error_code="BROWSER_PAGE_CRASHED",
    )


def _read_json(path: str | Path) -> Any:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise WebHttpBridgeError(
            f"无法读取 HTTP 通道请求文件：{exc}",
            error_code="WEB_HTTP_BAD_REQUEST",
        ) from exc


def _write_json(path: str | Path, payload: Any) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _normalize_spec(spec: Any, timeout_seconds: int) -> dict[str, Any]:
    if not isinstance(spec, dict) or not spec.get("url"):
        raise WebHttpBridgeError("HTTP 通道请求缺少 url", error_code="WEB_HTTP_BAD_REQUEST")

    body_base64 = spec.get("bodyBase64")
    if body_base64:
        try:
            size = len(base64.b64decode(str(body_base64), validate=False))
        except Exception as exc:
            raise WebHttpBridgeError("HTTP 通道请求体不是合法 base64", error_code="WEB_HTTP_BAD_REQUEST") from exc
        if size > MAX_BRIDGE_BODY_BYTES:
            raise WebHttpBridgeError(
                f"HTTP 通道请求体过大（{size} 字节，上限 {MAX_BRIDGE_BODY_BYTES}）",
                error_code="WEB_HTTP_BODY_TOO_LARGE",
            )

    return {
        "url": str(spec["url"]),
        "method": str(spec.get("method") or "GET").upper(),
        "headers": {str(k): str(v) for k, v in (spec.get("headers") or {}).items()},
        "bodyBase64": body_base64 or None,
        "bodyText": spec.get("bodyText"),
        "credentials": spec.get("credentials") or "include",
        "redirect": spec.get("redirect") or "follow",
        # fetch 默认；受保护端点用 xhr 才能拿到站点自己加的 sign 头。
        "transport": "xhr" if str(spec.get("transport") or "").lower() == "xhr" else "fetch",
        "pageUrl": spec.get("pageUrl") or None,
        "timeoutMs": max(1, int(spec.get("timeoutSeconds") or timeout_seconds)) * 1000,
    }


def run_web_fetch(
    *,
    provider: str,
    request_file: str,
    response_file: str,
    timeout_seconds: int = DEFAULT_FETCH_TIMEOUT_SECONDS,
) -> CommandResponse:
    """Execute one or more fetches from the provider page; write results to disk.

    The request file holds either a single request spec or ``{"requests": [...]}``
    so a whole upload handshake can be replayed without re-attaching to CDP.
    """
    _require_provider(provider)
    raw = _read_json(request_file)
    raw_requests = raw.get("requests") if isinstance(raw, dict) and "requests" in raw else [raw]
    specs = [_normalize_spec(item, timeout_seconds) for item in raw_requests]

    desired_page = next((item.get("pageUrl") for item in specs if item.get("pageUrl")), None)

    def _run(context: Any) -> list[dict[str, Any]]:
        page = _provider_page(context, provider, desired_page)
        page.set_default_timeout(max(specs, key=lambda s: s["timeoutMs"])["timeoutMs"] + 15_000)
        results: list[dict[str, Any]] = []
        for spec in specs:
            started = time.monotonic()
            result = page.evaluate(_FETCH_SCRIPT, spec)
            result["elapsedMs"] = int((time.monotonic() - started) * 1000)
            results.append(result)
            # A failed step invalidates every later step of a handshake.
            if not result.get("ok") and len(specs) > 1:
                break
        return results

    results = _connect(_run, provider=provider, initial_url=desired_page)
    _write_json(response_file, {"responses": results})

    summary = [
        {"status": item.get("status"), "ok": bool(item.get("ok")), "elapsedMs": item.get("elapsedMs")}
        for item in results
    ]
    return CommandResponse(
        success=True,
        platform="browser",
        command="web-fetch",
        data={
            "provider": provider,
            "response_file": response_file,
            "count": len(results),
            # Status codes only — never headers or bodies, which land in app.log.
            "statuses": summary,
        },
    )


def run_web_context(*, provider: str, output_file: str, recaptcha_action: str = "") -> CommandResponse:
    """Collect the provider's runtime auth/bootstrap context into ``output_file``."""
    _require_provider(provider)
    script = _CONTEXT_SCRIPTS[provider]

    def _run(context: Any) -> dict[str, Any]:
        page = _provider_page(context, provider)
        page.set_default_timeout(60_000)
        payload = page.evaluate(script, {"recaptchaAction": recaptcha_action})
        cookies = context.cookies(PROVIDER_COOKIE_URLS[provider])
        payload["cookies"] = [
            {
                "name": cookie.get("name"),
                "value": cookie.get("value"),
                "domain": cookie.get("domain"),
                "path": cookie.get("path"),
            }
            for cookie in cookies or []
        ]
        return payload

    payload = _connect(_run, provider=provider)
    _write_json(output_file, payload)

    # Report presence, never values.
    return CommandResponse(
        success=True,
        platform="browser",
        command="web-context",
        data={
            "provider": provider,
            "output_file": output_file,
            "cookie_count": len(payload.get("cookies") or []),
            "fields": sorted(key for key, value in payload.items() if key != "cookies" and value),
        },
    )
