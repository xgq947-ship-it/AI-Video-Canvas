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
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

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


def _connect(handler: Any) -> Any:
    """Attach to the dedicated headless Chrome and run ``handler(context)``."""
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

    ok, message = chrome_cdp.start_chrome(headless=True)
    if not ok:
        raise WebHttpBridgeError(message or "无法启动 Evan 专属 Chrome", error_code="BROWSER_CLOSED")

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
    try:
        return str(page.evaluate("() => window.name || ''") or "")
    except Exception:
        return ""


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


def _provider_page(context: Any, provider: str, desired_url: str | None = None) -> Any:
    """Return a long-lived page parked on the provider's origin.

    Deliberately does **not** run ``cleanup_playwright_context``: closing other
    pages is exactly the bug documented in ``geminiWebWorkflow.js`` — a bridge
    call would kill a browser-workflow task running in parallel.
    """
    marker = f"{WEBHTTP_WINDOW_PREFIX}{provider}"
    expected_host = PROVIDER_HOSTS[provider]

    pages = []
    stale_marker = None
    for candidate in list(getattr(context, "pages", []) or []):
        try:
            if candidate.is_closed():
                continue
        except Exception:
            continue
        current = str(getattr(candidate, "url", "") or "")
        host = (urlparse(current).hostname or "").lower()
        candidate_marker = _page_window_name(candidate) == marker
        if candidate_marker and host != expected_host:
            stale_marker = candidate
        pages.append((candidate, current, host, candidate_marker))

    # Sites are allowed to overwrite window.name and redirects can strand an
    # old marker on google.com/sorry. Prefer a healthy origin page over marker
    # identity, and only reuse a redirected marker if no healthy page exists.
    page = None
    for require_marker, require_target in ((True, True), (False, True), (True, False), (False, False)):
        for candidate, current, host, candidate_marker in reversed(pages):
            if host != expected_host:
                continue
            if require_marker and not candidate_marker:
                continue
            if require_target and desired_url and not _same_page_target(current, desired_url):
                continue
            page = candidate
            break
        if page is not None:
            break

    if page is None:
        page = stale_marker or context.new_page()

    def mark_page() -> None:
        try:
            page.evaluate("(name) => { window.name = name; }", marker)
        except Exception:
            pass

    current = str(getattr(page, "url", "") or "")
    host = (urlparse(current).hostname or "").lower()

    # 有些平台的权益判定与请求来源页面绑定：实测即梦同一份生图请求，从
    # /ai-tool/generate?type=image 发出可以通过鉴权，从 ?type=video 发出则一律
    # permission denied。所以调用方可以指定必须待在哪个工具页上。
    if host == expected_host:
        if not desired_url or _same_page_target(current, desired_url):
            mark_page()
            return page
        page.goto(desired_url, wait_until="domcontentloaded", timeout=PAGE_READY_TIMEOUT_MS)
        # 应用要把安全 SDK 和工具页初始化完才会给请求补签名；实测 3 秒不够，
        # 太早发出的请求会被判 permission denied。
        page.wait_for_timeout(9000)
        mark_page()
        return page

    # A single redirect is not proof of a logout: these apps intermittently bounce
    # through a consent/interstitial page and land correctly on a second attempt.
    # Reporting AUTH_REQUIRED on the first bounce would push `auto` mode into a
    # browser fallback (and the user into a pointless re-login) for a blip.
    target = desired_url or PROVIDER_ORIGINS[provider]
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
            mark_page()
            return page

    raise WebHttpBridgeError(
        f"{provider} 页面被重定向到 {host or '未知地址'}，通常表示登录已失效或平台暂时不可用",
        error_code="AUTH_REQUIRED",
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

    results = _connect(_run)
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

    payload = _connect(_run)
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
