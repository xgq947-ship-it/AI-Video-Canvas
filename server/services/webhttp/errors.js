/**
 * Unified error type for the three Web HTTP providers.
 *
 * The `submitted` flag is the important one, and it carries exactly the meaning
 * `opsCliRunner.js` already gives it: once a generation request has reached the
 * platform, the user's quota is spent. Retrying or falling back to the browser
 * at that point produces a second charge and a second result. So:
 *
 *   submitted === false → no quota was spent; retryable still decides whether retrying is useful
 *   submitted === true  → surface the failure, never re-run
 */

/** Failure classes shared by Gemini Web / 即梦 / Flow. */
export const WEB_PROVIDER_ERROR_CODES = Object.freeze([
    'AUTH_EXPIRED',
    'RECAPTCHA_REQUIRED',
    'SIGN_FAILED',
    // WAF_BLOCKED：403 被 reCAPTCHA / WAF / 浏览器指纹墙拦下，请求根本没落到生成器。
    // 刻意与 AUTH_EXPIRED 分开：401 是登录过期（重新登录能解），403 是墙（登录解不开）。
    // 对照 gflow-cli 的 WafRejectionError —— 它把 403 和 401 分成两类正是因为二者的
    // 修复路径完全不同。归错会让 authRecovery 把任务挂起等一个永远解不开的登录。
    'WAF_BLOCKED',
    'RATE_LIMIT',
    'QUOTA_EXHAUSTED',
    'CONTENT_POLICY',
    'UPLOAD_FAILED',
    'GENERATION_FAILED',
    'POLL_TIMEOUT',
    'PROTOCOL_CHANGED',
    'BRIDGE_UNAVAILABLE',
    'INVALID_INPUT',
    'UNKNOWN'
]);

/**
 * Codes that mean "the request never reached the generator". Only these may
 * trigger an HTTP retry or an automatic browser fallback.
 */
const PRE_SUBMIT_CODES = new Set([
    'AUTH_EXPIRED',
    'RECAPTCHA_REQUIRED',
    'SIGN_FAILED',
    // 403 墙拦截发生在生成之前：没扣配额，按提交前失败处理（可安全回退浏览器 / 让用户重试）。
    'WAF_BLOCKED',
    'PROTOCOL_CHANGED',
    'BRIDGE_UNAVAILABLE',
    'INVALID_INPUT'
]);

/**
 * Strip anything credential-shaped out of a string before it can reach a log.
 *
 * Applied to every message this layer produces, because provider error bodies
 * routinely echo back the request (即梦 echoes query strings including
 * msToken; Google echoes Authorization on some 400s).
 */
export function redactSecrets(value) {
    let text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
    if (!text) return '';
    const rules = [
        [/(authorization"?\s*[:=]\s*"?)(bearer\s+)?[A-Za-z0-9._~+/=-]{12,}/gi, '$1***'],
        [/(cookie"?\s*[:=]\s*"?)[^"\n,}]{8,}/gi, '$1***'],
        // \b 锚定，且不收 `at`：不加边界的话 `createdAt: 2026-07-27T14:16` 会被当成
        // 凭证抹掉，错误信息里的时间戳就全没了。
        [/\b((?:msToken|a_bogus|uifid|x-amz-security-token|x-secsdk-web-signature|SNlM0e|access_token|accessToken|recaptchaToken|SessionKey)"?\s*[:=]\s*"?)[A-Za-z0-9._~+/=%-]{8,}/gi, '$1***'],
        [/\b(SAPISID|APISID|SSID|HSID|SID|__Secure-[A-Za-z0-9_-]+|sessionid(?:_ss)?|sid_tt|uid_tt|ttwid|odin_tt)=[^;\s&"]+/gi, '$1=***']
    ];
    for (const [pattern, replacement] of rules) text = text.replace(pattern, replacement);
    return text;
}

export class WebProviderError extends Error {
    /**
     * @param {string} message
     * @param {object} options
     * @param {string} options.provider  'gemini-web' | 'jimeng' | 'google-flow'
     * @param {string} options.code      one of WEB_PROVIDER_ERROR_CODES
     * @param {boolean} [options.submitted] override the code-derived default
     */
    constructor(message, { provider, code = 'UNKNOWN', submitted, retryable, details, cause } = {}) {
        // 在构造点统一脱敏：这条 message 最终会进后端日志、API 响应和画布错误提示，
        // 而平台的错误体经常把请求原样回显（即梦回显含 msToken 的 query，
        // Google 某些 400 会回显 Authorization）。只在打印处脱敏必然会漏掉某条路径。
        super(redactSecrets(message));
        this.name = 'WebProviderError';
        this.provider = provider;
        this.code = WEB_PROVIDER_ERROR_CODES.includes(code) ? code : 'UNKNOWN';
        // Unknown failures are treated as submitted: better to make the user
        // click regenerate once than to silently bill them twice.
        this.submitted = submitted === undefined ? !PRE_SUBMIT_CODES.has(this.code) : Boolean(submitted);
        this.retryable = retryable === undefined ? !this.submitted : Boolean(retryable);
        if (details && typeof details === 'object') this.details = details;
        if (cause) this.cause = cause;
    }

    /** Legacy compatibility flag: whether failure happened before submit and remains retryable. */
    get canFallbackToBrowser() {
        return this.submitted === false && this.retryable !== false;
    }
}

export function isWebProviderError(error) {
    return error instanceof WebProviderError;
}

/** Wrap an arbitrary throwable so callers always see the same shape. */
export function asWebProviderError(error, { provider, code = 'UNKNOWN', submitted } = {}) {
    if (isWebProviderError(error)) return error;
    return new WebProviderError(error?.message || String(error), { provider, code, submitted, cause: error });
}

/**
 * Map an HTTP status + response text onto a provider error code.
 *
 * Called before a generation request is known to have landed, so the caller
 * decides `submitted`; this only classifies the *kind* of failure.
 */
export function classifyHttpFailure(status, bodyText = '') {
    const text = String(bodyText || '').slice(0, 2000).toLowerCase();
    const mentionsRecaptcha = text.includes('recaptcha') || text.includes('captcha');
    const looksLikeBadSign = text.includes('sign') && text.includes('invalid');
    // 401 = 登录态过期，重新登录能解 → AUTH_EXPIRED。
    if (status === 401) {
        if (mentionsRecaptcha) return 'RECAPTCHA_REQUIRED';
        if (looksLikeBadSign) return 'SIGN_FAILED';
        return 'AUTH_EXPIRED';
    }
    // 403 = 墙（reCAPTCHA / WAF / 指纹校验），重新登录解不开 → WAF_BLOCKED，绝不归成 AUTH_EXPIRED。
    // reCAPTCHA / 签名两类仍单独细分，因为它们各有专门的重铸/重签路径。
    if (status === 403) {
        if (mentionsRecaptcha) return 'RECAPTCHA_REQUIRED';
        if (looksLikeBadSign) return 'SIGN_FAILED';
        return 'WAF_BLOCKED';
    }
    if (status === 429) return 'RATE_LIMIT';
    if (text.includes('quota') || text.includes('credit') || text.includes('积分不足')) return 'QUOTA_EXHAUSTED';
    // 内容安全优先按平台 reason 码判定：比关键词匹配更准、更少漏判（对照 gflow-cli
    // _classify_content_safety 的 PUBLIC_ERROR_UNSAFE_* 判定）。关键词兜底仍保留在下方。
    if (/public_error_unsafe_(?:generation|content|face|identity)/i.test(text)) {
        return 'CONTENT_POLICY';
    }
    const contentPolicyViolation = text.includes('policy')
        || text.includes('违规')
        || text.includes('敏感')
        || /\bviolat(?:e|ed|es|ion|ions|ing)\b/.test(text)
            && /\b(?:safety|content|prompt|guideline|policy)\b/.test(text);
    if (contentPolicyViolation) {
        return 'CONTENT_POLICY';
    }
    if (status >= 500) return 'GENERATION_FAILED';
    if (status === 0) return 'BRIDGE_UNAVAILABLE';
    return 'PROTOCOL_CHANGED';
}

/** Retry-After 的上限：与 gflow-cli 的 RETRY_AFTER_CAP_SECONDS=60 对齐，防止服务端塞一个离谱的大值。 */
export const RETRY_AFTER_CAP_MS = 60_000;

/**
 * 解析 `Retry-After` 响应头（只认秒数形式）为毫秒，封顶 60s。
 *
 * 平台的 429/限流响应会用这个头告诉客户端「过多久再来」。尊重它比盲目指数退避更礼貌、
 * 也更快恢复（对照 gflow-cli parse_retry_after）。HTTP-date 形式刻意不支持：实测上游只发
 * 整数秒，解析 RFC 7231 日期只会平白多一个依赖。
 *
 * @param {Headers|Object|null} headers  fetch Headers、普通对象或桥接响应的 headers 字典
 * @returns {number|null} 毫秒；头缺失或非法时返回 null
 */
export function parseRetryAfterMs(headers) {
    if (!headers) return null;
    const read = typeof headers.get === 'function'
        ? key => headers.get(key)
        : key => headers[key] ?? headers[key.toLowerCase()];
    const raw = read('retry-after') ?? read('Retry-After');
    if (raw === undefined || raw === null || raw === '') return null;
    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS);
}
