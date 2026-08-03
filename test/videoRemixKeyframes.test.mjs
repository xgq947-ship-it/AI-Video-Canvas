import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyVideoRemixKeyframeResult,
  applyVideoRemixPromptOptimization,
  beginVideoRemixKeyframeGeneration,
  buildAllVideoRemixPrompts,
  buildVideoRemixShots,
  confirmVideoRemixKeyframes,
  confirmVideoRemixPrompts,
  createVideoRemixState,
  getVideoRemixKeyframeReadiness,
  keyframePositionsForComplexity,
  prepareVideoRemixKeyframes,
  recoverStaleVideoRemixKeyframes,
  replaceVideoRemixAsset,
  setVideoRemixKeyframeError,
  updateVideoRemixKeyframePrompt,
} from '../shared/videoRemix.js';

const editable = value => ({
  value,
  source: 'ai',
  confidence: 0.96,
  locked: false,
});

function keyframeFixture(complexity = 'medium', {
  characterReplacement = false,
  lookReplacement = false,
} = {}) {
  const [baseShot] = buildVideoRemixShots({ duration: 4 });
  const shot = {
    ...baseShot,
    analysisStatus: 'ready',
    motionComplexity: complexity,
    storyBeat: editable('人物走到桌边，拿起杯子。'),
    characters: [{ characterId: 'CHAR_01', lookId: 'LOOK_01' }],
    scene: { sceneId: 'SCENE_01', sceneZone: 'ZONE_TABLE' },
    props: [{ propId: 'PROP_01', role: '手持' }],
    analysisFrames: [
      { position: 'start', time: 0, url: '/library/start.png' },
      { position: 'middle', time: 2, url: '/library/middle.png' },
      { position: 'end', time: 4, url: '/library/end.png' },
    ],
    frameBlueprint: {
      shotSize: editable('中景'),
      cameraAngle: editable('平视'),
      subjects: [{
        id: 'CHAR_01',
        x: 0.3,
        y: 0.55,
        scale: 0.62,
        facing: '向右',
        pose: '行走',
      }],
      props: [{ id: 'PROP_01', x: 0.62, y: 0.62, scale: 0.12 }],
    },
    motionBlueprint: {
      subjects: [{
        characterId: 'CHAR_01',
        actionSequence: [
          { start: 0, end: 2, action: '走向桌边', category: 'body' },
          { start: 2, end: 4, action: '拿起杯子', category: 'object' },
        ],
        movementDirection: '从左向右',
      }],
      propInteractions: [{
        actor: 'CHAR_01',
        prop: 'PROP_01',
        action: '拿起',
        hand: 'right',
        start: 2,
        end: 4,
      }],
    },
    cameraBlueprint: {
      shotSize: editable('中景'),
      angle: editable('平视'),
      movement: [{ type: 'dolly_in', start: 0, end: 4 }],
      lensFeel: editable('自然'),
    },
    timingBlueprint: {
      phases: [
        { phase: '走近', start: 0, end: 2 },
        { phase: '拿杯', start: 2, end: 4 },
      ],
    },
    audioBlueprint: {
      dialogue: [],
      environment: editable('室内环境声'),
      soundEvents: [],
    },
    startState: {
      characterStates: {
        CHAR_01: { position: '画面左侧', direction: '向右', emotion: '平静' },
      },
      sceneId: 'SCENE_01',
      sceneZone: 'ZONE_TABLE',
      lighting: '暖色侧光',
    },
    endState: {
      characterStates: {
        CHAR_01: {
          holding: 'PROP_01',
          position: '桌边',
          direction: '向右',
          emotion: '惊讶',
        },
      },
      sceneId: 'SCENE_01',
      sceneZone: 'ZONE_TABLE',
      lighting: '暖色侧光',
    },
  };
  let state = createVideoRemixState({
    remixId: `remix_keyframe_${complexity}`,
    stage: 'assets_ready',
    source: {
      id: 'source',
      duration: 4,
      orientation: 'landscape',
    },
    story: {
      summary: '拿起杯子',
      structure: ['走近', '拿杯'],
      style: '写实短片',
    },
    assetReview: { confirmed: true },
    shots: [shot],
    assets: {
      characters: [{
        id: 'CHAR_01',
        name: '女主',
        identity: '黑色长发、椭圆脸',
        looks: [{
          id: 'LOOK_01',
          name: '日常装',
          description: '白色衬衫与黑色长裤',
          referenceImages: ['/library/look.png'],
          source: 'analysis',
          ...(lookReplacement ? {
            replacement: {
              source: 'upload',
              name: '新造型',
              description: '蓝色夹克与白色长裤',
              referenceImages: ['/library/new-look.png'],
              updatedAt: '2026-07-30T00:00:00.000Z',
            },
          } : {}),
        }],
        referenceImages: ['/library/character.png'],
        appearsInShots: [shot.shotId],
        source: 'analysis',
        ...(characterReplacement ? {
          replacement: {
            source: 'upload',
            name: '新女主',
            identity: '短发、清晰下颌线',
            referenceImages: ['/library/new-character.png'],
            updatedAt: '2026-07-30T00:00:00.000Z',
          },
        } : {}),
      }],
      scenes: [{
        id: 'SCENE_01',
        name: '咖啡厅',
        visualDescription: '木质桌椅与暖色灯光',
        zones: [{
          id: 'ZONE_TABLE',
          name: '桌边',
          description: '靠窗木桌',
        }],
        referenceImages: ['/library/scene.png'],
        appearsInShots: [shot.shotId],
        source: 'analysis',
      }],
      props: [{
        id: 'PROP_01',
        name: '咖啡杯',
        category: 'interactive',
        description: '白色陶瓷杯',
        referenceImages: ['/library/prop.png'],
        appearsInShots: [shot.shotId],
        source: 'analysis',
      }],
    },
  });
  state = buildAllVideoRemixPrompts(state, 'google-flow-omni-flash');
  const prompt = state.prompts[shot.shotId];
  state = applyVideoRemixPromptOptimization(state, shot.shotId, {
    optimizedTemplate: `【视频优化】\n${prompt.rawPrompt}`,
    videoProfileId: 'video-flow',
    imagePromptTemplate: `【关键帧优化】\n${prompt.rawImagePrompt}`,
    imageProfileId: 'image-remix-keyframe',
  });
  return confirmVideoRemixPrompts(state);
}

const keyframeOptions = {
  imageModel: 'google-flow-nano-banana-pro',
  aspectRatio: '16:9',
  resolution: '2K',
};

test('关键帧策略严格按 simple / medium / complex 分配', () => {
  assert.deepEqual(keyframePositionsForComplexity('simple'), ['start']);
  assert.deepEqual(keyframePositionsForComplexity('medium'), ['start', 'end']);
  assert.deepEqual(
    keyframePositionsForComplexity('complex'),
    ['start', 'middle', 'end']
  );
  assert.deepEqual(keyframePositionsForComplexity('unknown'), ['start', 'end']);
});

test('关键帧计划保存位置 Prompt、原参考帧与当前资产参考图', () => {
  let state = prepareVideoRemixKeyframes(
    keyframeFixture('complex', { characterReplacement: true }),
    keyframeOptions
  );

  assert.deepEqual(
    state.keyframes.map(item => item.position),
    ['start', 'middle', 'end']
  );
  assert.deepEqual(
    state.keyframes.map(item => item.sourceFrameUrl),
    ['/library/start.png', '/library/middle.png', '/library/end.png']
  );
  assert.match(state.keyframes[0].prompt, /起始帧/);
  assert.match(state.keyframes[1].prompt, /中间帧/);
  assert.match(state.keyframes[1].prompt, /拿起杯子/);
  assert.match(state.keyframes[2].prompt, /手持 咖啡杯/);
  assert.equal(state.keyframes[0].referenceImages[0], '/library/new-character.png');
  assert.equal(state.keyframes[0].referenceImages[1], '/library/start.png');
  assert.equal(state.keyframeReview.imageModel, keyframeOptions.imageModel);
  assert.equal(getVideoRemixKeyframeReadiness(state).total, 3);

  state = prepareVideoRemixKeyframes(
    keyframeFixture('simple', { lookReplacement: true }),
    keyframeOptions
  );
  assert.deepEqual(
    state.keyframes[0].referenceImages.slice(0, 2),
    [
      '/library/new-look.png',
      '/library/start.png',
    ]
  );
});

test('简单工作流无论动作复杂度都只准备一张起始关键帧', () => {
  const state = prepareVideoRemixKeyframes(
    keyframeFixture('complex'),
    { ...keyframeOptions, strategy: 'single' }
  );
  assert.deepEqual(state.keyframes.map(item => item.position), ['start']);
  assert.equal(state.keyframeReview.strategy, 'single');
  assert.match(state.keyframes[0].prompt, /起始帧/);
});

test('相同输入复用关键帧缓存，切换图片模型会安全失效', () => {
  let state = prepareVideoRemixKeyframes(
    keyframeFixture('simple'),
    keyframeOptions
  );
  const [keyframe] = state.keyframes;
  state = beginVideoRemixKeyframeGeneration(state, keyframe.id);
  state = applyVideoRemixKeyframeResult(state, keyframe.id, {
    url: '/library/generated.png',
    inputHash: keyframe.inputHash,
  });
  state = confirmVideoRemixKeyframes(state);

  const same = prepareVideoRemixKeyframes(state, keyframeOptions);
  assert.equal(same, state);
  assert.equal(same.keyframes[0].status, 'confirmed');

  const changed = prepareVideoRemixKeyframes(state, {
    ...keyframeOptions,
    imageModel: 'jimeng-image-5-0-pro',
  });
  assert.equal(changed.keyframes[0].status, 'pending');
  assert.equal(changed.keyframes[0].url, undefined);
  assert.equal(changed.keyframeReview.confirmed, false);
});

test('生成结果按 inputHash 防止旧任务覆盖，Prompt 编辑会清空旧成品', () => {
  let state = prepareVideoRemixKeyframes(
    keyframeFixture('simple'),
    keyframeOptions
  );
  const [keyframe] = state.keyframes;
  state = beginVideoRemixKeyframeGeneration(state, keyframe.id);
  const ignored = applyVideoRemixKeyframeResult(state, keyframe.id, {
    url: '/library/stale.png',
    inputHash: 'stale-input',
  });
  assert.equal(ignored, state);
  assert.equal(state.keyframes[0].status, 'generating');

  state = applyVideoRemixKeyframeResult(state, keyframe.id, {
    url: '/library/generated.png',
    inputHash: keyframe.inputHash,
  });
  assert.equal(state.keyframes[0].status, 'ready');
  state = confirmVideoRemixKeyframes(state);
  assert.equal(state.keyframeReview.confirmed, true);

  state = updateVideoRemixKeyframePrompt(
    state,
    keyframe.id,
    `${state.keyframes[0].prompt}\n【补充】保持手指与杯柄接触。`
  );
  assert.equal(state.keyframes[0].status, 'pending');
  assert.equal(state.keyframes[0].url, undefined);
  assert.equal(state.keyframes[0].promptSource, 'user');
  assert.equal(state.keyframeReview.confirmed, false);
});

test('单关键帧失败不清空其他结果，未知提交状态阻止自动批量重试', () => {
  let state = prepareVideoRemixKeyframes(
    keyframeFixture('medium'),
    keyframeOptions
  );
  const [start, end] = state.keyframes;
  state = beginVideoRemixKeyframeGeneration(state, start.id);
  state = beginVideoRemixKeyframeGeneration(state, end.id);
  state = applyVideoRemixKeyframeResult(state, start.id, {
    url: '/library/start-generated.png',
    inputHash: start.inputHash,
  });
  state = setVideoRemixKeyframeError(
    state,
    end.id,
    '平台已接收请求，但下载中断',
    {
      code: 'SUBMISSION_UNKNOWN',
      retryable: true,
      submitted: true,
      inputHash: end.inputHash,
    }
  );

  assert.equal(state.keyframes[0].status, 'ready');
  assert.equal(state.keyframes[0].url, '/library/start-generated.png');
  assert.equal(state.keyframes[1].status, 'failed');
  assert.equal(state.keyframes[1].retryBlocked, true);
  assert.equal(state.errors.at(-1).retryable, false);
  assert.equal(confirmVideoRemixKeyframes(state).keyframeReview.confirmed, false);
});

test('超过恢复窗口的 generating 任务转为可重试，活跃任务保持不变', () => {
  let state = prepareVideoRemixKeyframes(
    keyframeFixture('simple'),
    keyframeOptions
  );
  const [keyframe] = state.keyframes;
  state = beginVideoRemixKeyframeGeneration(state, keyframe.id);
  const fresh = recoverStaleVideoRemixKeyframes(
    state,
    Date.parse(state.keyframes[0].generationStartedAt) + 60_000,
    20 * 60_000
  );
  assert.equal(fresh, state);

  const recovered = recoverStaleVideoRemixKeyframes(
    state,
    Date.parse(state.keyframes[0].generationStartedAt) + 21 * 60_000,
    20 * 60_000
  );
  assert.equal(recovered.keyframes[0].status, 'failed');
  assert.equal(recovered.keyframes[0].errorCode, 'KEYFRAME_TASK_INTERRUPTED');
  assert.equal(recovered.keyframes[0].retryable, true);
});

test('资产替换会清空已生成关键帧与确认，防止旧人物继续下游生成', () => {
  let state = prepareVideoRemixKeyframes(
    keyframeFixture('simple'),
    keyframeOptions
  );
  const [keyframe] = state.keyframes;
  state = beginVideoRemixKeyframeGeneration(state, keyframe.id);
  state = applyVideoRemixKeyframeResult(state, keyframe.id, {
    url: '/library/generated.png',
    inputHash: keyframe.inputHash,
  });
  state = confirmVideoRemixKeyframes(state);

  state = replaceVideoRemixAsset(state, 'characters', 'CHAR_01', {
    source: 'upload',
    name: '第二版人物',
    identity: '卷发、圆脸',
    referenceImages: ['/library/character-v2.png'],
    updatedAt: '2026-07-30T01:00:00.000Z',
  });
  assert.deepEqual(state.keyframes, []);
  assert.equal(state.keyframeReview.confirmed, false);
  assert.equal(state.promptReview.confirmed, false);
});
