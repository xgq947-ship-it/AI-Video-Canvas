/**
 * 认证失效时的任务保留与恢复。
 *
 * 需求：用户发起生成后 Session 过期，任务不能直接丢。期望是
 *   任务 Running → AUTH_EXPIRED → waiting-auth → 打开登录 → 用户登录完成
 *   → Session 恢复 → 原任务重新执行。
 *
 * 这里只保管**还没提交出去**的任务。已提交的任务绝不重放：平台可能已经在生成，
 * 重放等于二次扣费。`WebProviderError#submitted` 就是这道分界线。
 *
 * 任务体保存在内存里（含提示词与素材引用），不落盘：它可能包含用户素材路径，
 * 而且跨进程重放本来也没有意义。
 */

import { WebProviderError } from './errors.js';
import { getSessionManager, handleAuthFailure } from './sessionManager.js';

/** 与画布已有的任务状态并列的新状态。 */
export const WAITING_AUTH = 'waiting-auth';

/** 单个平台最多挂起多少个待登录任务；超出丢最旧的，避免无限堆积。 */
const MAX_PENDING_PER_PROVIDER = 8;

const pending = new Map();

function bucket(provider) {
    if (!pending.has(provider)) pending.set(provider, []);
    return pending.get(provider);
}

/**
 * 包装一次生成：认证失效时把任务挂起，而不是直接失败。
 *
 * @param {object}   options
 * @param {string}   options.provider
 * @param {string}   options.label     给用户看的任务名
 * @param {Function} options.run       真正的任务体，必须可重入（重放时会再调一次）
 * @param {object}   [options.store]   browserSessionState，用于同步登录状态
 */
export async function runWithAuthRecovery({ provider, label, run, store, metadata }) {
    try {
        return await run();
    } catch (error) {
        const isAuthFailure = error?.code === 'AUTH_EXPIRED';
        // 已提交的任务即使是认证错误也不能重放 —— 平台那边可能已经在跑了。
        if (!isAuthFailure || error?.submitted === true) throw error;

        handleAuthFailure(provider, store);

        const entry = {
            id: `${provider}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            provider,
            label,
            metadata: metadata || null,
            createdAt: Date.now(),
            run
        };
        const queue = bucket(provider);
        queue.push(entry);
        while (queue.length > MAX_PENDING_PER_PROVIDER) queue.shift();

        throw new WebProviderError(
            `${label} 已暂停：${provider} 登录已失效。请重新登录，登录完成后会自动继续。`,
            { provider, code: 'AUTH_EXPIRED', submitted: false, cause: error }
        );
    }
}

/** 某平台当前挂起的任务（不含任务体，可安全返回给前端）。 */
export function listPendingAuthTasks(provider) {
    const source = provider ? [[provider, bucket(provider)]] : [...pending.entries()];
    return source.flatMap(([id, queue]) => queue.map(entry => ({
        id: entry.id,
        provider: id,
        label: entry.label,
        state: WAITING_AUTH,
        createdAt: entry.createdAt,
        metadata: entry.metadata
    })));
}

export function clearPendingAuthTasks(provider) {
    if (provider) pending.delete(provider);
    else pending.clear();
}

/**
 * 登录完成后恢复。
 *
 * 先确认 Session 真的好了再重放：否则一次失败的登录会把挂起任务全部消耗掉，
 * 而且每个都再报一次同样的错。
 */
export async function resumePendingAuthTasks(provider, { signal, store } = {}) {
    const queue = bucket(provider);
    if (queue.length === 0) return { resumed: [], failed: [], skipped: 'no-pending' };

    const manager = getSessionManager(provider);
    const status = await manager.refreshSession({ signal });
    if (status.status !== 'logged-in') {
        return { resumed: [], failed: [], skipped: 'still-logged-out', status: status.status };
    }
    if (store) {
        const { persistAuthStatus } = await import('./auth.js');
        persistAuthStatus(store, status);
    }

    // 取走整批再执行：任务体里可能再次触发挂起，留在原数组上会无限循环。
    const batch = queue.splice(0, queue.length);
    const resumed = [];
    const failed = [];
    for (const entry of batch) {
        try {
            const result = await entry.run();
            resumed.push({ id: entry.id, label: entry.label, result });
        } catch (error) {
            failed.push({ id: entry.id, label: entry.label, code: error?.code, message: error?.message });
        }
    }
    return { resumed, failed };
}
