/**
 * Shared primitives for the Cinematic Director workflow.
 *
 * This module deliberately contains no browser, filesystem or provider
 * execution code. The renderer, backend and regression tests all use the
 * same settings, cast, prompt and storyboard contract.
 */

import {
  getVideoGenerationProvider,
  listVideoGenerationProviders,
} from './generationProviders.js';

export const CINEMATIC_SCHEMA_VERSION = '1.0';

export const CINEMATIC_ASPECT_RATIOS = Object.freeze([
  '9:16', '16:9', '1:1', '4:5', '3:4',
]);

export const CINEMATIC_RESOLUTION_PRESETS = Object.freeze({
  '9:16': Object.freeze([
    { width: 720, height: 1280, label: '720 × 1280' },
    { width: 1080, height: 1920, label: '1080 × 1920' },
    { width: 1440, height: 2560, label: '1440 × 2560' },
  ]),
  '16:9': Object.freeze([
    { width: 1280, height: 720, label: '1280 × 720' },
    { width: 1920, height: 1080, label: '1920 × 1080' },
    { width: 2560, height: 1440, label: '2560 × 1440' },
  ]),
  '1:1': Object.freeze([
    { width: 720, height: 720, label: '720 × 720' },
    { width: 1080, height: 1080, label: '1080 × 1080' },
    { width: 1440, height: 1440, label: '1440 × 1440' },
  ]),
  '4:5': Object.freeze([
    { width: 864, height: 1080, label: '864 × 1080' },
    { width: 1080, height: 1350, label: '1080 × 1350' },
  ]),
  '3:4': Object.freeze([
    { width: 810, height: 1080, label: '810 × 1080' },
    { width: 1080, height: 1440, label: '1080 × 1440' },
  ]),
});

export const CINEMATIC_VISUAL_STYLES = Object.freeze([
  {
    id: 'cinematic-realistic',
    label: '电影写实',
    prompt: '写实电影场景，完整光影层次、真实材质、自然人物表演和可测量的摄影机运动。',
  },
  {
    id: 'urban-night',
    label: '都市夜景',
    prompt: '都市夜景写实质感，冷色环境光与局部暖色灯源形成明确的空间层次，湿润材质呈现真实反光。',
  },
  {
    id: 'retro-film',
    label: '复古胶片',
    prompt: '复古胶片质感，柔和高光、自然颗粒、克制的色彩分离和稳定的真实运动。',
  },
  {
    id: 'cyberpunk',
    label: '赛博朋克',
    prompt: '写实赛博朋克场景，霓虹光束绑定到建筑与湿润材质，空气透视和反射遵守真实物理。',
  },
  {
    id: 'custom',
    label: '自定义',
    prompt: '',
  },
]);

export const CINEMATIC_PACES = Object.freeze(['舒缓', '标准', '快节奏', '强节奏', '自动']);

export const CINEMATIC_PLATFORMS = Object.freeze([
  '抖音', 'TikTok', 'YouTube Shorts', 'Instagram Reels', '小红书', 'YouTube', 'B站', '自定义',
]);

export const CINEMATIC_CAST_ROLES = Object.freeze(['protagonist', 'supporting']);
export const CINEMATIC_REFERENCE_SOURCES = Object.freeze(['upload', 'library', 'ai']);
export const CINEMATIC_FOVS = Object.freeze([
  '180°鱼眼', '107°建筑广角', '84°广角', '63°纪实', '47°自然人眼',
  '29°人像压缩', '18°特写肖像', '12°长焦细节', '8°超长焦',
]);
export const CINEMATIC_SHOT_TYPES = Object.freeze(['远景', '全景', '中景', '近景', '特写', '大特写']);

export const CINEMATIC_DEFAULT_VIDEO_MODEL = 'google-flow-omni-flash';

const DEFAULT_SETTINGS = Object.freeze({
  provider: 'auto',
  platform: '抖音',
  visualStyle: 'cinematic-realistic',
  customVisualStyle: '',
  aspectRatio: '9:16',
  width: 1080,
  height: 1920,
  totalDuration: 48,
  shotCount: 6,
  durationPerShot: 8,
  language: 'zh-CN',
  pace: '标准',
  videoModel: CINEMATIC_DEFAULT_VIDEO_MODEL,
  videoResolution: '自动',
  audioEnabled: true,
  allowDirectorOptimization: true,
});

const asText = value => String(value ?? '').trim();
const asPositiveNumber = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};
const asPositiveInteger = (value, fallback) => Math.max(1, Math.round(asPositiveNumber(value, fallback)));
const objectOrEmpty = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

const ratioParts = ratio => {
  const match = asText(ratio).match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : null;
};

const ratioDistance = (left, right) => {
  const a = ratioParts(left);
  const b = ratioParts(right);
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.abs(a.width / a.height - b.width / b.height);
};

export const nearestCinematicAspectRatio = (width, height, fallback = '9:16') => {
  const w = Number(width);
  const h = Number(height);
  if (!(w > 0 && h > 0)) return CINEMATIC_ASPECT_RATIOS.includes(fallback) ? fallback : '9:16';
  return CINEMATIC_ASPECT_RATIOS.reduce((best, candidate) => (
    ratioDistance(`${w}:${h}`, candidate) < ratioDistance(`${w}:${h}`, best) ? candidate : best
  ), '9:16');
};

export const resolveCinematicResolution = (aspectRatio, width, height) => {
  const ratio = CINEMATIC_ASPECT_RATIOS.includes(aspectRatio) ? aspectRatio : '9:16';
  const presets = CINEMATIC_RESOLUTION_PRESETS[ratio] || [];
  const requestedWidth = Math.max(256, Math.round(Number(width) || presets[0]?.width || 720));
  const requestedHeight = Math.max(256, Math.round(Number(height) || presets[0]?.height || 1280));
  const exact = presets.find(item => item.width === requestedWidth && item.height === requestedHeight);
  if (exact) return { ...exact, aspectRatio: ratio, custom: false };
  if (presets.length === 0) return {
    width: requestedWidth,
    height: requestedHeight,
    label: `${requestedWidth} × ${requestedHeight}`,
    aspectRatio: ratio,
    custom: true,
  };
  const requestedRatio = requestedWidth / requestedHeight;
  const closest = presets.reduce((best, item) => {
    const bestScore = Math.abs(best.width / best.height - requestedRatio)
      + Math.abs(best.width - requestedWidth) / 100000;
    const score = Math.abs(item.width / item.height - requestedRatio)
      + Math.abs(item.width - requestedWidth) / 100000;
    return score < bestScore ? item : best;
  }, presets[0]);
  return {
    ...closest,
    aspectRatio: ratio,
    custom: false,
    mappedFrom: { width: requestedWidth, height: requestedHeight },
  };
};

export const cinematicVisualStyle = settings => {
  const source = objectOrEmpty(settings);
  if (source.visualStyle === 'custom') return asText(source.customVisualStyle) || '写实电影场景';
  return CINEMATIC_VISUAL_STYLES.find(item => item.id === source.visualStyle)?.prompt
    || CINEMATIC_VISUAL_STYLES[0].prompt;
};

export const getCinematicVideoModel = modelId => {
  const requested = asText(modelId);
  if (requested) return getVideoGenerationProvider(requested) || null;
  return getVideoGenerationProvider(CINEMATIC_DEFAULT_VIDEO_MODEL)
    || listVideoGenerationProviders()[0]
    || null;
};

export const cinematicModelUsesReferenceTags = modelId => {
  const id = asText(modelId).toLowerCase();
  return id.startsWith('jimeng-') || id.startsWith('seedance-');
};

export const resolveCinematicDuration = (duration, modelId, fallback = 8) => {
  const model = getCinematicVideoModel(modelId);
  const supported = Array.isArray(model?.supportedDurations)
    ? model.supportedDurations.map(Number).filter(value => Number.isFinite(value) && value > 0)
    : [];
  const requested = asPositiveNumber(duration, fallback);
  if (supported.length === 0) return Math.min(60, requested);
  return supported.reduce((best, candidate) => (
    Math.abs(candidate - requested) < Math.abs(best - requested) ? candidate : best
  ), supported[0]);
};

export const normalizeCinematicSettings = (input = {}) => {
  const source = objectOrEmpty(input);
  const aspectRatio = CINEMATIC_ASPECT_RATIOS.includes(source.aspectRatio)
    ? source.aspectRatio
    : nearestCinematicAspectRatio(source.width, source.height, DEFAULT_SETTINGS.aspectRatio);
  const resolution = resolveCinematicResolution(
    aspectRatio,
    source.width ?? DEFAULT_SETTINGS.width,
    source.height ?? DEFAULT_SETTINGS.height,
  );
  // 镜头数量与单镜头时长现在由 AI 按剧情自动决定（用户不再输入）。
  // 保留默认值仅作兼容与兜底：旧项目数据继续可读，未提供时用 6 镜头/总时长÷镜头数。
  const shotCount = Math.min(30, asPositiveInteger(source.shotCount, DEFAULT_SETTINGS.shotCount));
  const totalDuration = Math.min(600, asPositiveNumber(source.totalDuration, DEFAULT_SETTINGS.totalDuration));
  const videoModel = (getCinematicVideoModel(source.videoModel)?.id
    || CINEMATIC_DEFAULT_VIDEO_MODEL);
  const model = getCinematicVideoModel(videoModel);
  const supportsAudio = Boolean(model?.supportsNativeAudio);
  const visualStyle = CINEMATIC_VISUAL_STYLES.some(item => item.id === source.visualStyle)
    ? source.visualStyle
    : DEFAULT_SETTINGS.visualStyle;
  const defaultDuration = resolveCinematicDuration(
    source.durationPerShot,
    videoModel,
    totalDuration / shotCount || DEFAULT_SETTINGS.durationPerShot,
  );
  return {
    ...DEFAULT_SETTINGS,
    ...source,
    provider: ['auto', 'gemini', 'codex', 'deepseek'].includes(asText(source.provider).toLowerCase())
      ? asText(source.provider).toLowerCase()
      : DEFAULT_SETTINGS.provider,
    platform: asText(source.platform) || DEFAULT_SETTINGS.platform,
    visualStyle,
    customVisualStyle: asText(source.customVisualStyle),
    aspectRatio,
    width: resolution.width,
    height: resolution.height,
    totalDuration,
    shotCount,
    durationPerShot: defaultDuration,
    language: asText(source.language) || DEFAULT_SETTINGS.language,
    pace: CINEMATIC_PACES.includes(source.pace) ? source.pace : DEFAULT_SETTINGS.pace,
    videoModel,
    videoResolution: asText(source.videoResolution) || model?.resolutions?.[0] || DEFAULT_SETTINGS.videoResolution,
    audioEnabled: supportsAudio && source.audioEnabled !== false,
    allowDirectorOptimization: source.allowDirectorOptimization !== false,
  };
};

const normalizeReferenceImage = (value, index, castName) => {
  if (typeof value === 'string') {
    const url = asText(value);
    return url ? {
      id: `${castName || 'cast'}-ref-${index + 1}`,
      url,
      source: 'upload',
      label: `参考图 ${index + 1}`,
    } : null;
  }
  const source = objectOrEmpty(value);
  const url = asText(source.url || source.resultUrl);
  if (!url) return null;
  const imageSource = CINEMATIC_REFERENCE_SOURCES.includes(source.source) ? source.source : 'upload';
  return {
    id: asText(source.id) || `${castName || 'cast'}-ref-${index + 1}`,
    url,
    source: imageSource,
    label: asText(source.label) || `参考图 ${index + 1}`,
    ...(asText(source.usage) ? { usage: asText(source.usage) } : {}),
    ...(asText(source.nodeId) ? { nodeId: asText(source.nodeId) } : {}),
  };
};

export const normalizeCinematicCast = (input = []) => {
  const list = Array.isArray(input) ? input : [];
  return list.map((raw, index) => {
    const source = objectOrEmpty(raw);
    const name = asText(source.name) || `角色 ${index + 1}`;
    const role = CINEMATIC_CAST_ROLES.includes(source.role) ? source.role : index === 0 ? 'protagonist' : 'supporting';
    const id = asText(source.id) || `CAST_${String(index + 1).padStart(2, '0')}`;
    const references = (Array.isArray(source.referenceImages) ? source.referenceImages : [])
      .map((image, imageIndex) => normalizeReferenceImage(image, imageIndex, id))
      .filter(Boolean);
    return {
      id,
      name,
      role,
      description: asText(source.description),
      referenceImages: references,
    };
  });
};

export const countCinematicReferences = cast => normalizeCinematicCast(cast)
  .reduce((total, member) => total + member.referenceImages.length, 0);

export const validateCinematicCast = (cast, { requireProtagonist = true } = {}) => {
  const normalized = normalizeCinematicCast(cast);
  const errors = [];
  if (normalized.length === 0) errors.push('角色表至少需要一个角色');
  const names = new Set();
  const ids = new Set();
  normalized.forEach((member, index) => {
    if (!asText(member.name)) errors.push(`cast[${index}].name 不能为空`);
    if (names.has(member.name)) errors.push(`角色名重复：${member.name}`);
    names.add(member.name);
    if (ids.has(member.id)) errors.push(`角色 ID 重复：${member.id}`);
    ids.add(member.id);
    if (!CINEMATIC_CAST_ROLES.includes(member.role)) errors.push(`cast[${index}].role 无效`);
    if (member.referenceImages.length > 3) errors.push(`cast[${index}].referenceImages 最多 3 张`);
    member.referenceImages.forEach((image, imageIndex) => {
      if (!CINEMATIC_REFERENCE_SOURCES.includes(image.source)) errors.push(`cast[${index}].referenceImages[${imageIndex}].source 无效`);
    });
  });
  if (requireProtagonist && normalized.length > 0 && !normalized.some(member => member.role === 'protagonist')) {
    errors.push('角色表至少需要一个主角');
  }
  return { valid: errors.length === 0, errors, cast: normalized };
};

export const validateCinematicReferenceBudget = (cast, videoModel) => {
  const model = getCinematicVideoModel(videoModel);
  const count = countCinematicReferences(cast);
  const maxReferenceImages = Math.max(1, Number(model?.maxReferenceImages) || 1);
  const errors = [];
  if (!model) errors.push(`未知视频模型：${videoModel}`);
  if (count > maxReferenceImages) {
    errors.push(`${model?.name || videoModel} 最多支持 ${maxReferenceImages} 张角色参考图，当前为 ${count} 张`);
  }
  return {
    valid: errors.length === 0,
    errors,
    count,
    maxReferenceImages,
    modelId: model?.id || asText(videoModel),
  };
};

const normalizeDialogue = value => {
  if (!value) return undefined;
  if (typeof value === 'string') return { text: asText(value) };
  const source = objectOrEmpty(value);
  const text = asText(source.text);
  return text ? {
    text,
    ...(asText(source.speaker) ? { speaker: asText(source.speaker) } : {}),
    ...(asText(source.emotion) ? { emotion: asText(source.emotion) } : {}),
  } : undefined;
};

const castMemberFor = (value, cast) => {
  const source = asText(value);
  return cast.find(member => member.id === source || member.name === source);
};

const normalizeShotCast = (value, cast) => {
  const input = Array.isArray(value) ? value : [];
  return [...new Set(input.map(item => castMemberFor(item, cast)?.id).filter(Boolean))];
};

const normalizeCamera = (raw = {}) => {
  const source = objectOrEmpty(raw);
  const shotType = CINEMATIC_SHOT_TYPES.includes(source.shotType) ? source.shotType : asText(source.shotType) || '中景';
  const fov = CINEMATIC_FOVS.includes(source.fov) ? source.fov : '47°自然人眼';
  return {
    shotType,
    fov,
    angle: asText(source.angle) || '平视',
    motion: asText(source.motion || source.cameraMotion) || '固定机位',
    ...(asText(source.transition) ? { transition: source.transition === 'fade' ? 'fade' : 'hard_cut' } : {}),
  };
};

const styleForPrompt = settings => cinematicVisualStyle(settings);

const castForShot = (shot, cast) => {
  const ids = normalizeShotCast(shot?.cast, cast);
  return cast.filter(member => ids.includes(member.id));
};

const referenceDescription = (member, usesTags) => {
  if (usesTags) return `@${member.name}：本镜头中保持该角色的脸部身份、发型、服装材质与固定配件一致。`;
  return `${member.name}：${member.description || '保持参考图中的脸部身份、发型、体型、服装和固定配件一致'}。`;
};

export const compileCinematicPrompt = (shot, global = {}, cast = []) => {
  const settings = normalizeCinematicSettings(global);
  const normalizedCast = normalizeCinematicCast(cast);
  const participants = castForShot(shot, normalizedCast);
  const usesTags = cinematicModelUsesReferenceTags(settings.videoModel);
  const scene = asText(shot?.scene || shot?.visual?.scene) || '真实电影场景';
  const action = asText(shot?.action || shot?.visual?.action) || '人物完成清晰连续的动作';
  const camera = normalizeCamera(shot?.camera || {});
  const dialogue = normalizeDialogue(shot?.dialogue || shot?.audio?.dialogue);
  const blocks = [
    `【场景】${scene}。${styleForPrompt(settings)}`,
    participants.length > 0 ? `【参考素材】${participants.map(member => referenceDescription(member, usesTags)).join(' ')}` : '',
    asText(shot?.space) ? `【空间】${asText(shot.space)}` : '',
    asText(shot?.firstFrame) ? `【首帧】${asText(shot.firstFrame)}` : `【首帧】${participants.map(member => member.name).join('、') || '主体'}在画面中保持清晰可见的初始位置与朝向，构图服务于${scene}。`,
    '【分镜方式】单镜头，一气呵成，摄影机不自行剪切。',
    `【镜头】${camera.shotType}，${camera.fov}视场角，${camera.angle}。`,
    `【运镜】${camera.motion}，焦点持续落在${participants[0]?.name || '主要动作主体'}的动作与视线。`,
    `【动作】${action}。`,
    asText(shot?.performance) ? `【表演】${asText(shot.performance)}` : '',
    asText(shot?.physics) ? `【物理】${asText(shot.physics)}` : '',
    asText(shot?.lighting) ? `【光线】${asText(shot.lighting)}` : '',
    asText(shot?.color) ? `【调色】${asText(shot.color)}` : '',
    asText(shot?.wardrobe) ? `【服装】${asText(shot.wardrobe)}` : '',
    dialogue?.text && settings.audioEnabled
      ? `【声音】${dialogue.speaker ? `${dialogue.speaker}：` : ''}${dialogue.text}`
      : dialogue?.text ? `【声音】对白内容保留为${dialogue.speaker ? `${dialogue.speaker}：` : ''}${dialogue.text}。画面保持与动作同步。` : '',
    `【风格】${styleForPrompt(settings)} 输出画幅 ${settings.aspectRatio}，${settings.width} × ${settings.height}，${resolveCinematicDuration(shot?.duration, settings.videoModel, settings.durationPerShot)} 秒，保持真实速度与自然运动。`,
    `【锁定】${participants.map(member => `${member.name}的身份、服装和固定配件全程保持一致`).join('；') || '主体位置、动作方向和空间结构全程保持一致'}。`,
  ].filter(Boolean);
  return blocks.join('\n');
};

const normalizeGeneration = (raw, settings) => {
  const source = objectOrEmpty(raw);
  const statuses = ['pending', 'queued', 'generating', 'completed', 'failed', 'cancelled', 'submission_unknown'];
  const timestamps = Object.fromEntries(['queuedAt', 'startedAt', 'finishedAt', 'elapsedMs'].flatMap(key => {
    const value = Number(source[key]);
    return Number.isFinite(value) && value >= 0 ? [[key, value]] : [];
  }));
  return {
    provider: asText(source.provider) || getCinematicVideoModel(settings.videoModel)?.browserProvider || 'workflow',
    modelId: asText(source.modelId) || settings.videoModel,
    status: statuses.includes(source.status) ? source.status : 'pending',
    ...(Number.isFinite(Number(source.progress)) ? { progress: Number(source.progress) } : {}),
    ...(asText(source.taskId) ? { taskId: asText(source.taskId) } : {}),
    ...(asText(source.videoUrl || source.resultUrl) ? { videoUrl: asText(source.videoUrl || source.resultUrl) } : {}),
    ...(asText(source.thumbnailUrl) ? { thumbnailUrl: asText(source.thumbnailUrl) } : {}),
    ...(asText(source.error) ? { error: asText(source.error) } : {}),
    retryCount: Math.max(0, Math.round(Number(source.retryCount) || 0)),
    ...timestamps,
  };
};

const normalizeCinematicShot = (raw, index, settings, cast) => {
  const source = objectOrEmpty(raw);
  const scene = asText(source.scene || source.visual?.scene) || '真实电影场景';
  const action = asText(source.action || source.visual?.action) || '人物完成清晰连续的动作';
  const shot = {
    id: asText(source.id || source.shotId) || `shot_${String(index + 1).padStart(2, '0')}`,
    order: index + 1,
    title: asText(source.title || source.summary) || `镜头 ${index + 1}`,
    duration: resolveCinematicDuration(source.duration, settings.videoModel, settings.durationPerShot),
    scene,
    action,
    ...(normalizeDialogue(source.dialogue || source.audio?.dialogue) ? { dialogue: normalizeDialogue(source.dialogue || source.audio?.dialogue) } : {}),
    cast: normalizeShotCast(source.cast || source.characters, cast),
    camera: normalizeCamera(source.camera || source),
    ...(asText(source.space) ? { space: asText(source.space) } : {}),
    ...(asText(source.firstFrame) ? { firstFrame: asText(source.firstFrame) } : {}),
    ...(asText(source.performance) ? { performance: asText(source.performance) } : {}),
    ...(asText(source.physics) ? { physics: asText(source.physics) } : {}),
    ...(asText(source.lighting) ? { lighting: asText(source.lighting) } : {}),
    ...(asText(source.color) ? { color: asText(source.color) } : {}),
    ...(asText(source.wardrobe) ? { wardrobe: asText(source.wardrobe) } : {}),
    prompt: asText(source.prompt || source.promptDraft),
    generation: normalizeGeneration(source.generation, settings),
  };
  shot.prompt = shot.prompt || compileCinematicPrompt(shot, settings, cast);
  return {
    ...shot,
    aspectRatio: settings.aspectRatio,
    width: settings.width,
    height: settings.height,
  };
};

const outputModel = (model = {}, settings) => {
  const provider = asText(model.provider).toLowerCase();
  return {
    provider: ['gemini', 'codex', 'deepseek'].includes(provider) ? provider : 'gemini',
    modelId: asText(model.modelId) || asText(settings.modelId) || 'gemini-web',
  };
};

export const normalizeCinematicDirectorOutput = (value, {
  settings = {},
  model = {},
  cast = [],
} = {}) => {
  const source = objectOrEmpty(value);
  const normalizedSettings = normalizeCinematicSettings(settings);
  const inputCast = normalizeCinematicCast(cast);
  const rawCast = Array.isArray(source.cast) && source.cast.length > 0
    ? normalizeCinematicCast(source.cast)
    : inputCast;
  const castByKey = new Map(inputCast.flatMap(member => [[member.id, member], [member.name, member]]));
  const mergedCast = rawCast.map(member => {
    const original = castByKey.get(member.id) || castByKey.get(member.name);
    return original && member.referenceImages.length === 0
      ? { ...member, referenceImages: original.referenceImages }
      : member;
  });
  const rawShots = Array.isArray(source.shots) ? source.shots : [];
  const count = rawShots.length || normalizedSettings.shotCount;
  const shots = Array.from({ length: count }, (_, index) => normalizeCinematicShot(
    rawShots[index] || {},
    index,
    normalizedSettings,
    mergedCast,
  ));
  const global = objectOrEmpty(source.global);
  const output = {
    version: CINEMATIC_SCHEMA_VERSION,
    title: asText(source.title) || '电影短片',
    sourceType: 'script',
    model: outputModel(model || source.model, normalizedSettings),
    global: {
      platform: asText(global.platform) || normalizedSettings.platform,
      visualStyle: asText(global.visualStyle) || normalizedSettings.visualStyle,
      aspectRatio: normalizedSettings.aspectRatio,
      width: normalizedSettings.width,
      height: normalizedSettings.height,
      totalDuration: normalizedSettings.totalDuration,
      shotCount: shots.length,
      language: asText(global.language) || normalizedSettings.language,
      pace: asText(global.pace) || normalizedSettings.pace,
      videoModel: normalizedSettings.videoModel,
      audioEnabled: normalizedSettings.audioEnabled,
    },
    cast: mergedCast,
    shots,
  };
  output.global.totalDuration = shots.reduce((sum, shot) => sum + shot.duration, 0);
  return output;
};

export const validateCinematicDirectorOutput = (value, { targetTotalDuration } = {}) => {
  const errors = [];
  if (!value || typeof value !== 'object') return { valid: false, errors: ['导演输出必须是对象'] };
  if (value.version !== CINEMATIC_SCHEMA_VERSION) errors.push(`version 必须为 ${CINEMATIC_SCHEMA_VERSION}`);
  if (!asText(value.title)) errors.push('title 不能为空');
  if (value.sourceType !== 'script') errors.push('sourceType 必须为 script');
  if (!value.model || !['gemini', 'codex', 'deepseek'].includes(value.model.provider) || !asText(value.model.modelId)) {
    errors.push('model.provider/modelId 无效');
  }
  const global = value.global;
  if (!global || !CINEMATIC_ASPECT_RATIOS.includes(global.aspectRatio)) errors.push('global.aspectRatio 无效');
  if (!(Number.isInteger(global?.width) && global.width >= 256)) errors.push('global.width 必须是 >=256 的整数');
  if (!(Number.isInteger(global?.height) && global.height >= 256)) errors.push('global.height 必须是 >=256 的整数');
  if (!(Number(global?.totalDuration) > 0)) errors.push('global.totalDuration 必须大于 0');
  if (!getVideoGenerationProvider(global?.videoModel)) errors.push(`global.videoModel 无效：${global?.videoModel || ''}`);
  const model = getCinematicVideoModel(global?.videoModel);
  if (global?.audioEnabled && model && !model.supportsNativeAudio) errors.push('无原生音频的视频模型不能启用 audioEnabled');
  const castValidation = validateCinematicCast(value.cast);
  errors.push(...castValidation.errors);
  const budget = validateCinematicReferenceBudget(value.cast, global?.videoModel);
  errors.push(...budget.errors);
  const castIds = new Set((Array.isArray(value.cast) ? value.cast : []).map(member => member?.id));
  if (!Array.isArray(value.shots) || value.shots.length === 0) errors.push('shots 不能为空');
  if (Array.isArray(value.shots)) {
    const orders = new Set();
    value.shots.forEach((shot, index) => {
      if (!asText(shot?.id)) errors.push(`shots[${index}].id 不能为空`);
      if (orders.has(shot?.order)) errors.push(`shots[${index}].order 重复`);
      orders.add(shot?.order);
      if (shot?.order !== index + 1) errors.push(`shots[${index}].order 必须连续递增`);
      if (!(Number(shot?.duration) > 0)) errors.push(`shots[${index}].duration 必须大于 0`);
      if (!asText(shot?.scene)) errors.push(`shots[${index}].scene 不能为空`);
      if (!asText(shot?.action)) errors.push(`shots[${index}].action 不能为空`);
      if (!CINEMATIC_FOVS.includes(shot?.camera?.fov)) errors.push(`shots[${index}].camera.fov 无效`);
      if (!Array.isArray(shot?.cast)) errors.push(`shots[${index}].cast 必须是数组`);
      shot?.cast?.forEach((id, castIndex) => {
        if (!castIds.has(id)) errors.push(`shots[${index}].cast[${castIndex}] 未映射到角色表`);
      });
      if (!(Number.isInteger(shot?.width) && shot.width >= 256)) errors.push(`shots[${index}].width 无效`);
      if (!(Number.isInteger(shot?.height) && shot.height >= 256)) errors.push(`shots[${index}].height 无效`);
      if (!asText(shot?.prompt)) errors.push(`shots[${index}].prompt 不能为空`);
      if (!shot?.generation || !asText(shot.generation.modelId)) errors.push(`shots[${index}].generation.modelId 无效`);
      if (!['pending', 'queued', 'generating', 'completed', 'failed', 'cancelled', 'submission_unknown'].includes(shot?.generation?.status)) {
        errors.push(`shots[${index}].generation.status 无效`);
      }
    });
    if (global?.shotCount !== value.shots.length) errors.push('global.shotCount 必须等于 shots.length');
    if (Number(targetTotalDuration) > 0) {
      const actual = value.shots.reduce((sum, shot) => sum + (Number(shot?.duration) || 0), 0);
      const target = Number(targetTotalDuration);
      // AI 按剧情自动分配镜头时长：允许 ±20% 浮动，避免模型因严格的精确匹配反复修复。
      const tolerance = target * 0.2;
      if (Math.abs(actual - target) > tolerance) {
        errors.push(`镜头总时长 ${actual}s 与目标 ${target}s 偏差超过 20%`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
};

export const mergeCinematicShotsPreservingGeneration = (previousShots = [], nextShots = []) => {
  const previous = Array.isArray(previousShots) ? previousShots : [];
  const next = Array.isArray(nextShots) ? nextShots : [];
  const byId = new Map(previous.map(shot => [asText(shot?.id), shot]).filter(([id]) => id));
  return next.map(shot => {
    const prior = byId.get(asText(shot?.id));
    const sameContent = prior && asText(prior.prompt) === asText(shot?.prompt);
    const hasResult = prior?.generation
      && (asText(prior.generation.videoUrl) || prior.generation.status === 'completed');
    return sameContent && hasResult
      ? { ...shot, generation: { ...shot.generation, ...prior.generation } }
      : shot;
  });
};

export const rollupCinematicGenerationStatus = (shots = []) => {
  const list = Array.isArray(shots) ? shots : [];
  const total = list.length;
  const statusOf = shot => shot?.generation?.status || 'pending';
  const completed = list.filter(shot => statusOf(shot) === 'completed').length;
  const failed = list.filter(shot => statusOf(shot) === 'failed').length;
  const active = list.some(shot => ['queued', 'generating'].includes(statusOf(shot)));
  const unknown = list.some(shot => statusOf(shot) === 'submission_unknown');
  let batchStatus;
  if (total === 0) batchStatus = 'idle';
  else if (active) batchStatus = 'running';
  else if (unknown) batchStatus = 'recovery_required';
  else if (completed === total) batchStatus = 'completed';
  else if (failed > 0 && completed > 0) batchStatus = 'partial_failed';
  else if (failed > 0) batchStatus = 'failed';
  else batchStatus = 'ready';
  return {
    total,
    completed,
    failed,
    batchStatus,
    storyboardStatus: batchStatus === 'completed' ? 'completed'
      : batchStatus === 'failed' ? 'failed'
        : batchStatus === 'running' ? 'generating'
          : batchStatus === 'recovery_required' ? 'recovery_required'
            : 'ready',
  };
};

const stripJsonFence = value => asText(value)
  .replace(/^```(?:json)?\s*/i, '')
  .replace(/\s*```$/i, '')
  .trim();

export const parseCinematicDirectorJson = value => {
  const text = stripJsonFence(value);
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error('电影导演模型没有返回有效 JSON');
  }
};

export const buildCinematicReferenceBundle = (cast, { maxReferenceImages } = {}) => {
  const normalized = normalizeCinematicCast(cast);
  const references = normalized.flatMap(member => member.referenceImages.map(image => ({
    url: image.url,
    label: member.name,
    castId: member.id,
    source: image.source,
    imageId: image.id,
  })));
  const limit = Number(maxReferenceImages);
  if (Number.isFinite(limit) && limit > 0 && references.length > limit) {
    throw new Error(`角色参考图共 ${references.length} 张，超过当前视频模型的 ${limit} 张上限`);
  }
  return {
    referenceImages: references.map(item => item.url),
    referenceImageLabels: references.map(item => item.label),
    references,
  };
};

export const buildCinematicVideoRequest = ({ workflowId, nodeId, shot, cast, settings } = {}) => {
  const normalizedSettings = normalizeCinematicSettings(settings);
  const model = getCinematicVideoModel(normalizedSettings.videoModel);
  const bundle = buildCinematicReferenceBundle(cast, { maxReferenceImages: model?.maxReferenceImages });
  return {
    workflowId,
    nodeId,
    prompt: asText(shot?.prompt) || compileCinematicPrompt(shot, normalizedSettings, cast),
    referenceImages: bundle.referenceImages,
    referenceImageLabels: bundle.referenceImageLabels,
    aspectRatio: normalizedSettings.aspectRatio,
    resolution: normalizedSettings.videoResolution,
    duration: resolveCinematicDuration(shot?.duration, normalizedSettings.videoModel, normalizedSettings.durationPerShot),
    videoModel: normalizedSettings.videoModel,
    generateAudio: normalizedSettings.audioEnabled,
  };
};

export const buildCinematicMergeManifest = ({
  workflowId,
  title = '电影短片成片',
  shots = [],
  width = 1080,
  height = 1920,
  fps = 30,
  skipFailed = true,
} = {}) => {
  const selected = (Array.isArray(shots) ? shots : [])
    .filter(shot => shot && typeof shot.videoUrl === 'string' && shot.videoUrl.trim())
    .filter(shot => !skipFailed || shot.status === 'completed' || !shot.status)
    .sort((left, right) => Number(left.order || 0) - Number(right.order || 0))
    .map((shot, index) => ({
      id: String(shot.id || `shot_${index + 1}`),
      name: String(shot.title || shot.id || `镜头 ${index + 1}`),
      file: shot.videoUrl,
      start: 0,
      end: Math.max(0.1, Number(shot.duration) || 5),
      // 电影镜头本身已经由视频模型生成原生音频；拼接时默认继承，
      // 只有调用方明确传入 0 才静音。
      volume: Number.isFinite(Number(shot.volume))
        ? Math.max(0, Math.min(1, Number(shot.volume)))
        : 1,
      order: index + 1,
      transition: shot.transition === 'fade' ? 'fade' : 'hard_cut',
    }));
  if (selected.length === 0) throw new Error('没有可拼接的已完成镜头');
  return {
    project: { id: String(workflowId || 'cinematic-project'), title: String(title || '电影短片成片') },
    composition: {
      width: Math.max(256, Math.round(Number(width) || 1080)),
      height: Math.max(256, Math.round(Number(height) || 1920)),
      fps: Math.max(1, Math.round(Number(fps) || 30)),
    },
    shots: selected,
    audioTracks: [],
    output: { endFadeToBlack: 0.6 },
  };
};
