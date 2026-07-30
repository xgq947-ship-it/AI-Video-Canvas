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
