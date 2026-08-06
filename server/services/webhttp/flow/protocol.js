/**
 * Google Labs Flow HTTP protocol — request builders and response parsers.
 *
 * Pure functions only: no network, no browser, no clock. Everything here is
 * driven by current Flow runtime requests captured on 2026-07-28. The page's
 * model table is family-based: one visible video model resolves to a different
 * protocol key and endpoint for text, start-image and reference-image modes.
 */

export const FLOW_TOOL = 'PINHOLE';
export const FLOW_API_ORIGIN = 'https://aisandbox-pa.googleapis.com';
export const FLOW_LABS_ORIGIN = 'https://labs.google';
export const FLOW_IMAGE_RESOLUTIONS = Object.freeze(['1K', '2K']);
export const FLOW_DEFAULT_IMAGE_RESOLUTION = '2K';

/** Current visible model defaults, used only when model discovery is unavailable. */
export const FLOW_BASELINE_IMAGE_MODEL = 'NARWHAL';
export const FLOW_BASELINE_VIDEO_MODEL = 'abra';
export const FLOW_VIDEO_UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;

const IMAGE_ASPECT_RATIOS = Object.freeze({
    '1:1': 'IMAGE_ASPECT_RATIO_SQUARE',
    '16:9': 'IMAGE_ASPECT_RATIO_LANDSCAPE',
    '9:16': 'IMAGE_ASPECT_RATIO_PORTRAIT',
    '4:3': 'IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE',
    '3:4': 'IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR'
});

const VIDEO_ASPECT_RATIOS = Object.freeze({
    '16:9': 'VIDEO_ASPECT_RATIO_LANDSCAPE',
    '9:16': 'VIDEO_ASPECT_RATIO_PORTRAIT',
    '1:1': 'VIDEO_ASPECT_RATIO_SQUARE'
});

export function toFlowImageAspectRatio(ratio) {
    return IMAGE_ASPECT_RATIOS[String(ratio || '').trim()] || 'IMAGE_ASPECT_RATIO_UNSPECIFIED';
}

export function toFlowVideoAspectRatio(ratio) {
    return VIDEO_ASPECT_RATIOS[String(ratio || '').trim()] || 'VIDEO_ASPECT_RATIO_LANDSCAPE';
}

export function fromFlowImageAspectRatio(value) {
    const entry = Object.entries(IMAGE_ASPECT_RATIOS).find(([, enumValue]) => enumValue === value);
    return entry ? entry[0] : '';
}

/** Seeds are user-invisible but must vary per request. */
export function randomSeed(random = Math.random, maximum = 1_000_000) {
    return Math.floor(random() * maximum) + 1;
}

function clientContext({ projectId, sessionId, recaptchaToken, userPaygateTier }) {
    const context = { projectId, tool: FLOW_TOOL };
    if (sessionId) context.sessionId = sessionId;
    if (recaptchaToken) {
        context.recaptchaContext = {
            token: recaptchaToken,
            applicationType: 'RECAPTCHA_APPLICATION_TYPE_WEB'
        };
    }
    if (userPaygateTier) context.userPaygateTier = userPaygateTier;
    return context;
}

export function buildUploadImageRequest({ auth, buffer, fileName, mimeType }) {
    return {
        url: `${FLOW_API_ORIGIN}/v1/flow/uploadImage`,
        method: 'POST',
        headers: {
            authorization: `Bearer ${auth.accessToken}`,
            'content-type': 'text/plain;charset=UTF-8'
        },
        body: JSON.stringify({
            clientContext: { projectId: auth.projectId, tool: FLOW_TOOL },
            imageBytes: Buffer.from(buffer).toString('base64'),
            isUserUploaded: true,
            isHidden: false,
            mimeType,
            fileName
        })
    };
}

export function parseUploadImageResponse(payload) {
    const mediaId = payload?.media?.name || payload?.workflow?.metadata?.primaryMediaId || '';
    if (!mediaId) return null;
    return {
        mediaId,
        workflowId: payload?.media?.workflowId || '',
        width: payload?.media?.image?.dimensions?.width,
        height: payload?.media?.image?.dimensions?.height
    };
}

export function buildStartVideoUploadRequest({ projectId, fileName, mimeType, size }) {
    return {
        url: `${FLOW_LABS_ORIGIN}/fx/api/upload-video?action=start`,
        method: 'POST',
        headers: {
            'x-upload-project-id': String(projectId || ''),
            'x-upload-content-length': String(size),
            'x-upload-content-type': String(mimeType || 'video/mp4'),
            'x-upload-file-name': encodeURIComponent(String(fileName || 'reference-video.mp4'))
        }
    };
}

export function parseStartVideoUploadResponse(payload) {
    const sessionUrl = String(payload?.sessionUrl || '');
    return sessionUrl ? { sessionUrl, status: String(payload?.status || '') } : null;
}

export function buildVideoUploadChunkRequest({ projectId, sessionUrl, fileName, offset, buffer, final }) {
    return {
        url: `${FLOW_LABS_ORIGIN}/fx/api/upload-video?action=upload`,
        method: 'PUT',
        headers: {
            'content-type': 'application/octet-stream',
            'x-upload-session-url': String(sessionUrl || ''),
            'x-upload-offset': String(offset),
            'x-upload-command': final ? 'upload, finalize' : 'upload',
            'x-upload-project-id': String(projectId || ''),
            'x-upload-file-name': encodeURIComponent(String(fileName || 'reference-video.mp4'))
        },
        body: Buffer.from(buffer)
    };
}

export function parseVideoUploadResponse(payload) {
    const mediaId = String(payload?.mediaServerId || '');
    const workflowId = String(payload?.workflowServerId || '');
    if (!mediaId || !workflowId) return null;
    return {
        mediaId,
        workflowId,
        status: String(payload?.status || ''),
        width: Number(payload?.videoWidth) || undefined,
        height: Number(payload?.videoHeight) || undefined
    };
}

/**
 * batchGenerateImages. Reference images are passed as previously-uploaded
 * mediaIds; the doc confirms Flow reuses its own generated mediaIds too, so no
 * re-upload round trip is needed for canvas-to-canvas references.
 */
export function buildGenerateImagesRequest({
    auth,
    prompt,
    modelName = FLOW_BASELINE_IMAGE_MODEL,
    aspectRatio,
    count = 1,
    referenceMediaIds = [],
    seed,
    batchId
}) {
    const context = clientContext(auth);
    const imageInputs = referenceMediaIds.filter(Boolean).map(mediaId => ({
        imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE',
        name: mediaId
    }));

    const requests = Array.from({ length: Math.max(1, count) }, (unused, index) => ({
        clientContext: context,
        imageModelName: modelName,
        imageAspectRatio: toFlowImageAspectRatio(aspectRatio),
        structuredPrompt: { parts: [{ text: String(prompt) }] },
        seed: (seed || randomSeed()) + index,
        imageInputs
    }));

    return {
        url: `${FLOW_API_ORIGIN}/v1/projects/${encodeURIComponent(auth.projectId)}/flowMedia:batchGenerateImages`,
        method: 'POST',
        headers: {
            authorization: `Bearer ${auth.accessToken}`,
            'content-type': 'text/plain;charset=UTF-8'
        },
        body: JSON.stringify({
            clientContext: context,
            mediaGenerationContext: { batchId },
            useNewMedia: true,
            requests
        })
    };
}

export function parseGenerateImagesResponse(payload) {
    return (payload?.media ?? []).map(item => {
        const generated = item?.image?.generatedImage ?? {};
        const dimensions = item?.image?.dimensions ?? {};
        return {
            mediaId: generated.mediaId || item?.name || '',
            workflowId: item?.workflowId || generated.workflowId || '',
            imageUrl: generated.fifeUrl || '',
            prompt: generated.prompt || '',
            model: generated.modelNameType || '',
            aspectRatio: generated.aspectRatio || '',
            width: dimensions.width,
            height: dimensions.height,
            seed: generated.seed
        };
    }).filter(item => item.mediaId);
}

/**
 * Flow 页面 2026-07-29 的真实图片下载协议：
 *
 * - 1K "Original size"：media.getMediaUrlRedirect → 307 → 签名 CDN；
 * - 2K "Upscaled"：POST /v1/flow/upsampleImage，响应 JSON 的 encodedImage
 *   就是最终 JPEG，同时返回一个新的 2K media.name。
 *
 * 旧项目只有 Auto/自动或没有字段时按产品默认 2K；明确保存的 1K 保持不变。
 */
export function normalizeFlowImageResolution(value) {
    const stored = String(value || '').trim();
    if (!stored || ['AUTO', '自动'].includes(stored.toUpperCase())) {
        return FLOW_DEFAULT_IMAGE_RESOLUTION;
    }
    const normalized = stored.toUpperCase();
    if (FLOW_IMAGE_RESOLUTIONS.includes(normalized)) return normalized;
    throw new Error(`Google Flow 图片分辨率只支持 ${FLOW_IMAGE_RESOLUTIONS.join('/')}`);
}

export function buildUpsampleImageRequest({ auth, mediaId, resolution = FLOW_DEFAULT_IMAGE_RESOLUTION }) {
    const normalized = normalizeFlowImageResolution(resolution);
    if (normalized !== '2K') {
        throw new Error(`Flow 高清接口不支持目标分辨率：${resolution}`);
    }
    if (!mediaId) throw new Error('Flow 2K 高清下载缺少原始 mediaId');
    return {
        url: `${FLOW_API_ORIGIN}/v1/flow/upsampleImage`,
        method: 'POST',
        headers: {
            authorization: `Bearer ${auth.accessToken}`,
            'content-type': 'text/plain;charset=UTF-8'
        },
        body: JSON.stringify({
            mediaId,
            targetResolution: 'UPSAMPLE_IMAGE_RESOLUTION_2K',
            clientContext: clientContext(auth)
        })
    };
}

export function parseUpsampleImageResponse(payload) {
    const media = payload?.media ?? {};
    const generated = media?.image?.generatedImage ?? {};
    const encodedImage = String(payload?.encodedImage || '').replace(/^data:image\/[^;]+;base64,/i, '');
    if (!media?.name || !encodedImage) return null;
    return {
        mediaId: media.name,
        workflowId: media.workflowId || generated.workflowId || '',
        encodedImage,
        resolution: generated?.upsampleMetadata?.imageUpsampleResolution || '',
        size: Number(media?.mediaMetadata?.mediaBlobSize || 0)
    };
}

/**
 * Validate the bytes that will actually be saved, not the UI selection.
 *
 * Flow's original media dimensions are returned by batchGenerateImages and are
 * aspect-ratio aware (the captured 16:9 sample is 1376×768). The official 2K
 * endpoint doubles both axes (captured: 2752×1536), so comparison against the
 * source dimensions is stronger than assuming every ratio is 2048×2048.
 */
export function validateFlowImageDimensions({
    requestedResolution,
    actualWidth,
    actualHeight,
    sourceWidth,
    sourceHeight
}) {
    const resolution = normalizeFlowImageResolution(requestedResolution);
    const width = Number(actualWidth);
    const height = Number(actualHeight);
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
        return {
            valid: false,
            reason: '下载结果没有可读取的正整数像素尺寸',
            requestedResolution: resolution,
            actualWidth: width || 0,
            actualHeight: height || 0
        };
    }

    const originalWidth = Number(sourceWidth);
    const originalHeight = Number(sourceHeight);
    if (Number.isInteger(originalWidth) && originalWidth > 0
        && Number.isInteger(originalHeight) && originalHeight > 0) {
        const scale = resolution === '2K' ? 2 : 1;
        const expectedWidth = originalWidth * scale;
        const expectedHeight = originalHeight * scale;
        return {
            valid: width === expectedWidth && height === expectedHeight,
            reason: width === expectedWidth && height === expectedHeight
                ? ''
                : `期望 ${expectedWidth}×${expectedHeight}，实际 ${width}×${height}`,
            requestedResolution: resolution,
            sourceWidth: originalWidth,
            sourceHeight: originalHeight,
            expectedWidth,
            expectedHeight,
            actualWidth: width,
            actualHeight: height
        };
    }

    // Compatibility fallback for a future response shape that omits source
    // dimensions. It still rejects the known 1K class when 2K was requested.
    const minimumLongEdge = resolution === '2K' ? 2048 : 1024;
    const actualLongEdge = Math.max(width, height);
    return {
        valid: actualLongEdge >= minimumLongEdge,
        reason: actualLongEdge >= minimumLongEdge
            ? ''
            : `${resolution} 长边至少应为 ${minimumLongEdge}px，实际 ${actualLongEdge}px`,
        requestedResolution: resolution,
        actualWidth: width,
        actualHeight: height,
        minimumLongEdge
    };
}

const FLOW_VIDEO_ENDPOINTS = Object.freeze({
    text: 'batchAsyncGenerateVideoText',
    'start-image': 'batchAsyncGenerateVideoStartImage',
    'reference-images': 'batchAsyncGenerateVideoReferenceImages'
});

const FLOW_VIDEO_DURATIONS = Object.freeze({
    abra: Object.freeze({
        text: [4, 6, 8, 10],
        'start-image': [4, 6, 8, 10],
        'reference-images': [4, 6, 8, 10]
    }),
    veo_3_1_lite: Object.freeze({
        text: [8],
        'start-image': [8],
        'reference-images': [8]
    }),
    veo_3_1_fast: Object.freeze({
        text: [8],
        'start-image': [8],
        'reference-images': [8]
    }),
    veo_3_1_quality: Object.freeze({
        text: [8],
        'start-image': [8]
    })
});

/** Families returned by Flow's authenticated /v1/flow/models/statuses endpoint. */
export const FLOW_VIDEO_FAMILY_CAPABILITIES = Object.freeze({
    abra: Object.freeze({
        displayName: 'Omni Flash', durations: [4, 6, 8, 10],
        aspectRatios: ['16:9', '9:16'], supportsImageToVideo: true,
        supportsFirstFrame: true, maxReferenceImages: 7, maxBatchCount: 1, supportsAudio: true
    }),
    veo_3_1_lite: Object.freeze({
        displayName: 'Veo 3.1 - Lite', durations: [8],
        aspectRatios: ['16:9', '9:16'], supportsImageToVideo: true,
        supportsFirstFrame: true, maxReferenceImages: 3, maxBatchCount: 1, supportsAudio: true
    }),
    veo_3_1_fast: Object.freeze({
        displayName: 'Veo 3.1 - Fast', durations: [8],
        aspectRatios: ['16:9', '9:16'], supportsImageToVideo: true,
        supportsFirstFrame: true, maxReferenceImages: 3, maxBatchCount: 1, supportsAudio: true
    }),
    veo_3_1_quality: Object.freeze({
        displayName: 'Veo 3.1 - Quality', durations: [8],
        aspectRatios: ['16:9', '9:16'], supportsImageToVideo: true,
        supportsFirstFrame: true, maxReferenceImages: 1, maxBatchCount: 1, supportsAudio: true
    })
});

function normalizeFlowVideoDuration(modelFamily, mode, duration) {
    const supported = FLOW_VIDEO_DURATIONS[modelFamily]?.[mode];
    if (!supported) return Number(duration) || 8;
    const requested = Number(duration) || supported[0];
    if (!supported.includes(requested)) {
        throw new Error(
            `Google Flow ${modelFamily} 的 ${mode} 模式不支持 ${requested} 秒；支持 ${supported.join('/')} 秒`
        );
    }
    return requested;
}

/** Resolve a visible Flow video family to the exact current request key/API. */
export function resolveFlowVideoVariant({
    modelFamily = FLOW_BASELINE_VIDEO_MODEL,
    mode = 'text',
    duration,
    aspectRatio = '16:9'
}) {
    const endpoint = FLOW_VIDEO_ENDPOINTS[mode];
    if (!endpoint) throw new Error(`Google Flow 不支持的视频输入模式：${mode}`);

    // Compatibility for protocol ids stored by development builds before the
    // family-aware resolver existed.
    if (/^(abra_|veo_3_1_).*(?:t2v|i2v|r2v)/.test(modelFamily)) {
        return { modelKey: modelFamily, apiPathname: endpoint, duration: Number(duration) || undefined };
    }

    if (modelFamily === 'veo_3_1_quality' && mode === 'reference-images') {
        throw new Error('Google Flow Veo 3.1 - Quality 当前不支持 Ingredients 多参考图模式');
    }
    const seconds = normalizeFlowVideoDuration(modelFamily, mode, duration);
    if (modelFamily === 'abra') {
        const kind = mode === 'text' ? 't2v' : mode === 'start-image' ? 'i2v' : 'r2v';
        return { modelKey: `abra_${kind}_${seconds}s`, apiPathname: endpoint, duration: seconds };
    }
    if (modelFamily === 'veo_3_1_lite') {
        let modelKey;
        if (mode === 'text') modelKey = 'veo_3_1_t2v_lite';
        if (mode === 'start-image') modelKey = 'veo_3_1_i2v_lite';
        if (mode === 'reference-images') modelKey = 'veo_3_1_r2v_lite';
        return { modelKey, apiPathname: endpoint, duration: seconds };
    }
    if (modelFamily === 'veo_3_1_fast') {
        let modelKey;
        if (mode === 'text') modelKey = 'veo_3_1_t2v_fast';
        if (mode === 'start-image') modelKey = 'veo_3_1_i2v_s_fast';
        if (mode === 'reference-images') {
            modelKey = aspectRatio === '9:16'
                ? 'veo_3_1_r2v_fast_portrait'
                : 'veo_3_1_r2v_fast_landscape';
        }
        return { modelKey, apiPathname: endpoint, duration: seconds };
    }
    if (modelFamily === 'veo_3_1_quality') {
        const modelKey = mode === 'text' ? 'veo_3_1_t2v' : 'veo_3_1_i2v_s';
        return { modelKey, apiPathname: endpoint, duration: seconds };
    }
    throw new Error(`Google Flow 未识别的视频模型族：${modelFamily}`);
}

export function buildGenerateVideoRequest({
    auth,
    prompt,
    modelFamily = FLOW_BASELINE_VIDEO_MODEL,
    aspectRatio,
    duration,
    count = 1,
    seed,
    batchId,
    flowWorkflowId = '',
    collectionId = '',
    sceneId = '',
    firstFrameMediaId = '',
    referenceMediaIds = [],
    referenceVideo
}) {
    const context = clientContext(auth);
    const references = referenceMediaIds.filter(Boolean);
    if (referenceVideo && (firstFrameMediaId || references.length > 0)) {
        throw new Error('Google Flow 参考视频不能与首帧或参考图混用');
    }
    if (firstFrameMediaId && references.length > 0) {
        throw new Error('Google Flow 首帧模式与多参考图模式不能在同一请求中混用');
    }
    if (referenceVideo && modelFamily !== 'abra') {
        throw new Error('Google Flow 参考视频当前只支持 Omni Flash');
    }
    const mode = referenceVideo ? 'video-edit' : references.length > 0 ? 'reference-images' : firstFrameMediaId ? 'start-image' : 'text';
    const variant = referenceVideo
        ? { modelKey: 'abra_edit', apiPathname: 'batchAsyncGenerateVideoEditVideo' }
        : resolveFlowVideoVariant({ modelFamily, mode, duration, aspectRatio });

    const requests = Array.from({ length: Math.max(1, count) }, (unused, index) => {
        const seedMaximum = referenceVideo ? 0x7fff : 1_000_000;
        const request = {
            aspectRatio: toFlowVideoAspectRatio(aspectRatio),
            textInput: { structuredPrompt: { parts: [{ text: String(prompt || '') }] } },
            videoModelKey: variant.modelKey,
            seed: (seed ?? randomSeed(Math.random, seedMaximum)) + index,
            metadata: {
                ...(flowWorkflowId ? { workflowId: String(flowWorkflowId) } : {}),
                ...(collectionId ? { collectionId: String(collectionId) } : {}),
                ...(sceneId ? { sceneId: String(sceneId) } : {})
            }
        };
        if (firstFrameMediaId) request.startImage = { mediaId: firstFrameMediaId };
        if (references.length > 0) {
            // 提交请求使用 referenceImages + IMAGE_USAGE_TYPE_ASSET；Flow 落到项目
            // 历史后会把同一输入规范化为 videoGenerationImageInputs + ASSET_IMAGE。
            // 这两个枚举属于不同 schema，不能混用。
            request.referenceImages = references.map(mediaId => ({
                mediaId,
                imageUsageType: 'IMAGE_USAGE_TYPE_ASSET'
            }));
        }
        if (referenceVideo) {
            if (referenceVideo.workflowId) request.metadata.workflowId = referenceVideo.workflowId;
            if (referenceVideo.collectionId) request.metadata.collectionId = referenceVideo.collectionId;
            if (referenceVideo.sceneId) request.metadata.sceneId = referenceVideo.sceneId;
            request.videoInput = { mediaId: referenceVideo.mediaId };
            // Flow's page only sends trim indices when the user explicitly trims the
            // source. Sending fabricated indices for a full-video edit can leave the
            // request accepted but never materialize in project history.
            if (referenceVideo.startFrameIndex !== undefined) {
                request.videoInput.startFrameIndex = Number(referenceVideo.startFrameIndex);
            }
            if (referenceVideo.endFrameIndex !== undefined) {
                request.videoInput.endFrameIndex = Number(referenceVideo.endFrameIndex);
            }
        }
        return request;
    });

    return {
        url: `${FLOW_API_ORIGIN}/v1/video:${variant.apiPathname}`,
        method: 'POST',
        headers: {
            authorization: `Bearer ${auth.accessToken}`,
            'content-type': 'text/plain;charset=UTF-8'
        },
        body: JSON.stringify({
            mediaGenerationContext: {
                batchId,
                // Flow 页面只在用户明确打开「允许静音视频」时才发送
                // audioFailurePreference；默认请求不携带该字段。
            },
            clientContext: context,
            requests,
            ...(referenceVideo ? {} : { useV2ModelConfig: true })
        })
    };
}

export const FLOW_VIDEO_STATUS_SUCCESS = 'MEDIA_GENERATION_STATUS_SUCCESSFUL';
const FLOW_VIDEO_STATUS_FAILED = new Set([
    'MEDIA_GENERATION_STATUS_FAILED',
    'MEDIA_GENERATION_STATUS_FAILED_SAFETY',
    'MEDIA_GENERATION_STATUS_CANCELLED'
]);

export function parseFlowVideoMedia(media) {
    const videoGenerationRequestData = media?.mediaMetadata?.requestData?.videoGenerationRequestData;
    const videoInputs = videoGenerationRequestData?.videoGenerationVideoInputs
        || videoGenerationRequestData?.videoGenerationImageInputs;
    const mediaStatus = media?.mediaMetadata?.mediaStatus || {};
    const failureReasons = Array.isArray(mediaStatus.failureReasons)
        ? mediaStatus.failureReasons.filter(Boolean).map(String)
        : [];
    return {
        mediaId: media?.name || media?.mediaId || media?.video?.generatedVideo?.mediaId || media?.video?.operation?.name || '',
        workflowId: media?.workflowId || media?.mediaMetadata?.workflowId || '',
        workflowStepId: media?.workflowStepId || media?.mediaMetadata?.workflowStepId || '',
        status: mediaStatus.mediaGenerationStatus || '',
        errorCode: mediaStatus.error?.code ?? '',
        errorMessage: mediaStatus.error?.message || '',
        failureReasons,
        visibility: media?.mediaMetadata?.visibility || '',
        model: media?.video?.generatedVideo?.model || '',
        prompt: media?.video?.generatedVideo?.prompt || '',
        seed: media?.video?.generatedVideo?.seed,
        aspectRatio: media?.video?.generatedVideo?.aspectRatio || '',
        duration: media?.video?.dimensions?.length || '',
        resolution: media?.mediaMetadata?.requestData?.videoGenerationRequestData
            ?.videoModelControlInput?.videoResolution || '',
        videoInputMediaIds: Array.isArray(videoInputs)
            ? videoInputs.map(input => input?.mediaId).filter(Boolean)
            : [],
        generationMode: media?.mediaMetadata?.requestData?.videoGenerationRequestData
            ?.videoModelControlInput?.videoGenerationMode || '',
        size: Number(media?.mediaMetadata?.mediaBlobSize || 0),
        isLooped: media?.video?.generatedVideo?.isLooped ?? false
    };
}

export function parseGenerateVideoResponse(payload) {
    // The doc is explicit that one request may return several media entries.
    // tRPC/API gateway wrappers have returned both { media } and
    // { result: { data: { media } } } over time, so only use a nested array
    // when it contains media-shaped objects.
    const findMedia = (value, depth = 0) => {
        if (!value || depth > 5) return [];
        if (Array.isArray(value)) {
            return value.some(item => item && typeof item === 'object'
                && (item.name || item.mediaId || item.video || item.mediaMetadata))
                ? value
                : value.flatMap(item => findMedia(item, depth + 1));
        }
        if (typeof value !== 'object') return [];
        if (Array.isArray(value.media)) return value.media;
        return Object.values(value).flatMap(item => findMedia(item, depth + 1));
    };
    return findMedia(payload).map(parseFlowVideoMedia).filter(item => item.mediaId);
}

export function isFlowVideoCompleted(media) {
    return media?.status === FLOW_VIDEO_STATUS_SUCCESS;
}

/**
 * 从项目 media 列表里挑出「参考视频编辑」的结果条目。
 *
 * 编辑结果的最终 name 由 Flow 在提交之后才分配，提交响应里拿不到，所以不能只按提交
 * mediaId 轮询。大多数结果会继承参考视频的 workflowId，但真实历史里也存在 workflowId
 * 变化、只在 requestData 里保留输入视频 mediaId 的结果，因此两种字段都要支持。
 */
export function selectEditResultMedia(parsedMedia, { workflowId, referenceMediaId } = {}) {
    if (!workflowId && !referenceMediaId) return [];
    return (parsedMedia || [])
        .filter(item => item?.mediaId && item.mediaId !== referenceMediaId)
        .filter(item => {
            const sameWorkflow = Boolean(workflowId && item.workflowId === workflowId);
            const usesReferenceVideo = Boolean(
                referenceMediaId && item.videoInputMediaIds?.includes(referenceMediaId)
            );
            return sameWorkflow || usesReferenceVideo;
        });
}

export function isFlowVideoFailed(media) {
    return FLOW_VIDEO_STATUS_FAILED.has(media?.status);
}

export function buildFlowMediaUrl(mediaId) {
    return `${FLOW_LABS_ORIGIN}/fx/api/trpc/media.getMediaUrlRedirect?name=${encodeURIComponent(mediaId)}`;
}

/**
 * Re-query one media item so an async video can be polled.
 *
 * `media.getMediaUrlRedirect` only serves finished media, so an in-flight
 * generation is detected by a non-2xx / HTML answer rather than by a status
 * field. The Labs project media list is the authoritative status source.
 */
export function buildProjectMediaRequest({ auth, mediaIds = [] }) {
    const input = encodeURIComponent(JSON.stringify({ json: { projectId: auth.projectId } }));
    return {
        // This is the same endpoint the Flow project page uses on hydration.
        // Unlike aisandbox's internal video:fetchMedia it is CORS-independent
        // and can be polled directly from Node with the Labs session cookie.
        url: `${FLOW_LABS_ORIGIN}/fx/api/trpc/flow.projectInitialData?input=${input}`,
        method: 'GET',
        headers: {
            accept: 'application/json',
            cookie: auth.labsCookie,
            'cache-control': 'no-cache',
            pragma: 'no-cache'
        },
        mediaIds: mediaIds.filter(Boolean)
    };
}

/**
 * Flow's page polls in-flight video generations through this endpoint before
 * refreshing project history. Project history only contains materialized
 * media, so using it as the sole status source makes filtered/failed jobs look
 * like they are still generating forever.
 */
export function buildVideoGenerationStatusRequest({ auth, mediaIds = [] }) {
    const ids = mediaIds.filter(Boolean);
    return {
        url: `${FLOW_API_ORIGIN}/v1/video:batchCheckAsyncVideoGenerationStatus`,
        method: 'POST',
        headers: {
            authorization: `Bearer ${auth.accessToken}`,
            accept: 'application/json',
            'content-type': 'application/json',
            origin: FLOW_LABS_ORIGIN,
            referer: `${FLOW_LABS_ORIGIN}/`
        },
        body: JSON.stringify({
            media: ids.map(name => ({ name, projectId: auth.projectId }))
        }),
        mediaIds: ids
    };
}

/**
 * Dynamic model discovery.
 *
 * Flow has no public model-list endpoint, so this walks whatever config blob
 * the caller managed to read out of the page and normalizes every model key it
 * finds. Unknown shapes yield an empty list and the caller keeps the verified
 * baseline — it never throws, because a discovery miss must not block generation.
 */
export function extractFlowModels(raw) {
    const images = new Map();
    const videos = new Map();

    const visit = (node, depth = 0) => {
        if (!node || depth > 8) return;
        if (Array.isArray(node)) {
            node.forEach(item => visit(item, depth + 1));
            return;
        }
        if (typeof node !== 'object') return;

        const key = node.videoModelKey || node.modelKey || node.key || node.name || node.id;
        const display = node.displayName || node.label || node.title || '';
        if (typeof key === 'string' && key) {
            const family = FLOW_VIDEO_FAMILY_CAPABILITIES[key];
            const status = String(node.status || '');
            if (family) {
                if (!/UNHEALTHY|DISABLED|UNAVAILABLE/.test(status)) {
                    videos.set(key, { id: key, ...family });
                }
            } else if (/^abra_|_t2v_|_i2v_|_r2v_|^veo/i.test(key)) {
                videos.set(key, {
                    id: key,
                    displayName: display || key,
                    durations: normalizeDurations(node),
                    resolutions: normalizeList(node.resolutions || node.supportedResolutions),
                    aspectRatios: normalizeList(node.aspectRatios || node.supportedAspectRatios),
                    supportsImageToVideo: Boolean(
                        node.supportsImageToVideo ?? node.imageToVideo ?? /i2v/i.test(key)
                    ),
                    supportsAudio: Boolean(node.supportsAudio ?? node.hasAudio ?? true),
                    maxBatchCount: Number(node.maxBatchCount || node.batchSize || 0) || undefined
                });
            } else if (/^GEM_PIX|^IMAGEN|_image_/i.test(key)) {
                images.set(key, {
                    id: key,
                    displayName: display || key,
                    aspectRatios: normalizeList(node.aspectRatios || node.supportedAspectRatios),
                    resolutions: [...FLOW_IMAGE_RESOLUTIONS],
                    defaultResolution: FLOW_DEFAULT_IMAGE_RESOLUTION,
                    maxReferenceImages: Number(node.maxReferenceImages || node.maxImageInputs || 0) || undefined,
                    maxBatchCount: Number(node.maxBatchCount || node.batchSize || 0) || undefined
                });
            }
        }
        Object.values(node).forEach(value => visit(value, depth + 1));
    };

    try {
        visit(raw);
    } catch {
        return { images: [], videos: [] };
    }
    return { images: [...images.values()], videos: [...videos.values()] };
}

function normalizeList(value) {
    if (!Array.isArray(value)) return undefined;
    const list = value.map(item => String(item)).filter(Boolean);
    return list.length ? list : undefined;
}

function normalizeDurations(node) {
    const source = node.durations || node.durationOptions || node.supportedDurations;
    if (Array.isArray(source)) {
        const list = source.map(item => Number(String(item).replace(/[^0-9.]/g, ''))).filter(Boolean);
        return list.length ? list : undefined;
    }
    // `abra_t2v_4s` encodes its only duration in the key itself.
    const fromKey = String(node.videoModelKey || node.key || '').match(/_(\d+)s$/);
    return fromKey ? [Number(fromKey[1])] : undefined;
}
