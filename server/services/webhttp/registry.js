/**
 * GenerationModelRegistry — one source of truth for what the three Web
 * providers can currently do.
 *
 * Two layers, deliberately:
 *
 *   baseline   the canvas model ids the app has always shipped, so an offline
 *              machine, an expired login or a discovery miss never empties the
 *              model picker or breaks an existing project file.
 *   discovered whatever the account actually exposes at runtime, merged on top.
 *
 * The UI consumes `capabilities` (ratios / resolutions / durations / reference
 * limits) instead of testing model ids, so a new platform model shows up
 * without a code change.
 */

import { discoverFlowModels } from './flow/provider.js';
import { discoverGeminiModels } from './gemini/provider.js';
import { discoverJimengModels } from './jimeng/provider.js';
import {
    JIMENG_BASELINE_IMAGE_MODEL,
    JIMENG_BASELINE_VIDEO_MODEL
} from './jimeng/protocol.js';
import { FLOW_BASELINE_IMAGE_MODEL, FLOW_BASELINE_VIDEO_MODEL } from './flow/protocol.js';

export const WEB_PROVIDER_IDS = Object.freeze(['gemini-web', 'jimeng', 'google-flow']);

/**
 * Canvas model id → provider protocol model.
 *
 * Existing project files store the canvas ids, so this mapping is what keeps
 * old canvases loading after the HTTP switch. Unknown ids fall through to the
 * provider baseline rather than throwing.
 */
export const CANVAS_MODEL_PROTOCOL_IDS = Object.freeze({
    'jimeng-image-5-0-lite': JIMENG_BASELINE_IMAGE_MODEL,
    'jimeng-image-5-0-pro': 'high_aes_general_v50_pro',
    'jimeng-seedance-2-0-mini': JIMENG_BASELINE_VIDEO_MODEL,
    'jimeng-seedance-2-0': 'dreamina_seedance_40',
    'jimeng-seedance-2-0-fast': 'dreamina_seedance_40_fast',
    'jimeng-seedance-2-0-standard': 'dreamina_seedance_40_standard',
    'jimeng-seedance-2-0-fast-standard': 'dreamina_seedance_40_fast_standard',
    'google-flow-nano-banana-2': FLOW_BASELINE_IMAGE_MODEL,
    'google-flow-nano-banana-pro': 'GEM_PIX_2_PRO',
    'google-flow-nano-banana-2-lite': 'GEM_PIX_2_LITE',
    'google-flow-omni-flash': FLOW_BASELINE_VIDEO_MODEL,
    'google-flow-veo-3-1-lite': 'veo_3_1_lite'
});

export function resolveProtocolModelId(canvasModelId, fallback) {
    return CANVAS_MODEL_PROTOCOL_IDS[canvasModelId] || fallback;
}

/**
 * Reverse lookup, used when folding a discovered model back into the registry.
 *
 * Without it, discovering `high_aes_general_v50` would add a second entry next
 * to the canvas model `jimeng-image-5-0-lite` that already maps to it — the
 * user would see the same model twice in the picker, one of which the nodes
 * cannot actually route.
 */
const PROTOCOL_TO_CANVAS_ID = Object.freeze(Object.fromEntries(
    Object.entries(CANVAS_MODEL_PROTOCOL_IDS).map(([canvasId, protocolId]) => [protocolId, canvasId])
));

export function resolveCanvasModelId(protocolModelId) {
    return PROTOCOL_TO_CANVAS_ID[protocolModelId] || null;
}

/** Baseline definitions keyed by the canvas model id the nodes already use. */
const BASELINE_MODELS = [
    {
        provider: 'gemini-web', id: 'gemini-web-image', displayName: 'Gemini Web 生图', type: 'image',
        inputModes: ['text', 'reference-image', 'multi-reference'],
        aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
        maxReferenceImages: 12, maxBatchCount: 1
    },
    {
        provider: 'gemini-web', id: 'gemini-web-video', displayName: 'Gemini Web 生视频', type: 'video',
        inputModes: ['text', 'image-to-video', 'reference-image'],
        aspectRatios: ['16:9', '9:16'], durations: [8],
        maxReferenceImages: 1, maxBatchCount: 1, supportsAudio: true
    },
    {
        provider: 'jimeng', id: 'jimeng-image-5-0-lite', displayName: '图片 5.0 Lite', type: 'image',
        inputModes: ['text', 'reference-image', 'multi-reference', 'unified-edit'],
        aspectRatios: ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'],
        resolutions: ['2K', '4K'], maxReferenceImages: 12, maxBatchCount: 4
    },
    {
        provider: 'jimeng', id: 'jimeng-image-5-0-pro', displayName: '图片 5.0 Pro', type: 'image',
        inputModes: ['text', 'reference-image', 'multi-reference', 'unified-edit'],
        aspectRatios: ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'],
        resolutions: ['2K', '4K'], maxReferenceImages: 12, maxBatchCount: 4
    },
    {
        provider: 'jimeng', id: 'jimeng-seedance-2-0-mini', displayName: '即梦 Seedance 2.0 mini', type: 'video',
        inputModes: ['text', 'unified-edit', 'first-frame', 'last-frame', 'multi-reference'],
        aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
        resolutions: ['720P'], durations: [4, 5, 6, 8, 10, 15],
        maxReferenceImages: 9, maxBatchCount: 4, supportsAudio: true
    },
    {
        provider: 'google-flow', id: 'google-flow-nano-banana-2', displayName: 'Nano Banana 2', type: 'image',
        inputModes: ['text', 'reference-image', 'multi-reference'],
        aspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16'],
        maxReferenceImages: 3, maxBatchCount: 4
    },
    {
        provider: 'google-flow', id: 'google-flow-omni-flash', displayName: 'Omni Flash', type: 'video',
        inputModes: ['text', 'image-to-video', 'first-frame', 'multi-reference'],
        aspectRatios: ['16:9', '9:16'], durations: [4, 6, 8, 10],
        maxReferenceImages: 3, maxBatchCount: 1, supportsAudio: true
    }
];

function baselineFor(provider) {
    return BASELINE_MODELS.filter(model => model.provider === provider);
}

/**
 * Normalize a discovered protocol model into a registry definition.
 *
 * Discovered models keep their *protocol* id, because that is what the provider
 * needs and what makes a brand-new platform model usable with no code change.
 */
function toDefinition(provider, model, type, discovered) {
    const inputModes = new Set(['text']);
    if (model.supportsReferenceImage !== false && (model.maxReferenceImages ?? 1) > 0) {
        inputModes.add('reference-image');
    }
    if ((model.maxReferenceImages ?? 0) > 1) inputModes.add('multi-reference');
    if (type === 'video') {
        if (model.supportsImageToVideo !== false) inputModes.add('image-to-video');
        if (model.supportsFirstFrame) inputModes.add('first-frame');
        if (model.supportsEndFrame) inputModes.add('last-frame');
        (model.inputModes || []).forEach(mode => {
            if (mode === 'unified_edit') inputModes.add('unified-edit');
            if (mode === 'first_frame') inputModes.add('first-frame');
            if (mode === 'end_frame') inputModes.add('last-frame');
        });
    }

    return {
        provider,
        id: model.id,
        displayName: model.displayName || model.id,
        type,
        inputModes: [...inputModes],
        aspectRatios: model.aspectRatios,
        resolutions: model.resolutions,
        durations: model.durations,
        maxReferenceImages: model.maxReferenceImages,
        maxBatchCount: model.maxBatchCount,
        supportsAudio: model.supportsAudio,
        supportsPromptEnhancement: model.supportsPromptEnhancement,
        supportsSeed: true,
        discovered: Boolean(discovered),
        metadata: model.metadata || {}
    };
}

/**
 * Cache. Model capabilities do change (a plan upgrade adds 1080p), so this
 * expires — the doc's "不要永久相信旧缓存" — and the settings page can force a
 * refresh.
 */
const CACHE_TTL_MS = 10 * 60_000;
let cache = null;
let cachedAt = 0;
let inflight = null;

export function invalidateModelRegistryCache() {
    cache = null;
    cachedAt = 0;
}

async function discoverProvider(provider, signal) {
    try {
        if (provider === 'gemini-web') return await discoverGeminiModels({ signal });
        if (provider === 'jimeng') return await discoverJimengModels({ signal });
        return await discoverFlowModels({ signal });
    } catch (error) {
        console.warn(`[model-registry] ${provider} 模型发现失败，沿用内置基线：${error.message}`);
        return { images: [], videos: [], discovered: false };
    }
}

/**
 * Build the full registry.
 *
 * Baseline first, discovered merged on top by id — so a discovered model
 * enriches its baseline entry rather than duplicating it.
 */
export async function getModelRegistry({ refresh = false, signal } = {}) {
    if (!refresh && cache && Date.now() - cachedAt < CACHE_TTL_MS) return cache;
    if (!refresh && inflight) return inflight;

    inflight = (async () => {
        const models = new Map();
        for (const model of BASELINE_MODELS) {
            models.set(`${model.provider}:${model.id}`, { ...model, discovered: false });
        }

        const providers = {};
        for (const provider of WEB_PROVIDER_IDS) {
            const found = await discoverProvider(provider, signal);
            providers[provider] = { discovered: Boolean(found.discovered) };
            // discovered 只在平台**真的**回了模型列表时才为 true。
            // 发现失败时 provider 返回的是它自己的基线对象，若照样标成 discovered，
            // 模型注册表就会谎称「动态发现成功」——正是 §41 要求不能出现的情况。
            const reallyDiscovered = Boolean(found.discovered);
            for (const model of found.images || []) {
                merge(models, toDefinition(provider, model, 'image', reallyDiscovered));
            }
            for (const model of found.videos || []) {
                merge(models, toDefinition(provider, model, 'video', reallyDiscovered));
            }
        }

        const result = {
            updatedAt: new Date().toISOString(),
            providers,
            models: [...models.values()]
        };
        cache = result;
        cachedAt = Date.now();
        return result;
    })().finally(() => { inflight = null; });

    return inflight;
}

function merge(models, definition) {
    // A discovered protocol model enriches its canvas counterpart instead of
    // appearing beside it; only genuinely new models get their own entry.
    const canvasId = resolveCanvasModelId(definition.id);
    const key = canvasId && models.has(`${definition.provider}:${canvasId}`)
        ? `${definition.provider}:${canvasId}`
        : `${definition.provider}:${definition.id}`;
    const existing = models.get(key);
    if (!existing) {
        models.set(key, definition);
        return;
    }
    // Discovered capability data wins where present; baseline fills the gaps.
    // `id` and `displayName` stay on the baseline: the canvas id is what the
    // nodes and saved project files use, and renaming it would orphan them.
    models.set(key, {
        ...existing,
        ...Object.fromEntries(Object.entries(definition).filter(([, value]) => value !== undefined)),
        id: existing.id,
        displayName: existing.displayName,
        inputModes: [...new Set([...(existing.inputModes || []), ...(definition.inputModes || [])])],
        discovered: Boolean(existing.discovered) || Boolean(definition.discovered)
    });
}

/**
 * Look a model up without a network round trip when possible.
 * Returns `undefined` for unknown ids — callers keep the stored value and show
 * a compatibility hint rather than refusing to open the project (doc §37).
 */
export function findBaselineModel(modelId) {
    return BASELINE_MODELS.find(model => model.id === modelId);
}

export { BASELINE_MODELS };
