import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HIGH_FIDELITY_LOCKS,
  VIDEO_REMIX_SCHEMA_VERSION,
  VIDEO_REMIX_STAGES,
  VIDEO_REMIX_WORKSPACE_TABS,
  beginVideoRemixPreprocessing,
  buildVideoRemixShots,
  completeVideoRemixPreprocessing,
  createVideoRemixState,
  isVideoRemixState,
  normalizeVideoRemixCutPoints,
  replaceVideoRemixSource,
  setVideoRemixPreprocessingError,
  setVideoRemixSourceError,
  summarizeVideoRemixState,
  workspaceTabForStage,
} from '../shared/videoRemix.js';

test('Video Remix 初始状态是可持久化的高复刻 source 阶段', () => {
  const state = createVideoRemixState({ remixId: 'remix_test' });

  assert.equal(state.schemaVersion, VIDEO_REMIX_SCHEMA_VERSION);
  assert.equal(state.remixId, 'remix_test');
  assert.equal(state.stage, 'source');
  assert.equal(state.mode, 'high_fidelity');
  assert.deepEqual(state.locks, HIGH_FIDELITY_LOCKS);
  assert.equal(state.locks.story, true);
  assert.equal(state.locks.characters, false);
  assert.equal(isVideoRemixState(state), true);
});

test('Video Remix 阶段和工作台页签保持稳定映射', () => {
  assert.equal(VIDEO_REMIX_STAGES.includes('keyframes_ready'), true);
  assert.deepEqual(
    VIDEO_REMIX_WORKSPACE_TABS.map(tab => tab.id),
    ['source', 'analysis', 'assets', 'shots', 'keyframes', 'videos', 'final']
  );
  assert.equal(workspaceTabForStage('analyzing'), 'analysis');
  assert.equal(workspaceTabForStage('preprocessing'), 'source');
  assert.equal(workspaceTabForStage('shots_ready'), 'shots');
  assert.equal(workspaceTabForStage('videos_ready'), 'videos');
  assert.equal(workspaceTabForStage('completed'), 'final');
});

test('镜头切点会排序、去重并过滤过短镜头', () => {
  assert.deepEqual(
    normalizeVideoRemixCutPoints(4, [3.9, 2, 0.1, 2, 1]),
    [0, 1, 2, 4]
  );
  assert.deepEqual(normalizeVideoRemixCutPoints(0, [1]), []);
});

test('Shot 占位蓝图完整，移动边界时保留镜头 id 并清空旧语义', () => {
  const original = buildVideoRemixShots({
    duration: 4,
    cutPoints: [2],
    detectionSource: 'ffmpeg',
    detections: [{ time: 2, score: 0.72 }],
  });
  original[0].storyBeat.value = '旧语义';
  const adjusted = buildVideoRemixShots({
    duration: 4,
    cutPoints: [2.4],
    previousShots: original,
    detectionSource: 'manual',
  });

  assert.equal(original.length, 2);
  assert.equal(original[1].detection.score, 0.72);
  assert.equal(original[0].analysisFrames.length, 0);
  assert.equal(adjusted[0].shotId, original[0].shotId);
  assert.equal(adjusted[0].storyBeat.value, '');
  assert.equal(adjusted[0].detection.source, 'manual');
  assert.equal(adjusted[0].frameBlueprint.subjects.length, 0);
  assert.equal(adjusted[0].audioBlueprint.dialogue.length, 0);
});

test('预处理状态会写入代理、Shot 与时间线，并可恢复为可重试错误', () => {
  const source = {
    id: 'ref_1',
    localUrl: '/library/source.mp4',
    duration: 4,
  };
  const state = createVideoRemixState({ remixId: 'remix_preprocess', source });
  const processing = beginVideoRemixPreprocessing(state);
  const shots = buildVideoRemixShots({ duration: 4, cutPoints: [2] });
  const ready = completeVideoRemixPreprocessing(processing, {
    source,
    proxyUrl: '/library/proxy.mp4',
    shots,
  });

  assert.equal(processing.stage, 'preprocessing');
  assert.equal(ready.stage, 'shots_ready');
  assert.equal(ready.source.proxyUrl, '/library/proxy.mp4');
  assert.deepEqual(ready.timeline.map(item => item.shotId), shots.map(item => item.shotId));
  assert.equal(ready.timeline[1].start, 2);

  const failed = setVideoRemixPreprocessingError(processing, '自动拆镜失败');
  assert.equal(failed.stage, 'source');
  assert.deepEqual(failed.errors.at(-1), {
    scope: 'preprocessing',
    message: '自动拆镜失败',
    retryable: true,
  });
});

test('Video Remix 摘要只统计已确认关键帧和已完成镜头视频', () => {
  const state = createVideoRemixState({
    remixId: 'remix_summary',
    assets: {
      characters: [{ id: 'char_1' }],
      scenes: [{ id: 'scene_1' }],
      props: [{ id: 'prop_1' }, { id: 'prop_2' }],
    },
    shots: [{ shotId: 'shot_1' }, { shotId: 'shot_2' }],
    keyframes: [
      { id: 'kf_1', status: 'confirmed' },
      { id: 'kf_2', status: 'ready' },
    ],
    generatedVideos: [
      { id: 'video_1', status: 'completed' },
      { id: 'video_2', status: 'failed' },
    ],
  });

  assert.deepEqual(summarizeVideoRemixState(state), {
    shots: 2,
    characters: 1,
    scenes: 1,
    props: 2,
    confirmedKeyframes: 1,
    completedVideos: 1,
  });
});

test('替换源视频会清除所有由旧视频派生的结果', () => {
  const state = createVideoRemixState({
    remixId: 'remix_replace',
    stage: 'videos_ready',
    source: { id: 'old' },
    story: { summary: 'old', structure: [] },
    shots: [{ shotId: 'shot_1' }],
    prompts: { shot_1: { rawPrompt: 'old' } },
    keyframes: [{ id: 'key_1', status: 'confirmed' }],
    generatedVideos: [{ id: 'video_1', status: 'completed' }],
    timeline: [{ shotId: 'shot_1' }],
    output: { url: '/old.mp4', duration: 1 },
    errors: [{ scope: 'source', message: 'old', retryable: true }],
  });
  const next = replaceVideoRemixSource(state, { id: 'new' });

  assert.equal(next.source.id, 'new');
  assert.equal(next.stage, 'source');
  assert.equal(next.story, null);
  assert.deepEqual(next.shots, []);
  assert.deepEqual(next.prompts, {});
  assert.deepEqual(next.keyframes, []);
  assert.deepEqual(next.generatedVideos, []);
  assert.deepEqual(next.timeline, []);
  assert.equal(next.output, null);
  assert.deepEqual(next.errors, []);
  assert.equal(next.createdAt, state.createdAt);
});

test('源视频错误保持可重试且只保留最近一次失败', () => {
  const state = createVideoRemixState({ remixId: 'remix_error' });
  const first = setVideoRemixSourceError(state, '第一次失败');
  const second = setVideoRemixSourceError(first, '第二次失败');

  assert.equal(second.stage, 'error');
  assert.deepEqual(second.errors, [{
    scope: 'source',
    message: '第二次失败',
    retryable: true,
  }]);
});

test('替换失败不会让已有 Remix 丢失原来的工作阶段', () => {
  const state = createVideoRemixState({
    remixId: 'remix_existing',
    stage: 'keyframes_ready',
    source: { id: 'existing' },
  });
  const next = setVideoRemixSourceError(state, '新链接下载失败');

  assert.equal(next.stage, 'keyframes_ready');
  assert.equal(next.source.id, 'existing');
  assert.equal(next.errors[0].message, '新链接下载失败');
});
