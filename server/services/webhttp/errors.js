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
    if (status === 401 || status === 403) {
        if (text.includes('recaptcha') || text.includes('captcha')) return 'RECAPTCHA_REQUIRED';
        if (text.includes('sign') && text.includes('invalid')) return 'SIGN_FAILED';
        return 'AUTH_EXPIRED';
    }
    if (status === 429) return 'RATE_LIMIT';
    if (text.includes('quota') || text.includes('credit') || text.includes('积分不足')) return 'QUOTA_EXHAUSTED';
    if (text.includes('policy') || text.includes('violat') || text.includes('违规') || text.includes('敏感')) {
        return 'CONTENT_POLICY';
    }
    if (status >= 500) return 'GENERATION_FAILED';
    if (status === 0) return 'BRIDGE_UNAVAILABLE';
    return 'PROTOCOL_CHANGED';
}
