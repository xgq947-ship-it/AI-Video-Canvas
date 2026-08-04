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
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

import {
    attachCurrentGenerationDetails,
    runProviderDownload,
    runProviderPoll
} from '../../generationRuntime/scheduler.js';
import { webContext, webFetchOk, cookieHeaderFor, buildRequestSpec } from '../bridge.js';
import { parseRetryAfterMs, WebProviderError } from '../errors.js';
import { downloadResultMedia, loadReferenceImageFiles, requireNonEmptyPrompt } from '../media.js';
import {
    FLOW_BASELINE_IMAGE_MODEL,
    FLOW_BASELINE_VIDEO_MODEL,
    FLOW_VIDEO_UPLOAD_CHUNK_BYTES,
    FLOW_VIDEO_FAMILY_CAPABILITIES,
    buildGenerateImagesRequest,
    buildGenerateVideoRequest,
    buildStartVideoUploadRequest,
    buildVideoUploadChunkRequest,
    buildFlowMediaUrl,
    buildProjectMediaRequest,
    buildUpsampleImageRequest,
    buildUploadImageRequest,
    extractFlowModels,
    isFlowVideoCompleted,
    isFlowVideoFailed,
    normalizeFlowImageResolution,
    parseFlowVideoMedia,
    parseGenerateImagesResponse,
    parseGenerateVideoResponse,
    parseUpsampleImageResponse,
    parseUploadImageResponse,
    parseStartVideoUploadResponse,
    parseVideoUploadResponse,
    selectEditResultMedia,
    validateFlowImageDimensions
} from './protocol.js';
import { probeReferenceVideo } from '../../videoRemix/referenceVideo.js';

const PROVIDER = 'google-flow';
const PROVIDER_NAME = 'Google Flow';
const UPSAMPLE_RECAPTCHA_RETRY_DELAY_MS = Math.max(
    1_000,
    Number(process.env.EVAN_FLOW_UPSAMPLE_RECAPTCHA_RETRY_MS) || 30_000
);
const UPSAMPLE_BATCH_GAP_MS = Math.max(
    0,
    Number(process.env.EVAN_FLOW_UPSAMPLE_BATCH_GAP_MS) || 2_000
);

export function shouldRetryFlowUpsampleError(error, attempt) {
    return attempt === 1
        && ['RECAPTCHA_REQUIRED', 'AUTH_EXPIRED'].includes(error?.code);
}

export function shouldFallbackFlowUpsampleToOriginal(error) {
    return !error?.cancelled && error?.code !== 'OPERATION_CANCELLED';
}

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
            `${PROVIDER_NAME} 未能获取访问令牌，请在系统共享 Chrome 中重新登录 Google 账号`,
            { provider: PROVIDER, code: 'AUTH_EXPIRED', submitted: false }
        );
    }
    if (!context?.projectId) {
        throw new WebProviderError(
            `${PROVIDER_NAME} 未能确定当前项目（projectId）。请在系统共享 Chrome 中打开一个 Flow 项目后重试。`,
            { provider: PROVIDER, code: 'AUTH_EXPIRED', submitted: false }
        );
    }
    // Flow 的 /fx/api/auth/session 会返回真实 expires（web-context 透传为 context.expires）。
    // 记下它，长轮询就能在会话临近过期时**主动**续期，而不是干等下一次 401（借鉴 gflow-cli
    // 把真实过期时间接入长任务的做法）。解析失败则留空，退回纯反应式续期。
    const expiresAt = context.expires ? Date.parse(context.expires) : NaN;
    const baseAuth = {
        accessToken: context.accessToken,
        projectId: context.projectId,
        sessionId: context.sessionId || `;${Date.now()}`,
        userPaygateTier: context.userPaygateTier || 'PAYGATE_TIER_ONE',
        labsCookie: cookieHeaderFor(context, ['labs.google', 'google.com']),
        rawModelConfig: context.modelConfig || null,
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : null
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

/** 会话剩余寿命低于这个阈值就提前续期，避免下一次请求 / 轮询正好撞上 401。 */
const AUTH_PROACTIVE_REFRESH_MS = 5 * 60_000;
/** 主动续期失败后的冷却窗：过期后每 10s 一次 bridge 往返会把浏览器队列打满，这里踩刹车。 */
const AUTH_PROACTIVE_REFRESH_COOLDOWN_MS = 60_000;

/** 上次主动续期尝试失败后的冷却截止时间（成功则不设，靠新 expiresAt 天然错开）。 */
let proactiveRefreshCooldownUntil = 0;

/**
 * 会话临近过期时主动换一份新的 auth（借鉴 gflow-cli 把真实 expires 接入长任务）。
 *
 * 续期失败不致命：老 auth 也许还能再撑一会，真撞上 401 时反应式续期会再兜一次。
 * 没有 expiresAt（解析失败 / 老缓存）时原样返回，退回纯反应式续期。
 *
 * 续期失败会设一个冷却窗：否则会话一过期，这个函数会在每一轮（约 10s）轮询前都发起一次
 * 注定失败的 bridge 往返，把共享 Chrome 队列压满。冷却让它退化成「每分钟最多试一次」。
 */
async function ensureFreshFlowAuth(auth, { signal } = {}) {
    if (!auth?.expiresAt) return auth;
    if (Date.now() < auth.expiresAt - AUTH_PROACTIVE_REFRESH_MS) return auth;
    if (Date.now() < proactiveRefreshCooldownUntil) return auth;
    try {
        const refreshed = await getFlowAuth({ signal, forceRefresh: true });
        // 成功拿到新 expiresAt，上面的阈值判断会天然错开下一次，无需再设冷却。
        proactiveRefreshCooldownUntil = 0;
        return refreshed;
    } catch (error) {
        proactiveRefreshCooldownUntil = Date.now() + AUTH_PROACTIVE_REFRESH_COOLDOWN_MS;
        console.warn(`[Flow HTTP] 会话主动续期失败，${AUTH_PROACTIVE_REFRESH_COOLDOWN_MS / 1000}s 内不再重试，暂时沿用现有登录态：${error.message}`);
        return auth;
    }
}

/**
 * 对「不含 reCAPTCHA、非计费」的 Flow 请求做一次静默重认证重试。
 *
 * 对照 gflow-cli 的 `_run_with_aisandbox_retry`：401 时清缓存、强制刷新一份 Bearer/cookie，
 * 用**重新构建**的请求重发一次，仍失败才把 AUTH_EXPIRED 冒泡。这样长任务里会话中途过期能被
 * 一次静默续期吃掉，不必惊动用户去重新登录。
 *
 * ⚠️ 硬约束（勿扩展到生成 / 高清）：buildSpec 每次都用最新 auth 现构请求；但生成、高清请求
 * 内嵌**单次即用的 reCAPTCHA token**（见上方 getFlowAuth 注释），重放已消费的 token 必然失败。
 * 因此本函数只接受 builder 不带 recaptchaAction 的请求：参考图上传、项目媒体轮询。
 *
 * @param {(auth: object) => object} buildSpec 用给定 auth 现构请求 spec（每次尝试都重建）
 * @returns {Promise<{ response: object, auth: object }>} 响应与（可能已刷新的）auth
 */
async function flowFetchOkWithReauth(buildSpec, { auth, signal, submitted = false, what }) {
    let currentAuth = auth;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
            const response = await webFetchOk(PROVIDER, buildRequestSpec(buildSpec(currentAuth)), {
                signal, submitted, what
            });
            return { response, auth: currentAuth };
        } catch (error) {
            if (attempt === 1 && error?.code === 'AUTH_EXPIRED' && !signal?.aborted) {
                console.warn(`[Flow HTTP] ${what} 认证失效，静默刷新令牌后重试一次（不触发重新生成）`);
                clearFlowAuthCache();
                currentAuth = await getFlowAuth({ signal, forceRefresh: true });
                continue;
            }
            throw error;
        }
    }
    // 不可达：上面的循环要么 return 要么 throw。保留显式抛出让控制流对静态分析闭合。
    throw new WebProviderError(`${PROVIDER_NAME} ${what} 重试逻辑异常`, {
        provider: PROVIDER, code: 'UNKNOWN', submitted
    });
}


export async function discoverFlowModels({ signal } = {}) {
    const baseline = {
        images: [
            {
                id: 'GEM_PIX_2', displayName: 'Nano Banana Pro',
                resolutions: ['1K', '2K'], defaultResolution: '2K',
                maxReferenceImages: 10, maxBatchCount: 4
            },
            {
                id: FLOW_BASELINE_IMAGE_MODEL, displayName: 'Nano Banana 2',
                resolutions: ['1K', '2K'], defaultResolution: '2K',
                maxReferenceImages: 10, maxBatchCount: 4
            },
            {
                id: 'HARBOR_SEAL', displayName: 'Nano Banana 2 Lite',
                resolutions: ['1K', '2K'], defaultResolution: '2K',
                maxReferenceImages: 10, maxBatchCount: 4
            }
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
    // 上传不含 reCAPTCHA、不计费，可安全走静默重认证；一旦某张触发续期，后续几张沿用新 auth。
    let currentAuth = auth;
    for (const file of files) {
        const { response, auth: refreshed } = await flowFetchOkWithReauth(
            uploadAuth => buildUploadImageRequest({
                auth: uploadAuth,
                buffer: file.buffer,
                fileName: file.fileName,
                mimeType: file.mimeType
            }),
            { auth: currentAuth, signal, submitted: false, what: '参考图上传' }
        );
        currentAuth = refreshed;
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

function imageFormatDetails(format) {
    if (format === 'jpeg') return { extension: 'jpg', contentType: 'image/jpeg' };
    if (format === 'webp') return { extension: 'webp', contentType: 'image/webp' };
    return { extension: 'png', contentType: 'image/png' };
}

async function verifyFlowImageBytes(buffer, item, requestedResolution) {
    let imageMetadata;
    try {
        imageMetadata = await sharp(buffer).metadata();
    } catch (error) {
        throw new WebProviderError(`${PROVIDER_NAME} ${requestedResolution} 下载结果不是可读取的图片`, {
            provider: PROVIDER,
            code: 'PROTOCOL_CHANGED',
            submitted: true,
            cause: error,
            details: { mediaIds: [item.mediaId].filter(Boolean), requestedResolution }
        });
    }

    const verification = validateFlowImageDimensions({
        requestedResolution,
        actualWidth: imageMetadata.width,
        actualHeight: imageMetadata.height,
        sourceWidth: item.width,
        sourceHeight: item.height
    });
    const logDetails = {
        requestedResolution: verification.requestedResolution,
        actualWidth: verification.actualWidth,
        actualHeight: verification.actualHeight,
        sourceWidth: verification.sourceWidth,
        sourceHeight: verification.sourceHeight,
        mediaId: item.mediaId
    };
    if (!verification.valid) {
        console.error('[Flow HTTP] 图片实际像素校验失败', logDetails, verification.reason);
        throw new WebProviderError(
            `${PROVIDER_NAME} 请求 ${verification.requestedResolution}，但最终文件像素不符合官方输出：${verification.reason}`,
            {
                provider: PROVIDER,
                code: 'PROTOCOL_CHANGED',
                submitted: true,
                details: { ...logDetails, reason: verification.reason }
            }
        );
    }
    console.info('[Flow HTTP] 图片实际像素校验通过', logDetails);
    return {
        ...verification,
        format: imageMetadata.format || 'png',
        ...imageFormatDetails(imageMetadata.format)
    };
}

async function downloadFlowOriginalImage(item, {
    requestedResolution,
    generationAuth,
    fallbackReason,
    signal
}) {
    const downloaded = await downloadResultMedia(buildFlowMediaUrl(item.mediaId), {
        providerName: fallbackReason
            ? `${PROVIDER_NAME} 文生图 ${requestedResolution} 回退原始 1K`
            : `${PROVIDER_NAME} 文生图 1K`,
        expectedType: 'image',
        cookieHeader: generationAuth.labsCookie,
        recoveryHint: '请先到 Flow 项目历史中下载本次原图，不要直接重新生成。',
        signal
    });
    const verified = await verifyFlowImageBytes(downloaded.buffer, item, '1K');
    return {
        ...downloaded,
        extension: verified.extension,
        contentType: verified.contentType,
        metadata: {
            ...item,
            sourceMediaId: item.mediaId,
            finalMediaId: item.mediaId,
            requestedResolution,
            deliveredResolution: '1K',
            actualWidth: verified.actualWidth,
            actualHeight: verified.actualHeight,
            downloadProtocol: fallbackReason
                ? 'media.getMediaUrlRedirect.fallback-from-upsampling'
                : 'media.getMediaUrlRedirect',
            ...(fallbackReason ? {
                resolutionFallbackReason: String(fallbackReason)
            } : {})
        }
    };
}

async function downloadFlowImage(item, {
    requestedResolution,
    generationAuth,
    signal
}) {
    if (!item.mediaId) {
        throw new WebProviderError(`${PROVIDER_NAME} 图片结果缺少 mediaId，无法按官方 ${requestedResolution} 协议下载`, {
            provider: PROVIDER,
            code: 'PROTOCOL_CHANGED',
            submitted: true
        });
    }

    if (requestedResolution === '1K') {
        return downloadFlowOriginalImage(item, {
            requestedResolution,
            generationAuth,
            signal
        });
    }

    // The generation reCAPTCHA token was consumed by batchGenerateImages.
    // Flow's official 2K button mints another IMAGE_GENERATION token for every
    // upsample call; batch outputs therefore each receive their own fresh token.
    let response;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
            const upsampleAuth = await getFlowAuth({
                signal,
                forceRefresh: true,
                recaptchaAction: 'IMAGE_GENERATION'
            });
            const spec = buildUpsampleImageRequest({
                auth: upsampleAuth,
                mediaId: item.mediaId,
                resolution: requestedResolution
            });
            response = await webFetchOk(PROVIDER, buildRequestSpec(spec), {
                signal,
                submitted: true,
                what: `${requestedResolution} 高清下载`,
                timeoutSeconds: 300
            });
            break;
        } catch (error) {
            // This is a definite server-side rejection: the upsample did not
            // start, while the paid image generation already completed. Retry
            // only this download step with a fresh token after a cooldown.
            // Transport/unknown failures are never retried because they may
            // already have created the 2K media; in that case retain the
            // successful original result instead of re-running generation.
            if (shouldRetryFlowUpsampleError(error, attempt)) {
                console.warn(
                    `[Flow HTTP] ${requestedResolution} 高清 token 被拒绝，`
                    + `${UPSAMPLE_RECAPTCHA_RETRY_DELAY_MS / 1000} 秒后仅重试高清步骤；不会重新生图`
                );
                await sleep(UPSAMPLE_RECAPTCHA_RETRY_DELAY_MS, signal);
                continue;
            }
            if (shouldFallbackFlowUpsampleToOriginal(error)) {
                console.warn(
                    `[Flow HTTP] ${requestedResolution} 高清步骤失败（${error?.code || 'UNKNOWN'}），`
                    + '保留已生成内容并安全回退原始 1K；不会重新生图'
                );
                return downloadFlowOriginalImage(item, {
                    requestedResolution,
                    generationAuth,
                    fallbackReason: error?.code || 'UNKNOWN',
                    signal
                });
            }
            throw error;
        }
    }
    const upsampled = parseUpsampleImageResponse(response.json());
    if (!upsampled) {
        throw new WebProviderError(
            `${PROVIDER_NAME} ${requestedResolution} 接口没有返回 encodedImage 或新的 mediaId`,
            {
                provider: PROVIDER,
                code: 'PROTOCOL_CHANGED',
                submitted: true,
                details: { mediaIds: [item.mediaId] }
            }
        );
    }

    const buffer = Buffer.from(upsampled.encodedImage, 'base64');
    const verified = await verifyFlowImageBytes(buffer, item, requestedResolution);
    return {
        buffer,
        extension: verified.extension,
        contentType: verified.contentType,
        source: 'http',
        metadata: {
            ...item,
            // Preserve the original generation relationship for compatibility,
            // while recording the new media entity returned by the 2K endpoint.
            sourceMediaId: item.mediaId,
            finalMediaId: upsampled.mediaId,
            upsampledMediaId: upsampled.mediaId,
            upsampleWorkflowId: upsampled.workflowId,
            requestedResolution,
            actualWidth: verified.actualWidth,
            actualHeight: verified.actualHeight,
            upsampleResolution: upsampled.resolution,
            downloadProtocol: 'flow.upsampleImage'
        }
    };
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
    resolution,
    libraryDir,
    signal
}) {
    const requestedResolution = normalizeFlowImageResolution(resolution);
    const cleanPrompt = requireNonEmptyPrompt(prompt, `${PROVIDER_NAME} 图片`);
    const files = await loadReferenceImageFiles(referenceImageInputs, libraryDir, { providerName: PROVIDER_NAME });
    const uploadAuth = files.length ? await getFlowAuth({ signal, forceRefresh: true }) : null;
    const referenceMediaIds = files.length ? await uploadReferenceImages(uploadAuth, files, { signal }) : [];
    // Mint after uploads so the action-bound, single-use token is as fresh as possible.
    const auth = await getFlowAuth({ signal, forceRefresh: true, recaptchaAction: 'IMAGE_GENERATION' });

    const batchId = randomUUID();
    attachCurrentGenerationDetails(PROVIDER, { batchId, projectId: auth.projectId });
    const spec = buildGenerateImagesRequest({
        auth,
        prompt: cleanPrompt,
        modelName: modelId || FLOW_BASELINE_IMAGE_MODEL,
        aspectRatio,
        count,
        referenceMediaIds,
        batchId
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
    attachCurrentGenerationDetails(PROVIDER, {
        projectId: auth.projectId,
        mediaIds: results.map(item => item.mediaId).filter(Boolean)
    });

    const downloadOne = item => runProviderDownload(
        PROVIDER,
        () => downloadFlowImage(item, { requestedResolution, generationAuth: auth, signal }),
        { signal, label: `${PROVIDER_NAME} 图片 ${requestedResolution} 下载` }
    );
    // Each 2K upsample needs a fresh, single-use reCAPTCHA token immediately
    // followed by its own POST. Keep that pair sequential so a later batch item
    // cannot mint another token between the two operations.
    const images = [];
    if (requestedResolution === '2K') {
        for (const [index, item] of results.entries()) {
            if (index > 0 && UPSAMPLE_BATCH_GAP_MS > 0) {
                await sleep(UPSAMPLE_BATCH_GAP_MS, signal);
            }
            images.push(await downloadOne(item));
        }
    } else {
        images.push(...await Promise.all(results.map(downloadOne)));
    }
    attachCurrentGenerationDetails(PROVIDER, {
        mediaIds: images.flatMap(image => [
            image.metadata?.sourceMediaId,
            image.metadata?.finalMediaId
        ]).filter(Boolean)
    });
    // 首图字段保持与浏览器实现一致，产品场景等单图调用方无需改动。
    return { images, ...images[0], channel: 'http' };
}

const VIDEO_POLL_INTERVAL_MS = 10_000;
const REFERENCE_VIDEO_READY_TIMEOUT_MS = 90_000;

function videoMimeType(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === '.mov') return 'video/quicktime';
    if (extension === '.webm') return 'video/webm';
    return 'video/mp4';
}

function resolveLocalLibraryVideo(input, libraryDir) {
    if (!input || typeof input !== 'string') return null;
    let candidate = input;
    if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
        const url = new URL(candidate);
        if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) return null;
        candidate = url.pathname;
    }
    if (!candidate.startsWith('/library/')) return null;
    const cleanPath = decodeURIComponent(candidate.split('?')[0].split('#')[0]);
    const root = path.resolve(libraryDir);
    const resolved = path.resolve(root, cleanPath.replace(/^\/library\//, ''));
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
        throw new WebProviderError('Google Flow 参考视频路径超出素材库范围', {
            provider: PROVIDER, code: 'INVALID_INPUT', submitted: false
        });
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        throw new WebProviderError('Google Flow 参考视频文件不存在', {
            provider: PROVIDER, code: 'INVALID_INPUT', submitted: false
        });
    }
    return resolved;
}

async function uploadReferenceVideo(auth, filePath, { signal }) {
    const stat = fs.statSync(filePath);
    if (!(stat.size > 0)) {
        throw new WebProviderError('Google Flow 参考视频为空文件', {
            provider: PROVIDER, code: 'INVALID_INPUT', submitted: false
        });
    }
    const fileName = path.basename(filePath);
    const start = await webFetchOk(PROVIDER, buildRequestSpec(buildStartVideoUploadRequest({
        projectId: auth.projectId,
        fileName,
        mimeType: videoMimeType(filePath),
        size: stat.size
    })), { signal, submitted: false, what: '参考视频上传初始化' });
    const session = parseStartVideoUploadResponse(start.json());
    if (!session) {
        throw new WebProviderError(`${PROVIDER_NAME} 没有返回参考视频上传会话`, {
            provider: PROVIDER, code: 'PROTOCOL_CHANGED', submitted: false
        });
    }

    const handle = fs.openSync(filePath, 'r');
    try {
        let offset = 0;
        let completed = null;
        while (offset < stat.size) {
            const size = Math.min(FLOW_VIDEO_UPLOAD_CHUNK_BYTES, stat.size - offset);
            const buffer = Buffer.allocUnsafe(size);
            fs.readSync(handle, buffer, 0, size, offset);
            const final = offset + size === stat.size;
            const response = await webFetchOk(PROVIDER, buildRequestSpec(buildVideoUploadChunkRequest({
                projectId: auth.projectId,
                sessionUrl: session.sessionUrl,
                fileName,
                offset,
                buffer,
                final
            })), { signal, submitted: false, what: '参考视频上传' });
            if (final) completed = parseVideoUploadResponse(response.json());
            offset += size;
        }
        if (!completed) {
            throw new WebProviderError(`${PROVIDER_NAME} 参考视频上传完成但没有返回媒体 ID`, {
                provider: PROVIDER, code: 'PROTOCOL_CHANGED', submitted: false
            });
        }
        return completed;
    } finally {
        fs.closeSync(handle);
    }
}

/**
 * Flow 的视频上传完成响应不代表生成服务已经能读取该 mediaId。
 * 页面会先等上传媒体进入项目状态，再提交编辑请求；HTTP 通道也必须保留这个顺序，
 * 否则生成请求虽然返回 200，任务却可能永远不落到项目历史。
 */
async function waitForReferenceVideoReady(uploadedVideo, auth, { signal }) {
    // 单调时钟算超时预算，避免系统睡眠 / NTP 校时把 90s 窗口算错（借鉴 gflow-cli 的 time.monotonic）。
    const deadline = performance.now() + REFERENCE_VIDEO_READY_TIMEOUT_MS;
    let pollAuth = auth;
    while (performance.now() < deadline) {
        if (signal?.aborted) {
            throw new WebProviderError('任务已取消', { provider: PROVIDER, code: 'UNKNOWN', submitted: false });
        }
        try {
            pollAuth = await ensureFreshFlowAuth(pollAuth, { signal });
            const payload = await fetchFlowProjectMedia(
                buildProjectMediaRequest({ auth: pollAuth, mediaIds: [uploadedVideo.mediaId] }),
                { signal }
            );
            const ready = collectMediaEntries(payload)
                .map(parseFlowVideoMedia)
                .find(item => item.mediaId === uploadedVideo.mediaId);
            if (ready?.status === 'MEDIA_GENERATION_STATUS_SUCCESSFUL') return ready;
        } catch (error) {
            // 与主轮询一致：认证失效时静默续期一次后继续等，而不是直接抛断整个任务。
            // 参考视频就绪检查发生在**提交前**，中途续期完全安全（借鉴 6 的一致性收口）。
            if (error?.code === 'AUTH_EXPIRED') {
                try {
                    pollAuth = await getFlowAuth({ signal, forceRefresh: true });
                    console.warn('[Flow HTTP] 参考视频就绪轮询遇认证失效，已静默续期后继续等待');
                } catch (refreshError) {
                    console.warn(`[Flow HTTP] 参考视频就绪轮询续期失败，继续等待：${refreshError.message}`);
                }
            }
        }
        await sleep(VIDEO_POLL_INTERVAL_MS, signal);
    }
    throw new WebProviderError(
        `${PROVIDER_NAME} 参考视频上传完成但 Flow 尚未准备好读取，未提交生成请求，请稍后重试。`,
        { provider: PROVIDER, code: 'GENERATION_FAILED', submitted: false }
    );
}

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
    referenceVideoInput,
    aspectRatio = '16:9',
    duration = 4,
    count = 1,
    modelId,
    libraryDir,
    timeoutMinutes = 15,
    signal
}) {
    const cleanPrompt = requireNonEmptyPrompt(prompt, `${PROVIDER_NAME} 视频`);
    if (referenceVideoInput && (firstFrameInput || referenceImageInputs.length > 0)) {
        throw new WebProviderError('Google Flow 参考视频不能与参考图或首帧混用', {
            provider: PROVIDER, code: 'INVALID_INPUT', submitted: false
        });
    }
    const frameInputs = [firstFrameInput, ...referenceImageInputs].filter(Boolean);
    const files = await loadReferenceImageFiles(frameInputs, libraryDir, { providerName: PROVIDER_NAME });
    const referenceVideoPath = referenceVideoInput
        ? resolveLocalLibraryVideo(referenceVideoInput, libraryDir)
        : null;
    if (referenceVideoInput && !referenceVideoPath) {
        throw new WebProviderError('Google Flow 参考视频必须来自当前素材库', {
            provider: PROVIDER, code: 'INVALID_INPUT', submitted: false
        });
    }
    const probe = referenceVideoPath ? await probeReferenceVideo(referenceVideoPath) : null;
    if (probe && probe.duration > 10.05) {
        throw new WebProviderError(`Google Flow 参考视频最多 10 秒，当前为 ${probe.duration.toFixed(2)} 秒`, {
            provider: PROVIDER, code: 'INVALID_INPUT', submitted: false
        });
    }
    const uploadAuth = (files.length || referenceVideoPath) ? await getFlowAuth({ signal, forceRefresh: true }) : null;
    const mediaIds = files.length ? await uploadReferenceImages(uploadAuth, files, { signal }) : [];
    const uploadedVideo = referenceVideoPath
        ? await uploadReferenceVideo(uploadAuth, referenceVideoPath, { signal })
        : null;
    if (uploadedVideo) await waitForReferenceVideoReady(uploadedVideo, uploadAuth, { signal });
    const auth = await getFlowAuth({ signal, forceRefresh: true, recaptchaAction: 'VIDEO_GENERATION' });

    const batchId = randomUUID();
    attachCurrentGenerationDetails(PROVIDER, { batchId, projectId: auth.projectId });
    const spec = buildGenerateVideoRequest({
        auth,
        prompt: cleanPrompt,
        modelFamily: modelId || FLOW_BASELINE_VIDEO_MODEL,
        aspectRatio,
        duration,
        count,
        batchId,
        firstFrameMediaId: firstFrameInput ? mediaIds[0] : '',
        referenceMediaIds: firstFrameInput ? mediaIds.slice(1) : mediaIds,
        referenceVideo: uploadedVideo ? {
            mediaId: uploadedVideo.mediaId,
            workflowId: uploadedVideo.workflowId
        } : null
    });
    const response = await webFetchOk(PROVIDER, buildRequestSpec(spec), {
        signal,
        submitted: true,
        what: '视频生成',
        timeoutSeconds: 600
    });

    const submitJson = response.json();
    let media = parseGenerateVideoResponse(submitJson);
    if (media.length === 0) {
        throw new WebProviderError(
            `${PROVIDER_NAME} 视频任务已提交但没有返回媒体条目，请到 Flow 项目历史中确认，不要直接重新生成。`,
            { provider: PROVIDER, code: 'GENERATION_FAILED', submitted: true }
        );
    }
    attachCurrentGenerationDetails(PROVIDER, {
        projectId: auth.projectId,
        mediaIds: media.map(item => item.mediaId).filter(Boolean)
    });

    media = await waitForFlowVideos(media, auth, {
        timeoutMinutes,
        signal,
        // 参考视频编辑走 workflowId 匹配，绕开「提交 mediaId ≠ 最终结果 name」。
        editMatch: uploadedVideo
            ? { workflowId: uploadedVideo.workflowId, referenceMediaId: uploadedVideo.mediaId }
            : null
    });

    const videos = await Promise.all(media.map(item => runProviderDownload(PROVIDER, async () => {
        const downloaded = await downloadResultMedia(buildFlowMediaUrl(item.mediaId), {
            providerName: PROVIDER_NAME,
            expectedType: 'video',
            cookieHeader: auth.labsCookie,
            recoveryHint: '请先到 Flow 项目历史中下载本次结果，不要直接重新生成。',
            signal
        });
        return { ...downloaded, metadata: item };
    }, { signal, label: `${PROVIDER_NAME} 视频下载` })));
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
async function waitForFlowVideos(media, auth, { timeoutMinutes, signal, editMatch = null }) {
    // 参考视频编辑的结果 name 由 Flow 在提交后才分配，提交响应里没有，所以不能提前
    // 判定「已完成」。只有非编辑路径能走这条快速返回。
    if (!editMatch && media.every(isFlowVideoCompleted)) return media;

    // 单调时钟算超时预算（借鉴 gflow-cli 的 time.monotonic）；auth 设为可变，长视频轮询
    // 中途可静默续期，扛过 session 过期而不是干等到 15 分钟超时。
    const deadline = performance.now() + timeoutMinutes * 60_000;
    let current = media;
    let pollAuth = auth;
    // 下一轮轮询前的等待；命中 429 时按服务端 Retry-After 覆盖（借鉴 gflow-cli 尊重 Retry-After）。
    let nextPollDelayMs = VIDEO_POLL_INTERVAL_MS;
    while (performance.now() < deadline) {
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

        await sleep(nextPollDelayMs, signal);
        nextPollDelayMs = VIDEO_POLL_INTERVAL_MS;

        try {
            // 会话临近过期先主动续期，避免这次轮询正好撞上 401。
            pollAuth = await ensureFreshFlowAuth(pollAuth, { signal });
            const wantedIds = current.map(item => item.mediaId);
            const spec = buildProjectMediaRequest({ auth: pollAuth, mediaIds: wantedIds });
            const payload = await runProviderPoll(
                PROVIDER,
                () => fetchFlowProjectMedia(spec, { signal }),
                { signal, label: `${PROVIDER_NAME} 视频轮询` }
            );
            const refreshed = collectMediaEntries(payload).map(parseFlowVideoMedia).filter(item => item.mediaId);
            const wanted = new Set(wantedIds);
            let matches = refreshed.filter(item => wanted.has(item.mediaId));

            // 参考视频编辑：结果 media 的最终 name 由 Flow 在提交之后分配，提交响应里
            // 拿不到，按提交 mediaId 轮询永远匹配不上（正是 15 分钟超时的根因）。但结果
            // 会继承参考视频的 workflowId——我们每轮都新上传参考视频，该 id 每次唯一，
            // 且同一 workflowId 下除参考视频本身外只有这一个生成结果，据此稳定定位。
            const editMatches = editMatch ? selectEditResultMedia(refreshed, editMatch) : [];
            if (editMatches.length > 0) matches = editMatches;

            if (matches.length > 0) current = matches;
        } catch (error) {
            // Poll endpoints change shape more often than generate endpoints do;
            // a lookup failure must not discard an already-billed generation.
            // 认证失效（401）：轮询中途静默续期一次后继续等，让长视频扛过 session 过期
            // （借鉴 gflow-cli 的 401→refresh→retry）。403 是墙、续期解不开，只记日志继续等。
            if (error?.code === 'AUTH_EXPIRED') {
                try {
                    pollAuth = await getFlowAuth({ signal, forceRefresh: true });
                    console.warn('[Flow HTTP] 视频轮询遇认证失效，已静默刷新登录态后继续等待');
                } catch (refreshError) {
                    console.warn(`[Flow HTTP] 视频轮询续期失败，继续等待：${refreshError.message}`);
                }
            } else {
                // 限流：按服务端 Retry-After 拉长下一轮等待（不短于常规轮询间隔）。
                if (error?.code === 'RATE_LIMIT' && error?.details?.retryAfterMs > 0) {
                    nextPollDelayMs = Math.max(VIDEO_POLL_INTERVAL_MS, error.details.retryAfterMs);
                }
                console.warn(`[Flow HTTP] 视频状态查询失败，继续等待：${error.message}`);
            }
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
            // 401 = 登录过期（可续期解），403 = 墙（续期解不开），429 = 限流（尊重 Retry-After）。
            // 分开归类，让轮询只对 401 触发续期、对 429 按服务端指示退避。
            const code = response.status === 401 ? 'AUTH_EXPIRED'
                : response.status === 403 ? 'WAF_BLOCKED'
                    : response.status === 429 ? 'RATE_LIMIT'
                        : 'GENERATION_FAILED';
            const retryAfterMs = code === 'RATE_LIMIT' ? parseRetryAfterMs(response.headers) : null;
            throw new WebProviderError(`${PROVIDER_NAME} 视频状态查询失败：HTTP ${response.status}`, {
                provider: PROVIDER,
                code,
                submitted: true,
                ...(retryAfterMs !== null ? { details: { retryAfterMs } } : {})
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
