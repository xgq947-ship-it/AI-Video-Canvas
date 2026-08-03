import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROMPT_OPTIMIZATION_PROFILES,
} from '../shared/promptOptimizationProfiles.js';
import {
  VIDEO_REMIX_ASSET_PROMPT_PROFILES,
  buildVideoRemixAssetConsistencyDefinition,
  mergeVideoRemixAssetConsistencyPack,
} from '../shared/videoRemixAssetPrompts.js';
import {
  addVideoRemixCharacterLook,
  applyVideoRemixGlobalAnalysis,
  applyVideoRemixAssetConsistencyResult,
  buildVideoRemixRawPrompt,
  confirmVideoRemixAssets,
  confirmVideoRemixAssetConsistencyPack,
  confirmVideoRemixAssetPrimaryReference,
  createVideoRemixShot,
  createVideoRemixState,
  getVideoRemixAssetConsistencyPack,
  getVideoRemixAssetConsistencyReadiness,
  getVideoRemixMinimumAssetReadiness,
  getVideoRemixShotReferencePlan,
  prepareVideoRemixAssetConsistencyPack,
  replaceVideoRemixCharacterLook,
  replaceVideoRemixAsset,
  resolveVideoRemixPromptTemplate,
} from '../shared/videoRemix.js';
import {
  normalizeGlobalVideoAnalysis,
} from '../server/services/videoRemix/videoAnalysisSchemas.js';

function character(overrides = {}) {
  return {
    id: 'CHAR_01',
    name: '林晓',
    identity: '28 岁中国女性，椭圆脸，右眼下方一颗小痣，齐肩黑发',
    looks: [{
      id: 'LOOK_01',
      name: '基础造型',
      description: '米白衬衫、深灰长裤、黑色乐福鞋',
      referenceImages: [],
      source: 'analysis',
    }],
    referenceImages: ['/character-source.jpg'],
    appearsInShots: ['shot_001'],
    source: 'analysis',
    ...overrides,
  };
}

function scene(overrides = {}) {
  return {
    id: 'SCENE_01',
    name: '现代厨房',
    visualDescription: 'L 形浅木橱柜，左侧落地窗，中央白色石材岛台',
    audioDescription: '轻微冰箱运转声',
    zones: [{ id: 'ZONE_01', name: '岛台区', description: '用于备餐和产品展示' }],
    referenceImages: ['/scene-source.jpg'],
    appearsInShots: ['shot_001'],
    source: 'analysis',
    ...overrides,
  };
}

function prop(overrides = {}) {
  return {
    id: 'PROP_01',
    name: '便携榨汁杯',
    category: 'hero',
    description: '圆柱形磨砂白杯身，透明杯盖，正面一枚圆形银色按钮',
    referenceImages: ['/prop-source.jpg'],
    appearsInShots: ['shot_001'],
    source: 'analysis',
    ...overrides,
  };
}

function stateFixture() {
  const shot = createVideoRemixShot({ shotId: 'shot_001', start: 0, end: 3 });
  shot.analysisStatus = 'ready';
  shot.storyBeat = { value: '人物拿起产品展示按钮', source: 'ai', confidence: 0.9, locked: false };
  shot.characters = [{ characterId: 'CHAR_01', lookId: 'LOOK_01' }];
  shot.scene = { sceneId: 'SCENE_01', sceneZone: 'ZONE_01' };
  shot.props = [{ propId: 'PROP_01', role: '产品特写' }];
  shot.frameBlueprint.shotSize = { value: '产品特写', source: 'ai', confidence: 0.9, locked: false };
  return createVideoRemixState({
    remixId: 'remix_asset_consistency',
    story: { summary: '产品展示', structure: ['展示'] },
    assets: {
      characters: [character()],
      scenes: [scene()],
      props: [prop()],
    },
    shots: [shot],
  });
}

function completedPack(kind, asset, urls) {
  const definition = buildVideoRemixAssetConsistencyDefinition(kind, asset);
  const pack = mergeVideoRemixAssetConsistencyPack(definition, null, []);
  return {
    ...pack,
    primaryConfirmed: true,
    confirmed: true,
    status: 'ready',
    items: pack.items.map((item, index) => ({
      ...item,
      url: urls[index],
      status: 'confirmed',
    })),
  };
}

test('人物、场景和道具各提供三张中文一致性参考图模板', () => {
  for (const [kind, profileIds] of Object.entries(VIDEO_REMIX_ASSET_PROMPT_PROFILES)) {
    assert.equal(profileIds.length, 3, kind);
    for (const profileId of profileIds) {
      const profile = PROMPT_OPTIMIZATION_PROFILES[profileId];
      assert.ok(profile, profileId);
      assert.equal(profile.nodeType, 'image');
      assert.match(profile.systemInstruction, /严格|生成/);
    }
  }

  const definition = buildVideoRemixAssetConsistencyDefinition('characters', character());
  assert.equal(definition.items[0].aspectRatio, '1:1');
  assert.deepEqual(definition.items[1].dependsOn, ['image-identity-front']);
  assert.deepEqual(definition.items[2].dependsOn, [
    'image-identity-front',
    'image-identity-angles',
  ]);
  assert.match(definition.items[0].prompt, /右眼下方一颗小痣/);
  assert.match(definition.anchorBlock, /人物身份锁定 CHAR_01/);
});

test('人物身份参考包不受新增或编辑服装造型影响', () => {
  let state = stateFixture();
  state.assets.characters[0].consistencyPack = completedPack(
    'characters',
    state.assets.characters[0],
    ['/character-front.jpg', '/character-angles.jpg', '/character-board.jpg']
  );
  const originalDefinition = buildVideoRemixAssetConsistencyDefinition(
    'characters',
    state.assets.characters[0]
  );

  state = addVideoRemixCharacterLook(state, 'CHAR_01', {
    id: 'LOOK_02',
    name: '晚宴造型',
    description: '黑色礼服、银色耳饰',
    referenceImages: [],
    source: 'upload',
  });
  let pack = getVideoRemixAssetConsistencyPack(state, 'characters', 'CHAR_01');
  assert.deepEqual(pack.items.map(item => item.url), [
    '/character-front.jpg',
    '/character-angles.jpg',
    '/character-board.jpg',
  ]);
  assert.equal(pack.confirmed, true);
  assert.equal(
    buildVideoRemixAssetConsistencyDefinition(
      'characters',
      state.assets.characters[0]
    ).definitionHash,
    originalDefinition.definitionHash
  );

  state = replaceVideoRemixCharacterLook(
    state,
    'CHAR_01',
    'LOOK_02',
    { source: 'upload', url: '/look-02.jpg' }
  );
  pack = getVideoRemixAssetConsistencyPack(state, 'characters', 'CHAR_01');
  assert.deepEqual(pack.items.map(item => item.url), [
    '/character-front.jpg',
    '/character-angles.jpg',
    '/character-board.jpg',
  ]);
  assert.equal(pack.confirmed, true);
});

test('未保存主提示词的人物新增造型时身份定义保持稳定', () => {
  const original = character();
  const changed = {
    ...original,
    looks: [
      ...original.looks,
      {
        id: 'LOOK_02',
        name: '运动造型',
        description: '蓝色运动外套、白色运动鞋',
        referenceImages: [],
        source: 'upload',
      },
    ],
  };
  const before = buildVideoRemixAssetConsistencyDefinition('characters', original);
  const after = buildVideoRemixAssetConsistencyDefinition('characters', changed);

  assert.equal(after.definitionHash, before.definitionHash);
  assert.doesNotMatch(after.masterPrompt, /运动造型|蓝色运动外套/);
});

test('一致性参考包先确认主图，再允许锁定完整三图包', () => {
  let state = prepareVideoRemixAssetConsistencyPack(
    stateFixture(),
    'characters',
    'CHAR_01'
  );
  let pack = getVideoRemixAssetConsistencyPack(state, 'characters', 'CHAR_01');
  assert.equal(pack.items[0].url, undefined);
  assert.equal(pack.primaryConfirmed, false);

  state = applyVideoRemixAssetConsistencyResult(
    state,
    'characters',
    'CHAR_01',
    'image-identity-front',
    { url: '/character-front.jpg' }
  );
  state = confirmVideoRemixAssetPrimaryReference(state, 'characters', 'CHAR_01');
  state = applyVideoRemixAssetConsistencyResult(
    state,
    'characters',
    'CHAR_01',
    'image-identity-angles',
    { url: '/character-angles.jpg' }
  );
  state = applyVideoRemixAssetConsistencyResult(
    state,
    'characters',
    'CHAR_01',
    'image-identity-board',
    { url: '/character-board.jpg' }
  );
  state = confirmVideoRemixAssetConsistencyPack(state, 'characters', 'CHAR_01');
  pack = getVideoRemixAssetConsistencyPack(state, 'characters', 'CHAR_01');
  assert.equal(pack.confirmed, true);
  assert.ok(pack.items.every(item => item.status === 'confirmed'));
  assert.equal(getVideoRemixAssetConsistencyReadiness(state).confirmed, 1);

  state = applyVideoRemixAssetConsistencyResult(
    state,
    'characters',
    'CHAR_01',
    'image-identity-front',
    { url: '/character-front-v2.jpg', source: 'upload' }
  );
  pack = getVideoRemixAssetConsistencyPack(state, 'characters', 'CHAR_01');
  assert.equal(pack.primaryConfirmed, false);
  assert.equal(pack.confirmed, false);
  assert.equal(pack.items[0].url, '/character-front-v2.jpg');
  assert.equal(pack.items[0].source, 'upload');
  assert.equal(pack.items[1].url, undefined);
  assert.equal(pack.items[2].url, undefined);
  assert.equal(getVideoRemixAssetConsistencyReadiness(state).confirmed, 0);
});

test('分析分镜截图不会成为人物、场景或道具资产图', () => {
  const current = stateFixture();
  current.shots[0].analysisFrames = [{
    position: 'middle',
    timestamp: 1.5,
    url: '/same-analysis-frame.jpg',
  }];
  const analyzed = applyVideoRemixGlobalAnalysis(current, {
    story: { summary: '产品展示', structure: ['展示'] },
    shotComplexities: [{
      shotId: 'shot_001',
      motionComplexity: 'simple',
      confidence: 0.9,
    }],
    characters: [character({
      referenceImages: ['/same-analysis-frame.jpg'],
      looks: [{
        id: 'LOOK_01',
        name: '基础造型',
        description: '米白衬衫、深灰长裤、黑色乐福鞋',
        referenceImages: ['/same-analysis-frame.jpg'],
        source: 'analysis',
      }],
    })],
    scenes: [scene({ referenceImages: ['/same-analysis-frame.jpg'] })],
    props: [prop({ referenceImages: ['/same-analysis-frame.jpg'] })],
  });

  assert.deepEqual(analyzed.assets.characters[0].referenceImages, []);
  assert.deepEqual(analyzed.assets.characters[0].looks[0].referenceImages, []);
  assert.deepEqual(analyzed.assets.scenes[0].referenceImages, []);
  assert.deepEqual(analyzed.assets.props[0].referenceImages, []);
  assert.equal(
    getVideoRemixAssetConsistencyPack(analyzed, 'characters', 'CHAR_01').items[0].url,
    undefined
  );
});

test('用户上传或生成的真实资产图可以播种一致性主图', () => {
  const state = replaceVideoRemixAsset(
    stateFixture(),
    'props',
    'PROP_01',
    {
      source: 'upload',
      name: '我的产品',
      description: '用户上传的白色圆柱形产品',
      referenceImages: ['/my-product.jpg'],
    }
  );
  const pack = getVideoRemixAssetConsistencyPack(state, 'props', 'PROP_01');

  assert.equal(pack.items[0].url, '/my-product.jpg');
  assert.equal(pack.items[0].source, 'existing');
});

test('最小资产门槛只要求一张真实人物主参考图，场景道具与三图包不阻断', () => {
  let state = stateFixture();
  assert.deepEqual(getVideoRemixMinimumAssetReadiness(state), {
    characterAssets: 1,
    preparedCharacters: 0,
    preparedCharacterIds: [],
    requiredCharacters: 1,
    ready: false,
  });
  assert.equal(confirmVideoRemixAssets(state).assetReview.confirmed, false);

  state = applyVideoRemixAssetConsistencyResult(
    state,
    'characters',
    'CHAR_01',
    'image-identity-front',
    { url: '/character-front.jpg' }
  );
  const readiness = getVideoRemixMinimumAssetReadiness(state);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.preparedCharacters, 1);
  assert.equal(getVideoRemixAssetConsistencyReadiness(state).confirmed, 0);
  assert.equal(getVideoRemixAssetConsistencyPack(
    state,
    'scenes',
    'SCENE_01'
  ).items[0].url, undefined);
  assert.equal(getVideoRemixAssetConsistencyPack(
    state,
    'props',
    'PROP_01'
  ).items[0].url, undefined);

  const confirmed = confirmVideoRemixAssets(state);
  assert.equal(confirmed.assetReview.confirmed, true);
  assert.equal(confirmed.stage, 'assets_ready');
});

test('没有人物的镜头允许完全使用提示词进入视频生成', () => {
  const state = stateFixture();
  state.assets.characters = [];
  state.shots[0].characters = [];
  state.shots[0].frameBlueprint.subjects = [];

  assert.deepEqual(getVideoRemixMinimumAssetReadiness(state), {
    characterAssets: 0,
    preparedCharacters: 0,
    preparedCharacterIds: [],
    requiredCharacters: 0,
    ready: true,
  });
  assert.equal(confirmVideoRemixAssets(state).assetReview.confirmed, true);
});

test('Gemini 旧结构缺少主提示词时自动补全中文主提示词和冻结锚点', () => {
  const {
    referenceImages: ignoredCharacterImages,
    source: ignoredCharacterSource,
    ...rawCharacter
  } = character();
  rawCharacter.looks = rawCharacter.looks.map(({
    referenceImages: ignoredLookImages,
    source: ignoredLookSource,
    ...look
  }) => look);
  const {
    referenceImages: ignoredSceneImages,
    source: ignoredSceneSource,
    ...rawScene
  } = scene();
  const {
    referenceImages: ignoredPropImages,
    source: ignoredPropSource,
    ...rawProp
  } = prop();
  const normalized = normalizeGlobalVideoAnalysis({
    story: { summary: '产品展示', genre: '广告', structure: ['展示'] },
    characters: [rawCharacter],
    scenes: [rawScene],
    props: [rawProp],
    style: '自然写实产品摄影',
    shotComplexities: [{ shotId: 'shot_001', motionComplexity: 'simple', confidence: 0.9 }],
  }, ['shot_001']);
  assert.match(normalized.characters[0].masterPrompt, /林晓/);
  assert.match(normalized.characters[0].anchorBlock, /人物身份锁定/);
  assert.match(normalized.scenes[0].anchorBlock, /场景空间锁定/);
  assert.match(normalized.props[0].anchorBlock, /道具结构锁定/);
});

test('提示词逐镜加入冻结锚点，产品特写优先选择产品三视图', () => {
  let state = stateFixture();
  state.assets.characters[0].consistencyPack = completedPack(
    'characters',
    state.assets.characters[0],
    ['/character-front.jpg', '/character-angles.jpg', '/character-board.jpg']
  );
  state.assets.scenes[0].consistencyPack = completedPack(
    'scenes',
    state.assets.scenes[0],
    ['/scene-main.jpg', '/scene-layout.jpg', '/scene-light.jpg']
  );
  state.assets.props[0].consistencyPack = completedPack(
    'props',
    state.assets.props[0],
    ['/prop-front.jpg', '/prop-angles.jpg', '/prop-details.jpg']
  );

  const plan = getVideoRemixShotReferencePlan(state, 'shot_001');
  assert.equal(plan.scenario, 'product_closeup');
  assert.deepEqual(plan.references.slice(0, 3).map(item => item.url), [
    '/prop-front.jpg',
    '/prop-angles.jpg',
    '/prop-details.jpg',
  ]);
  const template = buildVideoRemixRawPrompt(state, 'shot_001');
  assert.match(template, /【资产一致性锚点】/);
  assert.match(template, /\{\{CHAR_01\}\}/);
  const prompt = resolveVideoRemixPromptTemplate(state, 'shot_001', template);
  assert.match(prompt, /人物身份锁定 CHAR_01/);
  assert.match(prompt, /场景空间锁定 SCENE_01/);
  assert.match(prompt, /道具结构锁定 PROP_01/);
});
