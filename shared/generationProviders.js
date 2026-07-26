/**
 * 图片 / 视频生成 Provider 的单一注册源。
 *
 * React 节点只负责按 capability 渲染；后端用同一份 id/capability 做参数校验。
 * 第三方网页能力变化时，应优先修改这里和对应 Provider，不在业务节点散落 model if。
 */

export const IMAGE_GENERATION_PROVIDERS = Object.freeze([
  {
    id: 'codex-imagegen',
    name: 'Codex 生图',
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
    maxReferenceImages: 12,
    supportsMultipleOutputs: true,
    maxOutputCount: 4,
    resolutions: ['自动'],
    supportedAspectRatios: ['1:1', '16:9', '4:3', '3:4', '9:16'],
  })),
  ...[
    ['jimeng-image-5-0-pro', '即梦 · 图片 5.0 Pro'],
    ['jimeng-image-5-0-lite', '即梦 · 图片 5.0 Lite'],
  ].map(([id, name]) => ({
    id,
    name,
    provider: 'workflow',
    browserProvider: 'jimeng',
    supportsImageToImage: true,
    supportsMultipleReferenceImages: true,
    maxReferenceImages: 12,
    supportsMultipleOutputs: true,
    maxOutputCount: 4,
    resolutions: ['2K', '4K'],
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
    supportsTextToVideo: false, supportsImageToVideo: true, supportsMultipleReferenceImages: true,
    maxReferenceImages: 4, supportsNativeAudio: false, supportsExtend: false,
    supportedDurations: [4, 6, 8, 10], resolutions: ['自动'], supportedAspectRatios: ['16:9', '9:16'],
  },
  {
    id: 'google-flow-veo-3-1-lite', name: 'Google Flow · Veo 3.1 - Lite', provider: 'workflow', browserProvider: 'google-flow',
    supportsTextToVideo: false, supportsImageToVideo: true, supportsMultipleReferenceImages: true,
    maxReferenceImages: 4, supportsNativeAudio: false, supportsExtend: false,
    supportedDurations: [], resolutions: ['自动'], supportedAspectRatios: ['16:9', '9:16'],
  },
  ...[
    ['jimeng-seedance-2-0-mini', '即梦 · Seedance 2.0 mini'],
    ['jimeng-seedance-2-0-fast', '即梦 · Seedance 2.0 Fast VIP'],
    ['jimeng-seedance-2-0', '即梦 · Seedance 2.0 VIP'],
    ['jimeng-seedance-2-0-fast-standard', '即梦 · Seedance 2.0 Fast'],
    ['jimeng-seedance-2-0-standard', '即梦 · Seedance 2.0'],
  ].map(([id, name]) => ({
    id, name, provider: 'workflow', browserProvider: 'jimeng',
    supportsTextToVideo: true, supportsImageToVideo: true, supportsMultipleReferenceImages: true,
    maxReferenceImages: 12, supportsNativeAudio: false, supportsExtend: false,
    supportedDurations: [4, 5, 6, 8, 10, 15], resolutions: ['720P', '1080P', '4K'],
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
    supportsTextToVideo: true, supportsImageToVideo: true, supportsMultipleReferenceImages: true,
    // 官方当前支持最多 5 张；产品工作流按需求保守使用 1~3 张。
    maxReferenceImages: 3, supportsNativeAudio: true, supportsExtend: true,
    // Gemini 网页没有稳定公开的时长选择器，本轮只提交当前通用 8 秒能力。
    supportedDurations: [8], resolutions: ['自动'], supportedAspectRatios: ['16:9', '9:16'],
  },
]);

export const getImageGenerationProvider = id => IMAGE_GENERATION_PROVIDERS.find(item => item.id === id) || null;
export const getVideoGenerationProvider = id => VIDEO_GENERATION_PROVIDERS.find(item => item.id === id) || null;

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
 * 产品短视频节点的画幅是从场景参考图**推断**出来的（inferProductSceneAspectRatio 只认
 * 16:9/4:3/1:1/3:4/9:16），并不受所选模型的能力约束。竖构图场景 + Gemini Web 图片 会推出
 * 3:4，而 Gemini Web 不支持 3:4 —— 结果是识图跑完好几分钟后才在 Python 侧抛
 * ASPECT_RATIO_NOT_SUPPORTED。这里在建任务时就收口，避免白跑一次生成。
 */
export function normalizeImageAspectRatio(modelId, value) {
  const ratios = getImageGenerationProvider(modelId)?.supportedAspectRatios || [];
  if (ratios.length === 0) return value;
  return ratios.includes(value) ? value : ratios[0];
}

export function normalizeVideoParameters(modelId, { aspectRatio, duration } = {}) {
  const provider = getVideoGenerationProvider(modelId) || VIDEO_GENERATION_PROVIDERS[0];
  const ratios = provider.supportedAspectRatios || [];
  const durations = provider.supportedDurations || [];
  return {
    aspectRatio: ratios.includes(aspectRatio) ? aspectRatio : ratios[0],
    duration: durations.length === 0 ? undefined : durations.includes(Number(duration)) ? Number(duration) : durations[0],
  };
}
