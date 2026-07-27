/**
 * Google Labs Flow HTTP protocol — request builders and response parsers.
 *
 * Pure functions only: no network, no browser, no clock. Everything here is
 * driven by `Flow-Web-HTTP-最终改造数据.md`; anything the document marked as
 * unverified is kept behind a capability flag rather than hard-coded.
 */

export const FLOW_TOOL = 'PINHOLE';
export const FLOW_API_ORIGIN = 'https://aisandbox-pa.googleapis.com';
export const FLOW_LABS_ORIGIN = 'https://labs.google';

/** Verified sample from the protocol doc; used only as a discovery fallback. */
export const FLOW_BASELINE_IMAGE_MODEL = 'GEM_PIX_2';
export const FLOW_BASELINE_VIDEO_MODEL = 'abra_t2v_4s';

const IMAGE_ASPECT_RATIOS = Object.freeze({
    '1:1': 'IMAGE_ASPECT_RATIO_SQUARE',
    '16:9': 'IMAGE_ASPECT_RATIO_LANDSCAPE',
    '9:16': 'IMAGE_ASPECT_RATIO_PORTRAIT',
    '4:3': 'IMAGE_ASPECT_RATIO_FULL',
    '3:4': 'IMAGE_ASPECT_RATIO_PORTRAIT_FULL'
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
export function randomSeed(random = Math.random) {
    return Math.floor(random() * 1_000_000) + 1;
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
        mediaId
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
    }).filter(item => item.imageUrl);
}

/**
 * batchAsyncGenerateVideoText.
 *
 * Image-to-video: the doc could not capture it, so rather than inventing a
 * field name we send every candidate the response schema already names —
 * `imageInput.mediaId` plus the `baseImageMediaGenerationId` that appears in
 * the verified text-to-video *response*. Flow ignores unknown request fields,
 * and `detectImageToVideoShape` records which one the platform echoed back so
 * the next call can narrow down. Marked unverified-in-production.
 */
export function buildGenerateVideoRequest({
    auth,
    prompt,
    modelKey = FLOW_BASELINE_VIDEO_MODEL,
    aspectRatio,
    count = 1,
    seed,
    batchId,
    firstFrameMediaId = '',
    referenceMediaIds = []
}) {
    const context = clientContext(auth);
    const baseImageId = firstFrameMediaId || referenceMediaIds.filter(Boolean)[0] || '';

    const requests = Array.from({ length: Math.max(1, count) }, (unused, index) => {
        const request = {
            aspectRatio: toFlowVideoAspectRatio(aspectRatio),
            textInput: { structuredPrompt: { parts: [{ text: String(prompt || '') }] } },
            videoModelKey: modelKey,
            seed: (seed || randomSeed()) + index,
            metadata: {}
        };
        if (baseImageId) {
            request.imageInput = { mediaId: baseImageId };
            request.baseImageMediaGenerationId = baseImageId;
            request.videoGenerationMode = 'VIDEO_GENERATION_MODE_IMAGE_TO_VIDEO';
        }
        const extraReferences = referenceMediaIds.filter(Boolean).filter(id => id !== baseImageId);
        if (extraReferences.length > 0) {
            request.referenceMediaIds = extraReferences;
        }
        return request;
    });

    return {
        url: `${FLOW_API_ORIGIN}/v1/video:batchAsyncGenerateVideoText`,
        method: 'POST',
        headers: {
            authorization: `Bearer ${auth.accessToken}`,
            'content-type': 'text/plain;charset=UTF-8'
        },
        body: JSON.stringify({
            mediaGenerationContext: { batchId, audioFailurePreference: 'BLOCK_SILENCED_VIDEOS' },
            clientContext: context,
            requests,
            useV2ModelConfig: true
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
    return {
        mediaId: media?.name || media?.video?.operation?.name || '',
        workflowId: media?.workflowId || '',
        status: media?.mediaMetadata?.mediaStatus?.mediaGenerationStatus || '',
        model: media?.video?.generatedVideo?.model || '',
        prompt: media?.video?.generatedVideo?.prompt || '',
        seed: media?.video?.generatedVideo?.seed,
        aspectRatio: media?.video?.generatedVideo?.aspectRatio || '',
        duration: media?.video?.dimensions?.length || '',
        resolution: media?.mediaMetadata?.requestData?.videoGenerationRequestData
            ?.videoModelControlInput?.videoResolution || '',
        generationMode: media?.mediaMetadata?.requestData?.videoGenerationRequestData
            ?.videoModelControlInput?.videoGenerationMode || '',
        size: Number(media?.mediaMetadata?.mediaBlobSize || 0),
        isLooped: media?.video?.generatedVideo?.isLooped ?? false
    };
}

export function parseGenerateVideoResponse(payload) {
    // The doc is explicit that one request may return several media entries.
    return (payload?.media ?? []).map(parseFlowVideoMedia).filter(item => item.mediaId);
}

export function isFlowVideoCompleted(media) {
    return media?.status === FLOW_VIDEO_STATUS_SUCCESS;
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
    const input = encodeURIComponent(JSON.stringify({ json: { projectId: auth.projectId, mediaIds } }));
    return {
        url: `${FLOW_LABS_ORIGIN}/fx/api/trpc/media.fetchMedia?input=${input}`,
        method: 'GET',
        headers: { accept: 'application/json' }
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
            if (/^abra_|_t2v_|_i2v_|^veo/i.test(key)) {
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
