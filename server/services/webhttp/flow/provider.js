/**
 * Google Flow HTTP provider.
 *
 * HTTP does the work; the browser only supplies the Bearer / reCAPTCHA /
 * projectId / Labs cookie context and stays as the `auto`-mode fallback.
 *
 * Concurrency note: only `webContext()` and the generate/upload calls touch the
 * shared Chrome. Polling and the final download run in plain Node, so a ten
 * minute video no longer holds the browser queue — that is the whole point of
 * §29 in the Gemini protocol doc.
 */

import { randomUUID } from 'node:crypto';

import { webContext, webFetchOk, cookieHeaderFor, buildRequestSpec } from '../bridge.js';
import { WebProviderError } from '../errors.js';
import { downloadResultMedia, loadReferenceImageFiles, requireNonEmptyPrompt } from '../media.js';
import {
    FLOW_BASELINE_IMAGE_MODEL,
    FLOW_BASELINE_VIDEO_MODEL,
    FLOW_VIDEO_FAMILY_CAPABILITIES,
    buildGenerateImagesRequest,
    buildGenerateVideoRequest,
    buildFlowMediaUrl,
    buildProjectMediaRequest,
    buildUploadImageRequest,
    extractFlowModels,
    isFlowVideoCompleted,
    isFlowVideoFailed,
    parseFlowVideoMedia,
    parseGenerateImagesResponse,
    parseGenerateVideoResponse,
    parseUploadImageResponse
} from './protocol.js';

const PROVIDER = 'google-flow';
const PROVIDER_NAME = 'Google Flow';

/**
 * Auth context cache.
 *
 * The Bearer lives ~1h but the reCAPTCHA token is single-use and short-lived,
 * so it is deliberately re-minted for every generation rather than cached.
 * Nothing here is written to disk.
 */
let cachedAuth = null;
let cachedAuthAt = 0;
const AUTH_TTL_MS = 5 * 60_000;

export function clearFlowAuthCache() {
    cachedAuth = null;
    cachedAuthAt = 0;
}

export async function getFlowAuth({ signal, forceRefresh = false, recaptchaAction = '' } = {}) {
    if (!recaptchaAction && !forceRefresh && cachedAuth && Date.now() - cachedAuthAt < AUTH_TTL_MS) {
        return cachedAuth;
    }
    const context = await webContext(PROVIDER, { signal, recaptchaAction });
    if (!context?.accessToken) {
        throw new WebProviderError(
            `${PROVIDER_NAME} 未能获取访问令牌，请在 Evan 专属 Chrome 中重新登录 Google 账号`,
            { provider: PROVIDER, code: 'AUTH_EXPIRED', submitted: false }
        );
    }
    if (!context?.projectId) {
        throw new WebProviderError(
            `${PROVIDER_NAME} 未能确定当前项目（projectId）。请在 Evan 专属 Chrome 中打开一个 Flow 项目后重试。`,
            { provider: PROVIDER, code: 'AUTH_EXPIRED', submitted: false }
        );
    }
    const baseAuth = {
        accessToken: context.accessToken,
        projectId: context.projectId,
        sessionId: context.sessionId || `;${Date.now()}`,
        userPaygateTier: context.userPaygateTier || 'PAYGATE_TIER_ONE',
        labsCookie: cookieHeaderFor(context, ['labs.google', 'google.com']),
        rawModelConfig: context.modelConfig || null
    };
    // Never cache a reCAPTCHA token. Flow binds it to an action and rejects
    // reuse; the caller receives it only for the immediately following submit.
    cachedAuth = baseAuth;
    cachedAuthAt = Date.now();
    if (recaptchaAction && !context.recaptchaToken) {
        throw new WebProviderError(`${PROVIDER_NAME} 未能生成 ${recaptchaAction} 验证令牌，请刷新 Flow 页面后重试`, {
            provider: PROVIDER, code: 'AUTH_EXPIRED', submitted: false
        });
    }
    return recaptchaAction
        ? { ...baseAuth, recaptchaToken: context.recaptchaToken }
        : baseAuth;
}


export async function discoverFlowModels({ signal } = {}) {
    const baseline = {
        images: [
            { id: 'GEM_PIX_2', displayName: 'Nano Banana Pro', maxReferenceImages: 10, maxBatchCount: 4 },
            { id: FLOW_BASELINE_IMAGE_MODEL, displayName: 'Nano Banana 2', maxReferenceImages: 10, maxBatchCount: 4 },
            { id: 'HARBOR_SEAL', displayName: 'Nano Banana 2 Lite', maxReferenceImages: 10, maxBatchCount: 4 }
        ],
        videos: Object.entries(FLOW_VIDEO_FAMILY_CAPABILITIES).map(([id, capabilities]) => ({
            id,
            ...capabilities
        }))
    };
    try {
        const auth = await getFlowAuth({ signal });
        const discovered = extractFlowModels(auth.rawModelConfig);
        return {
            images: discovered.images.length ? discovered.images : baseline.images,
            videos: discovered.videos.length ? discovered.videos : baseline.videos,
            discovered: discovered.images.length > 0 || discovered.videos.length > 0
        };
    } catch {
        // Discovery must never block generation — fall back to the verified sample.
        return { ...baseline, discovered: false };
    }
}

async function uploadReferenceImages(auth, files, { signal }) {
    const mediaIds = [];
    for (const file of files) {
        const spec = buildUploadImageRequest({
            auth,
            buffer: file.buffer,
            fileName: file.fileName,
            mimeType: file.mimeType
        });
        const response = await webFetchOk(PROVIDER, buildRequestSpec(spec), {
            signal,
            submitted: false,
            what: '参考图上传'
        });
        const uploaded = parseUploadImageResponse(response.json());
        if (!uploaded?.mediaId) {
            throw new WebProviderError(`${PROVIDER_NAME} 参考图上传未返回 mediaId`, {
                provider: PROVIDER, code: 'UPLOAD_FAILED', submitted: false
            });
        }
        mediaIds.push(uploaded.mediaId);
    }
    return mediaIds;
}

/**
 * Text-to-image and reference-image generation. Flow returns finished images
 * synchronously — no polling stage exists.
 */
export async function generateFlowImageHttp({
    prompt,
    aspectRatio = '1:1',
    referenceImageInputs = [],
    count = 1,
    modelId,
    libraryDir,
    signal
}) {
    const cleanPrompt = requireNonEmptyPrompt(prompt, `${PROVIDER_NAME} 图片`);
    const files = await loadReferenceImageFiles(referenceImageInputs, libraryDir, { providerName: PROVIDER_NAME });
    const uploadAuth = files.length ? await getFlowAuth({ signal, forceRefresh: true }) : null;
    const referenceMediaIds = files.length ? await uploadReferenceImages(uploadAuth, files, { signal }) : [];
    // Mint after uploads so the action-bound, single-use token is as fresh as possible.
    const auth = await getFlowAuth({ signal, forceRefresh: true, recaptchaAction: 'IMAGE_GENERATION' });

    const spec = buildGenerateImagesRequest({
        auth,
        prompt: cleanPrompt,
        modelName: modelId || FLOW_BASELINE_IMAGE_MODEL,
        aspectRatio,
        count,
        referenceMediaIds,
        batchId: randomUUID()
    });
    // Everything up to here is pre-submit; this call is the one that bills.
    const response = await webFetchOk(PROVIDER, buildRequestSpec(spec), {
        signal,
        submitted: true,
        what: '图片生成',
        timeoutSeconds: 300
    });

    const results = parseGenerateImagesResponse(response.json());
    if (results.length === 0) {
        throw new WebProviderError(
            `${PROVIDER_NAME} 图片生成已提交但没有返回结果，请到 Flow 项目历史中确认，不要直接重新生成。`,
            { provider: PROVIDER, code: 'GENERATION_FAILED', submitted: true }
        );
    }

    const images = [];
    for (const item of results) {
        const downloaded = await downloadResultMedia(item.imageUrl, {
            providerName: `${PROVIDER_NAME} 文生图`,
            expectedType: 'image',
            cookieHeader: auth.labsCookie,
            recoveryHint: '请先到 Flow 项目历史中下载本次结果，不要直接重新生成。'
        });
        images.push({ ...downloaded, metadata: item });
    }
    // 首图字段保持与浏览器实现一致，产品场景等单图调用方无需改动。
    return { images, ...images[0], channel: 'http' };
}

const VIDEO_POLL_INTERVAL_MS = 10_000;

/**
 * Text-to-video and image-to-video.
 *
 * The submit call returns media entries that may already be SUCCESSFUL (the
 * captured 4s sample was) or may still be running, so this handles both instead
 * of assuming either.
 */
export async function generateFlowVideoHttp({
    prompt,
    firstFrameInput,
    referenceImageInputs = [],
    aspectRatio = '16:9',
    duration = 4,
    count = 1,
    modelId,
    libraryDir,
    timeoutMinutes = 15,
    signal
}) {
    const cleanPrompt = requireNonEmptyPrompt(prompt, `${PROVIDER_NAME} 视频`);
    const frameInputs = [firstFrameInput, ...referenceImageInputs].filter(Boolean);
    const files = await loadReferenceImageFiles(frameInputs, libraryDir, { providerName: PROVIDER_NAME });
    const uploadAuth = files.length ? await getFlowAuth({ signal, forceRefresh: true }) : null;
    const mediaIds = files.length ? await uploadReferenceImages(uploadAuth, files, { signal }) : [];
    const auth = await getFlowAuth({ signal, forceRefresh: true, recaptchaAction: 'VIDEO_GENERATION' });

    const spec = buildGenerateVideoRequest({
        auth,
        prompt: cleanPrompt,
        modelFamily: modelId || FLOW_BASELINE_VIDEO_MODEL,
        aspectRatio,
        duration,
        count,
        batchId: randomUUID(),
        firstFrameMediaId: firstFrameInput ? mediaIds[0] : '',
        referenceMediaIds: firstFrameInput ? mediaIds.slice(1) : mediaIds
    });
    const response = await webFetchOk(PROVIDER, buildRequestSpec(spec), {
        signal,
        submitted: true,
        what: '视频生成',
        timeoutSeconds: 600
    });

    let media = parseGenerateVideoResponse(response.json());
    if (media.length === 0) {
        throw new WebProviderError(
            `${PROVIDER_NAME} 视频任务已提交但没有返回媒体条目，请到 Flow 项目历史中确认，不要直接重新生成。`,
            { provider: PROVIDER, code: 'GENERATION_FAILED', submitted: true }
        );
    }

    media = await waitForFlowVideos(media, auth, { timeoutMinutes, signal });

    const videos = [];
    for (const item of media) {
        const downloaded = await downloadResultMedia(buildFlowMediaUrl(item.mediaId), {
            providerName: PROVIDER_NAME,
            expectedType: 'video',
            cookieHeader: auth.labsCookie,
            recoveryHint: '请先到 Flow 项目历史中下载本次结果，不要直接重新生成。'
        });
        videos.push({ ...downloaded, metadata: item });
    }
    return {
        videos,
        ...videos[0],
        runId: media.map(item => item.mediaId).filter(Boolean).join(','),
        channel: 'http'
    };
}

/**
 * Poll until every media entry is terminal.
 *
 * A poll failure is never fatal on its own: the generation is already paid for,
 * so transient errors keep retrying until the deadline and only then surface.
 */
async function waitForFlowVideos(media, auth, { timeoutMinutes, signal }) {
    if (media.every(isFlowVideoCompleted)) return media;

    const deadline = Date.now() + timeoutMinutes * 60_000;
    let current = media;
    while (Date.now() < deadline) {
        if (signal?.aborted) throw new WebProviderError('任务已取消', { provider: PROVIDER, code: 'UNKNOWN', submitted: true });

        const failed = current.filter(isFlowVideoFailed);
        if (failed.length === current.length) {
            throw new WebProviderError(
                `${PROVIDER_NAME} 视频生成失败（${failed[0]?.status || '未知状态'}）`,
                { provider: PROVIDER, code: 'GENERATION_FAILED', submitted: true }
            );
        }
        if (current.every(item => isFlowVideoCompleted(item) || isFlowVideoFailed(item))) {
            const done = current.filter(isFlowVideoCompleted);
            if (done.length > 0) return done;
        }

        await sleep(VIDEO_POLL_INTERVAL_MS, signal);

        try {
            const wantedIds = current.map(item => item.mediaId);
            const spec = buildProjectMediaRequest({ auth, mediaIds: wantedIds });
            const payload = await fetchFlowProjectMedia(spec, { signal });
            const refreshed = collectMediaEntries(payload).map(parseFlowVideoMedia).filter(item => item.mediaId);
            const wanted = new Set(wantedIds);
            const matches = refreshed.filter(item => wanted.has(item.mediaId));
            if (matches.length > 0) current = matches;
        } catch (error) {
            // Poll endpoints change shape more often than generate endpoints do;
            // a lookup failure must not discard an already-billed generation.
            console.warn(`[Flow HTTP] 视频状态查询失败，继续等待：${error.message}`);
        }
    }

    const done = current.filter(isFlowVideoCompleted);
    if (done.length > 0) return done;
    const mediaIds = current.map(item => item.mediaId).filter(Boolean);
    const recoveryText = mediaIds.length ? ` 任务 ID：${mediaIds.join(', ')}。` : '';
    throw new WebProviderError(
        `${PROVIDER_NAME} 视频在 ${timeoutMinutes} 分钟内未完成。生成配额已经消耗。${recoveryText}`
        + '请到 Flow 项目历史中查看结果，不要直接重新生成。',
        {
            provider: PROVIDER,
            code: 'POLL_TIMEOUT',
            submitted: true,
            details: { mediaIds }
        }
    );
}

/** Poll Flow's own project hydration endpoint directly from Node. */
async function fetchFlowProjectMedia(spec, { signal } = {}) {
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('Flow project poll timeout')), 30_000);
    try {
        const response = await fetch(spec.url, {
            method: spec.method,
            headers: spec.headers,
            redirect: 'follow',
            signal: controller.signal
        });
        if (!response.ok) {
            throw new WebProviderError(`${PROVIDER_NAME} 视频状态查询失败：HTTP ${response.status}`, {
                provider: PROVIDER,
                code: response.status === 401 || response.status === 403 ? 'AUTH_EXPIRED' : 'GENERATION_FAILED',
                submitted: true
            });
        }
        return response.json();
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }
}

/** tRPC wraps payloads differently across versions; find media arrays anywhere. */
function collectMediaEntries(payload, depth = 0) {
    if (!payload || depth > 6) return [];
    if (Array.isArray(payload)) return payload.flatMap(item => collectMediaEntries(item, depth + 1));
    if (typeof payload !== 'object') return [];
    if (Array.isArray(payload.media)) return payload.media;
    return Object.values(payload).flatMap(value => collectMediaEntries(value, depth + 1));
}

function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        const cancelled = () => new WebProviderError(
            '任务已取消', { provider: PROVIDER, code: 'UNKNOWN', submitted: true }
        );
        if (signal?.aborted) {
            reject(cancelled());
            return;
        }
        const onAbort = () => {
            clearTimeout(timer);
            reject(cancelled());
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
