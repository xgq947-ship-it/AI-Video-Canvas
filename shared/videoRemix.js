/**
 * Video Remix shared state.
 *
 * This file deliberately contains only serializable data and pure helpers so
 * the same state can be stored in project.json, rendered by React, and
 * validated by server-side tests without importing browser code.
 */

export const VIDEO_REMIX_SCHEMA_VERSION = 1;

export const VIDEO_REMIX_STAGES = Object.freeze([
  'source',
  'preprocessing',
  'shots_ready',
  'analyzing',
  'analysis_partial',
  'analysis_ready',
  'assets_ready',
  'keyframes_generating',
  'keyframes_ready',
  'videos_generating',
  'videos_ready',
  'rendering',
  'completed',
  'error',
]);

export const VIDEO_REMIX_WORKSPACE_TABS = Object.freeze([
  { id: 'source', label: '源视频' },
  { id: 'analysis', label: '分析' },
  { id: 'assets', label: '资产' },
  { id: 'shots', label: '镜头' },
  { id: 'keyframes', label: '关键帧' },
  { id: 'videos', label: '视频' },
  { id: 'final', label: '成片' },
]);

export const HIGH_FIDELITY_LOCKS = Object.freeze({
  story: true,
  motion: true,
  composition: true,
  camera: true,
  duration: true,
  characters: false,
  scenes: false,
  props: false,
  style: false,
});

const DEFAULT_ANALYSIS_RUN = Object.freeze({
  mode: 'fast',
  globalStatus: 'idle',
  completedShots: 0,
  totalShots: 0,
});

const DEFAULT_ASSET_REVIEW = Object.freeze({
  confirmed: false,
});

const DEFAULT_PROMPT_REVIEW = Object.freeze({
  confirmed: false,
});

const TAB_BY_STAGE = Object.freeze({
  source: 'source',
  preprocessing: 'source',
  shots_ready: 'shots',
  analyzing: 'analysis',
  analysis_partial: 'analysis',
  analysis_ready: 'analysis',
  assets_ready: 'assets',
  keyframes_generating: 'keyframes',
  keyframes_ready: 'keyframes',
  videos_generating: 'videos',
  videos_ready: 'videos',
  rendering: 'final',
  completed: 'final',
  error: 'source',
});

export const SHOT_ANALYSIS_FRAME_POSITIONS = Object.freeze([
  'start',
  'quarter',
  'middle',
  'three_quarter',
  'end',
]);

const roundShotTime = value => Math.round(Number(value) * 1000) / 1000;

const emptyEditableField = () => ({
  value: '',
  source: 'ai',
  confidence: 0,
  locked: false,
});

export function createVideoRemixShot({
  shotId,
  start,
  end,
  detectionSource = 'manual',
  detectionScore,
  analysisFrames = [],
}) {
  const normalizedStart = roundShotTime(Math.max(0, Number(start) || 0));
  const normalizedEnd = roundShotTime(Math.max(normalizedStart, Number(end) || 0));
  return {
    shotId: String(shotId),
    start: normalizedStart,
    end: normalizedEnd,
    duration: roundShotTime(normalizedEnd - normalizedStart),
    storyBeat: emptyEditableField(),
    characters: [],
    scene: {},
    props: [],
    frameBlueprint: {
      shotSize: emptyEditableField(),
      cameraAngle: emptyEditableField(),
      subjects: [],
      props: [],
    },
    motionBlueprint: {
      subjects: [],
      propInteractions: [],
    },
    cameraBlueprint: {
      shotSize: emptyEditableField(),
      angle: emptyEditableField(),
      movement: [],
    },
    timingBlueprint: {
      phases: [],
    },
    audioBlueprint: {
      dialogue: [],
      environment: emptyEditableField(),
      soundEvents: [],
    },
    motionComplexity: 'medium',
    transition: 'hard_cut',
    analysisFrames,
    detection: {
      source: detectionSource,
      ...(Number.isFinite(Number(detectionScore))
        ? { score: Number(detectionScore) }
        : {}),
    },
  };
}

export function normalizeVideoRemixCutPoints(duration, cutPoints = [], {
  minShotDuration = 0.35,
} = {}) {
  const safeDuration = roundShotTime(Number(duration));
  if (!(safeDuration > 0)) return [];
  const minimum = Math.max(0.05, Number(minShotDuration) || 0.35);
  const candidates = [
    0,
    ...cutPoints,
    safeDuration,
  ]
    .map(Number)
    .filter(Number.isFinite)
    .map(value => roundShotTime(Math.min(safeDuration, Math.max(0, value))))
    .sort((left, right) => left - right);

  const normalized = [0];
  for (const candidate of candidates) {
    if (candidate <= 0 || candidate >= safeDuration) continue;
    if (candidate - normalized.at(-1) < minimum) continue;
    if (safeDuration - candidate < minimum) continue;
    if (candidate !== normalized.at(-1)) normalized.push(candidate);
  }
  normalized.push(safeDuration);
  return normalized;
}

function nextShotId(usedIds) {
  let index = 1;
  while (usedIds.has(`shot_${String(index).padStart(3, '0')}`)) index += 1;
  const id = `shot_${String(index).padStart(3, '0')}`;
  usedIds.add(id);
  return id;
}

function findPreviousShot(interval, previousShots, claimedIds) {
  const exact = previousShots.find(shot => (
    !claimedIds.has(shot?.shotId)
    && Math.abs(Number(shot?.start) - interval.start) < 0.002
    && Math.abs(Number(shot?.end) - interval.end) < 0.002
  ));
  if (exact) return { shot: exact, exact: true };

  let best = null;
  let bestOverlap = 0;
  for (const shot of previousShots) {
    if (!shot?.shotId || claimedIds.has(shot.shotId)) continue;
    const overlap = Math.max(
      0,
      Math.min(interval.end, Number(shot.end)) - Math.max(interval.start, Number(shot.start))
    );
    if (overlap > bestOverlap) {
      best = shot;
      bestOverlap = overlap;
    }
  }
  return best ? { shot: best, exact: false } : null;
}

export function buildVideoRemixShots({
  duration,
  cutPoints = [],
  previousShots = [],
  detectionSource = 'manual',
  detections = [],
  minShotDuration = 0.35,
} = {}) {
  const normalizedCuts = normalizeVideoRemixCutPoints(duration, cutPoints, { minShotDuration });
  if (normalizedCuts.length < 2) return [];
  const usedIds = new Set(
    previousShots
      .map(shot => String(shot?.shotId || ''))
      .filter(Boolean)
  );
  const claimedIds = new Set();

  return normalizedCuts.slice(0, -1).map((start, index) => {
    const end = normalizedCuts[index + 1];
    const interval = { start, end };
    const previous = findPreviousShot(interval, previousShots, claimedIds);
    const shotId = previous?.shot?.shotId || nextShotId(usedIds);
    claimedIds.add(shotId);
    const detection = detections.find(item => Math.abs(Number(item?.time) - start) < 0.01);

    if (previous?.exact) {
      return {
        ...previous.shot,
        start,
        end,
        duration: roundShotTime(end - start),
        analysisFrames: [],
      };
    }
    return createVideoRemixShot({
      shotId,
      start,
      end,
      detectionSource,
      detectionScore: detection?.score,
    });
  });
}

function createRemixId() {
  if (globalThis.crypto?.randomUUID) return `remix_${globalThis.crypto.randomUUID()}`;
  return `remix_${Date.now().toString(36)}`;
}

export function createVideoRemixState(overrides = {}) {
  const state = {
    schemaVersion: VIDEO_REMIX_SCHEMA_VERSION,
    remixId: String(overrides.remixId || createRemixId()),
    mode: 'high_fidelity',
    stage: 'source',
    source: null,
    analysisRun: { ...DEFAULT_ANALYSIS_RUN },
    assetReview: { ...DEFAULT_ASSET_REVIEW },
    promptReview: { ...DEFAULT_PROMPT_REVIEW },
    story: null,
    assets: {
      characters: [],
      scenes: [],
      props: [],
    },
    shots: [],
    prompts: {},
    keyframes: [],
    generatedVideos: [],
    timeline: [],
    bgm: { mode: 'none' },
    subtitles: { enabled: false, style: 'default' },
    output: null,
    locks: { ...HIGH_FIDELITY_LOCKS },
    errors: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };

  state.assets = {
    characters: [],
    scenes: [],
    props: [],
    ...(overrides.assets || {}),
  };
  state.analysisRun = {
    ...DEFAULT_ANALYSIS_RUN,
    ...(overrides.analysisRun || {}),
  };
  state.assetReview = {
    ...DEFAULT_ASSET_REVIEW,
    ...(overrides.assetReview || {}),
  };
  state.promptReview = {
    ...DEFAULT_PROMPT_REVIEW,
    ...(overrides.promptReview || {}),
  };
  state.locks = { ...HIGH_FIDELITY_LOCKS, ...(overrides.locks || {}) };
  state.bgm = { mode: 'none', ...(overrides.bgm || {}) };
  state.subtitles = { enabled: false, style: 'default', ...(overrides.subtitles || {}) };
  return state;
}

export function isVideoRemixState(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && Number(value.schemaVersion) === VIDEO_REMIX_SCHEMA_VERSION
    && typeof value.remixId === 'string'
    && VIDEO_REMIX_STAGES.includes(value.stage)
    && Array.isArray(value.shots)
    && value.assets
    && Array.isArray(value.assets.characters)
    && Array.isArray(value.assets.scenes)
    && Array.isArray(value.assets.props)
  );
}

export function workspaceTabForStage(stage) {
  return TAB_BY_STAGE[stage] || 'source';
}

export function summarizeVideoRemixState(state) {
  const safe = isVideoRemixState(state) ? state : createVideoRemixState();
  const shots = safe.shots.length;
  const confirmedKeyframes = safe.keyframes.filter(item => item?.status === 'confirmed').length;
  const completedVideos = safe.generatedVideos.filter(item => item?.status === 'completed').length;
  return {
    shots,
    characters: safe.assets.characters.length,
    scenes: safe.assets.scenes.length,
    props: safe.assets.props.length,
    confirmedKeyframes,
    completedVideos,
  };
}

/**
 * Installing a different source invalidates every derived artifact. The old
 * original remains on disk, but analysis, prompts and generated media must not
 * silently carry over to the new reference.
 */
export function replaceVideoRemixSource(state, source) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  return createVideoRemixState({
    remixId: current.remixId,
    createdAt: current.createdAt,
    mode: current.mode,
    locks: current.locks,
    source,
    stage: 'source',
    updatedAt: new Date().toISOString(),
  });
}

export function setVideoRemixSourceError(state, message, retryable = true) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  return {
    ...current,
    // A failed replacement must not invalidate a previously usable source and
    // its derived work. New remixes without any source still enter error state.
    stage: current.source ? current.stage : 'error',
    errors: [
      ...current.errors.filter(item => item?.scope !== 'source'),
      {
        scope: 'source',
        message: String(message || '参考视频处理失败'),
        retryable: Boolean(retryable),
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function beginVideoRemixPreprocessing(state) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  if (!current.source) return current;
  return {
    ...current,
    stage: 'preprocessing',
    errors: current.errors.filter(item => item?.scope !== 'preprocessing'),
    updatedAt: new Date().toISOString(),
  };
}

export function completeVideoRemixPreprocessing(state, {
  source,
  proxyUrl,
  shots,
}) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  const nextSource = source || current.source;
  if (!nextSource || !proxyUrl || !Array.isArray(shots)) return current;
  return {
    ...current,
    source: {
      ...nextSource,
      proxyUrl,
    },
    stage: 'shots_ready',
    analysisRun: {
      ...DEFAULT_ANALYSIS_RUN,
      totalShots: shots.length,
    },
    assetReview: { ...DEFAULT_ASSET_REVIEW },
    promptReview: { ...DEFAULT_PROMPT_REVIEW },
    story: null,
    assets: {
      characters: [],
      scenes: [],
      props: [],
    },
    shots,
    prompts: {},
    keyframes: [],
    generatedVideos: [],
    timeline: shots.map((shot, order) => ({
      shotId: shot.shotId,
      order,
      start: shot.start,
      end: shot.end,
      transition: shot.transition === 'fade' ? 'fade' : 'hard_cut',
    })),
    output: null,
    errors: current.errors.filter(item => item?.scope !== 'preprocessing'),
    updatedAt: new Date().toISOString(),
  };
}

export function setVideoRemixPreprocessingError(state, message, retryable = true) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  return {
    ...current,
    stage: current.stage === 'preprocessing'
      ? (current.source?.proxyUrl && current.shots.length > 0 ? 'shots_ready' : 'source')
      : current.stage,
    errors: [
      ...current.errors.filter(item => item?.scope !== 'preprocessing'),
      {
        scope: 'preprocessing',
        message: String(message || '视频预处理失败'),
        retryable: Boolean(retryable),
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function beginVideoRemixAnalysis(state, mode = 'fast') {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  if (!current.source || current.shots.length === 0) return current;
  return {
    ...current,
    stage: 'analyzing',
    analysisRun: {
      ...DEFAULT_ANALYSIS_RUN,
      ...(current.analysisRun || {}),
      mode: mode === 'deep' ? 'deep' : 'fast',
      globalStatus: 'analyzing',
      completedShots: current.shots.filter(shot => shot?.analysisStatus === 'ready').length,
      totalShots: current.shots.length,
      updatedAt: new Date().toISOString(),
    },
    errors: current.errors.filter(item => item?.scope !== 'analysis'),
    updatedAt: new Date().toISOString(),
  };
}

export function applyVideoRemixGlobalAnalysis(state, result) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  if (!result?.story || !Array.isArray(result?.shotComplexities)) return current;
  const complexityByShot = new Map(
    result.shotComplexities.map(item => [item.shotId, item])
  );
  const shots = current.shots.map(shot => {
    const classification = complexityByShot.get(shot.shotId);
    return {
      ...shot,
      motionComplexity: classification?.motionComplexity || shot.motionComplexity || 'medium',
      ...(Number.isFinite(Number(classification?.confidence))
        ? { motionComplexityConfidence: Number(classification.confidence) }
        : {}),
      analysisStatus: 'pending',
      analysisError: undefined,
    };
  });
  const completedShots = shots.filter(shot => shot.analysisStatus === 'ready').length;
  const referenceFramesFor = (appearsInShots, maximum = 4) => {
    const expected = new Set((appearsInShots || []).map(String));
    const references = [];
    for (const shot of shots) {
      if (!expected.has(shot.shotId)) continue;
      const frames = Array.isArray(shot.analysisFrames) ? shot.analysisFrames : [];
      for (const position of ['middle', 'quarter', 'three_quarter', 'start', 'end']) {
        const url = frames.find(frame => frame.position === position)?.url;
        if (url && !references.includes(url)) references.push(url);
        if (references.length >= maximum) return references;
      }
    }
    return references;
  };
  const previousCharacters = new Map(
    (current.assets?.characters || []).map(asset => [asset.id, asset])
  );
  const previousScenes = new Map(
    (current.assets?.scenes || []).map(asset => [asset.id, asset])
  );
  const previousProps = new Map(
    (current.assets?.props || []).map(asset => [asset.id, asset])
  );
  const characters = (Array.isArray(result.characters) ? result.characters : []).map(asset => {
    const previous = previousCharacters.get(asset.id);
    const extractedReferences = referenceFramesFor(asset.appearsInShots);
    const looks = (asset.looks || []).map(look => {
      const previousLook = previous?.looks?.find(item => item.id === look.id);
      return {
        ...look,
        source: look.source || 'analysis',
        referenceImages: look.referenceImages?.length
          ? look.referenceImages
          : extractedReferences,
        ...(previousLook?.replacement ? { replacement: previousLook.replacement } : {}),
      };
    });
    for (const previousLook of previous?.looks || []) {
      if (
        previousLook?.source !== 'analysis'
        && !looks.some(look => look.id === previousLook.id)
      ) {
        looks.push(previousLook);
      }
    }
    return {
      ...asset,
      source: asset.source || 'analysis',
      referenceImages: asset.referenceImages?.length
        ? asset.referenceImages
        : extractedReferences,
      looks,
      ...(previous?.replacement ? { replacement: previous.replacement } : {}),
    };
  });
  const scenes = (Array.isArray(result.scenes) ? result.scenes : []).map(asset => {
    const previous = previousScenes.get(asset.id);
    return {
      ...asset,
      source: asset.source || 'analysis',
      referenceImages: asset.referenceImages?.length
        ? asset.referenceImages
        : referenceFramesFor(asset.appearsInShots),
      ...(previous?.replacement ? { replacement: previous.replacement } : {}),
    };
  });
  const props = (Array.isArray(result.props) ? result.props : []).map(asset => {
    const previous = previousProps.get(asset.id);
    return {
      ...asset,
      source: asset.source || 'analysis',
      referenceImages: asset.referenceImages?.length
        ? asset.referenceImages
        : referenceFramesFor(asset.appearsInShots),
      ...(previous?.replacement ? { replacement: previous.replacement } : {}),
      ...(previous?.removed ? { removed: true } : {}),
    };
  });
  return {
    ...current,
    stage: completedShots === shots.length ? 'analysis_ready' : 'analyzing',
    story: {
      ...result.story,
      ...(result.style ? { style: result.style } : {}),
    },
    assets: {
      characters,
      scenes,
      props,
    },
    assetReview: {
      ...DEFAULT_ASSET_REVIEW,
      updatedAt: new Date().toISOString(),
    },
    promptReview: { ...DEFAULT_PROMPT_REVIEW },
    shots,
    prompts: {},
    keyframes: [],
    generatedVideos: [],
    timeline: (current.timeline || []).map(item => {
      const { videoUrl, ...rest } = item;
      return rest;
    }),
    output: null,
    analysisRun: {
      ...DEFAULT_ANALYSIS_RUN,
      ...(current.analysisRun || {}),
      mode: result.mode === 'deep' ? 'deep' : current.analysisRun?.mode || 'fast',
      analysisKey: result.analysisKey || current.analysisRun?.analysisKey,
      globalStatus: 'ready',
      completedShots,
      totalShots: shots.length,
      updatedAt: new Date().toISOString(),
    },
    errors: current.errors.filter(item => item?.scope !== 'analysis'),
    updatedAt: new Date().toISOString(),
  };
}

function isLockedUserEditable(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && value.source === 'user'
    && value.locked === true
    && (
      Object.hasOwn(value, 'value')
      || Object.hasOwn(value, 'lookId')
    )
  );
}

function containsLockedUserEditable(value) {
  if (isLockedUserEditable(value)) return true;
  if (Array.isArray(value)) return value.some(containsLockedUserEditable);
  return Boolean(
    value
    && typeof value === 'object'
    && Object.values(value).some(containsLockedUserEditable)
  );
}

function analysisArrayIdentity(value) {
  if (!value || typeof value !== 'object') return '';
  return String(
    value.shotId
    || value.characterId
    || value.sceneId
    || value.propId
    || value.id
    || ''
  );
}

function mergeUserLockedEditables(previous, incoming) {
  if (isLockedUserEditable(previous)) return previous;
  if (Array.isArray(incoming)) {
    const prior = Array.isArray(previous) ? previous : [];
    const matched = new Set();
    const merged = incoming.map((value, index) => {
      const identity = analysisArrayIdentity(value);
      const previousIndex = identity
        ? prior.findIndex((candidate, candidateIndex) => (
          !matched.has(candidateIndex)
          && analysisArrayIdentity(candidate) === identity
        ))
        : (!matched.has(index) ? index : -1);
      if (previousIndex >= 0) matched.add(previousIndex);
      return mergeUserLockedEditables(prior[previousIndex], value);
    });
    prior.forEach((value, index) => {
      if (!matched.has(index) && containsLockedUserEditable(value)) merged.push(value);
    });
    return merged;
  }
  if (incoming && typeof incoming === 'object') {
    const keys = new Set(Object.keys(incoming));
    if (previous && typeof previous === 'object') {
      Object.entries(previous).forEach(([key, value]) => {
        if (containsLockedUserEditable(value)) keys.add(key);
      });
    }
    return Object.fromEntries([...keys].map(key => [
      key,
      Object.hasOwn(incoming, key)
        ? mergeUserLockedEditables(previous?.[key], incoming[key])
        : previous[key],
    ]));
  }
  return incoming;
}

export function applyVideoRemixShotAnalysis(state, analyzedShot) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  if (!analyzedShot?.shotId) return current;
  let found = false;
  const shots = current.shots.map(shot => {
    if (shot.shotId !== analyzedShot.shotId) return shot;
    found = true;
    const merged = mergeUserLockedEditables(shot, analyzedShot);
    return {
      ...merged,
      analysisFrames: shot.analysisFrames || merged.analysisFrames || [],
      detection: shot.detection || merged.detection || { source: 'manual' },
      analysisStatus: 'ready',
      analysisError: undefined,
      analyzedAt: merged.analyzedAt || new Date().toISOString(),
    };
  });
  if (!found) return current;
  const completedShots = shots.filter(shot => shot.analysisStatus === 'ready').length;
  return {
    ...current,
    stage: completedShots === shots.length ? 'analysis_ready' : 'analysis_partial',
    shots,
    promptReview: { ...DEFAULT_PROMPT_REVIEW },
    prompts: Object.fromEntries(
      Object.entries(current.prompts || {}).filter(([shotId]) => (
        shotId !== analyzedShot.shotId
      ))
    ),
    keyframes: [],
    generatedVideos: [],
    timeline: (current.timeline || []).map(item => {
      const { videoUrl, ...rest } = item;
      return rest;
    }),
    output: null,
    analysisRun: {
      ...DEFAULT_ANALYSIS_RUN,
      ...(current.analysisRun || {}),
      globalStatus: 'ready',
      completedShots,
      totalShots: shots.length,
      updatedAt: new Date().toISOString(),
    },
    errors: current.errors.filter(item => !(
      item?.scope === 'analysis' && item?.id === analyzedShot.shotId
    )),
    updatedAt: new Date().toISOString(),
  };
}

export function setVideoRemixShotAnalysisError(state, shotId, message, {
  code,
  retryable = true,
} = {}) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  const safeShotId = String(shotId || '');
  const shots = current.shots.map(shot => (
    shot.shotId === safeShotId
      ? { ...shot, analysisStatus: 'failed', analysisError: String(message || 'Shot 分析失败') }
      : shot
  ));
  const completedShots = shots.filter(shot => shot.analysisStatus === 'ready').length;
  return {
    ...current,
    stage: 'analysis_partial',
    shots,
    analysisRun: {
      ...DEFAULT_ANALYSIS_RUN,
      ...(current.analysisRun || {}),
      globalStatus: current.analysisRun?.globalStatus || 'ready',
      completedShots,
      totalShots: shots.length,
      updatedAt: new Date().toISOString(),
    },
    errors: [
      ...current.errors.filter(item => !(
        item?.scope === 'analysis' && item?.id === safeShotId
      )),
      {
        scope: 'analysis',
        id: safeShotId,
        message: String(message || 'Shot 分析失败'),
        retryable: Boolean(retryable),
        ...(code ? { code: String(code) } : {}),
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function setVideoRemixGlobalAnalysisError(state, message, {
  code,
  retryable = true,
} = {}) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  return {
    ...current,
    stage: current.shots.some(shot => shot?.analysisStatus === 'ready')
      ? 'analysis_partial'
      : 'shots_ready',
    analysisRun: {
      ...DEFAULT_ANALYSIS_RUN,
      ...(current.analysisRun || {}),
      globalStatus: 'failed',
      updatedAt: new Date().toISOString(),
    },
    errors: [
      ...current.errors.filter(item => !(item?.scope === 'analysis' && !item?.id)),
      {
        scope: 'analysis',
        message: String(message || '全片分析失败'),
        retryable: Boolean(retryable),
        ...(code ? { code: String(code) } : {}),
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function restoreVideoRemixAnalysis(state, snapshot) {
  if (!snapshot?.global) return state;
  let restored = applyVideoRemixGlobalAnalysis(state, {
    ...snapshot.global,
    analysisKey: snapshot.analysisKey,
    mode: snapshot.mode,
  });
  for (const shot of snapshot.shots || []) {
    restored = applyVideoRemixShotAnalysis(restored, shot);
  }
  return restored;
}

function normalizeAssetReplacement(value) {
  if (!value || typeof value !== 'object') return undefined;
  const source = ['analysis', 'generated', 'upload', 'library'].includes(value.source)
    ? value.source
    : 'analysis';
  const replacement = {
    ...value,
    source,
    updatedAt: value.updatedAt || new Date().toISOString(),
  };
  if (value.referenceImages !== undefined) {
    replacement.referenceImages = [...new Set(
      (Array.isArray(value.referenceImages) ? value.referenceImages : [])
        .map(String)
        .filter(Boolean)
    )];
  }
  return replacement;
}

export function resolveVideoRemixAsset(asset) {
  if (!asset || typeof asset !== 'object') return asset;
  const replacement = normalizeAssetReplacement(asset.replacement);
  if (!replacement) return asset;
  return {
    ...asset,
    ...replacement,
    referenceImages: replacement.referenceImages === undefined
      ? asset.referenceImages || []
      : replacement.referenceImages,
    replacement: asset.replacement,
  };
}

export function resolveVideoRemixCharacterLook(look) {
  return resolveVideoRemixAsset(look);
}

function stageAfterAssetChange(current) {
  const laterStages = new Set([
    'assets_ready',
    'keyframes_generating',
    'keyframes_ready',
    'videos_generating',
    'videos_ready',
    'rendering',
    'completed',
  ]);
  if (laterStages.has(current.stage)) return 'analysis_ready';
  return current.stage;
}

function withInvalidatedAssetDerivatives(current, updates) {
  const nextCore = {
    ...current,
    ...updates,
  };
  return {
    ...nextCore,
    stage: stageAfterAssetChange(current),
    assetReview: {
      confirmed: false,
      updatedAt: new Date().toISOString(),
    },
    promptReview: { ...DEFAULT_PROMPT_REVIEW },
    prompts: refreshPromptRecordsForAssets(nextCore),
    keyframes: [],
    generatedVideos: [],
    timeline: (current.timeline || []).map(item => {
      const { videoUrl, ...rest } = item;
      return rest;
    }),
    output: null,
    updatedAt: new Date().toISOString(),
  };
}

export function replaceVideoRemixAsset(state, kind, assetId, replacement) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  if (!['characters', 'scenes', 'props'].includes(kind)) return current;
  const id = String(assetId || '');
  let found = false;
  const nextAssets = current.assets[kind].map(asset => {
    if (asset.id !== id) return asset;
    found = true;
    const normalized = normalizeAssetReplacement(replacement);
    if (!normalized) {
      const { replacement: ignored, ...base } = asset;
      return base;
    }
    return { ...asset, replacement: normalized };
  });
  if (!found) return current;
  return withInvalidatedAssetDerivatives(current, {
    assets: {
      ...current.assets,
      [kind]: nextAssets,
    },
  });
}

export function replaceVideoRemixCharacterLook(
  state,
  characterId,
  lookId,
  replacement
) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  let found = false;
  const characters = current.assets.characters.map(character => {
    if (character.id !== String(characterId || '')) return character;
    const looks = character.looks.map(look => {
      if (look.id !== String(lookId || '')) return look;
      found = true;
      const normalized = normalizeAssetReplacement(replacement);
      if (!normalized) {
        const { replacement: ignored, ...base } = look;
        return base;
      }
      return { ...look, replacement: normalized };
    });
    return found ? { ...character, looks } : character;
  });
  if (!found) return current;
  return withInvalidatedAssetDerivatives(current, {
    assets: { ...current.assets, characters },
  });
}

export function addVideoRemixCharacterLook(state, characterId, look) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  const id = String(look?.id || '');
  if (
    !id
    || !/^[A-Za-z0-9_-]+$/.test(id)
    || !String(look?.name || '').trim()
    || !String(look?.description || '').trim()
  ) {
    return current;
  }
  let found = false;
  const characters = current.assets.characters.map(character => {
    if (character.id !== String(characterId || '')) return character;
    found = true;
    const normalizedLook = {
      id,
      name: String(look.name).trim(),
      description: String(look.description).trim(),
      referenceImages: [...new Set(
        (Array.isArray(look.referenceImages) ? look.referenceImages : [])
          .map(String)
          .filter(Boolean)
      )],
      source: ['generated', 'upload', 'library'].includes(look.source)
        ? look.source
        : 'upload',
    };
    const existingIndex = character.looks.findIndex(item => item.id === id);
    const looks = [...character.looks];
    if (existingIndex >= 0) looks[existingIndex] = normalizedLook;
    else looks.push(normalizedLook);
    return { ...character, looks };
  });
  if (!found) return current;
  return withInvalidatedAssetDerivatives(current, {
    assets: { ...current.assets, characters },
  });
}

export function setVideoRemixShotCharacterLook(
  state,
  shotId,
  characterId,
  lookId
) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  const character = current.assets.characters.find(
    item => item.id === String(characterId || '')
  );
  if (!character?.looks.some(look => look.id === String(lookId || ''))) return current;
  let found = false;
  const shots = current.shots.map(shot => {
    if (shot.shotId !== String(shotId || '')) return shot;
    const characters = shot.characters.map(item => {
      if (item.characterId !== character.id) return item;
      found = true;
      return {
        ...item,
        lookId: String(lookId),
        lookOverride: {
          lookId: String(lookId),
          source: 'user',
          locked: true,
        },
      };
    });
    return found ? { ...shot, characters } : shot;
  });
  if (!found) return current;
  return withInvalidatedAssetDerivatives(current, { shots });
}

export function setVideoRemixPropRemoved(state, propId, removed = true) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  let found = false;
  const props = current.assets.props.map(prop => {
    if (prop.id !== String(propId || '')) return prop;
    found = true;
    return { ...prop, removed: Boolean(removed) };
  });
  if (!found) return current;
  return withInvalidatedAssetDerivatives(current, {
    assets: { ...current.assets, props },
  });
}

export function confirmVideoRemixAssets(state) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  if (
    !current.story
    || current.shots.length === 0
    || current.shots.some(shot => shot.analysisStatus !== 'ready')
  ) {
    return current;
  }
  const now = new Date().toISOString();
  return {
    ...current,
    stage: 'assets_ready',
    assetReview: {
      confirmed: true,
      confirmedAt: now,
      updatedAt: now,
    },
    updatedAt: now,
  };
}

export function resolveVideoRemixShotCharacter(state, shotId, characterId) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  const shot = current.shots.find(item => item.shotId === String(shotId || ''));
  const shotCharacter = shot?.characters?.find(
    item => item.characterId === String(characterId || '')
  );
  const baseCharacter = current.assets.characters.find(
    item => item.id === String(characterId || '')
  );
  if (!shotCharacter || !baseCharacter) return null;
  const character = resolveVideoRemixAsset(baseCharacter);
  const activeLookId = shotCharacter.lookOverride?.locked
    ? shotCharacter.lookOverride.lookId
    : shotCharacter.lookId;
  const baseLook = baseCharacter.looks.find(look => look.id === activeLookId);
  return {
    character,
    ...(baseLook ? { look: resolveVideoRemixCharacterLook(baseLook) } : {}),
  };
}

const PROMPT_TEMPLATE_TOKEN_RE = /\{\{([A-Za-z0-9_-]+)\}\}/g;

const editableText = value => (
  value && typeof value === 'object' && Object.hasOwn(value, 'value')
    ? String(value.value || '').trim()
    : String(value || '').trim()
);

const compactPromptText = value => String(value || '')
  .replace(/\s+/g, ' ')
  .trim();

function stablePromptValue(value) {
  if (Array.isArray(value)) return value.map(stablePromptValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, stablePromptValue(value[key])])
  );
}

function promptValueHash(value) {
  const input = JSON.stringify(stablePromptValue(value));
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function promptTemplateTokens(value) {
  const tokens = [];
  for (const match of String(value || '').matchAll(PROMPT_TEMPLATE_TOKEN_RE)) {
    if (!tokens.includes(match[1])) tokens.push(match[1]);
  }
  return tokens;
}

export function validateVideoRemixPromptTemplate(sourceTemplate, candidateTemplate) {
  const expected = promptTemplateTokens(sourceTemplate);
  const actual = promptTemplateTokens(candidateTemplate);
  const missing = expected.filter(token => !actual.includes(token));
  const unknown = actual.filter(token => !expected.includes(token));
  return {
    valid: missing.length === 0 && unknown.length === 0,
    missing,
    unknown,
  };
}

function placeholder(assetId) {
  return `{{${String(assetId || '')}}}`;
}

function timeRange(start, end) {
  return `${Number(start || 0).toFixed(1)}-${Number(end || 0).toFixed(1)} 秒`;
}

function frameSubjectLine(subject) {
  const details = [
    `中心约在画面 ${Math.round(Number(subject.x || 0) * 100)}% × ${Math.round(Number(subject.y || 0) * 100)}%`,
    `画面占比约 ${Math.round(Number(subject.scale || 0) * 100)}%`,
    subject.facing ? `朝向 ${subject.facing}` : '',
    subject.pose ? `姿势 ${subject.pose}` : '',
  ].filter(Boolean);
  return `${placeholder(subject.id)}：${details.join('；')}`;
}

function framePropLine(prop) {
  return `${placeholder(prop.id)}：位于画面 ${Math.round(Number(prop.x || 0) * 100)}% × ${Math.round(Number(prop.y || 0) * 100)}%${prop.scale === undefined ? '' : `，画面占比约 ${Math.round(Number(prop.scale || 0) * 100)}%`}`;
}

const ACTION_CATEGORY_LABELS = Object.freeze({
  body: '身体',
  pose: '姿态',
  hand: '手部',
  facial: '表情',
  object: '道具交互',
});

const PROP_CATEGORY_LABELS = Object.freeze({
  hero: '主道具',
  interactive: '交互道具',
  background: '背景道具',
});

const HAND_LABELS = Object.freeze({
  left: '左手',
  right: '右手',
  both: '双手',
});

export function buildVideoRemixRawPrompt(state, shotId) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  const shot = current.shots.find(item => item.shotId === String(shotId || ''));
  if (!shot) return '';
  const lines = [
    `【时长】持续约 ${Number(shot.duration || 0).toFixed(2)} 秒，保持原 Shot 时长与单镜头结构。`,
  ];
  const storyBeat = editableText(shot.storyBeat);
  if (storyBeat) lines.push(`【剧情】${storyBeat}`);
  if (shot.scene?.sceneId) {
    lines.push(`【场景】${placeholder(shot.scene.sceneId)}${shot.scene.sceneZone ? `，使用功能区 ${shot.scene.sceneZone}` : ''}`);
  }
  if (shot.characters.length > 0) {
    lines.push(`【人物】${shot.characters.map(item => placeholder(item.characterId)).join('；')}`);
  }
  const visibleProps = shot.props.filter(item => (
    !current.assets.props.find(prop => prop.id === item.propId)?.removed
  ));
  if (visibleProps.length > 0) {
    lines.push(`【道具】${visibleProps.map(item => (
      `${placeholder(item.propId)}${item.role ? `（${item.role}）` : ''}`
    )).join('；')}`);
  }
  const frameLines = [
    editableText(shot.frameBlueprint?.shotSize)
      ? `景别 ${editableText(shot.frameBlueprint.shotSize)}`
      : '',
    editableText(shot.frameBlueprint?.cameraAngle)
      ? `机位 ${editableText(shot.frameBlueprint.cameraAngle)}`
      : '',
    ...(shot.frameBlueprint?.subjects || []).map(frameSubjectLine),
    ...(shot.frameBlueprint?.props || [])
      .filter(prop => !current.assets.props.find(item => item.id === prop.id)?.removed)
      .map(framePropLine),
  ].filter(Boolean);
  if (frameLines.length > 0) lines.push(`【构图】\n${frameLines.join('\n')}`);

  const actionLines = [];
  for (const subject of shot.motionBlueprint?.subjects || []) {
    for (const action of subject.actionSequence || []) {
      actionLines.push(
        `${timeRange(action.start, action.end)}：${placeholder(subject.characterId)} ${action.action}${action.category ? `（${ACTION_CATEGORY_LABELS[action.category] || action.category}）` : ''}`
      );
    }
    if (subject.movementDirection) {
      actionLines.push(`${placeholder(subject.characterId)} 整体移动方向：${subject.movementDirection}`);
    }
  }
  for (const interaction of shot.motionBlueprint?.propInteractions || []) {
    const prop = current.assets.props.find(item => item.id === interaction.prop);
    actionLines.push(
      `${timeRange(interaction.start, interaction.end)}：${placeholder(interaction.actor)} 用${HAND_LABELS[interaction.hand] || '手'}执行 ${interaction.action}，${prop?.removed ? '保持原手部运动路径并维持空手状态' : `交互对象为 ${placeholder(interaction.prop)}`}`
    );
  }
  if (actionLines.length > 0) lines.push(`【动作】\n${actionLines.join('\n')}`);

  const cameraLines = [
    editableText(shot.cameraBlueprint?.shotSize)
      ? `景别保持 ${editableText(shot.cameraBlueprint.shotSize)}`
      : '',
    editableText(shot.cameraBlueprint?.angle)
      ? `摄影机角度 ${editableText(shot.cameraBlueprint.angle)}`
      : '',
    ...(shot.cameraBlueprint?.movement || []).map(movement => (
      `${movement.start === undefined || movement.end === undefined ? '' : `${timeRange(movement.start, movement.end)}：`}${movement.type}`
    )),
    editableText(shot.cameraBlueprint?.lensFeel)
      ? `镜头观感 ${editableText(shot.cameraBlueprint.lensFeel)}`
      : '',
  ].filter(Boolean);
  if (cameraLines.length > 0) lines.push(`【运镜】\n${cameraLines.join('\n')}`);

  const timingLines = (shot.timingBlueprint?.phases || []).map(phase => (
    `${timeRange(phase.start, phase.end)}：${phase.phase}`
  ));
  if (timingLines.length > 0) lines.push(`【节奏】\n${timingLines.join('\n')}`);

  const audioLines = [];
  for (const dialogue of shot.audioBlueprint?.dialogue || []) {
    const timing = dialogue.start === undefined || dialogue.end === undefined
      ? ''
      : `${timeRange(dialogue.start, dialogue.end)}：`;
    audioLines.push(
      `${timing}${placeholder(dialogue.characterId)}${dialogue.emotion ? `以${dialogue.emotion}情绪` : ''}说道：“${editableText(dialogue.text)}”`
    );
  }
  const environment = editableText(shot.audioBlueprint?.environment);
  if (environment) audioLines.push(`环境声：${environment}`);
  for (const event of shot.audioBlueprint?.soundEvents || []) {
    audioLines.push(`${timeRange(event.start, event.end)}：${event.description}`);
  }
  if (audioLines.length > 0) lines.push(`【声音】\n${audioLines.join('\n')}`);

  if (current.story?.style) lines.push(`【视觉风格】${current.story.style}`);
  lines.push('【锁定】保持原剧情、人物数量、动作顺序、构图、运镜、镜头边界和时长；只替换已经确认的资产外观。');
  return lines.join('\n');
}

export function buildVideoRemixImagePrompt(state, shotId) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  const shot = current.shots.find(item => item.shotId === String(shotId || ''));
  if (!shot) return '';
  const lines = ['【任务】生成该 Shot 的静态关键帧，不描述完整时间动作路径。'];
  if (shot.scene?.sceneId) {
    lines.push(`【场景】${placeholder(shot.scene.sceneId)}${shot.scene.sceneZone ? `，画面位于功能区 ${shot.scene.sceneZone}` : ''}`);
  }
  if (shot.characters.length > 0) {
    lines.push(`【人物】${shot.characters.map(item => placeholder(item.characterId)).join('；')}`);
  }
  const frameLines = [
    editableText(shot.frameBlueprint?.shotSize)
      ? `景别 ${editableText(shot.frameBlueprint.shotSize)}`
      : '',
    editableText(shot.frameBlueprint?.cameraAngle)
      ? `机位 ${editableText(shot.frameBlueprint.cameraAngle)}`
      : '',
    ...(shot.frameBlueprint?.subjects || []).map(frameSubjectLine),
    ...(shot.frameBlueprint?.props || [])
      .filter(prop => !current.assets.props.find(item => item.id === prop.id)?.removed)
      .map(framePropLine),
  ].filter(Boolean);
  if (frameLines.length > 0) lines.push(`【构图与姿势】\n${frameLines.join('\n')}`);
  const lighting = shot.startState?.lighting;
  if (lighting) lines.push(`【灯光】${lighting}`);
  if (current.story?.style) lines.push(`【视觉风格】${current.story.style}`);
  lines.push('【锁定】人物数量、位置、朝向、景别、机位、透视、场景功能区和关键道具位置与原参考帧一致。');
  return lines.join('\n');
}

function taggedReferenceModel(targetModel) {
  const model = String(targetModel || '');
  return model.startsWith('jimeng-') || model === 'seedance-2-0';
}

function referencePrefix(asset, targetModel, imagePrompt) {
  if (
    !imagePrompt
    && taggedReferenceModel(targetModel)
    && Array.isArray(asset.referenceImages)
    && asset.referenceImages.length > 0
  ) {
    return `@${asset.id}`;
  }
  return asset.name;
}

function characterPromptDescription(current, shot, assetId, targetModel, imagePrompt) {
  const resolved = resolveVideoRemixShotCharacter(current, shot.shotId, assetId);
  if (!resolved) return null;
  const { character, look } = resolved;
  const referenceAsset = {
    ...character,
    referenceImages: [
      ...(character.referenceImages || []),
      ...(look?.referenceImages || []),
    ],
  };
  const details = [
    `资产 ${character.id}`,
    character.identity,
    look ? `造型 ${look.name}：${look.description}` : '',
  ].filter(Boolean).map(compactPromptText);
  return `${referencePrefix(referenceAsset, targetModel, imagePrompt)}（${details.join('；')}）`;
}

function scenePromptDescription(current, shot, assetId, targetModel, imagePrompt) {
  const base = current.assets.scenes.find(item => item.id === assetId);
  if (!base) return null;
  const scene = resolveVideoRemixAsset(base);
  const zone = scene.zones?.find(item => item.id === shot.scene?.sceneZone);
  const details = [
    `资产 ${scene.id}`,
    scene.visualDescription,
    zone ? `功能区 ${zone.name}：${zone.description}` : '',
    scene.audioDescription ? `环境声 ${scene.audioDescription}` : '',
  ].filter(Boolean).map(compactPromptText);
  return `${referencePrefix(scene, targetModel, imagePrompt)}（${details.join('；')}）`;
}

function propPromptDescription(current, assetId, targetModel, imagePrompt) {
  const base = current.assets.props.find(item => item.id === assetId);
  if (!base) return null;
  if (base.removed) return '保持原手部运动路径的空手交互锚点';
  const prop = resolveVideoRemixAsset(base);
  const details = [
    `资产 ${prop.id}`,
    prop.description,
    `类型 ${PROP_CATEGORY_LABELS[prop.category] || prop.category}`,
  ].filter(Boolean).map(compactPromptText);
  return `${referencePrefix(prop, targetModel, imagePrompt)}（${details.join('；')}）`;
}

export function resolveVideoRemixPromptTemplate(
  state,
  shotId,
  template,
  { targetModel = '', imagePrompt = false } = {}
) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  const shot = current.shots.find(item => item.shotId === String(shotId || ''));
  if (!shot) return String(template || '');
  return String(template || '').replace(PROMPT_TEMPLATE_TOKEN_RE, (match, assetId) => (
    characterPromptDescription(current, shot, assetId, targetModel, imagePrompt)
    || scenePromptDescription(current, shot, assetId, targetModel, imagePrompt)
    || propPromptDescription(current, assetId, targetModel, imagePrompt)
    || match
  ));
}

function semanticShotForPromptHash(shot) {
  if (!shot) return null;
  const {
    analysisFrames: ignoredFrames,
    detection: ignoredDetection,
    analysisStatus: ignoredStatus,
    analysisError: ignoredError,
    analyzedAt: ignoredAnalyzedAt,
    ...semantic
  } = shot;
  return semantic;
}

function promptAssetSnapshot(current, shot) {
  return {
    characters: shot.characters.map(item => {
      const resolved = resolveVideoRemixShotCharacter(
        current,
        shot.shotId,
        item.characterId
      );
      return resolved ? {
        character: resolved.character,
        look: resolved.look || null,
      } : { characterId: item.characterId };
    }),
    scene: shot.scene?.sceneId
      ? resolveVideoRemixAsset(
        current.assets.scenes.find(item => item.id === shot.scene.sceneId)
      )
      : null,
    props: shot.props.map(item => {
      const base = current.assets.props.find(prop => prop.id === item.propId);
      return base ? resolveVideoRemixAsset(base) : { id: item.propId };
    }),
  };
}

function promptLayerReady(source, value) {
  return ['optimizer', 'user'].includes(source) && Boolean(String(value || '').trim());
}

function createPromptRecord(current, shot, targetModel, {
  resetVideoOptimization = false,
  resetImageOptimization = false,
} = {}) {
  const previous = current.prompts?.[shot.shotId];
  const analysisHash = promptValueHash(semanticShotForPromptHash(shot));
  const generatedRawPrompt = buildVideoRemixRawPrompt(current, shot.shotId);
  const preserveUserRaw = previous?.analysisHash === analysisHash
    && previous?.rawSource === 'user'
    && previous.rawPrompt;
  const rawPrompt = preserveUserRaw ? previous.rawPrompt : generatedRawPrompt;
  const rawSource = preserveUserRaw ? 'user' : 'analysis';
  const rawImagePrompt = buildVideoRemixImagePrompt(current, shot.shotId);
  const model = String(targetModel || previous?.targetModel || '');
  const assetHash = promptValueHash(promptAssetSnapshot(current, shot));
  const videoOptimizationHash = promptValueHash({
    analysisHash,
    rawPrompt,
    targetModel: model,
  });
  const imageOptimizationHash = promptValueHash({
    analysisHash,
    rawImagePrompt,
  });
  const sameVideoInput = !resetVideoOptimization
    && previous?.videoOptimizationHash === videoOptimizationHash;
  const sameImageInput = !resetImageOptimization
    && previous?.imageOptimizationHash === imageOptimizationHash;
  let optimizedTemplate = sameVideoInput ? previous?.optimizedTemplate || '' : '';
  let optimizedSource = optimizedTemplate ? 'optimizer' : '';
  let optimizedPrompt = optimizedTemplate
    ? resolveVideoRemixPromptTemplate(current, shot.shotId, optimizedTemplate, {
      targetModel: model,
    })
    : '';
  if (
    sameVideoInput
    && previous?.optimizedSource === 'user'
    && previous?.assetHash === assetHash
    && previous.optimizedPrompt
  ) {
    optimizedTemplate = '';
    optimizedSource = 'user';
    optimizedPrompt = previous.optimizedPrompt;
  }

  let imagePromptTemplate = sameImageInput
    ? previous?.imagePromptTemplate || ''
    : '';
  let imagePromptSource = imagePromptTemplate ? 'optimizer' : 'analysis';
  let imagePrompt = imagePromptTemplate
    ? resolveVideoRemixPromptTemplate(current, shot.shotId, imagePromptTemplate, {
      imagePrompt: true,
    })
    : resolveVideoRemixPromptTemplate(current, shot.shotId, rawImagePrompt, {
      imagePrompt: true,
    });
  if (
    sameImageInput
    && previous?.imagePromptSource === 'user'
    && previous?.assetHash === assetHash
    && previous.imagePrompt
  ) {
    imagePromptTemplate = '';
    imagePromptSource = 'user';
    imagePrompt = previous.imagePrompt;
  }

  const resolvedPrompt = resolveVideoRemixPromptTemplate(
    current,
    shot.shotId,
    rawPrompt,
    { targetModel: model }
  );
  const ready = promptLayerReady(optimizedSource, optimizedPrompt)
    && promptLayerReady(imagePromptSource, imagePrompt);
  const preserveFailure = previous?.optimizationStatus === 'failed'
    && sameVideoInput
    && sameImageInput
    && !ready;
  return {
    analysis: shot,
    analysisHash,
    rawPrompt,
    rawSource,
    resolvedPrompt,
    rawImagePrompt,
    optimizedTemplate,
    optimizedPrompt,
    optimizedSource,
    imagePromptTemplate,
    imagePrompt,
    imagePromptSource,
    targetModel: model,
    assetHash,
    videoOptimizationHash,
    imageOptimizationHash,
    promptHash: promptValueHash({
      rawPrompt,
      resolvedPrompt,
      optimizedPrompt,
      imagePrompt,
      targetModel: model,
    }),
    optimizationStatus: ready ? 'ready' : preserveFailure ? 'failed' : 'draft',
    ...(preserveFailure && previous?.optimizationError
      ? { optimizationError: previous.optimizationError }
      : {}),
    ...(sameVideoInput && previous?.videoProfileId
      ? { videoProfileId: previous.videoProfileId }
      : {}),
    ...(sameImageInput && previous?.imageProfileId
      ? { imageProfileId: previous.imageProfileId }
      : {}),
    updatedAt: new Date().toISOString(),
  };
}

function refreshPromptRecordsForAssets(current) {
  return Object.fromEntries(
    Object.keys(current.prompts || {}).flatMap(shotId => {
      const shot = current.shots.find(item => item.shotId === shotId);
      if (!shot) return [];
      return [[
        shotId,
        createPromptRecord(
          current,
          shot,
          current.prompts[shotId]?.targetModel
            || current.promptReview?.targetModel
            || ''
        ),
      ]];
    })
  );
}

function stageAfterPromptChange(current) {
  if ([
    'keyframes_generating',
    'keyframes_ready',
    'videos_generating',
    'videos_ready',
    'rendering',
    'completed',
  ].includes(current.stage)) {
    return current.assetReview?.confirmed ? 'assets_ready' : 'analysis_ready';
  }
  return current.stage;
}

function withInvalidatedPromptDerivatives(current, updates, targetModel) {
  return {
    ...current,
    ...updates,
    stage: stageAfterPromptChange(current),
    promptReview: {
      ...DEFAULT_PROMPT_REVIEW,
      targetModel: String(
        targetModel
        || updates.promptReview?.targetModel
        || current.promptReview?.targetModel
        || ''
      ),
      updatedAt: new Date().toISOString(),
    },
    keyframes: [],
    generatedVideos: [],
    timeline: (current.timeline || []).map(item => {
      const { videoUrl, ...rest } = item;
      return rest;
    }),
    output: null,
    updatedAt: new Date().toISOString(),
  };
}

export function buildVideoRemixShotPrompts(
  state,
  shotId,
  targetModel = '',
  options = {}
) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  const shot = current.shots.find(item => item.shotId === String(shotId || ''));
  if (!shot || shot.analysisStatus !== 'ready') return current;
  const model = String(
    targetModel
    || current.promptReview?.targetModel
    || current.prompts?.[shot.shotId]?.targetModel
    || ''
  );
  return withInvalidatedPromptDerivatives(current, {
    prompts: {
      ...(current.prompts || {}),
      [shot.shotId]: createPromptRecord(current, shot, model, options),
    },
  }, model);
}

export function buildAllVideoRemixPrompts(state, targetModel = '', options = {}) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  const model = String(targetModel || current.promptReview?.targetModel || '');
  const prompts = Object.fromEntries(
    current.shots
      .filter(shot => shot.analysisStatus === 'ready')
      .map(shot => [
        shot.shotId,
        createPromptRecord(current, shot, model, options),
      ])
  );
  return withInvalidatedPromptDerivatives(current, { prompts }, model);
}

export function updateVideoRemixPromptLayer(state, shotId, layer, value) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  const shot = current.shots.find(item => item.shotId === String(shotId || ''));
  if (!shot || !['rawPrompt', 'optimizedPrompt', 'imagePrompt'].includes(layer)) {
    return current;
  }
  const existing = current.prompts?.[shot.shotId]
    || createPromptRecord(
      current,
      shot,
      current.promptReview?.targetModel || ''
    );
  const nextValue = String(value || '').trim();
  let prompt = { ...existing, updatedAt: new Date().toISOString() };
  if (layer === 'rawPrompt') {
    const rawPrompt = nextValue;
    const resolvedPrompt = resolveVideoRemixPromptTemplate(
      current,
      shot.shotId,
      rawPrompt,
      { targetModel: existing.targetModel || '' }
    );
    prompt = {
      ...prompt,
      rawPrompt,
      rawSource: 'user',
      resolvedPrompt,
      optimizedTemplate: '',
      optimizedPrompt: '',
      optimizedSource: '',
      videoOptimizationHash: promptValueHash({
        analysisHash: existing.analysisHash,
        rawPrompt,
        targetModel: existing.targetModel || '',
      }),
      optimizationStatus: 'draft',
      optimizationError: undefined,
      videoProfileId: undefined,
    };
  }
  if (layer === 'optimizedPrompt') {
    prompt = {
      ...prompt,
      optimizedTemplate: '',
      optimizedPrompt: nextValue,
      optimizedSource: nextValue ? 'user' : '',
      optimizationStatus: promptLayerReady('user', nextValue)
        && promptLayerReady(prompt.imagePromptSource, prompt.imagePrompt)
        ? 'ready'
        : 'draft',
      optimizationError: undefined,
      videoProfileId: undefined,
    };
  }
  if (layer === 'imagePrompt') {
    prompt = {
      ...prompt,
      imagePromptTemplate: '',
      imagePrompt: nextValue,
      imagePromptSource: nextValue ? 'user' : 'analysis',
      optimizationStatus: promptLayerReady(prompt.optimizedSource, prompt.optimizedPrompt)
        && promptLayerReady(nextValue ? 'user' : 'analysis', nextValue)
        ? 'ready'
        : 'draft',
      optimizationError: undefined,
      imageProfileId: undefined,
    };
  }
  prompt.promptHash = promptValueHash({
    rawPrompt: prompt.rawPrompt,
    resolvedPrompt: prompt.resolvedPrompt,
    optimizedPrompt: prompt.optimizedPrompt,
    imagePrompt: prompt.imagePrompt,
    targetModel: prompt.targetModel,
  });
  return withInvalidatedPromptDerivatives(current, {
    prompts: {
      ...(current.prompts || {}),
      [shot.shotId]: prompt,
    },
  }, prompt.targetModel);
}

export function beginVideoRemixPromptOptimization(state, shotId) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  const safeShotId = String(shotId || '');
  const prompt = current.prompts?.[safeShotId];
  if (!prompt) return current;
  return withInvalidatedPromptDerivatives(current, {
    prompts: {
      ...current.prompts,
      [safeShotId]: {
        ...prompt,
        optimizationStatus: 'optimizing',
        optimizationError: undefined,
        updatedAt: new Date().toISOString(),
      },
    },
  }, prompt.targetModel);
}

export function applyVideoRemixPromptOptimization(state, shotId, {
  optimizedTemplate,
  imagePromptTemplate,
  videoProfileId,
  imageProfileId,
} = {}) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  const safeShotId = String(shotId || '');
  const prompt = current.prompts?.[safeShotId];
  if (!prompt) return current;
  const next = { ...prompt };
  if (optimizedTemplate !== undefined) {
    const validation = validateVideoRemixPromptTemplate(
      prompt.rawPrompt,
      optimizedTemplate
    );
    if (!validation.valid) {
      const detail = [
        validation.missing.length ? `缺少 ${validation.missing.join(', ')}` : '',
        validation.unknown.length ? `新增未知 ${validation.unknown.join(', ')}` : '',
      ].filter(Boolean).join('；');
      throw new Error(`视频 Prompt 优化结果破坏了资产占位符：${detail}`);
    }
    next.optimizedTemplate = String(optimizedTemplate || '').trim();
    next.optimizedPrompt = resolveVideoRemixPromptTemplate(
      current,
      safeShotId,
      next.optimizedTemplate,
      { targetModel: prompt.targetModel || '' }
    );
    next.optimizedSource = 'optimizer';
    next.videoProfileId = videoProfileId;
  }
  if (imagePromptTemplate !== undefined) {
    const validation = validateVideoRemixPromptTemplate(
      prompt.rawImagePrompt,
      imagePromptTemplate
    );
    if (!validation.valid) {
      const detail = [
        validation.missing.length ? `缺少 ${validation.missing.join(', ')}` : '',
        validation.unknown.length ? `新增未知 ${validation.unknown.join(', ')}` : '',
      ].filter(Boolean).join('；');
      throw new Error(`关键帧 Prompt 优化结果破坏了资产占位符：${detail}`);
    }
    next.imagePromptTemplate = String(imagePromptTemplate || '').trim();
    next.imagePrompt = resolveVideoRemixPromptTemplate(
      current,
      safeShotId,
      next.imagePromptTemplate,
      { imagePrompt: true }
    );
    next.imagePromptSource = 'optimizer';
    next.imageProfileId = imageProfileId;
  }
  const ready = promptLayerReady(next.optimizedSource, next.optimizedPrompt)
    && promptLayerReady(next.imagePromptSource, next.imagePrompt);
  next.optimizationStatus = ready ? 'ready' : 'optimizing';
  next.optimizationError = undefined;
  next.promptHash = promptValueHash({
    rawPrompt: next.rawPrompt,
    resolvedPrompt: next.resolvedPrompt,
    optimizedPrompt: next.optimizedPrompt,
    imagePrompt: next.imagePrompt,
    targetModel: next.targetModel,
  });
  next.updatedAt = new Date().toISOString();
  return withInvalidatedPromptDerivatives(current, {
    prompts: {
      ...current.prompts,
      [safeShotId]: next,
    },
    errors: current.errors.filter(item => !(
      item?.scope === 'prompt' && item?.id === safeShotId
    )),
  }, prompt.targetModel);
}

export function setVideoRemixPromptOptimizationError(
  state,
  shotId,
  message,
  retryable = true
) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  const safeShotId = String(shotId || '');
  const prompt = current.prompts?.[safeShotId];
  if (!prompt) return current;
  return {
    ...current,
    prompts: {
      ...current.prompts,
      [safeShotId]: {
        ...prompt,
        optimizationStatus: 'failed',
        optimizationError: String(message || 'Prompt 优化失败'),
        updatedAt: new Date().toISOString(),
      },
    },
    promptReview: {
      ...DEFAULT_PROMPT_REVIEW,
      targetModel: prompt.targetModel || current.promptReview?.targetModel || '',
      updatedAt: new Date().toISOString(),
    },
    errors: [
      ...current.errors.filter(item => !(
        item?.scope === 'prompt' && item?.id === safeShotId
      )),
      {
        scope: 'prompt',
        id: safeShotId,
        message: String(message || 'Prompt 优化失败'),
        retryable: Boolean(retryable),
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function invalidateVideoRemixShotPrompts(state, shotIds = []) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  const targets = new Set(
    (Array.isArray(shotIds) ? shotIds : [shotIds]).map(String)
  );
  const prompts = Object.fromEntries(
    Object.entries(current.prompts || {}).filter(([shotId]) => (
      !targets.has(shotId)
    ))
  );
  return withInvalidatedPromptDerivatives(current, { prompts });
}

export function getVideoRemixPromptReadiness(state) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  const total = current.shots.length;
  const ready = current.shots.filter(shot => {
    const prompt = current.prompts?.[shot.shotId];
    return Boolean(
      prompt
      && prompt.optimizationStatus === 'ready'
      && promptLayerReady(prompt.optimizedSource, prompt.optimizedPrompt)
      && promptLayerReady(prompt.imagePromptSource, prompt.imagePrompt)
      && promptTemplateTokens(prompt.resolvedPrompt).length === 0
      && promptTemplateTokens(prompt.optimizedPrompt).length === 0
      && promptTemplateTokens(prompt.imagePrompt).length === 0
    );
  }).length;
  const failed = current.shots.filter(shot => (
    current.prompts?.[shot.shotId]?.optimizationStatus === 'failed'
  )).length;
  return {
    total,
    ready,
    failed,
    confirmed: Boolean(current.promptReview?.confirmed),
  };
}

export function confirmVideoRemixPrompts(state) {
  const current = isVideoRemixState(state) ? state : createVideoRemixState();
  const readiness = getVideoRemixPromptReadiness(current);
  if (
    !current.assetReview?.confirmed
    || readiness.total === 0
    || readiness.ready !== readiness.total
  ) {
    return current;
  }
  const now = new Date().toISOString();
  return {
    ...current,
    promptReview: {
      confirmed: true,
      confirmedAt: now,
      updatedAt: now,
      targetModel: current.promptReview?.targetModel || '',
    },
    errors: current.errors.filter(item => item?.scope !== 'prompt'),
    updatedAt: now,
  };
}
