/**
 * Node-side client for the page-context HTTP bridge (`ops browser web-fetch` /
 * `web-context`, implemented in `server/python/ops_cli/webhttp.py`).
 *
 * Responsibilities split:
 * - Python owns "run this fetch inside the logged-in page and give me bytes".
 * - This module owns temp-file plumbing, decoding, redaction and error mapping.
 * - The protocol modules above it own request construction and result parsing.
 *
 * Secrets never travel through CLI argv or through the ops-cli JSON response —
 * both are written to `logs/app.log` and to the runtime context file. They go
 * through short-lived temp files that are deleted in `finally`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runOpsCli } from '../opsCliRunner.js';
import { asWebProviderError, classifyHttpFailure, WebProviderError } from './errors.js';

export const WEB_HTTP_PROVIDERS = Object.freeze(['gemini-web', 'jimeng', 'google-flow']);

/** Mirrors MAX_BRIDGE_BODY_BYTES in webhttp.py; enforced here for a nicer error. */
export const MAX_BRIDGE_BODY_BYTES = 24 * 1024 * 1024;

const DEFAULT_TIMEOUT_SECONDS = 120;

/**
 * Per-provider serialization for bridge calls only.
 *
 * Each call is a separate CLI process attaching over CDP to the same
 * long-lived page; serializing them keeps that page's state unambiguous. What
 * this deliberately does *not* cover is polling and downloading, which run in
 * plain Node — so a ten-minute video no longer occupies the shared Chrome, and
 * several HTTP tasks can be in flight at once.
 */
const bridgeQueues = new Map();

function enqueueBridgeCall(provider, task) {
    const previous = bridgeQueues.get(provider) || Promise.resolve();
    const next = previous.then(task, task);
    // Keep the chain alive but never let a rejection escape into the tail.
    bridgeQueues.set(provider, next.then(() => undefined, () => undefined));
    return next;
}

function makeTaskDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'evan-webhttp-'));
}

function cleanupTaskDir(taskDir) {
    try {
        fs.rmSync(taskDir, { recursive: true, force: true });
    } catch (error) {
        console.warn(`[web-http] 临时目录清理失败：${error.message}`);
    }
}

/**
 * Normalize one request into the shape webhttp.py expects.
 *
 * `body` may be a string, a Buffer/Uint8Array or a plain object (sent as JSON).
 */
export function buildRequestSpec({
    url,
    method = 'GET',
    headers = {},
    body,
    json,
    credentials = 'include',
    redirect = 'follow',
    timeoutSeconds,
    // 'xhr' 让请求走页面的 XMLHttpRequest —— 即梦的 sign 头由 XHR 钩子添加，
    // 走 fetch 拿不到（实测同一份请求体 fetch 被判 permission denied）。
    transport,
    // 请求必须从哪个页面发出。部分平台的权益判定绑定来源页面（见 webhttp.py）。
    pageUrl
}) {
    const spec = { url, method: String(method).toUpperCase(), headers: { ...headers }, credentials, redirect };
    if (transport) spec.transport = transport;
    if (pageUrl) spec.pageUrl = pageUrl;
    if (timeoutSeconds) spec.timeoutSeconds = timeoutSeconds;

    if (json !== undefined) {
        spec.bodyText = typeof json === 'string' ? json : JSON.stringify(json);
        if (!Object.keys(spec.headers).some(key => key.toLowerCase() === 'content-type')) {
            spec.headers['content-type'] = 'application/json';
        }
    } else if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
        const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
        if (buffer.length > MAX_BRIDGE_BODY_BYTES) {
            throw new WebProviderError(
                `请求体过大（${buffer.length} 字节），HTTP 通道上限为 ${MAX_BRIDGE_BODY_BYTES} 字节`,
                { code: 'PROTOCOL_CHANGED', submitted: false }
            );
        }
        spec.bodyBase64 = buffer.toString('base64');
    } else if (typeof body === 'string') {
        spec.bodyText = body;
    } else if (body !== undefined && body !== null) {
        spec.bodyText = JSON.stringify(body);
    }
    return spec;
}

/** Decoded view of one bridge response. */
function decodeResponse(raw, provider) {
    const buffer = Buffer.from(String(raw?.bodyBase64 || ''), 'base64');
    return {
        provider,
        ok: Boolean(raw?.ok),
        status: Number(raw?.status || 0),
        statusText: String(raw?.statusText || ''),
        url: String(raw?.url || ''),
        redirected: Boolean(raw?.redirected),
        networkError: Boolean(raw?.networkError),
        headers: raw?.headers || {},
        buffer,
        get text() { return buffer.toString('utf8'); },
        json() {
            const text = buffer.toString('utf8');
            try {
                return JSON.parse(text);
            } catch (error) {
                throw new WebProviderError(
                    `${provider} 返回的不是合法 JSON（HTTP ${raw?.status}）`,
                    { provider, code: 'PROTOCOL_CHANGED', submitted: false, cause: error }
                );
            }
        }
    };
}

/**
 * Run one or more fetches inside the provider page.
 *
 * Multiple specs are executed in one CLI invocation (one CDP attach) and stop
 * at the first failure, which is what multi-step upload handshakes need.
 *
 * @returns {Promise<Array<object>>} decoded responses, in request order
 */
/**
 * @param {boolean} [options.submitted] Does this request spend quota once it
 *   lands? A transport failure (CLI timeout, Python crash, page closed) on such
 *   a request has an **unknown** outcome — the platform may already be
 *   generating — so it must never be reported as pre-submit, or `auto` mode
 *   would re-run the whole generation through the browser and bill twice.
 */
export async function webFetchAll(provider, specs, {
    timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
    signal,
    label,
    submitted = false
} = {}) {
    if (!WEB_HTTP_PROVIDERS.includes(provider)) {
        throw new WebProviderError(`未知的 HTTP 通道平台：${provider}`, { provider, code: 'UNKNOWN', submitted: false });
    }
    const requests = (Array.isArray(specs) ? specs : [specs]).map(spec =>
        (spec && spec.url ? spec : buildRequestSpec(spec))
    );
    return enqueueBridgeCall(
        provider,
        () => runWebFetch(provider, requests, { timeoutSeconds, signal, label, submitted })
    );
}

async function runWebFetch(provider, requests, { timeoutSeconds, signal, label, submitted }) {
    const taskDir = makeTaskDir();
    const requestFile = path.join(taskDir, 'request.json');
    const responseFile = path.join(taskDir, 'response.json');
    try {
        fs.writeFileSync(requestFile, JSON.stringify({ requests }), 'utf8');
        // 单次调用的墙钟上限 = 请求超时 + 冷启动余量。
        //
        // 余量必须覆盖**最坏情况**：Chrome 冷启动 + 首个平台页面首次加载 +
        // 导航重试。实测冷启动后第一个平台可以逼近 3 分钟，原来给 120 秒会让
        // 首次「检测登录状态」必定超时报错（后两个平台复用实例反而很快）。
        const wallClockMs = (timeoutSeconds + 300) * 1000;
        await runOpsCli({
            label: label || `${provider} HTTP 请求`,
            signal,
            timeoutMs: wallClockMs,
            // 每次业务请求都写一次 session 状态会让画布上的登录指示灯疯狂闪烁；
            // 登录态由 web-context / check-login 负责，这里只做数据通道。
            trackSessionState: false,
            args: [
                'browser', 'web-fetch',
                '--provider', provider,
                '--request-file', requestFile,
                '--response-file', responseFile,
                '--timeout-seconds', String(timeoutSeconds)
            ]
        });

        const payload = JSON.parse(fs.readFileSync(responseFile, 'utf8'));
        const responses = (payload?.responses || []).map(item => decodeResponse(item, provider));
        if (responses.length === 0) {
            throw new WebProviderError(`${provider} HTTP 通道没有返回任何响应`, {
                provider, code: 'BRIDGE_UNAVAILABLE', submitted: false
            });
        }
        return responses;
    } catch (error) {
        if (error instanceof WebProviderError) throw error;
        // Chrome 起不来 / Playwright 缺失 / 登录页重定向：这些确实发生在请求发出**之前**，
        // 无论调用方是不是计费请求都算 submitted:false。
        const beforeRequest = error?.code === 'AUTH_REQUIRED'
            || error?.code === 'BROWSER_MODELS_NOT_READY'
            || error?.code === 'BROWSER_CLOSED';
        const code = error?.code === 'AUTH_REQUIRED' ? 'AUTH_EXPIRED' : 'BRIDGE_UNAVAILABLE';
        // 其余传输层失败（CLI 超时、子进程被杀、页面中途关闭）结果未知：请求可能
        // 已经落到平台上了。计费请求在这种情况下必须按已提交处理，否则 auto 模式
        // 会用浏览器再生成一次，用户被扣两次费、拿到两份结果。
        throw asWebProviderError(error, {
            provider,
            code,
            submitted: beforeRequest ? false : Boolean(submitted)
        });
    } finally {
        cleanupTaskDir(taskDir);
    }
}

/** Single-request convenience wrapper. */
export async function webFetch(provider, spec, options = {}) {
    const [response] = await webFetchAll(provider, [spec], options);
    return response;
}

/**
 * Fetch and require a 2xx. `submitted` must be supplied by the caller: only it
 * knows whether this particular endpoint spends quota.
 */
export async function webFetchOk(provider, spec, { submitted = false, what = '请求', ...options } = {}) {
    // submitted 同时传给 webFetch：传输层失败也要按调用方的计费语义归类。
    const response = await webFetch(provider, spec, { ...options, submitted });
    if (!response.ok) {
        throw new WebProviderError(
            `${provider} ${what}失败：HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
            { provider, code: classifyHttpFailure(response.status, response.text), submitted }
        );
    }
    return response;
}

/**
 * Read the provider's runtime auth / bootstrap context.
 *
 * The returned object holds live credentials (Gemini `at`, Flow Bearer, cookies).
 * Callers keep it in memory only — never persist it, never log it.
 */
export async function webContext(provider, { signal, timeoutMs = 180_000 } = {}) {
    if (!WEB_HTTP_PROVIDERS.includes(provider)) {
        throw new WebProviderError(`未知的 HTTP 通道平台：${provider}`, { provider, code: 'UNKNOWN', submitted: false });
    }
    return enqueueBridgeCall(provider, () => runWebContext(provider, { signal, timeoutMs }));
}

async function runWebContext(provider, { signal, timeoutMs }) {
    const taskDir = makeTaskDir();
    const outputFile = path.join(taskDir, 'context.json');
    try {
        await runOpsCli({
            label: `${provider} 会话上下文`,
            signal,
            timeoutMs,
            // 这一步确实是登录探针：成功即代表页面可用且未被重定向到登录页。
            successSessionState: 'authenticated',
            args: ['browser', 'web-context', '--provider', provider, '--output-file', outputFile]
        });
        return JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    } catch (error) {
        if (error instanceof WebProviderError) throw error;
        const code = error?.code === 'AUTH_REQUIRED' ? 'AUTH_EXPIRED' : 'BRIDGE_UNAVAILABLE';
        throw asWebProviderError(error, { provider, code, submitted: false });
    } finally {
        cleanupTaskDir(taskDir);
    }
}

/** Serialize a cookie list from `webContext` into a `Cookie:` header value. */
export function cookieHeaderFor(context, hostSuffixes = []) {
    const cookies = Array.isArray(context?.cookies) ? context.cookies : [];
    const wanted = cookies.filter(cookie => {
        if (hostSuffixes.length === 0) return true;
        const domain = String(cookie?.domain || '').replace(/^\./, '').toLowerCase();
        return hostSuffixes.some(suffix => domain === suffix || domain.endsWith(`.${suffix}`));
    });
    const seen = new Set();
    const parts = [];
    for (const cookie of wanted) {
        if (!cookie?.name || seen.has(cookie.name)) continue;
        seen.add(cookie.name);
        parts.push(`${cookie.name}=${cookie.value}`);
    }
    return parts.join('; ');
}
