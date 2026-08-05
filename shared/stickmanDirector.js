/**
 * Shared primitives for the internal Stickman Video Director skill.
 *
 * This module is intentionally free of fs, browser and provider dependencies so
 * the backend, React canvas and tests all validate the same contract.
 */

export const STICKMAN_SCHEMA_VERSION = '1.0';

export const STICKMAN_ASPECT_RATIOS = Object.freeze(['9:16', '16:9', '1:1', '4:5', '3:4']);

export const STICKMAN_RESOLUTION_PRESETS = Object.freeze({
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

export const STICKMAN_VISUAL_THEMES = Object.freeze([
  { id: 'white-black', label: '白底黑色火柴人', background: '纯白', stickman: '黑色', accent: '红色' },
  { id: 'black-white', label: '黑底白色火柴人', background: '纯黑', stickman: '白色', accent: '红色' },
  { id: 'paper', label: '米白纸张风', background: '米白纸张纹理', stickman: '深灰', accent: '赭红' },
  { id: 'dark-minimal', label: '深色极简风', background: '深灰黑', stickman: '白色', accent: '暖黄' },
  { id: 'custom', label: '自定义', background: '由用户指定', stickman: '由用户指定', accent: '由用户指定' },
]);

export const STICKMAN_PACES = Object.freeze(['舒缓', '标准', '快节奏', '强节奏', '自动']);

export const STICKMAN_PLATFORMS = Object.freeze([
  '抖音', 'TikTok', 'YouTube Shorts', 'Instagram Reels', '小红书', 'YouTube', 'B站', '自定义'
]);

const DEFAULT_SETTINGS = Object.freeze({
  platform: '抖音',
  visualTheme: 'white-black',
  aspectRatio: '9:16',
  width: 1080,
  height: 1920,
  totalDuration: 48,
  shotCount: 6,
  durationPerShot: 8,
  language: 'zh-CN',
  promptLanguage: 'zh-CN',
  pace: '标准',
  dialogueLanguage: '中文',
  voiceGender: '不指定',
  voiceStyle: '自然、清晰、与情绪匹配',
  includeDialogue: true,
  includeVoiceover: true,
  includeAmbience: true,
  includeSfx: true,
  includeMusic: true,
  nativeAudio: true,
  preserveReferenceStructure: true,
  allowDirectorOptimization: true,
});

const asText = value => String(value ?? '').trim();
const asPositiveNumber = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};
const asPositiveInteger = (value, fallback) => Math.max(1, Math.round(asPositiveNumber(value, fallback)));

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

export const nearestStickmanAspectRatio = (width, height, fallback = '9:16') => {
  const w = Number(width);
  const h = Number(height);
  if (!(w > 0 && h > 0)) return STICKMAN_ASPECT_RATIOS.includes(fallback) ? fallback : '9:16';
  return STICKMAN_ASPECT_RATIOS.reduce((best, candidate) => (
    ratioDistance(`${w}:${h}`, candidate) < ratioDistance(`${w}:${h}`, best) ? candidate : best
  ), STICKMAN_ASPECT_RATIOS[0]);
};

/**
 * Return an exact preset or the closest supported preset. Custom dimensions
 * remain allowed when no preset is requested; the backend performs the final
 * capability validation before a generation request.
 */
export const resolveStickmanResolution = (aspectRatio, width, height) => {
  const ratio = STICKMAN_ASPECT_RATIOS.includes(aspectRatio) ? aspectRatio : '9:16';
  const presets = STICKMAN_RESOLUTION_PRESETS[ratio] || [];
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
  const targetRatio = requestedWidth / requestedHeight;
  const closest = presets.reduce((best, item) => {
    const bestScore = Math.abs(best.width / best.height - targetRatio) + Math.abs(best.width - requestedWidth) / 100000;
    const score = Math.abs(item.width / item.height - targetRatio) + Math.abs(item.width - requestedWidth) / 100000;
    return score < bestScore ? item : best;
  }, presets[0]);
  return { ...closest, aspectRatio: ratio, custom: false, mappedFrom: { width: requestedWidth, height: requestedHeight } };
};

export const normalizeStickmanSettings = (input = {}) => {
  const source = input && typeof input === 'object' ? input : {};
  const aspectRatio = STICKMAN_ASPECT_RATIOS.includes(source.aspectRatio)
    ? source.aspectRatio
    : nearestStickmanAspectRatio(source.width, source.height, DEFAULT_SETTINGS.aspectRatio);
  const resolution = resolveStickmanResolution(aspectRatio, source.width, source.height);
  const shotCount = Math.min(30, asPositiveInteger(source.shotCount, DEFAULT_SETTINGS.shotCount));
  const totalDuration = Math.min(600, asPositiveNumber(source.totalDuration, DEFAULT_SETTINGS.totalDuration));
  const durationPerShot = Math.min(60, asPositiveNumber(
    source.durationPerShot,
    totalDuration / shotCount || DEFAULT_SETTINGS.durationPerShot,
  ));
  const visualTheme = STICKMAN_VISUAL_THEMES.some(item => item.id === source.visualTheme)
    ? source.visualTheme
    : DEFAULT_SETTINGS.visualTheme;
  return {
    ...DEFAULT_SETTINGS,
    ...source,
    platform: asText(source.platform) || DEFAULT_SETTINGS.platform,
    visualTheme,
    aspectRatio,
    width: resolution.width,
    height: resolution.height,
    totalDuration,
    shotCount,
    durationPerShot,
    language: asText(source.language) || DEFAULT_SETTINGS.language,
    promptLanguage: asText(source.promptLanguage) || DEFAULT_SETTINGS.promptLanguage,
    pace: STICKMAN_PACES.includes(source.pace) ? source.pace : DEFAULT_SETTINGS.pace,
  };
};

export const resolveDirectorModel = ({ provider = 'auto', sourceType = 'script', hasVideo = false } = {}) => {
  const normalized = asText(provider).toLowerCase();
  if (normalized === 'deepseek') return { provider: 'deepseek', providerId: 'deepseek' };
  if (normalized === 'codex' || normalized === 'codex-cli') return { provider: 'codex', providerId: 'codex-cli' };
  if (normalized === 'gemini' || normalized === 'gemini-web') return { provider: 'gemini', providerId: 'gemini-web' };
  if (sourceType === 'reference_video' || hasVideo) return { provider: 'gemini', providerId: 'gemini-web' };
  return { provider: 'gemini', providerId: 'gemini-web' };
};

const themeFor = visualTheme => STICKMAN_VISUAL_THEMES.find(item => item.id === visualTheme)
  || STICKMAN_VISUAL_THEMES[0];

const audioText = (audio = {}, settings) => {
  const lines = [];
  if (settings.includeDialogue && audio.dialogue?.text) {
    const dialogue = audio.dialogue;
    lines.push(`${settings.dialogueLanguage || '中文'}对白${dialogue.speaker ? `（${dialogue.speaker}）` : ''}：“${dialogue.text}”`);
    const gender = settings.voiceGender && settings.voiceGender !== '不指定' ? `${settings.voiceGender}、` : '';
    lines.push(`使用${gender}${dialogue.voice || settings.voiceStyle || '自然'}声音，情绪为${dialogue.emotion || '符合镜头情绪'}。`);
  }
  if (settings.includeVoiceover && audio.voiceover?.text) lines.push(`旁白：“${audio.voiceover.text}”`);
  if (settings.includeAmbience && Array.isArray(audio.ambience) && audio.ambience.length) lines.push(`环境音：${audio.ambience.join('、')}`);
  if (settings.includeSfx && Array.isArray(audio.sfx) && audio.sfx.length) lines.push(`动作音效：${audio.sfx.join('、')}`);
  if (settings.includeMusic && audio.music) lines.push(`背景音乐：${audio.music}`);
  return lines.join('\n');
};

/** Compile an independent, complete prompt for one Flow shot. */
export const compileFlowPrompt = (shot, global = {}) => {
  const settings = normalizeStickmanSettings(global);
  const theme = themeFor(settings.visualTheme);
  const visual = shot?.visual || {};
  const english = settings.promptLanguage === 'en-US' || settings.promptLanguage === 'en';
  if (english) {
    return [
      `Minimal stickman animation. ${theme.background} background, ${theme.stickman} stickman, and ${theme.accent} as the only accent color. Keep character proportions, line weight, and visual style consistent across the film.`,
      `Scene: ${asText(visual.scene) || 'a clean minimal scene'}.`,
      `Action: ${asText(visual.action) || 'the character performs a clear continuous action'}.${visual.emotion ? ` Emotion: ${visual.emotion}.` : ''}`,
      [visual.composition && `Composition: ${visual.composition}`, visual.shotType && `Shot type: ${visual.shotType}`, visual.cameraAngle && `Camera angle: ${visual.cameraAngle}`, visual.cameraMotion && `Camera movement: ${visual.cameraMotion}`]
        .filter(Boolean).join('; '),
      audioText(shot?.audio, settings),
      `Continuity: ${settings.preserveReferenceStructure ? 'preserve character identity, scene, action direction, and shot order; this prompt must run independently.' : 'preserve continuity within this shot.'}`,
      `Output: ${settings.aspectRatio}, ${settings.width} × ${settings.height}, ${asPositiveNumber(shot?.duration, settings.durationPerShot)} seconds.`,
      'Negative: photorealistic humans, complex realistic objects, extra text, subtitles, watermarks, brand marks, unrelated characters, color clutter, or sudden changes to character proportions.',
    ].filter(block => asText(block)).join('\n\n');
  }
  const blocks = [
    `极简火柴人动画。${theme.background}背景，${theme.stickman}火柴人，${theme.accent}作为唯一强调色。保持人物身体比例、线条粗细和视觉风格在全片一致。`,
    `场景：${asText(visual.scene) || '简洁、可读的极简场景'}。`,
    `动作：${asText(visual.action) || '角色完成清晰、连续、可观察的动作'}。${visual.emotion ? `情绪：${visual.emotion}。` : ''}`,
    [visual.composition, visual.shotType && `景别：${visual.shotType}`, visual.cameraAngle && `镜头角度：${visual.cameraAngle}`, visual.cameraMotion && `运镜：${visual.cameraMotion}`]
      .filter(Boolean).join('；'),
    audioText(shot?.audio, settings),
    `连续性：${settings.preserveReferenceStructure ? '保持角色、场景、动作方向和镜头顺序连续；本镜头提示词必须独立可执行。' : '保持本镜头内部动作和风格连续。'}`,
    `输出：${settings.aspectRatio}，${settings.width} × ${settings.height}，${asPositiveNumber(shot?.duration, settings.durationPerShot)} 秒。`,
    '禁止：写实真人、复杂写实物件、额外文字、字幕、水印、品牌标识、无关角色、颜色泛滥、突然改变角色比例。',
  ].filter(block => asText(block));
  return blocks.join('\n\n');
};

const normalizeDialogue = value => {
  if (!value) return undefined;
  if (typeof value === 'string') return { text: value };
  if (typeof value !== 'object') return undefined;
  const text = asText(value.text);
  return text ? {
    text,
    ...(asText(value.speaker) ? { speaker: asText(value.speaker) } : {}),
    ...(asText(value.voice) ? { voice: asText(value.voice) } : {}),
    ...(asText(value.emotion) ? { emotion: asText(value.emotion) } : {}),
  } : undefined;
};

const normalizeVoiceover = value => {
  if (!value) return undefined;
  if (typeof value === 'string') return { text: value };
  if (typeof value !== 'object') return undefined;
  const text = asText(value.text);
  return text ? {
    text,
    ...(asText(value.voice) ? { voice: asText(value.voice) } : {}),
    ...(asText(value.emotion) ? { emotion: asText(value.emotion) } : {}),
  } : undefined;
};

const normalizeShot = (raw, index, settings, sourceShots = []) => {
  const source = raw && typeof raw === 'object' ? raw : {};
  const sourceShot = sourceShots.find(item => item?.id === source.sourceShotId || item?.shotId === source.sourceShotId)
    || sourceShots[index];
  const duration = asPositiveNumber(source.duration, asPositiveNumber(sourceShot?.duration, settings.durationPerShot));
  const visual = source.visual && typeof source.visual === 'object' ? source.visual : {};
  const audio = source.audio && typeof source.audio === 'object' ? source.audio : {};
  const shot = {
    id: asText(source.id) || `shot_${String(index + 1).padStart(2, '0')}`,
    order: index + 1,
    title: asText(source.title) || asText(source.summary) || `镜头 ${index + 1}`,
    ...(asText(source.sourceShotId || sourceShot?.id || sourceShot?.shotId) ? { sourceShotId: asText(source.sourceShotId || sourceShot?.id || sourceShot?.shotId) } : {}),
    ...(Number.isFinite(Number(source.sourceStartTime ?? sourceShot?.startTime ?? sourceShot?.start)) ? { sourceStartTime: Number(source.sourceStartTime ?? sourceShot?.startTime ?? sourceShot?.start) } : {}),
    ...(Number.isFinite(Number(source.sourceEndTime ?? sourceShot?.endTime ?? sourceShot?.end)) ? { sourceEndTime: Number(source.sourceEndTime ?? sourceShot?.endTime ?? sourceShot?.end) } : {}),
    ...(asText(source.sourceKeyframeUrl || sourceShot?.sourceKeyframeUrl) ? { sourceKeyframeUrl: asText(source.sourceKeyframeUrl || sourceShot?.sourceKeyframeUrl) } : {}),
    duration,
    aspectRatio: settings.aspectRatio,
    width: settings.width,
    height: settings.height,
    visual: {
      scene: asText(visual.scene || source.scene || sourceShot?.summary) || '简洁极简场景',
      action: asText(visual.action || source.action || sourceShot?.videoPrompt) || '角色完成清晰连续的动作',
      ...(asText(visual.emotion || source.emotion) ? { emotion: asText(visual.emotion || source.emotion) } : {}),
      ...(asText(visual.composition) ? { composition: asText(visual.composition) } : {}),
      ...(asText(visual.shotType) ? { shotType: asText(visual.shotType) } : {}),
      ...(asText(visual.cameraAngle) ? { cameraAngle: asText(visual.cameraAngle) } : {}),
      ...(asText(visual.cameraMotion) ? { cameraMotion: asText(visual.cameraMotion) } : {}),
      ...(asText(visual.transition) ? { transition: asText(visual.transition) } : {}),
    },
    audio: {
      ...(normalizeDialogue(audio.dialogue || source.dialogue || sourceShot?.dialogue) ? { dialogue: normalizeDialogue(audio.dialogue || source.dialogue || sourceShot?.dialogue) } : {}),
      ...(normalizeVoiceover(audio.voiceover || source.voiceover || sourceShot?.voiceover) ? { voiceover: normalizeVoiceover(audio.voiceover || source.voiceover || sourceShot?.voiceover) } : {}),
      ambience: Array.isArray(audio.ambience) ? audio.ambience.map(asText).filter(Boolean) : (asText(sourceShot?.soundPrompt) ? [asText(sourceShot.soundPrompt)] : []),
      sfx: Array.isArray(audio.sfx) ? audio.sfx.map(asText).filter(Boolean) : [],
      ...(asText(audio.music) ? { music: asText(audio.music) } : {}),
    },
    prompt: asText(source.prompt || source.flowPrompt || source.promptDraft),
    generation: {
      provider: 'flow',
      ...(asText(source.generation?.modelId || source.videoModel) ? { modelId: asText(source.generation?.modelId || source.videoModel) } : {}),
      status: ['pending', 'queued', 'generating', 'completed', 'failed', 'cancelled'].includes(source.generation?.status)
        ? source.generation.status
        : 'pending',
      ...(Number.isFinite(Number(source.generation?.progress)) ? { progress: Number(source.generation.progress) } : {}),
      ...(asText(source.generation?.taskId) ? { taskId: asText(source.generation.taskId) } : {}),
      ...(asText(source.generation?.videoUrl) ? { videoUrl: asText(source.generation.videoUrl) } : {}),
      ...(asText(source.generation?.thumbnailUrl) ? { thumbnailUrl: asText(source.generation.thumbnailUrl) } : {}),
      ...(asText(source.generation?.error) ? { error: asText(source.generation.error) } : {}),
      retryCount: Math.max(0, Math.round(Number(source.generation?.retryCount) || 0)),
    },
  };
  shot.prompt = shot.prompt || compileFlowPrompt(shot, settings);
  return shot;
};

export const normalizeStickmanDirectorOutput = (value, {
  sourceType = 'script',
  settings = {},
  model = {},
  sourceShots = [],
} = {}) => {
  const normalizedSettings = normalizeStickmanSettings(settings);
  const source = value && typeof value === 'object' ? value : {};
  const rawShots = Array.isArray(source.shots) ? source.shots : [];
  const count = sourceType === 'reference_video'
    ? Math.max(rawShots.length, sourceShots.length, 1)
    : (rawShots.length || normalizedSettings.shotCount);
  const shots = Array.from({ length: count }, (_, index) => normalizeShot(
    rawShots[index] || sourceShots[index] || {},
    index,
    normalizedSettings,
    sourceShots,
  ));
  const global = source.global && typeof source.global === 'object' ? source.global : {};
  const output = {
    version: STICKMAN_SCHEMA_VERSION,
    title: asText(source.title) || '火柴人视频',
    sourceType: sourceType === 'reference_video' ? 'reference_video' : 'script',
    model: {
      provider: model.provider === 'deepseek' || source.model?.provider === 'deepseek'
        ? 'deepseek'
        : model.provider === 'codex' || source.model?.provider === 'codex'
          ? 'codex'
          : 'gemini',
      modelId: asText(model.modelId || source.model?.modelId) || (
        model.provider === 'deepseek' || source.model?.provider === 'deepseek'
          ? 'deepseek-v4-flash'
          : model.provider === 'codex' || source.model?.provider === 'codex'
            ? 'codex-cli'
            : 'gemini-web'
      ),
    },
    global: {
      platform: asText(global.platform) || normalizedSettings.platform,
      visualTheme: asText(global.visualTheme) || normalizedSettings.visualTheme,
      aspectRatio: normalizedSettings.aspectRatio,
      width: normalizedSettings.width,
      height: normalizedSettings.height,
      totalDuration: normalizedSettings.totalDuration,
      shotCount: shots.length,
      language: asText(global.language) || normalizedSettings.language,
      pace: asText(global.pace) || normalizedSettings.pace,
      audioEnabled: global.audioEnabled !== false && normalizedSettings.nativeAudio !== false,
    },
    shots,
  };
  output.global.totalDuration = shots.reduce((sum, shot) => sum + shot.duration, 0);
  return output;
};

export const validateStickmanDirectorOutput = value => {
  const errors = [];
  if (!value || typeof value !== 'object') return { valid: false, errors: ['导演输出必须是对象'] };
  if (value.version !== STICKMAN_SCHEMA_VERSION) errors.push(`version 必须为 ${STICKMAN_SCHEMA_VERSION}`);
  if (!asText(value.title)) errors.push('title 不能为空');
  if (!['script', 'reference_video'].includes(value.sourceType)) errors.push('sourceType 非法');
  if (!value.model || !['gemini', 'codex', 'deepseek'].includes(value.model.provider) || !asText(value.model.modelId)) errors.push('model.provider/modelId 无效');
  const global = value.global;
  if (!global || !STICKMAN_ASPECT_RATIOS.includes(global.aspectRatio)) errors.push('global.aspectRatio 无效');
  if (!(Number.isInteger(global?.width) && global.width >= 256)) errors.push('global.width 必须是 >=256 的整数');
  if (!(Number.isInteger(global?.height) && global.height >= 256)) errors.push('global.height 必须是 >=256 的整数');
  if (!(Number(global?.totalDuration) > 0)) errors.push('global.totalDuration 必须大于 0');
  if (!Array.isArray(value.shots) || value.shots.length === 0) errors.push('shots 不能为空');
  if (Array.isArray(value.shots)) {
    const orders = new Set();
    value.shots.forEach((shot, index) => {
      if (!asText(shot?.id)) errors.push(`shots[${index}].id 不能为空`);
      if (orders.has(shot?.order)) errors.push(`shots[${index}].order 重复`);
      orders.add(shot?.order);
      if (shot?.order !== index + 1) errors.push(`shots[${index}].order 必须连续递增`);
      if (!(Number(shot?.duration) > 0)) errors.push(`shots[${index}].duration 必须大于 0`);
      if (!(Number.isInteger(shot?.width) && shot.width >= 256)) errors.push(`shots[${index}].width 无效`);
      if (!(Number.isInteger(shot?.height) && shot.height >= 256)) errors.push(`shots[${index}].height 无效`);
      if (!asText(shot?.prompt)) errors.push(`shots[${index}].prompt 不能为空`);
      if (!shot?.generation || shot.generation.provider !== 'flow') errors.push(`shots[${index}].generation.provider 必须为 flow`);
      if (!['pending', 'queued', 'generating', 'completed', 'failed', 'cancelled'].includes(shot?.generation?.status)) errors.push(`shots[${index}].generation.status 无效`);
    });
    if (global?.shotCount !== value.shots.length) errors.push('global.shotCount 必须等于 shots.length');
  }
  if (value.sourceType === 'reference_video') {
    value.shots?.forEach((shot, index) => {
      if (!asText(shot?.sourceShotId)) errors.push(`reference_video 的 shots[${index}] 缺少 sourceShotId`);
    });
  }
  return { valid: errors.length === 0, errors };
};

/**
 * Merge freshly planned shots with the previous storyboard, preserving the
 * generation result (video URL + status) of any shot whose id AND prompt are
 * unchanged. Re-planning ("重新规划分镜") must never silently orphan a Flow
 * video that already cost money, but it also must not attach an old video to a
 * shot whose content changed: normalizeShot reuses synthetic ids (shot_01,
 * shot_02, …) across unrelated re-plans, so id alone is not a safe key.
 */
export const mergeStickmanShotsPreservingGeneration = (previousShots = [], nextShots = []) => {
  const previous = Array.isArray(previousShots) ? previousShots : [];
  const next = Array.isArray(nextShots) ? nextShots : [];
  const byId = new Map();
  previous.forEach(shot => {
    const id = asText(shot?.id);
    if (id) byId.set(id, shot);
  });
  return next.map(shot => {
    const prior = byId.get(asText(shot?.id));
    const sameContent = prior && asText(prior.prompt) === asText(shot?.prompt);
    const priorGeneration = prior?.generation;
    const hasResult = priorGeneration
      && (asText(priorGeneration.videoUrl) || priorGeneration.status === 'completed');
    if (sameContent && hasResult) {
      return { ...shot, generation: { ...shot.generation, ...priorGeneration } };
    }
    return shot;
  });
};

/**
 * Roll a storyboard's overall status up from the full shot list. A batch run
 * only touches a subset of shots, so the summary must reflect every shot's
 * generation state — not just the shots that ran this round — otherwise a
 * single-shot regenerate falsely reports "全部完成".
 */
export const rollupStickmanGenerationStatus = (shots = []) => {
  const list = Array.isArray(shots) ? shots : [];
  const total = list.length;
  const statusOf = shot => shot?.generation?.status || 'pending';
  const completed = list.filter(shot => statusOf(shot) === 'completed').length;
  const failed = list.filter(shot => statusOf(shot) === 'failed').length;
  const active = list.some(shot => ['generating', 'queued'].includes(statusOf(shot)));
  let batchStatus;
  if (total === 0) batchStatus = 'idle';
  else if (active) batchStatus = 'running';
  else if (completed === total) batchStatus = 'completed';
  else if (failed > 0 && completed > 0) batchStatus = 'partial_failed';
  else if (failed > 0) batchStatus = 'failed';
  else batchStatus = 'ready';
  const storyboardStatus = batchStatus === 'completed' ? 'completed'
    : batchStatus === 'failed' ? 'failed'
      : batchStatus === 'running' ? 'generating'
        : 'ready';
  return { total, completed, failed, batchStatus, storyboardStatus };
};

const stripJsonFence = value => asText(value)
  .replace(/^```(?:json)?\s*/i, '')
  .replace(/\s*```$/i, '')
  .trim();

export const parseStickmanDirectorJson = value => {
  const text = stripJsonFence(value);
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error('导演模型没有返回有效 JSON');
  }
};

const formatScriptTime = seconds => {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  const remainder = value - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`;
};

/**
 * Convert the shared video-analysis result into a script draft. This is an
 * intermediate contract on purpose: the Stickman Director Skill must receive
 * a script and make its own shot decisions instead of inheriting analysis
 * shots as the final storyboard.
 */
export const createStickmanScriptFromAnalysis = (analysis, { settings = {}, title } = {}) => {
  const source = analysis && typeof analysis === 'object' ? analysis : {};
  const sourceShots = Array.isArray(source.shots) ? source.shots : [];
  const global = source.global && typeof source.global === 'object' ? source.global : {};
  const normalizedSettings = normalizeStickmanSettings(settings);

  const entityLines = [
    global.characterConsistency && `人物一致性：${global.characterConsistency}`,
    global.sceneConsistency && `场景一致性：${global.sceneConsistency}`,
    global.productRequirements && `道具与产品要求：${global.productRequirements}`,
  ].filter(Boolean);
  const timeline = sourceShots.map((shot, index) => {
    const start = shot?.startTime ?? shot?.start;
    const end = shot?.endTime ?? shot?.end;
    const timeRange = Number.isFinite(Number(start)) || Number.isFinite(Number(end))
      ? `（${formatScriptTime(start)}-${formatScriptTime(end)}）`
      : '';
    return [
      `剧情段落 ${index + 1}${timeRange}`,
      `剧情：${asText(shot?.summary) || '根据参考视频还原本段剧情'}`,
      asText(shot?.imagePrompt) && `画面信息：${asText(shot.imagePrompt)}`,
      asText(shot?.videoPrompt) && `动作信息：${asText(shot.videoPrompt)}`,
      asText(shot?.dialogue) && `对白：${asText(shot.dialogue)}`,
      asText(shot?.soundPrompt) && `声音：${asText(shot.soundPrompt)}`,
    ].filter(Boolean).join('\n');
  });

  const content = [
    '【参考视频分析生成的剧本草案】',
    '以下内容是参考视频的剧情、动作和声音信息，不是最终分镜。请火柴人视频导演 Skill 重新判断镜头数量、镜头边界、景别、构图、运镜和火柴人表现方式。',
    global.story && `故事概述：${asText(global.story)}`,
    global.visualStyle && `原视频视觉风格：${asText(global.visualStyle)}`,
    ...entityLines,
    timeline.length > 0 ? `\n【剧情与动作段落】\n${timeline.join('\n\n')}` : '【剧情与动作段落】\n未识别到可用段落，请根据原视频信息补全。',
  ].filter(Boolean).join('\n\n');

  return {
    title: asText(title) || asText(source.title) || '参考视频分析剧本',
    content,
    notes: '来源：参考视频分析。分析段落仅作为剧本素材，最终分镜由火柴人视频导演 Skill 重新推导。',
    platform: normalizedSettings.platform,
  };
};
