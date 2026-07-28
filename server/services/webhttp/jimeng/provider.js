/**
 * 即梦 (Dreamina) HTTP provider.
 *
 * Browser supplies the login + the per-request signature (requests are issued
 * from the page); Node owns workspace management, draft construction, task
 * polling, result parsing and the final CDN download.
 *
 * Recovery advantage worth noting: `submit_id` is generated *here*, before the
 * request goes out. So when a submit returns an ambiguous result, the task can
 * be looked up by that id instead of guessed at — see `recoverJimengTask`.
 */

import { randomUUID } from 'node:crypto';

import {
    attachCurrentGenerationDetails,
    runProviderDownload,
    runProviderPoll
} from '../../generationRuntime/scheduler.js';
import { buildRequestSpec, webContext, webFetch } from '../bridge.js';
import { WebProviderError, classifyHttpFailure } from '../errors.js';
import { downloadResultMedia, loadReferenceImageFiles, requireNonEmptyPrompt } from '../media.js';
import { fetchImageXCredentials, uploadReferenceImage } from './imagex.js';
import {
    JIMENG_BASELINE_IMAGE_MODEL,
    buildGenerateUrl,
    buildJimengSignHeaders,
    toolPageUrl,
    JIMENG_BASELINE_VIDEO_MODEL,
    JIMENG_IMAGE_RATIOS,
    JIMENG_IMAGE_RESOLUTIONS,
    JIMENG_IMAGE_LITE_MAX_BATCH_COUNT,
    JIMENG_VIDEO_INPUT_MODES,
    apiUrl,
    buildBlendDraft,
    buildGenerateBody,
    buildImageDraft,
    buildVideoDraft,
    extractJimengModels,
    isJimengImageCompleted,
    isJimengTaskFailed,
    isJimengVideoCompleted,
    jimengImageMaxBatchCount,
    jimengImageSupportedResolutions,
    jimengVideoCapabilities,
    jimengBusinessError,
    parseJimengImageResults,
    parseJimengVideoResults,
    pickHistoryRecord,
    pollingConfigFrom
} from './protocol.js';

const PROVIDER = 'jimeng';
const PROVIDER_NAME = '即梦';

/** First poll happens quickly, then the server's own cadence takes over (doc §30). */
const FIRST_POLL_DELAY_MS = 4_000;
const FALLBACK_POLL_INTERVAL_MS = 15_000;

async function jimengApi(path, body, { signal, submitted = false, what = '接口调用', timeoutSeconds, url, pageUrl } = {}) {
    const target = url || apiUrl(path);
    const response = await webFetch(PROVIDER, buildRequestSpec({
        url: target,
        method: 'POST',
        json: body ?? {},
        // 站点自己的请求层会加这一组头；裸 XHR 拿不到，必须我们补上，
        // 否则受保护接口一律 permission denied。
        headers: buildJimengSignHeaders(target),
        timeoutSeconds,
        pageUrl,
        // 即梦所有业务接口统一走 XHR：受保护路径必须靠 XHR 钩子补 sign 头，
        // 其余路径走 XHR 也完全正常，没必要按路径分叉。
        transport: 'xhr'
    }), { signal, timeoutSeconds, submitted });

    if (!response.ok) {
        throw new WebProviderError(`${PROVIDER_NAME}${what}失败：HTTP ${response.status}`, {
            provider: PROVIDER, code: classifyHttpFailure(response.status, response.text), submitted
        });
    }
    const payload = response.json();
    const businessError = jimengBusinessError(payload);
    if (businessError) {
        // ret != 0 covers login expiry and risk control as well as plain errors.
        const lowered = businessError.toLowerCase();
        const code = /login|登录|未登录|token/.test(lowered) ? 'AUTH_EXPIRED'
            : /sign|签名/.test(lowered) ? 'SIGN_FAILED'
                : /风控|risk/.test(lowered) ? 'RATE_LIMIT'
                    : /积分|余额|quota|credit/.test(lowered) ? 'QUOTA_EXHAUSTED'
                        : /违规|敏感|policy/.test(lowered) ? 'CONTENT_POLICY'
                            : 'GENERATION_FAILED';
        throw new WebProviderError(`${PROVIDER_NAME}${what}失败：${businessError}`, {
            provider: PROVIDER, code, submitted
        });
    }
    return payload;
}

// ---------------------------------------------------------------------------
// Session / workspace
// ---------------------------------------------------------------------------

/**
 * Per-browser client context (webId). Cached for the process: it is tied to the
 * browser profile, not to the login, so it does not rotate mid-session.
 */
let cachedClientContext = null;

export function clearJimengClientContext() {
    cachedClientContext = null;
}

async function getJimengClientContext({ signal } = {}) {
    if (cachedClientContext) return cachedClientContext;
    const context = await webContext(PROVIDER, { signal });
    cachedClientContext = { webId: context?.webId || '' };
    return cachedClientContext;
}


/** Workspaces are cheap; one per business task keeps histories separable. */
export async function createWorkspace({ name = '未命名对话', signal } = {}) {
    const payload = await jimengApi('/workspace/create', { name }, { signal, what: '创建工作区' });
    const workspaceId = findFirstValue(payload, key => key === 'workspace_id');
    if (!workspaceId) {
        throw new WebProviderError(`${PROVIDER_NAME}创建工作区未返回 workspace_id`, {
            provider: PROVIDER, code: 'PROTOCOL_CHANGED', submitted: false
        });
    }
    return String(workspaceId);
}

export async function updateWorkspace(workspaceId, { signal } = {}) {
    // The doc says it is unclear whether this is mandatory before every
    // generation, so a failure here must not abort the task.
    try {
        await jimengApi('/workspace/update', { workspace_id: Number(workspaceId) || workspaceId },
            { signal, what: '激活工作区' });
    } catch (error) {
        console.warn(`[即梦 HTTP] 激活工作区失败（继续生成）：${error.message}`);
    }
}

async function ensureWorkspace(workspaceId, { signal }) {
    if (workspaceId) {
        await updateWorkspace(workspaceId, { signal });
        return String(workspaceId);
    }
    return createWorkspace({ signal });
}

// ---------------------------------------------------------------------------
// Reference images
// ---------------------------------------------------------------------------

export async function uploadJimengReferenceImages(inputs, libraryDir, { signal } = {}) {
    const files = await loadReferenceImageFiles(inputs, libraryDir, { providerName: PROVIDER_NAME });
    if (files.length === 0) return [];
    const credentials = await fetchImageXCredentials({ signal });
    const uploaded = [];
    for (const file of files) {
        const result = await uploadReferenceImage({ buffer: file.buffer, credentials, signal });
        uploaded.push({ imageUri: result.imageUri });
    }
    return uploaded;
}

// ---------------------------------------------------------------------------
// Task submission + polling
// ---------------------------------------------------------------------------

async function submitDraft({
    draft,
    workspaceId,
    model,
    signal,
    what,
    generateCount = 1,
    toolId,
    featureKey,
    generateType,
    kind = 'image'
}) {
    // Generated before the request so an ambiguous outcome stays recoverable.
    const submitId = randomUUID();
    attachCurrentGenerationDetails(PROVIDER, { submitId, projectId: workspaceId });
    // babi_param（放在 URL 上）携带功能与权益描述符，缺了它服务端直接
    // permission denied；webId 取自 _tea_web_id Cookie，同样是必填。
    const { webId } = await getJimengClientContext({ signal });
    const payload = await jimengApi(
        '/aigc_draft/generate',
        buildGenerateBody({ draft, submitId, workspaceId, model, generateCount }),
        {
            signal, submitted: true, what, timeoutSeconds: 180,
            url: buildGenerateUrl({ model, webId, toolId, featureKey, generateType }),
            pageUrl: toolPageUrl(kind, workspaceId)
        }
    );
    return {
        submitId,
        workspaceId,
        taskId: payload?.data?.task?.task_id || payload?.data?.history_record_id || null,
        historyRecordId: payload?.data?.history_record_id || null
    };
}

export async function getHistoryByIds(submitIds, { signal } = {}) {
    return jimengApi('/get_history_by_ids', { submit_ids: submitIds }, { signal, submitted: true, what: '任务查询' });
}

/**
 * Poll a submitted task until it is terminal.
 *
 * `isCompleted` is passed in because images and videos disagree about what
 * "done" means — see doc §9.2, where a reference edit reports status 45 with an
 * empty item list.
 */
async function waitForTask(task, { isCompleted, parseResults, timeoutMinutes, signal, what }) {
    const deadline = Date.now() + timeoutMinutes * 60_000;
    let interval = FIRST_POLL_DELAY_MS;
    let consecutiveErrors = 0;

    while (Date.now() < deadline) {
        await sleep(interval, signal);
        let payload;
        try {
            payload = await runProviderPoll(
                PROVIDER,
                () => getHistoryByIds([task.submitId], { signal }),
                { signal, label: `${PROVIDER_NAME}${what}轮询` }
            );
            consecutiveErrors = 0;
        } catch (error) {
            // Quota is already spent; keep waiting through transient failures.
            if (error?.code === 'AUTH_EXPIRED' || ++consecutiveErrors >= 5) throw error;
            console.warn(`[即梦 HTTP] ${what}状态查询失败，继续等待：${error.message}`);
            interval = FALLBACK_POLL_INTERVAL_MS;
            continue;
        }

        interval = pollingConfigFrom(payload, FALLBACK_POLL_INTERVAL_MS).intervalMs;
        const record = pickHistoryRecord(payload, task.submitId);
        if (!record) continue;

        if (isCompleted(record)) {
            const results = parseResults(record);
            if (results.length > 0) return results;
        }
        if (isJimengTaskFailed(record)) {
            throw new WebProviderError(
                `${PROVIDER_NAME}${what}失败（status=${record.status}）`,
                { provider: PROVIDER, code: 'GENERATION_FAILED', submitted: true }
            );
        }
    }

    // 超时前最后一次按 submit_id 直接回捞：submit_id 是本地生成的，所以哪怕轮询
    // 一路失败，也能确定任务到底存不存在、结果有没有出来 —— 这是三个平台里唯一
    // 能做到「异常后精确恢复」的一个，不用它就等于白丢一次已经付过费的生成。
    try {
        const recovered = await recoverJimengTask(task.submitId, { signal });
        const results = what.includes('视频') ? recovered.videos : recovered.images;
        if (results?.length > 0) {
            console.warn(`[即梦 HTTP] ${what}轮询超时，但按 submit_id 回捞到结果，继续使用`);
            return results;
        }
    } catch (error) {
        console.warn(`[即梦 HTTP] ${what}超时后的结果回捞失败：${error.message}`);
    }

    throw new WebProviderError(
        `${PROVIDER_NAME}${what}在 ${timeoutMinutes} 分钟内未完成。生成配额已经消耗，`
        + `任务 ID：${task.submitId}。请到即梦历史记录中查看结果，不要直接重新生成。`,
        {
            provider: PROVIDER,
            code: 'POLL_TIMEOUT',
            submitted: true,
            details: { submitId: task.submitId }
        }
    );
}

/**
 * Recover a task whose submit response never arrived.
 *
 * Because the submit id is client-generated, an unknown-outcome submit can be
 * resolved by asking whether the task exists rather than by re-submitting.
 */
export async function recoverJimengTask(submitId, { signal } = {}) {
    const payload = await getHistoryByIds([submitId], { signal });
    const record = pickHistoryRecord(payload, submitId);
    if (!record) return { found: false };
    return {
        found: true,
        status: record.status,
        imageReady: isJimengImageCompleted(record),
        videoReady: isJimengVideoCompleted(record),
        images: parseJimengImageResults(record),
        videos: parseJimengVideoResults(record)
    };
}

// ---------------------------------------------------------------------------
// Public generation API
// ---------------------------------------------------------------------------

export async function generateJimengImageHttp({
    prompt,
    aspectRatio = '1:1',
    resolution = '2K',
    count = 1,
    referenceImageInputs = [],
    modelId,
    workspaceId,
    libraryDir,
    timeoutMinutes = 10,
    signal
}) {
    const cleanPrompt = requireNonEmptyPrompt(prompt, `${PROVIDER_NAME}图片`);
    const model = modelId || JIMENG_BASELINE_IMAGE_MODEL;
    const requestedCount = Number(count ?? 1);
    const maxCount = jimengImageMaxBatchCount(model);
    if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > maxCount) {
        throw new WebProviderError(
            `${PROVIDER_NAME}该图片模型单次生成数量只支持 1-${maxCount}`,
            { provider: PROVIDER, code: 'INVALID_INPUT', submitted: false, retryable: false }
        );
    }
    const requestedResolution = String(resolution || '2K').trim().toLowerCase();
    const normalizedResolution = !requestedResolution || requestedResolution === 'auto' || requestedResolution === '自动'
        ? '2k'
        : requestedResolution;
    const supportedResolutions = jimengImageSupportedResolutions(model);
    if (!supportedResolutions.includes(normalizedResolution)) {
        throw new WebProviderError(
            `${PROVIDER_NAME}该图片模型分辨率只支持 ${supportedResolutions.map(item => item.toUpperCase()).join(' / ')}`,
            { provider: PROVIDER, code: 'INVALID_INPUT', submitted: false, retryable: false }
        );
    }

    const references = await uploadJimengReferenceImages(referenceImageInputs, libraryDir, { signal });
    const workspace = await ensureWorkspace(workspaceId, { signal });

    const draft = references.length > 0
        ? buildBlendDraft({
            prompt: cleanPrompt, images: references, model, ratio: aspectRatio, resolution: normalizedResolution,
            count: requestedCount, maxCount
        })
        : buildImageDraft({
            prompt: cleanPrompt, model, ratio: aspectRatio, resolution: normalizedResolution,
            count: requestedCount, maxCount
        });

    const task = await submitDraft({
        draft, workspaceId: workspace, model, signal, what: '图片生成',
        generateCount: requestedCount,
        toolId: 'tool_image',
        featureKey: 'aigc_to_image',
        generateType: references.length > 0 ? 12 : 1,
        kind: 'image'
    });
    attachCurrentGenerationDetails(PROVIDER, task);
    const results = await waitForTask(task, {
        isCompleted: isJimengImageCompleted,
        parseResults: parseJimengImageResults,
        timeoutMinutes,
        signal,
        what: '图片生成'
    });

    const images = await Promise.all(results.map(item => runProviderDownload(PROVIDER, async () => {
        const downloaded = await downloadResultMedia(item.imageUrl, {
            providerName: `${PROVIDER_NAME}图片生成`,
            expectedType: 'image',
            recoveryHint: '请先到即梦历史记录中下载本次结果，不要直接重新生成。'
        });
        return { ...downloaded, metadata: item };
    }, { signal, label: `${PROVIDER_NAME}图片下载` })));
    return { images, ...images[0], task, runId: task.submitId, channel: 'http' };
}

export async function generateJimengVideoHttp({
    prompt,
    referenceImageInputs = [],
    firstFrameInput,
    endFrameInput,
    aspectRatio = '16:9',
    duration = 5,
    resolution = '720p',
    count = 1,
    modelId,
    inputMode,
    workspaceId,
    libraryDir,
    timeoutMinutes = 15,
    signal
}) {
    const model = modelId || JIMENG_BASELINE_VIDEO_MODEL;
    // Pure text-to-video is legitimate here, so an empty prompt is only invalid
    // when there is no material either.
    const hasMaterial = Boolean(firstFrameInput || endFrameInput || referenceImageInputs.filter(Boolean).length);
    if (!String(prompt || '').trim() && !hasMaterial) {
        throw new WebProviderError(`${PROVIDER_NAME}视频需要提示词或参考素材`, {
            provider: PROVIDER, code: 'PROTOCOL_CHANGED', submitted: false
        });
    }

    const capabilities = jimengVideoCapabilities(model);
    const requestedCount = Number(count ?? 1);
    if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 4) {
        throw new WebProviderError(`${PROVIDER_NAME}视频生成数量只支持 1-4`, {
            provider: PROVIDER, code: 'INVALID_INPUT', submitted: false, retryable: false
        });
    }
    const requestedDuration = Number(duration ?? 5);
    if (!Number.isInteger(requestedDuration) || !capabilities.durations.includes(requestedDuration)) {
        throw new WebProviderError(
            `${PROVIDER_NAME}该视频模型时长只支持 ${capabilities.durations.join(' / ')} 秒`,
            { provider: PROVIDER, code: 'INVALID_INPUT', submitted: false, retryable: false }
        );
    }
    const requestedRatio = String(aspectRatio || '16:9');
    if (!capabilities.aspectRatios.includes(requestedRatio)) {
        throw new WebProviderError(
            `${PROVIDER_NAME}该视频模型不支持 ${requestedRatio} 画幅`,
            { provider: PROVIDER, code: 'INVALID_INPUT', submitted: false, retryable: false }
        );
    }
    const resolutionValue = String(resolution || capabilities.resolutions[0]).trim().toUpperCase();
    const requestedResolution = !resolutionValue || resolutionValue === 'AUTO' || resolutionValue === '自动'
        ? capabilities.resolutions[0]
        : resolutionValue;
    if (!capabilities.resolutions.includes(requestedResolution)) {
        throw new WebProviderError(
            `${PROVIDER_NAME}该视频模型分辨率只支持 ${capabilities.resolutions.join(' / ')}`,
            { provider: PROVIDER, code: 'INVALID_INPUT', submitted: false, retryable: false }
        );
    }
    const materialCount = referenceImageInputs.filter(Boolean).length
        + (firstFrameInput ? 1 : 0)
        + (endFrameInput ? 1 : 0);
    if (materialCount > capabilities.maxReferenceImages) {
        throw new WebProviderError(
            `${PROVIDER_NAME}该视频模型最多支持 ${capabilities.maxReferenceImages} 张参考图`,
            { provider: PROVIDER, code: 'INVALID_INPUT', submitted: false, retryable: false }
        );
    }

    const uploads = await uploadJimengReferenceImages(
        [firstFrameInput, ...referenceImageInputs, endFrameInput].filter(Boolean),
        libraryDir,
        { signal }
    );
    let cursor = 0;
    const firstFrame = firstFrameInput ? uploads[cursor++] : undefined;
    const references = referenceImageInputs.filter(Boolean).map(() => uploads[cursor++]).filter(Boolean);
    const endFrame = endFrameInput ? uploads[cursor++] : undefined;

    const workspace = await ensureWorkspace(workspaceId, { signal });
    const draft = buildVideoDraft({
        prompt,
        mode: inputMode,
        images: references,
        firstFrame,
        endFrame,
        model,
        durationSec: requestedDuration,
        ratio: requestedRatio,
        resolution: requestedResolution.toLowerCase(),
        batchCount: requestedCount
    });

    const task = await submitDraft({
        draft, workspaceId: workspace, model, signal, what: '视频生成',
        generateCount: requestedCount,
        toolId: 'tool_video',
        featureKey: 'aigc_to_video',
        generateType: 10,
        kind: 'video'
    });
    attachCurrentGenerationDetails(PROVIDER, task);
    const results = await waitForTask(task, {
        isCompleted: isJimengVideoCompleted,
        parseResults: parseJimengVideoResults,
        timeoutMinutes,
        signal,
        what: '视频生成'
    });

    const videos = await Promise.all(results.map(item => runProviderDownload(PROVIDER, async () => {
        const downloaded = await downloadResultMedia(item.videoUrl, {
            providerName: PROVIDER_NAME,
            expectedType: 'video',
            recoveryHint: '请先到即梦历史记录中下载本次结果，不要直接重新生成。'
        });
        return { ...downloaded, metadata: item };
    }, { signal, label: `${PROVIDER_NAME}视频下载` })));
    return { videos, ...videos[0], task, runId: task.submitId, channel: 'http' };
}

// ---------------------------------------------------------------------------
// Dynamic model discovery
// ---------------------------------------------------------------------------

/**
 * 动态模型发现。
 *
 * 数据源是页面 bootstrap 里服务端下发的模型表（见 webhttp.py 的 jimeng 上下文
 * 脚本），不是猜来的接口名。发现失败时退回内置基线，绝不让模型下拉变空。
 */
export async function discoverJimengModels({ signal } = {}) {
    const baseline = {
        images: [{
            id: JIMENG_BASELINE_IMAGE_MODEL,
            displayName: '图片 5.0 Lite',
            type: 'image',
            aspectRatios: [...JIMENG_IMAGE_RATIOS],
            resolutions: [...JIMENG_IMAGE_RESOLUTIONS],
            maxBatchCount: JIMENG_IMAGE_LITE_MAX_BATCH_COUNT,
            supportsReferenceImage: true
        }],
        videos: [{
            id: JIMENG_BASELINE_VIDEO_MODEL,
            displayName: '即梦 Seedance 2.0 mini',
            type: 'video',
            fps: 24,
            durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
            aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
            resolutions: ['720P'],
            maxBatchCount: 4,
            maxReferenceImages: 9,
            inputModes: [...JIMENG_VIDEO_INPUT_MODES],
            supportsAudio: true
        }]
    };

    try {
        const context = await webContext(PROVIDER, { signal });
        const found = extractJimengModels(context?.modelConfig);
        if (found.images.length > 0 || found.videos.length > 0) {
            return {
                images: found.images.length ? found.images : baseline.images,
                videos: found.videos.length ? found.videos : baseline.videos,
                discovered: true
            };
        }
    } catch (error) {
        console.warn(`[即梦 HTTP] 模型发现失败，沿用内置基线：${error.message}`);
    }
    return { ...baseline, discovered: false };
}

// ---------------------------------------------------------------------------

function findFirstValue(node, matches, depth = 0) {
    if (!node || depth > 8 || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
        for (const item of node) {
            const found = findFirstValue(item, matches, depth + 1);
            if (found) return found;
        }
        return null;
    }
    for (const [key, value] of Object.entries(node)) {
        if (matches(key) && value) return value;
    }
    for (const value of Object.values(node)) {
        const found = findFirstValue(value, matches, depth + 1);
        if (found) return found;
    }
    return null;
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
