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
  return {
    ...current,
    stage: completedShots === shots.length ? 'analysis_ready' : 'analyzing',
    story: {
      ...result.story,
      ...(result.style ? { style: result.style } : {}),
    },
    assets: {
      characters: Array.isArray(result.characters) ? result.characters : [],
      scenes: Array.isArray(result.scenes) ? result.scenes : [],
      props: Array.isArray(result.props) ? result.props : [],
    },
    shots,
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
    && Object.hasOwn(value, 'value')
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

function mergeUserLockedEditables(previous, incoming) {
  if (isLockedUserEditable(previous)) return previous;
  if (Array.isArray(incoming)) {
    const prior = Array.isArray(previous) ? previous : [];
    const merged = incoming.map((value, index) => (
      mergeUserLockedEditables(prior[index], value)
    ));
    prior.forEach((value, index) => {
      if (index >= incoming.length && containsLockedUserEditable(value)) merged.push(value);
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
