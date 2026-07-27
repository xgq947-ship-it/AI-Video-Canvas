/**
 * Execution-mode dispatcher shared by all three Web providers.
 *
 * The rule that matters, inherited from `opsCliRunner.js`: once a generation
 * request has been submitted, the user's quota is spent. Falling back to the
 * browser at that point would generate — and bill — a second time. So the HTTP
 * attempt may only be abandoned when it failed *before* submission, which is
 * exactly what `WebProviderError#canFallbackToBrowser` encodes.
 */

import { isWebProviderError, redactSecrets, WebProviderError } from './errors.js';

export { WebProviderError, isWebProviderError, redactSecrets } from './errors.js';
export {
    WEB_EXECUTION_MODES,
    WEB_HTTP_PROVIDER_IDS,
    WEB_HTTP_PROVIDER_LABELS,
    DEFAULT_WEB_EXECUTION_MODE,
    applyWebExecutionPreferenceToApp,
    describeWebExecutionSettings,
    loadWebExecutionPreference,
    resolveWebExecutionMode,
    saveWebExecutionPreference
} from './executionMode.js';

/**
 * Run an operation through the configured channel.
 *
 * @param {object}   options
 * @param {string}   options.mode      'auto' | 'http' | 'browser'
 * @param {string}   options.provider
 * @param {string}   options.label     user-facing task name, used in messages
 * @param {Function} options.http      HTTP implementation
 * @param {Function} options.browser   existing browser-workflow implementation
 * @param {number}   [options.httpAttempts]  pre-submit retries (default 2)
 */
export async function runWithExecutionMode({
    mode = 'auto',
    provider,
    label,
    http,
    browser,
    httpAttempts = 2
}) {
    if (mode === 'browser' || typeof http !== 'function') {
        return browser();
    }

    let lastError;
    for (let attempt = 1; attempt <= Math.max(1, httpAttempts); attempt += 1) {
        try {
            return await http({ attempt });
        } catch (error) {
            lastError = error;
            const webError = isWebProviderError(error)
                ? error
                : new WebProviderError(error?.message || String(error), { provider, submitted: true, cause: error });

            // Submitted → the platform is already working on it (or already
            // charged for it). Surface it; never retry, never fall back.
            if (!webError.canFallbackToBrowser) throw webError;

            const isLastAttempt = attempt >= Math.max(1, httpAttempts);
            console.warn(
                `[web-http] ${label} 第 ${attempt} 次 HTTP 尝试失败（${webError.code}）：`
                + redactSecrets(webError.message)
            );
            if (!isLastAttempt) continue;

            if (mode === 'http') {
                throw new WebProviderError(
                    `${label} HTTP 通道失败：${redactSecrets(webError.message)}`
                    + '（当前执行模式为「仅 HTTP」，未自动回退浏览器）',
                    { provider, code: webError.code, submitted: false, cause: webError }
                );
            }
            if (typeof browser !== 'function') throw webError;

            console.warn(`[web-http] ${label} 回退到浏览器自动化通道`);
            const result = await browser();
            // 识图/提示词优化的浏览器实现返回的是字符串，不能被展开成对象。
            if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
            return { ...result, channel: 'browser', httpFallbackReason: webError.code };
        }
    }
    throw lastError;
}
