/**
 * 图片 / 视频生成 Provider 的单一注册源。
 *
 * React 节点只负责按 capability 渲染；后端用同一份 id/capability 做参数校验。
 * 第三方网页能力变化时，应优先修改这里和对应 Provider，不在业务节点散落 model if。
 */

export const IMAGE_GENERATION_PROVIDERS = Object.freeze([
  {
    id: 'codex-imagegen',
    name: 'Codex CLI · ChatGPT 生图',
    provider: 'codex',
    browserProvider: null,
    supportsImageToImage: true,
    supportsMultipleReferenceImages: true,
    maxReferenceImages: 14,
    supportsMultipleOutputs: false,
    maxOutputCount: 1,
    resolutions: ['Auto'],
    supportedAspectRatios: ['Auto', '1:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9'],
  },
  ...[
    ['google-flow-nano-banana-pro', 'Google Flow · Nano Banana Pro'],
    ['google-flow-nano-banana-2', 'Google Flow · Nano Banana 2'],
    ['google-flow-nano-banana-2-lite', 'Google Flow · Nano Banana 2 Lite'],
  ].map(([id, name]) => ({
    id,
    name,
    provider: 'workflow',
    browserProvider: 'google-flow',
    supportsImageToImage: true,
    supportsMultipleReferenceImages: true,
    maxReferenceImages: 10,
    supportsMultipleOutputs: true,
    maxOutputCount: 4,
    resolutions: ['1K', '2K'],
    defaultResolution: '2K',
    supportedAspectRatios: ['1:1', '16:9', '4:3', '3:4', '9:16'],
  })),
  ...[
    ['jimeng-image-5-0-pro', '即梦 · 图片 5.0 Pro', 4, 10, ['1K', '2K', '4K']],
    ['jimeng-image-5-0-lite', '即梦 · 图片 5.0 Lite', 8, 12, ['2K', '4K']],
  ].map(([id, name, maxOutputCount, maxReferenceImages, resolutions]) => ({
    id,
    name,
    provider: 'workflow',
    browserProvider: 'jimeng',
    supportsImageToImage: true,
    supportsMultipleReferenceImages: true,
    maxReferenceImages,
    supportsMultipleOutputs: true,
    maxOutputCount,
    resolutions,
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'],
  })),
  {
    id: 'gemini-web-image',
    name: 'Gemini Web · 图片',
    provider: 'workflow',
    browserProvider: 'gemini-web',
    supportsImageToImage: true,
    supportsMultipleReferenceImages: true,
    // Gemini Apps 当前帮助页明确支持多图；Provider 保守限制为 5，避免超过网页上传能力。
    maxReferenceImages: 5,
    supportsMultipleOutputs: false,
    maxOutputCount: 1,
    resolutions: ['自动'],
    supportedAspectRatios: ['16:9', '9:16', '1:1', '3:2', '4:3'],
  },
]);

export const VIDEO_GENERATION_PROVIDERS = Object.freeze([
  {
    id: 'google-flow-omni-flash', name: 'Google Flow · Omni Flash', provider: 'workflow', browserProvider: 'google-flow',
    supportsTextToVideo: true, supportsImageToVideo: true, supportsVideoReference: true, supportsMultipleReferenceImages: true,
    maxReferenceImages: 7, supportsNativeAudio: true, supportsExtend: false,
    supportedDurations: [4, 6, 8, 10], resolutions: ['自动'], supportedAspectRatios: ['16:9', '9:16'],
  },
  {
    id: 'google-flow-veo-3-1-lite', name: 'Google Flow · Veo 3.1 - Lite', provider: 'workflow', browserProvider: 'google-flow',
    supportsTextToVideo: true, supportsImageToVideo: true, supportsMultipleReferenceImages: true,
    maxReferenceImages: 3, supportsNativeAudio: true, supportsExtend: false,
    supportedDurations: [8], resolutions: ['自动'], supportedAspectRatios: ['16:9', '9:16'],
  },
  {
    id: 'google-flow-veo-3-1-fast', name: 'Google Flow · Veo 3.1 - Fast', provider: 'workflow', browserProvider: 'google-flow',
    supportsTextToVideo: true, supportsImageToVideo: true, supportsMultipleReferenceImages: true,
    maxReferenceImages: 3, supportsNativeAudio: true, supportsExtend: false,
    supportedDurations: [8], resolutions: ['自动'], supportedAspectRatios: ['16:9', '9:16'],
  },
  {
    id: 'google-flow-veo-3-1-quality', name: 'Google Flow · Veo 3.1 - Quality', provider: 'workflow', browserProvider: 'google-flow',
    supportsTextToVideo: true, supportsImageToVideo: true, supportsMultipleReferenceImages: false,
    maxReferenceImages: 1, supportsNativeAudio: true, supportsExtend: false,
    supportedDurations: [8], resolutions: ['自动'], supportedAspectRatios: ['16:9', '9:16'],
  },
  ...[
    ['jimeng-seedance-2-0-mini', '即梦 · Seedance 2.0 mini', ['720P']],
    ['jimeng-seedance-2-0-fast', '即梦 · Seedance 2.0 Fast VIP', ['720P']],
    ['jimeng-seedance-2-0', '即梦 · Seedance 2.0 VIP', ['720P', '1080P', '4K']],
    ['jimeng-seedance-2-0-fast-standard', '即梦 · Seedance 2.0 Fast', ['720P']],
    ['jimeng-seedance-2-0-standard', '即梦 · Seedance 2.0', ['720P']],
  ].map(([id, name, resolutions]) => ({
    id, name, provider: 'workflow', browserProvider: 'jimeng',
    supportsTextToVideo: true, supportsImageToVideo: true, supportsMultipleReferenceImages: true,
    maxReferenceImages: 9, supportsNativeAudio: false, supportsExtend: false,
    supportedDurations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], resolutions,
    supportedAspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
  })),
  {
    id: 'seedance-2-0', name: 'Seedance 2.0', provider: 'seedance', browserProvider: null,
    supportsTextToVideo: true, supportsImageToVideo: true, supportsMultipleReferenceImages: true,
    maxReferenceImages: 14, supportsNativeAudio: true, supportsExtend: false,
    supportedDurations: [4, 5, 6, 8, 10, 15], resolutions: ['720p', '1080p'],
    supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
  },
  {
    id: 'gemini-web-video', name: 'Gemini Web · 视频', provider: 'workflow', browserProvider: 'gemini-web',
    supportsTextToVideo: true, supportsImageToVideo: true, supportsMultipleReferenceImages: false,
    // 当前 Gemini 网页视频入口只暴露一个文件输入，不宣称未经页面支持的多参考图能力。
    maxReferenceImages: 1, supportsNativeAudio: true, supportsExtend: true,
    // 当前网页没有时长选择器；两次真实 HTTP 结果都固定为 10.005 秒。
    supportedDurations: [10], resolutions: ['自动'], supportedAspectRatios: ['16:9', '9:16'],
  },
]);

/**
 * 运行时发现的能力覆盖层。
 *
 * 上面的静态表是**基线**：离线、未登录、模型发现失败时它保证节点不会空掉，也保证
 * 旧项目文件里的 model id 永远能解析。平台真正开放的能力（新比例、1080p、新时长、
 * 新的参考图上限）由 /api/settings/models 在运行时叠加上来，这样平台加模型时不需要
 * 改前端代码。
 *
 * 只覆盖 capability 字段，不改 id / provider / browserProvider —— 那三个决定了走哪条
 * 链路，必须由代码而不是远端数据决定。
 */
const capabilityOverlay = new Map();

const CAPABILITY_KEYS = new Set([
  'name', 'maxReferenceImages', 'maxOutputCount', 'supportsMultipleOutputs',
  'supportsMultipleReferenceImages', 'supportsImageToImage', 'supportsImageToVideo',
  'supportsTextToVideo', 'supportsVideoReference', 'supportsNativeAudio', 'resolutions', 'supportedAspectRatios',
  'supportedDurations', 'defaultResolution'
]);

function withOverlay(model) {
  if (!model) return model;
  const overlay = capabilityOverlay.get(model.id);
  return overlay ? { ...model, ...overlay } : model;
}

/**
 * 把后端注册表（server/services/webhttp/registry.js）的结果叠加进来。
 *
 * 未识别的字段一律丢弃，缺失的字段保留基线值：一次残缺的发现结果不能把用户本来
 * 能用的比例或时长弄没。
 */
export function applyDiscoveredModelRegistry(registry) {
  const models = Array.isArray(registry?.models) ? registry.models : [];
  const byCanvasId = new Map(
    [...IMAGE_GENERATION_PROVIDERS, ...VIDEO_GENERATION_PROVIDERS].map(model => [model.id, model])
  );

  for (const model of models) {
    const overlay = {};
    if (model.displayName) overlay.name = model.displayName;
    if (Array.isArray(model.aspectRatios) && model.aspectRatios.length) {
      overlay.supportedAspectRatios = model.aspectRatios;
    }
    if (Array.isArray(model.resolutions) && model.resolutions.length) overlay.resolutions = model.resolutions;
    if (typeof model.defaultResolution === 'string' && model.defaultResolution) {
      overlay.defaultResolution = model.defaultResolution;
    }
    if (Array.isArray(model.durations) && model.durations.length) overlay.supportedDurations = model.durations;
    if (Number(model.maxReferenceImages) > 0) {
      overlay.maxReferenceImages = Number(model.maxReferenceImages);
      overlay.supportsMultipleReferenceImages = Number(model.maxReferenceImages) > 1;
    }
    if (Number(model.maxBatchCount) > 0) {
      overlay.maxOutputCount = Number(model.maxBatchCount);
      overlay.supportsMultipleOutputs = Number(model.maxBatchCount) > 1;
    }
    if (typeof model.supportsAudio === 'boolean') overlay.supportsNativeAudio = model.supportsAudio;
    if (Array.isArray(model.inputModes)) {
      if (model.type === 'video') {
        overlay.supportsImageToVideo = model.inputModes.some(mode =>
          ['image-to-video', 'first-frame', 'reference-image', 'unified-edit', 'multi-reference'].includes(mode));
        overlay.supportsTextToVideo = model.inputModes.includes('text');
        if (model.inputModes.includes('video-edit')) overlay.supportsVideoReference = true;
      } else {
        overlay.supportsImageToImage = model.inputModes.some(mode =>
          ['reference-image', 'multi-reference', 'unified-edit'].includes(mode));
      }
    }

    const filtered = Object.fromEntries(
      Object.entries(overlay).filter(([key, value]) => CAPABILITY_KEYS.has(key) && value !== undefined)
    );

    if (byCanvasId.has(model.id)) {
      capabilityOverlay.set(model.id, filtered);
      continue;
    }
    // Unknown protocol ids are intentionally not exposed. The generation route
    // can only dispatch canvas ids with a reviewed protocol mapping; showing an
    // unrouteable discovery result would silently send it to the wrong provider.
  }
}

/** 测试与「刷新模型」用：回到纯基线状态。 */
export function resetDiscoveredModelRegistry() {
  capabilityOverlay.clear();
}

/** 节点下拉只展示有明确协议路由的模型；发现数据只叠加 capability。 */
export function listImageGenerationProviders() {
  return IMAGE_GENERATION_PROVIDERS.map(withOverlay);
}

/** Video Remix 一致性设定图允许所有支持参考图的图片通道，包括 Codex CLI。 */
export function listVideoRemixConsistencyImageProviders() {
  return listImageGenerationProviders().filter(model => model.supportsImageToImage);
}

export function listVideoGenerationProviders() {
  return VIDEO_GENERATION_PROVIDERS.map(withOverlay);
}

export const getImageGenerationProvider = id =>
  withOverlay(IMAGE_GENERATION_PROVIDERS.find(item => item.id === id))
  || null;

export const getVideoGenerationProvider = id =>
  withOverlay(VIDEO_GENERATION_PROVIDERS.find(item => item.id === id))
  || null;

/**
 * Resolve a stored image-node value through the selected model capability.
 *
 * Flow used to persist Auto/自动 because it exposed no resolution choice. Those
 * legacy values, and a missing field, now resolve to Flow's explicit 2K
 * default. An explicit stored 1K remains 1K.
 */
export function normalizeImageResolution(modelId, value) {
  const provider = getImageGenerationProvider(modelId);
  if (!provider) return value;
  const requested = String(value || '').trim();
  const exact = provider.resolutions.find(option => option.toLowerCase() === requested.toLowerCase());
  if (exact) return exact;
  const isAutomatic = !requested || ['auto', '自动'].includes(requested.toLowerCase());
  if (provider.defaultResolution && isAutomatic) return provider.defaultResolution;
  if (provider.defaultResolution && !exact) return provider.defaultResolution;
  if (isAutomatic) {
    return provider.resolutions.find(option => ['auto', '自动'].includes(option.toLowerCase()))
      || provider.resolutions[0]
      || requested;
  }
  return requested;
}

export function clampImageOutputCount(modelId, requestedCount) {
  const provider = getImageGenerationProvider(modelId);
  const maximum = provider?.supportsMultipleOutputs ? provider.maxOutputCount : 1;
  return Math.max(1, Math.min(maximum || 1, Number(requestedCount) || 1));
}

export function supportedImageOutputCounts(modelId) {
  const provider = getImageGenerationProvider(modelId);
  const maximum = provider?.supportsMultipleOutputs ? provider.maxOutputCount : 1;
  return Array.from({ length: Math.max(1, maximum || 1) }, (_, index) => index + 1);
}

/**
 * 把画幅收敛到该图片模型真正支持的取值。
 *
 * 产品短视频节点的画幅由用户统一指定，但模型可以随时切换（比如从即梦换到 Gemini Web，
 * 后者不支持 3:4）。不收口的话，要等识图跑完好几分钟才在 Python 侧抛
 * ASPECT_RATIO_NOT_SUPPORTED，白跑一次生成。
 */
export function normalizeImageAspectRatio(modelId, value) {
  const ratios = getImageGenerationProvider(modelId)?.supportedAspectRatios || [];
  if (ratios.length === 0) return value;
  return ratios.includes(value) ? value : ratios[0];
}

export function normalizeVideoParameters(modelId, { aspectRatio, duration } = {}) {
  const provider = getVideoGenerationProvider(modelId) || listVideoGenerationProviders()[0];
  const ratios = provider.supportedAspectRatios || [];
  const durations = provider.supportedDurations || [];
  return {
    aspectRatio: ratios.includes(aspectRatio) ? aspectRatio : ratios[0],
    duration: durations.length === 0 ? undefined : durations.includes(Number(duration)) ? Number(duration) : durations[0],
  };
}


/**
 * 按画幅挑一个能用的图生视频模型。
 *
 * 产品短视频链路里「比例」是用户唯一要决定的东西，替换图和短视频必须是同一个比例 ——
 * 替换图就是视频的首帧，比例对不上时平台只会裁掉或加黑边，而且**不报错**，
 * 要回看成片才发现构图被切了。
 *
 * 因此这里的取舍是：**比例是硬的，模型是软的**。所选模型撑不住这个比例，就换一个撑得住的，
 * 而不是偷偷把用户选的比例改掉。
 *
 * 优先级：
 * 1. 当前模型本身就支持 → 不动；
 * 2. 浏览器模型优先（只要登录，不需要额外配置 API Key）；
 * 3. 其余支持该比例的模型。
 * 一个都没有时返回 null，由调用方明确拒绝，不做静默裁切。
 */
export function resolveVideoModelForAspectRatio(aspectRatio, preferredModelId) {
  const usable = listVideoGenerationProviders().filter(model =>
    model.supportsImageToVideo && model.supportedAspectRatios.includes(aspectRatio));
  if (usable.length === 0) return null;
  const preferred = usable.find(model => model.id === preferredModelId);
  if (preferred) return { modelId: preferred.id, switched: false, from: preferredModelId };
  const fallback = usable.find(model => model.browserProvider) || usable[0];
  return { modelId: fallback.id, switched: true, from: preferredModelId || '' };
}

/** 该画幅下可选的图生视频模型；空数组表示没有模型支持它。 */
export function videoModelsForAspectRatio(aspectRatio) {
  return listVideoGenerationProviders().filter(model =>
    model.supportsImageToVideo && model.supportedAspectRatios.includes(aspectRatio));
}

/**
 * Video Remix consumes a stricter capability contract than a regular canvas
 * Video node. These values describe the protocol that the generation route
 * actually exposes, not only the broad capability advertised by a model.
 */
export function getVideoProviderCapabilities(modelId) {
  const provider = getVideoGenerationProvider(modelId);
  if (!provider) return null;
  const id = provider.id;
  const isJimeng = id.startsWith('jimeng-');
  const isGoogleFlow = id.startsWith('google-flow-');
  const isGeminiWeb = id === 'gemini-web-video';
  const isSeedanceApi = id === 'seedance-2-0';
  const referenceMaterialsOnly = isJimeng || isGeminiWeb;
  const multiReference = isJimeng
    || (isGoogleFlow && provider.supportsMultipleReferenceImages);
  const durations = (provider.supportedDurations || [])
    .map(Number)
    .filter(value => Number.isFinite(value) && value > 0);
  return {
    imageToVideo: Boolean(provider.supportsImageToVideo),
    startFrame: !referenceMaterialsOnly,
    endFrame: isSeedanceApi,
    multiReference,
    characterReference: referenceMaterialsOnly || multiReference,
    audioGeneration: Boolean(provider.supportsNativeAudio),
    maxDuration: durations.length > 0 ? Math.max(...durations) : 0,
    maxReferenceImages: isSeedanceApi
      ? 2
      : Math.max(1, Number(provider.maxReferenceImages) || 1),
    referenceMode: referenceMaterialsOnly
      ? 'reference-materials'
      : isSeedanceApi
        ? 'start-end'
        : 'start-frame',
  };
}
