/**
 * 即梦 (Dreamina) Web HTTP protocol.
 *
 * Pure functions: ratio/resolution tables, `draft_content` builders, task-state
 * predicates, result parsers and model-config normalization.
 *
 * Signing is deliberately absent from this file. `msToken` / `a_bogus` / `sign`
 * are produced by the page's own secsdk wrapper around `window.fetch`, so the
 * bridge issues these requests from inside the logged-in page and Node never
 * sees — let alone stores — a signature.
 */

export const JIMENG_ORIGIN = 'https://jimeng.jianying.com';
export const JIMENG_API_PREFIX = '/mweb/v1';
export const JIMENG_AID = 513695;

/** Captured client version block. Centralized so a bump is one edit. */
export const JIMENG_CLIENT = Object.freeze({
    aid: JIMENG_AID,
    web_version: '7.5.0',
    da_version: '3.3.21',
    device_platform: 'web',
    region: 'cn',
    aigc_features: 'app_lip_sync'
});

/** Verified sample models — the discovery baseline, never the whole list. */
export const JIMENG_BASELINE_IMAGE_MODEL = 'high_aes_general_v50';
export const JIMENG_BASELINE_VIDEO_MODEL = 'dreamina_seedance_40_mini';

// ---------------------------------------------------------------------------
// Ratio and resolution tables (doc §6)
// ---------------------------------------------------------------------------

export const JIMENG_IMAGE_RATIO = Object.freeze({
    '1:1': 1, '3:4': 2, '16:9': 3, '4:3': 4, '9:16': 5, '2:3': 6, '3:2': 7, '21:9': 8
});

const IMAGE_SIZE_2K = Object.freeze({
    '1:1': [2048, 2048], '3:4': [1728, 2304], '16:9': [2560, 1440], '4:3': [2304, 1728],
    '9:16': [1440, 2560], '2:3': [1664, 2496], '3:2': [2496, 1664], '21:9': [3024, 1296]
});

const IMAGE_SIZE_4K = Object.freeze({
    '1:1': [4096, 4096], '3:4': [3520, 4693], '16:9': [5404, 3040], '4:3': [4693, 3520],
    '9:16': [3040, 5404], '2:3': [3328, 4992], '3:2': [4992, 3328], '21:9': [6197, 2656]
});

export const JIMENG_IMAGE_RATIOS = Object.freeze(Object.keys(JIMENG_IMAGE_RATIO));
export const JIMENG_IMAGE_RESOLUTIONS = Object.freeze(['2k', '4k']);

export function normalizeRatio(ratio) {
    const value = String(ratio || '').trim();
    return JIMENG_IMAGE_RATIO[value] ? value : '1:1';
}

export function normalizeResolution(resolution) {
    const value = String(resolution || '2k').trim().toLowerCase();
    return value === '4k' ? '4k' : '2k';
}

/** Ratio enum + concrete pixel size. The doc is explicit: do not rely on prompt text. */
export function resolveImageSize(ratio, resolution) {
    const key = normalizeRatio(ratio);
    const type = normalizeResolution(resolution);
    const [width, height] = (type === '4k' ? IMAGE_SIZE_4K : IMAGE_SIZE_2K)[key];
    return {
        image_ratio: JIMENG_IMAGE_RATIO[key],
        large_image_info: { width, height, resolution_type: type }
    };
}

// ---------------------------------------------------------------------------
// draft_content builders
// ---------------------------------------------------------------------------

/**
 * Numeric enums observed in the captured requests. Confined to this module: the
 * document is explicit that they must never appear in UI or workflow code.
 */
const DRAFT_ENUM = Object.freeze({
    textToImageGenerateType: 1,
    textToImageImageType: 3,
    blendGenerateType: 12,
    blendImageType: 2,
    videoGenerateType: 10
});

export function randomSeed(random = Math.random) {
    return Math.floor(random() * 4_294_967_295);
}

function referenceMaterial(image) {
    const info = {
        source_from: 'upload',
        platform_type: 1,
        image_uri: image.imageUri,
        uri: image.imageUri
    };
    if (image.width) info.width = image.width;
    if (image.height) info.height = image.height;
    const material = { material_type: 'image', image_info: info };
    // Assets that came from 即梦's own history carry an item id; optional by design.
    if (image.aigcItemId) material.aigc_image = { item_id: image.aigcItemId };
    return material;
}

/** Text-to-image draft (doc §5.1). */
export function buildImageDraft({
    prompt,
    model = JIMENG_BASELINE_IMAGE_MODEL,
    ratio = '1:1',
    resolution = '2k',
    count = 1,
    seed,
    negativePrompt = '',
    sampleStrength = 0.5
}) {
    return {
        type: 'draft',
        component_list: [{
            type: 'image_base_component',
            aigc_mode: 'workbench',
            generate_type: 'generate',
            abilities: {
                generate: {
                    core_param: {
                        model,
                        prompt: String(prompt),
                        negative_prompt: negativePrompt,
                        seed: seed ?? randomSeed(),
                        sample_strength: sampleStrength,
                        ...resolveImageSize(ratio, resolution),
                        intelligent_ratio: false,
                        generate_type: 0
                    },
                    gen_option: {
                        // The only field that actually controls output count;
                        // metrics_extra.generateCount is telemetry (doc §5.2).
                        gen_count: Math.min(4, Math.max(1, Number(count) || 1)),
                        generate_all: false
                    }
                }
            }
        }]
    };
}

/**
 * Reference-image / edit draft (doc §11).
 *
 * The same TOS URIs must appear in all three places 即梦 reads them from, and
 * the prompt needs the `##image` placeholder prefix — generated here so callers
 * never have to know about it.
 */
export function buildBlendDraft({
    prompt,
    images = [],
    model = JIMENG_BASELINE_IMAGE_MODEL,
    ratio = '1:1',
    resolution = '2k',
    count = 1,
    seed,
    sampleStrength = 0.5
}) {
    const uris = images.map(image => image.imageUri).filter(Boolean);
    const text = String(prompt);
    const promptWithPlaceholder = text.startsWith('##image') ? text : `##image${text}`;

    return {
        type: 'draft',
        component_list: [{
            type: 'image_base_component',
            aigc_mode: 'workbench',
            generate_type: 'blend',
            abilities: {
                blend: {
                    core_param: {
                        model,
                        prompt: promptWithPlaceholder,
                        sample_strength: sampleStrength,
                        seed: seed ?? randomSeed(),
                        ...resolveImageSize(ratio, resolution)
                    },
                    ability_list: [{
                        name: 'byte_edit',
                        image_uri_list: uris,
                        image_list: images.map(image => ({
                            source_from: 'upload',
                            platform_type: 1,
                            image_uri: image.imageUri,
                            uri: image.imageUri
                        })),
                        strength: sampleStrength
                    }],
                    unified_edit_input: {
                        material_list: images.map(referenceMaterial),
                        meta_list: [
                            ...images.map((unused, index) => ({
                                meta_type: 'image',
                                material_ref: { material_idx: index }
                            })),
                            { meta_type: 'text', text }
                        ]
                    },
                    gen_option: {
                        gen_count: Math.min(4, Math.max(1, Number(count) || 1)),
                        generate_all: false
                    }
                }
            }
        }]
    };
}

export const JIMENG_VIDEO_INPUT_MODES = Object.freeze(['unified_edit', 'prompt', 'first_frame', 'end_frame']);

/**
 * Seedance video draft (doc §18).
 *
 * The captured sample is the `unified_edit` shape. The pure-text `prompt` mode
 * was left for implementation to determine, so it is built by *removing*
 * `unified_edit_input` and putting the text on `video_gen_inputs[].prompt` —
 * the minimal difference the doc asks to be detected, rather than a second
 * parallel video builder.
 */
export function buildVideoDraft({
    prompt = '',
    mode,
    images = [],
    firstFrame,
    endFrame,
    model = JIMENG_BASELINE_VIDEO_MODEL,
    durationSec = 5,
    fps = 24,
    ratio = '16:9',
    resolution = '720p',
    batchCount = 1,
    seed,
    videoMode = 2
}) {
    const materials = [];
    if (firstFrame?.imageUri) materials.push(referenceMaterial(firstFrame));
    materials.push(...images.filter(image => image?.imageUri).map(referenceMaterial));
    if (endFrame?.imageUri) materials.push(referenceMaterial(endFrame));

    const effectiveMode = JIMENG_VIDEO_INPUT_MODES.includes(mode)
        ? mode
        : (materials.length > 0 ? 'unified_edit' : 'prompt');

    const input = {
        prompt: String(prompt || ''),
        video_mode: videoMode,
        fps,
        duration_ms: Math.round(Number(durationSec) * 1000),
        resolution: String(resolution).toLowerCase()
    };

    if (effectiveMode !== 'prompt' && materials.length > 0) {
        input.unified_edit_input = { material_list: materials };
    }
    if (effectiveMode === 'first_frame' && firstFrame?.imageUri) {
        input.first_frame_image = { image_uri: firstFrame.imageUri, uri: firstFrame.imageUri };
    }
    if (effectiveMode === 'end_frame' && endFrame?.imageUri) {
        input.end_frame_image = { image_uri: endFrame.imageUri, uri: endFrame.imageUri };
    }

    return {
        type: 'draft',
        component_list: [{
            type: 'video_base_component',
            aigc_mode: 'workbench',
            generate_type: 'gen_video',
            abilities: {
                gen_video: {
                    text_to_video_params: {
                        video_gen_inputs: Array.from(
                            { length: Math.min(4, Math.max(1, Number(batchCount) || 1)) },
                            () => ({ ...input })
                        ),
                        video_aspect_ratio: String(ratio),
                        seed: seed ?? randomSeed(),
                        model_req_key: model,
                        priority: 0
                    }
                }
            }
        }]
    };
}

/** Wrap a draft into the `aigc_draft/generate` request body. */
export function buildGenerateBody({ draft, submitId, workspaceId, model }) {
    return {
        extend: { root_model: model, workspace_id: String(workspaceId) },
        submit_id: submitId,
        draft_content: JSON.stringify(draft),
        http_common_info: { aid: JIMENG_AID }
    };
}

export function apiUrl(path, query = {}) {
    const url = new URL(`${JIMENG_API_PREFIX}${path}`, JIMENG_ORIGIN);
    for (const [key, value] of Object.entries({ ...JIMENG_CLIENT, ...query })) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    return url.toString();
}

// ---------------------------------------------------------------------------
// Task state (doc §9, §19)
// ---------------------------------------------------------------------------

export const JIMENG_STATUS = Object.freeze({ processing: 20, imageDone: 45, videoDone: 50 });
/** Terminal failure states observed on the platform. */
const FAILED_STATUSES = new Set([30, 60, 70, 80]);

/**
 * Image completion.
 *
 * `status === 45` alone is NOT sufficient — the doc records a capture where a
 * reference edit reported 45 with an empty `item_list`. Every result-bearing
 * field has to agree.
 */
export function isJimengImageCompleted(history) {
    const total = Number(history?.total_image_count ?? 0);
    const finished = Number(history?.finished_image_count ?? 0);
    const items = Array.isArray(history?.item_list) ? history.item_list : [];
    return total > 0 && finished >= total && items.length >= total && Number(history?.finish_time ?? 0) > 0;
}

export function isJimengVideoCompleted(history) {
    if (Number(history?.status) !== JIMENG_STATUS.videoDone) return false;
    if (!(Number(history?.finish_time ?? 0) > 0)) return false;
    const items = Array.isArray(history?.item_list) ? history.item_list : [];
    return items.some(item => item?.video?.transcoded_video?.origin?.video_url);
}

export function isJimengTaskFailed(history) {
    return FAILED_STATUSES.has(Number(history?.status));
}

// ---------------------------------------------------------------------------
// Result parsers (doc §10, §20)
// ---------------------------------------------------------------------------

export function parseJimengImageResult(item) {
    const image = item?.image?.large_images?.[0];
    if (!image?.image_url) return null;
    return {
        itemId: item?.common_attr?.id,
        imageUrl: image.image_url,
        imageUri: image.image_uri,
        width: image.width,
        height: image.height,
        format: image.format,
        size: image.size,
        previewUrl: item?.common_attr?.cover_url_map?.['720'] || item?.common_attr?.cover_url
    };
}

export function parseJimengImageResults(history) {
    return (Array.isArray(history?.item_list) ? history.item_list : [])
        .map(parseJimengImageResult)
        .filter(Boolean);
}

export function parseJimengVideoResult(item) {
    const video = item?.video;
    const origin = video?.transcoded_video?.origin;
    if (!origin?.video_url) return null;
    return {
        itemId: item?.common_attr?.id,
        videoId: video.video_id,
        videoUrl: origin.video_url,
        coverUrl: video.cover_url || item?.common_attr?.cover_url,
        width: origin.width,
        height: origin.height,
        fps: origin.fps,
        durationMs: video.duration_ms,
        format: origin.format,
        size: origin.size,
        md5: origin.md5,
        hasAudio: video.has_audio,
        isMute: video.is_mute
    };
}

export function parseJimengVideoResults(history) {
    return (Array.isArray(history?.item_list) ? history.item_list : [])
        .map(parseJimengVideoResult)
        .filter(Boolean);
}

/** Alternate transcode ladder; `main_url` is base64-encoded (doc §22). */
export function parseJimengVideoVariants(item) {
    try {
        const model = JSON.parse(item?.video?.video_model || '{}');
        return Object.entries(model?.video_list || {}).map(([key, entry]) => ({
            key,
            definition: entry?.definition,
            width: entry?.vwidth,
            height: entry?.vheight,
            fps: entry?.fps,
            size: entry?.size,
            url: entry?.main_url ? Buffer.from(entry.main_url, 'base64').toString('utf8') : ''
        })).filter(entry => entry.url);
    } catch {
        return [];
    }
}

/** Locate this task's record inside a `get_history_by_ids` response. */
export function pickHistoryRecord(payload, submitId) {
    const container = payload?.data ?? payload;
    if (!container || typeof container !== 'object') return null;
    for (const value of Object.values(container)) {
        if (!value || typeof value !== 'object') continue;
        if (value.submit_id === submitId || value.task?.submit_id === submitId) return value;
    }
    // Older responses key by history id rather than submit id.
    const records = Object.values(container).filter(
        value => value && typeof value === 'object' && ('item_list' in value || 'status' in value)
    );
    return records.length === 1 ? records[0] : null;
}

/** Server-suggested polling cadence; the doc says prefer it over ours (§30). */
export function pollingConfigFrom(payload, fallbackIntervalMs = 5_000) {
    const config = payload?.data?.polling_config || payload?.polling_config;
    const seconds = Number(config?.interval_seconds);
    return {
        intervalMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : fallbackIntervalMs,
        timeoutMs: Number(config?.timeout_seconds) > 0 ? Number(config.timeout_seconds) * 1000 : null
    };
}

/** `ret` is 即梦's application-level status; `0` means success. */
export function jimengBusinessError(payload) {
    const ret = payload?.ret;
    if (ret === undefined || ret === null || String(ret) === '0') return null;
    return String(payload?.errmsg || payload?.message || `即梦接口返回 ret=${ret}`);
}

// ---------------------------------------------------------------------------
// Dynamic model discovery
// ---------------------------------------------------------------------------

/**
 * Normalize whatever model configuration the account exposes.
 *
 * The doc is emphatic that the two captured `model_req_key`s are samples, and
 * that UI names come from the server (`model_name`) rather than being guessed
 * from the key. This walks an arbitrary config blob and registers every model
 * it finds together with its declared capabilities.
 */
export function extractJimengModels(raw) {
    const images = new Map();
    const videos = new Map();

    const visit = (node, depth = 0) => {
        if (!node || depth > 10) return;
        if (Array.isArray(node)) {
            node.forEach(item => visit(item, depth + 1));
            return;
        }
        if (typeof node !== 'object') return;

        const key = node.model_req_key || node.model_key || node.req_key;
        if (typeof key === 'string' && key) {
            const entry = normalizeModelNode(key, node);
            if (entry.type === 'video') videos.set(key, entry.model);
            else images.set(key, entry.model);
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

function toNumberList(value) {
    if (!Array.isArray(value)) return undefined;
    const list = value.map(item => Number(String(item).replace(/[^0-9.]/g, ''))).filter(Number.isFinite);
    return list.length ? [...new Set(list)] : undefined;
}

function toStringList(value) {
    if (!Array.isArray(value)) return undefined;
    const list = value.map(item => String(item)).filter(Boolean);
    return list.length ? [...new Set(list)] : undefined;
}

function normalizeModelNode(key, node) {
    const options = node.model_options || node.options || node;
    const unifiedEdit = node.unified_edit_config || options.unified_edit_config;
    const durations = toNumberList(options.duration_option || options.durations || options.duration_options);
    const isVideo = Boolean(
        durations || options.fps || node.video_model || /seedance|video|t2v|i2v/i.test(key)
    );

    const shared = {
        id: key,
        // Server-provided display name only — never derived from the key.
        displayName: node.model_name || node.name || node.title || key,
        aspectRatios: toStringList(options.aspect_ratio || options.ratio_list || options.aspect_ratios),
        resolutions: toStringList(options.resolution || options.resolutions),
        maxBatchCount: Number(options.max_batch_gen_count || options.max_gen_count || 0) || undefined,
        maxPromptLength: Number(options.max_prompt_length || 0) || undefined,
        supportsPromptEnhancement: Boolean(options.support_prompt_enhancement),
        metadata: {}
    };

    if (isVideo) {
        const materialLimits = normalizeMaterialLimits(unifiedEdit);
        return {
            type: 'video',
            model: {
                ...shared,
                type: 'video',
                fps: Number(options.fps || 0) || undefined,
                durations,
                inputModes: toStringList(options.input_mode || options.input_modes)
                    || [...JIMENG_VIDEO_INPUT_MODES],
                supportsFirstFrame: Boolean(options.support_first_image ?? true),
                supportsEndFrame: Boolean(options.support_end_image ?? true),
                supportsAudio: Boolean(options.support_audio ?? true),
                maxReferenceImages: materialLimits.maxImages,
                metadata: { materialLimits }
            }
        };
    }

    return {
        type: 'image',
        model: {
            ...shared,
            type: 'image',
            aspectRatios: shared.aspectRatios || [...JIMENG_IMAGE_RATIOS],
            resolutions: shared.resolutions || [...JIMENG_IMAGE_RESOLUTIONS],
            maxBatchCount: shared.maxBatchCount || 4,
            supportsReferenceImage: Boolean(options.support_reference ?? options.byte_edit ?? true),
            maxReferenceImages: Number(options.max_reference_count || 0) || undefined
        }
    };
}

/**
 * `unified_edit_config` lists per-material-type limits. The doc says only
 * type 1 is confirmed to be images, so nothing else gets a business name here.
 */
function normalizeMaterialLimits(unifiedEdit) {
    const list = Array.isArray(unifiedEdit) ? unifiedEdit : (unifiedEdit?.material_config || []);
    const byType = {};
    for (const entry of Array.isArray(list) ? list : []) {
        const type = Number(entry?.material_type);
        if (!Number.isFinite(type)) continue;
        byType[type] = {
            maxCount: Number(entry.max_count) || undefined,
            maxDuration: Number(entry.max_duration) || undefined,
            minDuration: Number(entry.min_duration) || undefined,
            maxFileSize: Number(entry.max_file_size) || undefined
        };
    }
    return { byType, maxImages: byType[1]?.maxCount, maxTotal: Number(unifiedEdit?.max_total_count) || undefined };
}

export { DRAFT_ENUM as JIMENG_DRAFT_ENUM };
