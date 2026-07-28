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

import { createHash, randomUUID } from 'node:crypto';

export const JIMENG_ORIGIN = 'https://jimeng.jianying.com';
export const JIMENG_API_PREFIX = '/mweb/v1';

/**
 * 请求来源页面。
 *
 * 实测：同一份生图请求从 `?type=image` 页面发出可以通过鉴权，从 `?type=video`
 * 页面发出一律 `permission denied` —— 服务端的权益判定和来源页面绑定。
 */
export function toolPageUrl(kind = 'image', workspaceId) {
    const url = new URL('/ai-tool/generate', JIMENG_ORIGIN);
    url.searchParams.set('type', kind === 'video' ? 'video' : 'image');
    if (workspaceId) url.searchParams.set('workspace', String(workspaceId));
    return url.toString();
}
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
export const JIMENG_PRO_IMAGE_MODEL = 'high_aes_general_v50p_large';
export const JIMENG_BASELINE_VIDEO_MODEL = 'dreamina_seedance_40_mini';
export const JIMENG_IMAGE_LITE_MAX_BATCH_COUNT = 8;
export const JIMENG_IMAGE_DEFAULT_MAX_BATCH_COUNT = 4;

/**
 * 图片 5.0 Lite 的当前网页模型表开放 1-8 张，Pro 开放 1-4 张。
 * 未识别的新模型保守按 4 张处理，等动态模型表确认后再放宽。
 */
export function jimengImageMaxBatchCount(model = JIMENG_BASELINE_IMAGE_MODEL) {
    return model === JIMENG_BASELINE_IMAGE_MODEL
        ? JIMENG_IMAGE_LITE_MAX_BATCH_COUNT
        : JIMENG_IMAGE_DEFAULT_MAX_BATCH_COUNT;
}

export function jimengImageSupportedResolutions(model = JIMENG_BASELINE_IMAGE_MODEL) {
    return model === JIMENG_PRO_IMAGE_MODEL ? ['1k', '2k', '4k'] : ['2k', '4k'];
}

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

const IMAGE_SIZE_1K = Object.freeze({
    '1:1': [1024, 1024], '3:4': [768, 1024], '16:9': [1024, 576], '4:3': [1024, 768],
    '9:16': [576, 1024], '2:3': [682, 1024], '3:2': [1024, 682], '21:9': [1195, 512]
});

const IMAGE_SIZE_4K = Object.freeze({
    '1:1': [4096, 4096], '3:4': [3520, 4693], '16:9': [5404, 3040], '4:3': [4693, 3520],
    '9:16': [3040, 5404], '2:3': [3328, 4992], '3:2': [4992, 3328], '21:9': [6197, 2656]
});

export const JIMENG_IMAGE_RATIOS = Object.freeze(Object.keys(JIMENG_IMAGE_RATIO));
export const JIMENG_IMAGE_RESOLUTIONS = Object.freeze(['2k', '4k']);

const JIMENG_VIDEO_DURATIONS = Object.freeze([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
const JIMENG_VIDEO_RATIOS = Object.freeze(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);
const JIMENG_VIDEO_720P = Object.freeze(['720P']);
const JIMENG_VIDEO_VIP_RESOLUTIONS = Object.freeze(['720P', '1080P', '4K']);

/** 当前画布已接入的五个 Seedance 2.0 协议模型能力。 */
export const JIMENG_VIDEO_MODEL_CAPABILITIES = Object.freeze({
    dreamina_seedance_40_mini: Object.freeze({
        durations: JIMENG_VIDEO_DURATIONS, aspectRatios: JIMENG_VIDEO_RATIOS,
        resolutions: JIMENG_VIDEO_720P, maxReferenceImages: 9
    }),
    dreamina_seedance_40_vision: Object.freeze({
        durations: JIMENG_VIDEO_DURATIONS, aspectRatios: JIMENG_VIDEO_RATIOS,
        resolutions: JIMENG_VIDEO_720P, maxReferenceImages: 9
    }),
    dreamina_seedance_40_pro_vision: Object.freeze({
        durations: JIMENG_VIDEO_DURATIONS, aspectRatios: JIMENG_VIDEO_RATIOS,
        resolutions: JIMENG_VIDEO_VIP_RESOLUTIONS, maxReferenceImages: 9
    }),
    dreamina_seedance_40: Object.freeze({
        durations: JIMENG_VIDEO_DURATIONS, aspectRatios: JIMENG_VIDEO_RATIOS,
        resolutions: JIMENG_VIDEO_720P, maxReferenceImages: 9
    }),
    dreamina_seedance_40_pro: Object.freeze({
        durations: JIMENG_VIDEO_DURATIONS, aspectRatios: JIMENG_VIDEO_RATIOS,
        resolutions: JIMENG_VIDEO_720P, maxReferenceImages: 9
    })
});

export function jimengVideoCapabilities(model = JIMENG_BASELINE_VIDEO_MODEL) {
    return JIMENG_VIDEO_MODEL_CAPABILITIES[model]
        || JIMENG_VIDEO_MODEL_CAPABILITIES[JIMENG_BASELINE_VIDEO_MODEL];
}

export function normalizeRatio(ratio) {
    const value = String(ratio || '').trim();
    return JIMENG_IMAGE_RATIO[value] ? value : '1:1';
}

export function normalizeResolution(resolution, model = JIMENG_BASELINE_IMAGE_MODEL) {
    const value = String(resolution || '2k').trim().toLowerCase();
    return jimengImageSupportedResolutions(model).includes(value) ? value : '2k';
}

/** Ratio enum + concrete pixel size. The doc is explicit: do not rely on prompt text. */
export function resolveImageSize(ratio, resolution, model = JIMENG_BASELINE_IMAGE_MODEL) {
    const key = normalizeRatio(ratio);
    const type = normalizeResolution(resolution, model);
    const sizeTable = type === '1k' ? IMAGE_SIZE_1K : type === '4k' ? IMAGE_SIZE_4K : IMAGE_SIZE_2K;
    const [width, height] = sizeTable[key];
    return {
        image_ratio: JIMENG_IMAGE_RATIO[key],
        // large_image_info 同样是 draft 节点树的一员，必须带 type/id（实测请求如此）。
        large_image_info: node({ height, width, resolution_type: type })
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

/**
 * Draft envelope fields.
 *
 * 即梦's draft is a versioned node tree: **every** node carries `type` and `id`,
 * and the root additionally carries version / feature negotiation fields. A
 * draft that omits them is rejected with `ret=1002 common error` — the protocol
 * doc's abridged sample shows only the semantic fields, not this envelope,
 * which is why the first implementation failed against the live API.
 *
 * `min_features` is named in doc §32 as something to watch; it belongs here.
 */
const DRAFT_MIN_VERSION = '3.0.2';
const DRAFT_VERSION = '3.3.21';

function newId() {
    return randomUUID();
}

/** Wrap a node with the `type` / `id` pair every draft node must carry. */
function node(extra = {}) {
    return { type: '', id: newId(), ...extra };
}

function draftRoot(component) {
    return {
        type: 'draft',
        id: newId(),
        min_version: DRAFT_MIN_VERSION,
        min_features: [],
        is_from_tsn: true,
        version: DRAFT_VERSION,
        main_component_id: component.id,
        component_list: [component]
    };
}

function componentMetadata() {
    return {
        type: '',
        id: newId(),
        created_platform: 3,
        created_platform_version: '',
        created_time_in_ms: String(Date.now()),
        created_did: ''
    };
}

function referenceMaterial(image) {
    const info = node({
        source_from: 'upload',
        platform_type: 1,
        image_uri: image.imageUri,
        uri: image.imageUri
    });
    if (image.width) info.width = image.width;
    if (image.height) info.height = image.height;
    const material = node({ material_type: 'image', image_info: info });
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
    sampleStrength = 0.5,
    maxCount = jimengImageMaxBatchCount(model)
}) {
    return draftRoot(node({
        type: 'image_base_component',
        min_version: DRAFT_MIN_VERSION,
        aigc_mode: 'workbench',
        metadata: componentMetadata(),
        generate_type: 'generate',
        abilities: node({
            generate: node({
                core_param: node({
                    model,
                    prompt: String(prompt),
                    negative_prompt: negativePrompt,
                    seed: seed ?? randomSeed(),
                    sample_strength: sampleStrength,
                    ...resolveImageSize(ratio, resolution, model),
                    intelligent_ratio: false,
                    generate_type: 0
                })
            }),
            // 实测：gen_option 是 abilities 的**兄弟**节点，不在 generate 内部。
            // 放错层级时服务端不报字段错误，而是直接 permission denied。
            gen_option: node({
                // The only field that actually controls output count;
                // metrics_extra.generateCount is telemetry (doc §5.2).
                gen_count: Math.min(maxCount, Math.max(1, Number(count) || 1)),
                generate_all: false
            })
        })
    }));
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
    sampleStrength = 0.5,
    maxCount = jimengImageMaxBatchCount(model)
}) {
    const uris = images.map(image => image.imageUri).filter(Boolean);
    const text = String(prompt);
    const promptWithPlaceholder = text.startsWith('##image') ? text : `##image${text}`;

    return draftRoot(node({
        type: 'image_base_component',
        min_version: DRAFT_MIN_VERSION,
        aigc_mode: 'workbench',
        metadata: componentMetadata(),
        generate_type: 'blend',
        abilities: node({
            blend: node({
                core_param: node({
                    model,
                    prompt: promptWithPlaceholder,
                    sample_strength: sampleStrength,
                    seed: seed ?? randomSeed(),
                    ...resolveImageSize(ratio, resolution, model)
                }),
                ability_list: [node({
                    name: 'byte_edit',
                    image_uri_list: uris,
                    image_list: images.map(image => node({
                        source_from: 'upload',
                        platform_type: 1,
                        image_uri: image.imageUri,
                        uri: image.imageUri
                    })),
                    strength: sampleStrength
                })],
                unified_edit_input: node({
                    material_list: images.map(referenceMaterial),
                    meta_list: [
                        ...images.map((unused, index) => node({
                            meta_type: 'image',
                            material_ref: node({ material_idx: index })
                        })),
                        node({ meta_type: 'text', text })
                    ]
                })
            }),
            gen_option: node({
                gen_count: Math.min(maxCount, Math.max(1, Number(count) || 1)),
                generate_all: false
            })
        })
    }));
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

    return draftRoot(node({
        type: 'video_base_component',
        min_version: DRAFT_MIN_VERSION,
        aigc_mode: 'workbench',
        metadata: componentMetadata(),
        generate_type: 'gen_video',
        abilities: node({
            gen_video: node({
                text_to_video_params: node({
                    video_gen_inputs: Array.from(
                        { length: Math.min(4, Math.max(1, Number(batchCount) || 1)) },
                        () => node({ ...input })
                    ),
                    video_aspect_ratio: String(ratio),
                    seed: seed ?? randomSeed(),
                    model_req_key: model,
                    priority: 0
                })
            })
        })
    }));
}

/**
 * Wrap a draft into the `aigc_draft/generate` request body.
 *
 * `workspace_id` is a **number** on the wire, and `metrics_extra` is always
 * present — both taken from the captured request rather than inferred.
 */
export function buildGenerateBody({ draft, submitId, workspaceId, model, generateCount = 1 }) {
    const numericWorkspace = Number(workspaceId);
    return {
        extend: {
            root_model: model,
            workspace_id: Number.isFinite(numericWorkspace) ? numericWorkspace : workspaceId
        },
        submit_id: submitId,
        // Telemetry, not control — `gen_option.gen_count` decides the real count
        // (doc §5.2). It is still sent because the live request always sends it.
        metrics_extra: JSON.stringify({
            promptSource: 'custom',
            generateCount,
            enterFrom: 'click',
            isRegenerate: false,
            generateId: submitId
        }),
        draft_content: JSON.stringify(draft),
        http_common_info: { aid: JIMENG_AID }
    };
}

/**
 * `babi_param` — 即梦's feature/entitlement descriptor.
 *
 * This is the field that decides whether the account is allowed to run the
 * request at all: without it `aigc_draft/generate` answers
 * `ret=3018 permission denied`, no matter which model or resolution is asked
 * for. It travels as a **query parameter holding URL-encoded JSON**, which is
 * why it appears nowhere in the request body and never turned up in the page
 * bundle — it is assembled per click. Values below come from a captured live
 * request (doc §32 flags `babi_param.feature_key` as something to track).
 */
export function buildBabiParam({ model, toolId = 'tool_image', featureKey = 'aigc_to_image', generateType = '1' }) {
    return JSON.stringify({
        feature_entrance: 'to-generate',
        feature_entrance_detail: `to-generate-${model}`,
        feature_key: featureKey,
        scenario: 'image_video_generation',
        edit_type: 'tool',
        tool_id: toolId,
        sub_tool_id: toolId,
        tab_name: 'tool',
        enter_from: 'tool',
        template_id: '',
        scene_lv1: 'tool',
        scene_lv2: toolId,
        extra_param: { model_id: model, generate_type: String(generateType) }
    });
}

/**
 * Query parameters the web client always sends. `webId` identifies the browser
 * install; it is read from the page at runtime rather than invented.
 */
export function apiUrl(path, query = {}) {
    const url = new URL(`${JIMENG_API_PREFIX}${path}`, JIMENG_ORIGIN);
    const params = { ...JIMENG_CLIENT, os: 'mac', ...query };
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;
        // babi_param 的值本身是「已编码的 JSON」，URLSearchParams 会再编一层，
        // 正好还原成线上请求里的双重编码（%257B...）。
        url.searchParams.set(key, key === 'babi_param' ? encodeURIComponent(String(value)) : String(value));
    }
    return url.toString();
}

/**
 * 即梦业务请求的签名头。
 *
 * 算法取自站点自己的请求拦截器（web bundle 里的 axios request interceptor）：
 *
 *     sign = md5(`9e2c|${pathname.slice(-7)}|${pf}|${appvr}|${deviceTime}|${tdid}|11ac`)
 *
 * 这是**协议结构**，不是凭证：签名值每次按当前时间现算，绝不落盘、不入库。
 *
 * 为什么必须自己算：secsdk 的 XHR 钩子只补 `x-secsdk-web-signature` 与
 * BDMS 的 msToken / a_bogus，而 `sign` / `device-time` 来自即梦自己的请求层。
 * 缺这一组头时 `aigc_draft/generate` 会返回 `ret=3018 permission denied` ——
 * 报的是"没权限"，很容易被误读成账号没额度，实际上是请求没被认成正规客户端。
 */
const JIMENG_SIGN_PREFIX = '9e2c';
const JIMENG_SIGN_SUFFIX = '11ac';
const JIMENG_PF = '7';
const JIMENG_APPVR = '8.4.0';
const JIMENG_APP_SDK_VERSION = '48.0.0';

export function buildJimengSignHeaders(url, { pf = JIMENG_PF, appvr = JIMENG_APPVR, tdid = '', now } = {}) {
    const { pathname } = new URL(url);
    const deviceTime = Math.floor((now ?? Date.now()) / 1000);
    const payload = [
        JIMENG_SIGN_PREFIX,
        pathname.slice(-7),
        pf,
        appvr,
        deviceTime,
        tdid,
        JIMENG_SIGN_SUFFIX
    ].join('|');

    return {
        accept: 'application/json, text/plain, */*',
        appid: String(JIMENG_AID),
        'app-sdk-version': JIMENG_APP_SDK_VERSION,
        appvr,
        pf,
        lan: 'zh-Hans',
        loc: 'cn',
        tdid,
        sign: createHash('md5').update(payload).digest('hex').toLowerCase(),
        'sign-ver': '1',
        'device-time': String(deviceTime)
    };
}

/** Full generate URL, including the entitlement descriptor. */
export function buildGenerateUrl({ model, webId, toolId, featureKey, generateType } = {}) {
    return apiUrl('/aigc_draft/generate', {
        web_component_open_flag: 1,
        commerce_with_input_video: 1,
        generate_id: `gen-${randomUUID()}`,
        webId: webId || undefined,
        babi_param: buildBabiParam({ model, toolId, featureKey, generateType })
    });
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

/** image_ratio 枚举 → 比例字符串，用于把服务端的 ratio_type 还原成 UI 取值。 */
const RATIO_BY_ENUM = Object.freeze(Object.fromEntries(
    Object.entries(JIMENG_IMAGE_RATIO).map(([ratio, value]) => [value, ratio])
));

/**
 * 解析即梦页面 bootstrap 里的模型配置。
 *
 * 数据源是 `window.__image_generate_model_config__` /
 * `window.__video_generate_model_config__` —— 服务端随页面直接下发的**当前账号
 * 真实可用**的模型表。之前那版实现去猜 `/get_model_list` 之类的接口名，一个都
 * 没猜中，注册表只能一直用内置基线。
 *
 * 关键约定（协议文档 §14 明确要求）：UI 名一律取服务端的 `model_name`，
 * 绝不根据 `model_req_key` 猜 —— 例如 key 写着 `dreamina_seedance_40_mini`，
 * 而真实 UI 名是「即梦 Seedance 2.0 mini」。
 *
 * @param {object} config `{ image, video }`，两个 bootstrap 对象
 */
export function extractJimengModels(config) {
    try {
        return {
            images: (config?.image?.data?.model_list || []).map(normalizeImageModel).filter(Boolean),
            videos: (config?.video?.data?.model_list || []).map(model =>
                normalizeVideoModel(model, config?.video?.data)).filter(Boolean)
        };
    } catch {
        // 发现失败绝不能挡住生成：调用方会退回内置基线。
        return { images: [], videos: [] };
    }
}

function normalizeImageModel(model) {
    const key = model?.model_req_key;
    if (!key) return null;

    // resolution_map 同时给出「有哪些分辨率」和「每个比例的确切像素尺寸」。
    const resolutionMap = model.resolution_map || {};
    const resolutions = Object.keys(resolutionMap);
    const ratios = [...new Set(
        Object.values(resolutionMap)
            .flatMap(entry => entry?.image_ratio_sizes || [])
            .map(size => RATIO_BY_ENUM[size?.ratio_type])
            .filter(Boolean)
    )];

    const feats = Array.isArray(model.feats) ? model.feats : [];
    const counts = Array.isArray(model.generate_count_options) ? model.generate_count_options : [];
    const referenceLimit = (model.input_image_limit || [])
        .find(limit => limit?.ability_name === 'byte_edit');

    return {
        id: key,
        // 服务端文案，不从 key 反推。
        displayName: model.model_name || key,
        type: 'image',
        aspectRatios: ratios.length ? ratios : undefined,
        resolutions: resolutions.length ? resolutions.map(value => value.toUpperCase()) : undefined,
        maxBatchCount: counts.length ? Math.max(...counts) : undefined,
        // byte_edit = 参考图 / 图片编辑能力。
        supportsReferenceImage: feats.includes('byte_edit'),
        maxReferenceImages: Number(referenceLimit?.max_image_num) || undefined,
        metadata: {
            feats,
            source: model.extra?.model_source,
            benefitType: model.commercial_config?.image_model_commerce_config?.base?.default?.benefit_type
        }
    };
}

function optionValues(model, key) {
    const option = (model?.options || []).find(item => item?.key === key);
    const enumVal = option?.enum_val;
    if (!enumVal) return { option, values: undefined };
    return {
        option,
        values: enumVal.string_value || enumVal.int_value || enumVal.double_value || undefined
    };
}

function normalizeVideoModel(model, root) {
    const key = model?.model_req_key;
    if (!key) return null;

    const resolutions = optionValues(model, 'resolution').values;
    const ratios = optionValues(model, 'video_aspect_ratio').values;
    const fpsValues = optionValues(model, 'fps').values;
    const frames = optionValues(model, 'frames').values;
    const inputModes = optionValues(model, 'input_media_type').values || [];
    const unifiedEdit = (model.options || []).find(item => item?.key === 'unified_edit')?.unified_edit_config;

    // 时长来自 frames / fps —— 服务端只给帧数枚举，UI 上显示的是秒。
    const fps = Array.isArray(fpsValues) && fpsValues.length ? Number(fpsValues[0]) : undefined;
    const durations = Array.isArray(frames) && fps
        ? [...new Set(frames.map(count => Math.round(Number(count) / fps)))]
        : undefined;

    // material_type=1 是图片（协议文档只确认了这一个，其余不臆测命名）。
    const imageMaterial = (unifiedEdit?.supported_materials || [])
        .find(item => Number(item?.material_type) === 1);

    return {
        id: key,
        displayName: model.model_name || key,
        type: 'video',
        fps,
        durations,
        aspectRatios: Array.isArray(ratios) ? ratios : undefined,
        resolutions: Array.isArray(resolutions) ? resolutions.map(value => String(value).toUpperCase()) : undefined,
        inputModes: inputModes.length ? inputModes : undefined,
        supportsFirstFrame: inputModes.includes('first_frame'),
        supportsEndFrame: inputModes.includes('end_frame'),
        supportsImageToVideo: inputModes.includes('unified_edit') || inputModes.includes('first_frame'),
        maxReferenceImages: Number(imageMaterial?.limit?.max_count) || undefined,
        maxBatchCount: Number(root?.max_batch_gen_count) || undefined,
        metadata: {
            durationRangeMs: root?.video_duration_display_range,
            materialLimits: unifiedEdit?.supported_materials
        }
    };
}

export { DRAFT_ENUM as JIMENG_DRAFT_ENUM };
