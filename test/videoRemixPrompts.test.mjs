import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyVideoRemixPromptOptimization,
  buildAllVideoRemixPrompts,
  buildVideoRemixImagePrompt,
  buildVideoRemixRawPrompt,
  buildVideoRemixShots,
  confirmVideoRemixPrompts,
  createVideoRemixState,
  getVideoRemixPromptReadiness,
  replaceVideoRemixAsset,
  resolveVideoRemixPromptTemplate,
  setVideoRemixPropRemoved,
  setVideoRemixPromptOptimizationError,
  setVideoRemixShotCharacterLook,
  updateVideoRemixPromptLayer,
  validateVideoRemixPromptTemplate,
} from '../shared/videoRemix.js';

const editable = value => ({
  value,
  source: 'ai',
  confidence: 0.95,
  locked: false,
});

function promptFixture() {
  const [baseShot] = buildVideoRemixShots({ duration: 3.2 });
  const shot = {
    ...baseShot,
    analysisStatus: 'ready',
    storyBeat: editable('女主走入大堂，拿起咖啡杯并询问对方。'),
    characters: [{ characterId: 'CHAR_01', lookId: 'LOOK_01' }],
    scene: { sceneId: 'SCENE_01', sceneZone: 'ZONE_ENTRY' },
    props: [{ propId: 'PROP_01', role: '手持' }],
    frameBlueprint: {
      shotSize: editable('medium'),
      cameraAngle: editable('eye_level'),
      subjects: [{
        id: 'CHAR_01',
        x: 0.28,
        y: 0.55,
        scale: 0.62,
        facing: 'right',
        pose: '行走起步',
      }],
      props: [{ id: 'PROP_01', x: 0.58, y: 0.63, scale: 0.12 }],
    },
    motionBlueprint: {
      subjects: [{
        characterId: 'CHAR_01',
        actionSequence: [
          { start: 0, end: 1.2, action: '向前走两步', category: 'body' },
          { start: 1.2, end: 2, action: '右手拿起杯子', category: 'object' },
        ],
        movementDirection: 'left_to_right',
      }],
      propInteractions: [{
        actor: 'CHAR_01',
        prop: 'PROP_01',
        action: 'pick_up',
        hand: 'right',
        start: 1.2,
        end: 2,
      }],
    },
    cameraBlueprint: {
      shotSize: editable('medium'),
      angle: editable('eye_level'),
      movement: [{ type: 'dolly_in', start: 0, end: 3.2 }],
      lensFeel: editable('natural'),
    },
    timingBlueprint: {
      phases: [
        { phase: 'approach', start: 0, end: 1.2 },
        { phase: 'pick_up', start: 1.2, end: 2 },
        { phase: 'dialogue', start: 2, end: 3.2 },
      ],
    },
    audioBlueprint: {
      dialogue: [{
        characterId: 'CHAR_01',
        text: editable('你怎么会在这里？'),
        emotion: '惊讶',
        start: 2,
        end: 3.2,
      }],
      environment: editable('轻微交谈声与室内混响'),
      soundEvents: [{ start: 0, end: 1.2, description: '自然脚步声' }],
    },
    startState: {
      characterStates: {},
      lighting: '暖色顶灯与右侧自然光',
    },
  };
  return createVideoRemixState({
    remixId: 'remix_prompt',
    stage: 'assets_ready',
    source: {
      id: 'source',
      duration: 3.2,
      orientation: 'landscape',
    },
    story: {
      summary: '重逢',
      structure: ['进入', '对话'],
      style: '写实商业短片',
    },
    assetReview: { confirmed: true },
    shots: [shot],
    assets: {
      characters: [{
        id: 'CHAR_01',
        name: '原女主',
        identity: '25 岁女性，黑色长发，椭圆脸',
        looks: [
          {
            id: 'LOOK_01',
            name: '日常装',
            description: '白色衬衫与深色长裤',
            referenceImages: ['/library/char-look-1.png'],
            source: 'analysis',
          },
          {
            id: 'LOOK_02',
            name: '晚宴装',
            description: '黑色礼服与银色耳环',
            referenceImages: ['/library/char-look-2.png'],
            source: 'analysis',
          },
        ],
        referenceImages: ['/library/char.png'],
        appearsInShots: [shot.shotId],
        source: 'analysis',
      }],
      scenes: [{
        id: 'SCENE_01',
        name: '酒店大堂',
        visualDescription: '暖色灯光、石材地面与休息区',
        audioDescription: '轻微顾客交谈声',
        zones: [{
          id: 'ZONE_ENTRY',
          name: '入口',
          description: '旋转门与接待台之间',
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
    keyframes: [{ id: 'stale', shotId: shot.shotId, position: 'start', status: 'confirmed' }],
    generatedVideos: [{ id: 'stale', shotId: shot.shotId, status: 'completed' }],
    output: { url: '/library/stale.mp4', duration: 3.2 },
  });
}

test('Raw Prompt 保留资产占位符与时间蓝图，Image Prompt 只描述静态关键帧', () => {
  const state = promptFixture();
  const shotId = state.shots[0].shotId;
  const raw = buildVideoRemixRawPrompt(state, shotId);
  const image = buildVideoRemixImagePrompt(state, shotId);

  assert.match(raw, /\{\{CHAR_01\}\}/);
  assert.match(raw, /\{\{SCENE_01\}\}/);
  assert.match(raw, /\{\{PROP_01\}\}/);
  assert.match(raw, /0\.0-1\.2 秒/);
  assert.match(raw, /用右手执行/);
  assert.doesNotMatch(raw, /right手/);
  assert.match(raw, /你怎么会在这里/);
  assert.match(raw, /自然脚步声/);

  assert.match(image, /\{\{CHAR_01\}\}/);
  assert.match(image, /中心约在画面 28% × 55%/);
  assert.match(image, /暖色顶灯与右侧自然光/);
  assert.doesNotMatch(image, /向前走两步/);
  assert.doesNotMatch(image, /0\.0-1\.2 秒/);
});

test('Resolved Prompt 按目标模型解析当前资产与单 Shot Look', () => {
  let state = promptFixture();
  const shotId = state.shots[0].shotId;
  const raw = buildVideoRemixRawPrompt(state, shotId);
  const jimeng = resolveVideoRemixPromptTemplate(state, shotId, raw, {
    targetModel: 'jimeng-seedance-2-0',
  });
  const flow = resolveVideoRemixPromptTemplate(state, shotId, raw, {
    targetModel: 'google-flow-omni-flash',
  });

  assert.match(jimeng, /@CHAR_01/);
  assert.match(jimeng, /@SCENE_01/);
  assert.match(jimeng, /日常装：白色衬衫与深色长裤/);
  assert.doesNotMatch(flow, /@CHAR_01/);
  assert.match(flow, /原女主（资产 CHAR_01/);

  state = setVideoRemixShotCharacterLook(
    state,
    shotId,
    'CHAR_01',
    'LOOK_02'
  );
  const changed = resolveVideoRemixPromptTemplate(
    state,
    shotId,
    raw,
    { targetModel: 'google-flow-omni-flash' }
  );
  assert.match(changed, /晚宴装：黑色礼服与银色耳环/);
});

test('优化模板必须完整保留资产占位符', () => {
  const source = '让 {{CHAR_01}} 在 {{SCENE_01}} 拿起 {{PROP_01}}';
  assert.deepEqual(
    validateVideoRemixPromptTemplate(source, `【动作】${source}`),
    { valid: true, missing: [], unknown: [] }
  );
  assert.deepEqual(
    validateVideoRemixPromptTemplate(source, '让 {{CHAR_01}} 走入 {{SCENE_01}}'),
    { valid: false, missing: ['PROP_01'], unknown: [] }
  );
  assert.deepEqual(
    validateVideoRemixPromptTemplate(source, `${source}，并加入 {{CHAR_02}}`),
    { valid: false, missing: [], unknown: ['CHAR_02'] }
  );
});

test('优化后端破坏资产占位符时拒绝保存，并可记录单 Shot 重试状态', () => {
  let state = buildAllVideoRemixPrompts(
    promptFixture(),
    'google-flow-omni-flash'
  );
  const shotId = state.shots[0].shotId;
  assert.throws(
    () => applyVideoRemixPromptOptimization(state, shotId, {
      optimizedTemplate: '【动作】人物走入大堂。',
      videoProfileId: 'video-flow',
    }),
    /破坏了资产占位符/
  );

  state = setVideoRemixPromptOptimizationError(
    state,
    shotId,
    '优化结果缺少 PROP_01',
    true
  );
  assert.equal(state.prompts[shotId].optimizationStatus, 'failed');
  assert.equal(state.errors.at(-1).scope, 'prompt');
  assert.equal(state.errors.at(-1).retryable, true);

  const prompt = state.prompts[shotId];
  state = applyVideoRemixPromptOptimization(state, shotId, {
    optimizedTemplate: `【优化视频】\n${prompt.rawPrompt}`,
    videoProfileId: 'video-flow',
  });
  assert.equal(
    state.errors.some(item => item.scope === 'prompt' && item.id === shotId),
    false
  );
});

test('视频与关键帧优化结果分层保存，全部就绪后才能确认', () => {
  let state = buildAllVideoRemixPrompts(
    promptFixture(),
    'google-flow-omni-flash'
  );
  const shotId = state.shots[0].shotId;
  const prompt = state.prompts[shotId];

  assert.equal(state.keyframes.length, 0);
  assert.equal(state.generatedVideos.length, 0);
  assert.equal(state.output, null);
  assert.equal(getVideoRemixPromptReadiness(state).ready, 0);
  assert.equal(confirmVideoRemixPrompts(state).promptReview.confirmed, false);

  state = applyVideoRemixPromptOptimization(state, shotId, {
    optimizedTemplate: `【优化视频】\n${prompt.rawPrompt}`,
    videoProfileId: 'video-flow',
  });
  assert.equal(state.prompts[shotId].optimizationStatus, 'optimizing');
  state = applyVideoRemixPromptOptimization(state, shotId, {
    imagePromptTemplate: `【优化关键帧】\n${prompt.rawImagePrompt}`,
    imageProfileId: 'image-remix-keyframe',
  });

  assert.equal(state.prompts[shotId].optimizationStatus, 'ready');
  assert.equal(getVideoRemixPromptReadiness(state).ready, 1);
  state = confirmVideoRemixPrompts(state);
  assert.equal(state.promptReview.confirmed, true);
});

test('替换资产会本地刷新 Resolved 与优化成品，不重复丢弃占位符模板', () => {
  let state = buildAllVideoRemixPrompts(
    promptFixture(),
    'google-flow-omni-flash'
  );
  const shotId = state.shots[0].shotId;
  const prompt = state.prompts[shotId];
  state = applyVideoRemixPromptOptimization(state, shotId, {
    optimizedTemplate: `【优化视频】\n${prompt.rawPrompt}`,
    videoProfileId: 'video-flow',
    imagePromptTemplate: `【优化关键帧】\n${prompt.rawImagePrompt}`,
    imageProfileId: 'image-remix-keyframe',
  });
  const templateBefore = state.prompts[shotId].optimizedTemplate;

  state = replaceVideoRemixAsset(state, 'characters', 'CHAR_01', {
    source: 'upload',
    name: '新女主',
    identity: '30 岁女性，短发，清晰下颌线',
    referenceImages: ['/library/new-char.png'],
    updatedAt: '2026-07-30T00:00:00.000Z',
  });

  assert.equal(state.prompts[shotId].optimizedTemplate, templateBefore);
  assert.match(state.prompts[shotId].resolvedPrompt, /新女主/);
  assert.match(state.prompts[shotId].optimizedPrompt, /新女主/);
  assert.doesNotMatch(state.prompts[shotId].optimizedPrompt, /原女主/);
  assert.equal(state.prompts[shotId].optimizationStatus, 'ready');
  assert.equal(state.assetReview.confirmed, false);
  assert.equal(state.promptReview.confirmed, false);
});

test('移除交互道具会去掉视觉引用，但保留正向空手动作约束', () => {
  let state = buildAllVideoRemixPrompts(
    promptFixture(),
    'google-flow-omni-flash'
  );
  const shotId = state.shots[0].shotId;
  state = setVideoRemixPropRemoved(state, 'PROP_01', true);

  assert.doesNotMatch(state.prompts[shotId].rawPrompt, /\{\{PROP_01\}\}/);
  assert.match(state.prompts[shotId].rawPrompt, /保持原手部运动路径并维持空手状态/);
  assert.doesNotMatch(state.prompts[shotId].resolvedPrompt, /白色陶瓷杯/);
  assert.equal(state.prompts[shotId].optimizationStatus, 'draft');
});

test('切换目标模型只使视频优化失效，独立关键帧优化可以复用', () => {
  let state = buildAllVideoRemixPrompts(
    promptFixture(),
    'google-flow-omni-flash'
  );
  const shotId = state.shots[0].shotId;
  const prompt = state.prompts[shotId];
  state = applyVideoRemixPromptOptimization(state, shotId, {
    optimizedTemplate: `【优化视频】\n${prompt.rawPrompt}`,
    videoProfileId: 'video-flow',
    imagePromptTemplate: `【优化关键帧】\n${prompt.rawImagePrompt}`,
    imageProfileId: 'image-remix-keyframe',
  });
  state = buildAllVideoRemixPrompts(
    state,
    'gemini-web-video',
    { resetVideoOptimization: true }
  );

  assert.equal(state.prompts[shotId].optimizedPrompt, '');
  assert.equal(state.prompts[shotId].optimizedSource, '');
  assert.equal(state.prompts[shotId].imagePromptSource, 'optimizer');
  assert.match(state.prompts[shotId].imagePrompt, /优化关键帧/);
  assert.equal(state.prompts[shotId].optimizationStatus, 'draft');
});

test('手动修改 Raw 会重新解析并清空旧视频优化结果', () => {
  let state = buildAllVideoRemixPrompts(
    promptFixture(),
    'google-flow-omni-flash'
  );
  const shotId = state.shots[0].shotId;
  const prompt = state.prompts[shotId];
  state = applyVideoRemixPromptOptimization(state, shotId, {
    optimizedTemplate: `【优化视频】\n${prompt.rawPrompt}`,
    videoProfileId: 'video-flow',
  });
  state = updateVideoRemixPromptLayer(
    state,
    shotId,
    'rawPrompt',
    `${prompt.rawPrompt}\n【补充锁定】保持右手动作连续。`
  );

  assert.match(state.prompts[shotId].resolvedPrompt, /保持右手动作连续/);
  assert.equal(state.prompts[shotId].optimizedPrompt, '');
  assert.equal(state.prompts[shotId].rawSource, 'user');
  assert.equal(state.promptReview.confirmed, false);
});
