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

const TAB_BY_STAGE = Object.freeze({
  source: 'source',
  preprocessing: 'source',
  shots_ready: 'shots',
  analyzing: 'analysis',
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
