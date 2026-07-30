import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HIGH_FIDELITY_LOCKS,
  VIDEO_REMIX_SCHEMA_VERSION,
  VIDEO_REMIX_STAGES,
  VIDEO_REMIX_WORKSPACE_TABS,
  addVideoRemixCharacterLook,
  applyVideoRemixGlobalAnalysis,
  applyVideoRemixShotAnalysis,
  beginVideoRemixAnalysis,
  beginVideoRemixPreprocessing,
  buildVideoRemixShots,
  confirmVideoRemixAssets,
  completeVideoRemixPreprocessing,
  createVideoRemixState,
  isVideoRemixState,
  normalizeVideoRemixCutPoints,
  replaceVideoRemixAsset,
  replaceVideoRemixSource,
  resolveVideoRemixAsset,
  resolveVideoRemixShotCharacter,
  setVideoRemixPropRemoved,
  setVideoRemixPreprocessingError,
  setVideoRemixShotCharacterLook,
  setVideoRemixShotAnalysisError,
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

test('全片与逐 Shot 分析可以增量落状态，单镜头失败不清空已完成结果', () => {
  const source = {
    id: 'ref_analysis',
    localUrl: '/library/source.mp4',
    proxyUrl: '/library/proxy.mp4',
    duration: 2,
  };
  const shots = buildVideoRemixShots({ duration: 2, cutPoints: [1] });
  let state = createVideoRemixState({
    remixId: 'remix_analysis',
    source,
    shots,
    stage: 'shots_ready',
  });
  state = beginVideoRemixAnalysis(state, 'deep');
  state = applyVideoRemixGlobalAnalysis(state, {
    story: { summary: '故事', genre: '剧情', structure: ['开始'] },
    characters: [],
    scenes: [],
    props: [],
    style: '写实',
    mode: 'deep',
    analysisKey: 'analysis_1',
    shotComplexities: shots.map(shot => ({
      shotId: shot.shotId,
      motionComplexity: 'simple',
      confidence: 0.8,
    })),
  });

  assert.equal(state.analysisRun.globalStatus, 'ready');
  assert.equal(state.analysisRun.analysisKey, 'analysis_1');
  assert.equal(state.shots[0].analysisStatus, 'pending');
  assert.equal(state.shots[0].motionComplexity, 'simple');

  state.shots[0].storyBeat = {
    value: '用户锁定',
    source: 'user',
    locked: true,
  };
  state = applyVideoRemixShotAnalysis(state, {
    ...state.shots[0],
    storyBeat: { value: 'AI 第一镜', source: 'ai', confidence: 0.9, locked: false },
  });
  state = setVideoRemixShotAnalysisError(state, state.shots[1].shotId, '第二镜失败', {
    code: 'ANALYSIS_SCHEMA_INVALID',
  });

  assert.equal(state.stage, 'analysis_partial');
  assert.equal(state.analysisRun.completedShots, 1);
  assert.equal(state.shots[0].storyBeat.value, '用户锁定');
  assert.equal(state.shots[1].analysisStatus, 'failed');
  assert.equal(state.errors.at(-1).id, state.shots[1].shotId);
});

test('全片资产自动引用原 Shot 分析帧，重新分析保留用户替换与新增造型', () => {
  const shots = buildVideoRemixShots({ duration: 1 }).map(shot => ({
    ...shot,
    analysisFrames: [{
      position: 'middle',
      time: 0.5,
      url: '/library/projects/test/frame-middle.jpg',
    }],
  }));
  const global = {
    story: { summary: '故事', structure: ['开始'] },
    characters: [{
      id: 'CHAR_01',
      name: '人物',
      identity: '身份',
      looks: [{
        id: 'LOOK_01',
        name: '日常',
        description: '白衣',
        referenceImages: [],
        source: 'analysis',
      }],
      referenceImages: [],
      appearsInShots: [shots[0].shotId],
      source: 'analysis',
    }],
    scenes: [],
    props: [],
    shotComplexities: [{
      shotId: shots[0].shotId,
      motionComplexity: 'simple',
      confidence: 0.9,
    }],
  };
  let state = applyVideoRemixGlobalAnalysis(createVideoRemixState({
    remixId: 'remix_asset_frames',
    source: { id: 'source', duration: 1 },
    shots,
  }), global);

  assert.deepEqual(state.assets.characters[0].referenceImages, [
    '/library/projects/test/frame-middle.jpg',
  ]);
  assert.deepEqual(state.assets.characters[0].looks[0].referenceImages, [
    '/library/projects/test/frame-middle.jpg',
  ]);

  state = replaceVideoRemixAsset(state, 'characters', 'CHAR_01', {
    source: 'upload',
    name: '替换人物',
    identity: '替换身份',
    referenceImages: ['/library/projects/test/replacement.jpg'],
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  state = addVideoRemixCharacterLook(state, 'CHAR_01', {
    id: 'LOOK_USER',
    name: '新增造型',
    description: '黑衣',
    referenceImages: ['/library/projects/test/look.jpg'],
    source: 'upload',
  });
  state = applyVideoRemixGlobalAnalysis(state, global);

  assert.equal(resolveVideoRemixAsset(state.assets.characters[0]).name, '替换人物');
  assert.equal(
    state.assets.characters[0].looks.some(look => look.id === 'LOOK_USER'),
    true
  );
  assert.equal(state.assetReview.confirmed, false);
});

test('资产全局替换作用于所有 Shot，单 Shot 只覆盖所选造型', () => {
  const shots = buildVideoRemixShots({ duration: 2, cutPoints: [1] }).map((shot, index) => ({
    ...shot,
    analysisStatus: 'ready',
    characters: [{ characterId: 'CHAR_01', lookId: 'LOOK_01' }],
    scene: { sceneId: 'SCENE_01', sceneZone: 'ZONE_01' },
    props: [{ propId: 'PROP_01', role: '手持' }],
    analysisFrames: [{
      position: 'middle',
      time: shot.start + 0.5,
      url: `/library/frame-${index + 1}.jpg`,
    }],
  }));
  let state = createVideoRemixState({
    remixId: 'remix_assets',
    stage: 'analysis_ready',
    story: { summary: '测试', structure: ['开始'] },
    shots,
    assets: {
      characters: [{
        id: 'CHAR_01',
        name: '原人物',
        identity: '原身份',
        looks: [{
          id: 'LOOK_01',
          name: '原造型',
          description: '白衣',
          referenceImages: ['/library/original-look.jpg'],
          source: 'analysis',
        }],
        referenceImages: ['/library/original-character.jpg'],
        appearsInShots: shots.map(shot => shot.shotId),
        source: 'analysis',
      }],
      scenes: [{
        id: 'SCENE_01',
        name: '咖啡厅',
        visualDescription: '咖啡厅室内',
        zones: [{ id: 'ZONE_01', name: '入口', description: '门口' }],
        referenceImages: [],
        appearsInShots: shots.map(shot => shot.shotId),
        source: 'analysis',
      }],
      props: [{
        id: 'PROP_01',
        name: '杯子',
        category: 'interactive',
        description: '白杯',
        referenceImages: [],
        appearsInShots: shots.map(shot => shot.shotId),
        source: 'analysis',
      }],
    },
    prompts: { shot_001: { rawPrompt: 'stale' } },
    keyframes: [{ id: 'old', status: 'confirmed' }],
    generatedVideos: [{ id: 'old', status: 'completed' }],
    output: { url: '/library/old.mp4', duration: 2 },
  });

  state = replaceVideoRemixAsset(state, 'characters', 'CHAR_01', {
    source: 'library',
    name: '新人物',
    identity: '新身份',
    referenceImages: ['/library/new-character.jpg'],
    libraryAssetId: 'asset_character',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  state = replaceVideoRemixAsset(state, 'scenes', 'SCENE_01', {
    source: 'upload',
    name: '酒店',
    visualDescription: '酒店大堂',
    referenceImages: ['/library/hotel.jpg'],
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  state = replaceVideoRemixAsset(state, 'props', 'PROP_01', {
    source: 'generated',
    name: '按摩器',
    description: '手持按摩器',
    referenceImages: ['/library/massager.jpg'],
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  assert.equal(resolveVideoRemixAsset(state.assets.characters[0]).name, '新人物');
  assert.equal(resolveVideoRemixAsset(state.assets.scenes[0]).name, '酒店');
  assert.equal(resolveVideoRemixAsset(state.assets.props[0]).name, '按摩器');
  assert.equal(resolveVideoRemixShotCharacter(state, shots[0].shotId, 'CHAR_01').character.name, '新人物');
  assert.equal(resolveVideoRemixShotCharacter(state, shots[1].shotId, 'CHAR_01').character.name, '新人物');
  assert.match(state.prompts[shots[0].shotId].rawPrompt, /\{\{CHAR_01\}\}/);
  assert.match(state.prompts[shots[0].shotId].resolvedPrompt, /新人物/);
  assert.match(state.prompts[shots[0].shotId].resolvedPrompt, /酒店/);
  assert.match(state.prompts[shots[0].shotId].resolvedPrompt, /按摩器/);
  assert.equal(state.prompts[shots[0].shotId].optimizedPrompt, '');
  assert.deepEqual(state.keyframes, []);
  assert.deepEqual(state.generatedVideos, []);
  assert.equal(state.output, null);

  state = addVideoRemixCharacterLook(state, 'CHAR_01', {
    id: 'LOOK_LIBRARY',
    name: '晚宴造型',
    description: '黑色礼服',
    referenceImages: ['/library/look-library.jpg'],
    source: 'library',
  });
  state = setVideoRemixShotCharacterLook(
    state,
    shots[1].shotId,
    'CHAR_01',
    'LOOK_LIBRARY'
  );

  assert.equal(resolveVideoRemixShotCharacter(state, shots[0].shotId, 'CHAR_01').look.id, 'LOOK_01');
  assert.equal(resolveVideoRemixShotCharacter(state, shots[1].shotId, 'CHAR_01').look.id, 'LOOK_LIBRARY');

  state = applyVideoRemixShotAnalysis(state, {
    ...state.shots[1],
    characters: [{ characterId: 'CHAR_01', lookId: 'LOOK_01' }],
  });
  assert.equal(
    resolveVideoRemixShotCharacter(state, shots[1].shotId, 'CHAR_01').look.id,
    'LOOK_LIBRARY'
  );

  state = setVideoRemixPropRemoved(state, 'PROP_01', true);
  assert.equal(state.assets.props[0].removed, true);
  state = confirmVideoRemixAssets(state);
  assert.equal(state.stage, 'assets_ready');
  assert.equal(state.assetReview.confirmed, true);
});

test('单 Shot 造型覆盖按人物 ID 合并，不受重新分析返回顺序影响', () => {
  const [shot] = buildVideoRemixShots({ duration: 1 });
  let state = createVideoRemixState({
    remixId: 'remix_look_reorder',
    stage: 'analysis_ready',
    story: { summary: '测试', structure: ['开始'] },
    shots: [{
      ...shot,
      analysisStatus: 'ready',
      characters: [
        { characterId: 'CHAR_01', lookId: 'LOOK_01' },
        { characterId: 'CHAR_02', lookId: 'LOOK_03' },
      ],
    }],
    assets: {
      characters: [
        {
          id: 'CHAR_01',
          name: '人物一',
          identity: '身份一',
          looks: [
            {
              id: 'LOOK_01',
              name: '日常',
              description: '日常装',
              referenceImages: [],
              source: 'analysis',
            },
            {
              id: 'LOOK_02',
              name: '礼服',
              description: '晚礼服',
              referenceImages: [],
              source: 'analysis',
            },
          ],
          referenceImages: [],
          appearsInShots: [shot.shotId],
          source: 'analysis',
        },
        {
          id: 'CHAR_02',
          name: '人物二',
          identity: '身份二',
          looks: [{
            id: 'LOOK_03',
            name: '固定造型',
            description: '固定装束',
            referenceImages: [],
            source: 'analysis',
          }],
          referenceImages: [],
          appearsInShots: [shot.shotId],
          source: 'analysis',
        },
      ],
      scenes: [],
      props: [],
    },
  });

  state = setVideoRemixShotCharacterLook(
    state,
    shot.shotId,
    'CHAR_01',
    'LOOK_02'
  );
  state = applyVideoRemixShotAnalysis(state, {
    ...state.shots[0],
    characters: [
      { characterId: 'CHAR_02', lookId: 'LOOK_03' },
      { characterId: 'CHAR_01', lookId: 'LOOK_01' },
    ],
  });

  assert.equal(
    resolveVideoRemixShotCharacter(state, shot.shotId, 'CHAR_01').look.id,
    'LOOK_02'
  );
  assert.equal(
    state.shots[0].characters.find(item => item.characterId === 'CHAR_02').lookOverride,
    undefined
  );
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
