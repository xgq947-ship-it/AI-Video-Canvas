/**
 * Reference-image and result-media helpers shared by the three HTTP providers.
 *
 * The browser workflows hand Python a list of file *paths*; the HTTP channels
 * need the bytes instead. Rather than reimplement input resolution (library
 * URL / data URL / remote URL), this reuses the existing resolver and reads the
 * files it produced.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveBrowserReferenceImages } from '../googleFlowImageWorkflow.js';
import { fetchWorkflowMedia } from '../../utils/workflowMedia.js';
import { operationCancelledError } from '../operationCancelled.js';
import { WebProviderError } from './errors.js';

const MIME_BY_EXTENSION = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif'
};

export function mimeTypeForFile(filePath) {
    const extension = path.extname(String(filePath || '')).slice(1).toLowerCase();
    return MIME_BY_EXTENSION[extension] || 'image/png';
}

export function extensionForContentType(contentType, fallback = 'png') {
    const normalized = String(contentType || '').toLowerCase();
    if (normalized.includes('webp')) return 'webp';
    if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
    if (normalized.includes('png')) return 'png';
    if (normalized.includes('webm')) return 'webm';
    if (normalized.includes('mp4')) return 'mp4';
    return fallback;
}

/**
 * Resolve canvas reference inputs into in-memory files.
 *
 * @returns {Promise<Array<{buffer: Buffer, fileName: string, mimeType: string}>>}
 */
export async function loadReferenceImageFiles(inputs, libraryDir, { providerName = 'Web HTTP' } = {}) {
    const list = (Array.isArray(inputs) ? inputs : []).filter(Boolean);
    if (list.length === 0) return [];

    const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-webhttp-ref-'));
    try {
        const paths = await resolveBrowserReferenceImages(list, libraryDir, taskDir, { providerName });
        return paths.map(filePath => ({
            buffer: fs.readFileSync(filePath),
            fileName: path.basename(filePath),
            mimeType: mimeTypeForFile(filePath)
        }));
    } finally {
        try {
            fs.rmSync(taskDir, { recursive: true, force: true });
        } catch (error) {
            console.warn(`[web-http] 参考图临时目录清理失败：${error.message}`);
        }
    }
}

/** 结果下载的重试上限与基准退避（第 1、2 次重试前）。 */
const DOWNLOAD_MAX_ATTEMPTS = 3;
const DOWNLOAD_BASE_BACKOFF_MS = [1_000, 2_000];

/**
 * ±25% 抖动的退避时长（借鉴 gflow-cli 的 jittered exponential backoff）。
 *
 * 抖动是为了避免一批结果同时下载失败后**同步**重试、在同一瞬间再次撞上同一个抖动的 CDN。
 */
function jitteredBackoffMs(baseMs) {
    const jitter = baseMs * 0.25 * (2 * Math.random() - 1);
    return Math.max(0, baseMs + jitter);
}

/** 可被取消打断的退避等待；取消时提前 resolve，交给下一轮的 signal 检查去抛取消错误。 */
function abortableSleep(ms, signal) {
    return new Promise(resolve => {
        if (signal?.aborted) { resolve(); return; }
        const onAbort = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

/**
 * Download a finished result from the platform CDN.
 *
 * Deliberately runs in Node, not through the page bridge: the media CDNs do not
 * CORS-allow a page to read the response body, and a large video should not be
 * base64-shuttled through `page.evaluate`.
 *
 * The quota is already spent at this point, so a failure is phrased as a
 * recovery instruction rather than "generation failed".
 *
 * 下载是**幂等 GET、提交后但不计费**，与生成完全不同——所以偶发失败（网络抖动 / 5xx /
 * 传输中断 / 空文件）可安全重试，避免一次网络抖动就把用户赶去平台历史手动下载
 * （借鉴 gflow-cli 对下载的重试策略）。确定性失败（登录 HTML 回退、4xx）由
 * `fetchWorkflowMedia` 标记为不可重试，直接透出。
 *
 * `maxTotalMs` 是墙钟护栏：一个挂死的 CDN 不该把 3 次重试拖成好几分钟；预算不足以再跑
 * 一轮时就停在当前错误上。
 */
export async function downloadResultMedia(url, {
    providerName,
    expectedType,
    cookieHeader,
    recoveryHint,
    timeoutMs = 120_000,
    signal,
    maxAttempts = DOWNLOAD_MAX_ATTEMPTS,
    maxTotalMs = Math.max(timeoutMs + 60_000, Math.round(timeoutMs * 1.5)),
    // 可注入的 fetch 与退避基准，仅供测试免去真实网络与真实等待。
    fetchImpl,
    backoffScheduleMs = DOWNLOAD_BASE_BACKOFF_MS
} = {}) {
    const headers = { accept: expectedType === 'video' ? 'video/*,*/*' : 'image/*,*/*' };
    if (cookieHeader) headers.cookie = cookieHeader;
    // Flow's media endpoint is a streaming proxy that expects a Range request.
    if (expectedType === 'video') headers.range = 'bytes=0-';

    const startedAt = performance.now();
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        // 取消统一走 operationCancelledError：调度器 / 视频任务是**按字段**（cancelled / code）
        // 判定取消的，裸 Error 会被误记成普通失败，界面反而提示去平台历史找一个没提交的任务。
        if (signal?.aborted) throw operationCancelledError(`${providerName} 结果下载`);
        try {
            const downloaded = await fetchWorkflowMedia(url, {
                providerName,
                expectedType,
                recoveryHint: recoveryHint || '请先到对应平台历史记录中下载本次结果，不要直接重新生成。',
                headers,
                timeoutMs,
                signal,
                ...(fetchImpl ? { fetchImpl } : {})
            });
            return {
                buffer: downloaded.buffer,
                extension: extensionForContentType(downloaded.contentType, expectedType === 'video' ? 'mp4' : 'png'),
                contentType: downloaded.contentType,
                source: 'http'
            };
        } catch (error) {
            // 下载过程中被取消：归一成统一的取消错误，而不是把 fetch 抛出的裸错误当失败上报。
            if (signal?.aborted) throw operationCancelledError(`${providerName} 结果下载`);
            lastError = error;
            if (attempt >= maxAttempts || error?.retryable !== true) throw error;
            const backoff = jitteredBackoffMs(
                backoffScheduleMs[attempt - 1] ?? backoffScheduleMs[backoffScheduleMs.length - 1]
            );
            if (performance.now() - startedAt + backoff >= maxTotalMs) throw error;
            console.warn(
                `[web-http] ${providerName} 结果下载第 ${attempt} 次失败（可重试），`
                + `${Math.round(backoff)}ms 后重试：${error.message}`
            );
            await abortableSleep(backoff, signal);
        }
    }
    throw lastError;
}

/** Guard used by every provider before it starts spending quota. */
export function requireNonEmptyPrompt(prompt, providerName) {
    if (!String(prompt || '').trim()) {
        throw new WebProviderError(`${providerName}提示词不能为空`, {
            code: 'PROTOCOL_CHANGED',
            submitted: false
        });
    }
    return String(prompt).trim();
}
