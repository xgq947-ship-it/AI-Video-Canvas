/**
 * Execution-mode dispatcher shared by all three Web providers.
 *
 * 生成链路只剩 HTTP 一条：DOM 点击生成已整体删除，浏览器只提供登录与会话上下文。
 *
 * 这里仍然守着从 `opsCliRunner.js` 继承下来的那条硬规则：请求一旦提交出去，
 * 用户的配额就已经花掉了，绝不能重试 —— 重试等于二次扣费、两份结果。
 */

import { isWebProviderError, redactSecrets, WebProviderError } from './errors.js';
import { isOperationCancelled } from '../operationCancelled.js';
import {
    generationHasCrossedSubmissionBoundary,
    runScheduledGeneration
} from '../generationRuntime/scheduler.js';

export { WebProviderError, isWebProviderError, redactSecrets } from './errors.js';
export { getSessionManager, listSessionManagers, cookieHeaderForUrl } from './sessionManager.js';
export {
    WAITING_AUTH,
    listPendingAuthTasks,
    resumePendingAuthTasks,
    runWithAuthRecovery
} from './authRecovery.js';
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
 * @param {number}   [options.httpAttempts]  pre-submit retries (default 2)
 */
export async function runWithExecutionMode({
    mode = 'auto',
    provider,
    label,
    http,
    httpAttempts = 2,
    signal,
    metadata
}) {
    if (typeof http !== 'function') {
        throw new WebProviderError(`${label} 没有可用的 HTTP 实现`, {
            provider, code: 'BRIDGE_UNAVAILABLE', submitted: false
        });
    }

    return runScheduledGeneration({
        provider,
        label,
        signal,
        metadata,
        task: async () => {
            let lastError;
            for (let attempt = 1; attempt <= Math.max(1, httpAttempts); attempt += 1) {
                try {
                    return await http({ attempt });
                } catch (error) {
                    lastError = error;
                    if (isOperationCancelled(error)) {
                        if (generationHasCrossedSubmissionBoundary(provider)) {
                            error.submitted = true;
                            error.retryable = false;
                        }
                        throw error;
                    }
                    const webError = isWebProviderError(error)
                        ? error
                        : new WebProviderError(error?.message || String(error), { provider, submitted: true, cause: error });

                    // Error objects produced by a parser can still say
                    // submitted:false even though bridge.js already observed a
                    // response from the billable endpoint. The runtime's
                    // actual boundary wins; otherwise this loop would submit a
                    // second generation after a malformed response.
                    if (generationHasCrossedSubmissionBoundary(provider)
                        && webError.submitted !== true
                        && webError.retryable !== false) {
                        webError.submitted = true;
                        webError.retryable = false;
                    }

                    // 已提交 → 平台可能已经在生成（并且已经扣费），绝不重试。
                    // 额度耗尽等拒绝虽然 submitted=false（没有生成/扣费），但 retryable=false：
                    // 立刻重试只会重复撞额度并抬高网页风控概率。
                    if (webError.submitted || webError.retryable === false) throw webError;

                    if (attempt >= Math.max(1, httpAttempts)) {
                        // 提交前失败且重试用尽：如实抛出。
                        //
                        // 这里刻意没有「回退浏览器点击生成」这条路 —— 那套 DOM 自动化已按
                        // 需求整体删除。认证类失败应该走 Session 恢复（重新登录后重试原任务），
                        // 而不是换一条同样要花配额、结果更不可控的链路。
                        throw webError;
                    }
                    console.warn(
                        `[web-http] ${label} 第 ${attempt} 次 HTTP 尝试失败（${webError.code}）：`
                        + redactSecrets(webError.message)
                    );
                }
            }
            throw lastError;
        }
    });
}
