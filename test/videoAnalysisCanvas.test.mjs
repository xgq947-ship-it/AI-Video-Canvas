import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  assignVideoAnalysisInputPort,
  buildVideoAnalysisResultFromRemix,
  createVideoAnalysisNodeData,
  markVideoAnalysisDependentsStale,
  normalizeVideoAnalysisResult,
  syncVideoAnalysisInputRefs,
} from '../shared/videoAnalysis.js';

const analysisNode = (overrides = {}) => ({
  id: 'analysis-1',
  type: 'Video Analysis',
  videoAnalysis: createVideoAnalysisNodeData({
    status: 'completed',
    result: { global: { story: '旧故事' }, shots: [{ id: 'shot-1', imagePrompt: '旧图', videoPrompt: '旧视频' }] },
  }),
  parentIds: [],
  inputPortByParentId: {},
  ...overrides,
});

test('canvas video analysis keeps semantic input ports independent from parent order', () => {
  let node = analysisNode();
  node = assignVideoAnalysisInputPort(node, { id: 'scene-1', type: 'Image' }, 'scene-reference');
  node = assignVideoAnalysisInputPort(node, { id: 'video-1', type: 'Video' }, 'source-video');
  node = assignVideoAnalysisInputPort(node, { id: 'product-1', type: 'Image' }, 'product-reference');

  assert.deepEqual(node.parentIds, ['scene-1', 'video-1', 'product-1']);
  assert.equal(node.inputPortByParentId['video-1'], 'source-video');
  assert.deepEqual(node.videoAnalysis.inputRefs, {
    videoNodeId: 'video-1',
    productNodeIds: ['product-1'],
    characterNodeIds: [],
    sceneNodeIds: ['scene-1'],
  });

  const imageDroppedOnSource = assignVideoAnalysisInputPort(node, { id: 'image-2', type: 'Image' }, 'source-video');
  assert.equal(imageDroppedOnSource.inputPortByParentId['image-2'], 'character-reference');
  const videoDroppedOnReference = assignVideoAnalysisInputPort(imageDroppedOnSource, { id: 'video-2', type: 'Video' }, 'product-reference');
  assert.equal(videoDroppedOnReference.inputPortByParentId['video-2'], 'source-video');

  const replaced = assignVideoAnalysisInputPort(node, { id: 'video-2', type: 'Video' }, 'source-video');
  assert.equal(replaced.inputPortByParentId['video-1'], undefined);
  assert.equal(replaced.videoAnalysis.inputRefs.videoNodeId, 'video-2');
});

test('normalization produces one global continuity block and separate shot prompts', () => {
  const result = normalizeVideoAnalysisResult({
    source: { width: 720, height: 1280 },
    global: {
      story: { summary: '人物走进房间' },
      characters: [{ name: '主角', identity: '红衣' }],
      scenes: [{ name: '房间', visualDescription: '暖光' }],
    },
    shots: [
      { shotId: 'b', order: 2, start: 2, end: 4, imagePrompt: '后镜头', videoPrompt: '后动作' },
      { shotId: 'a', order: 1, start: 0, end: 2, imagePrompt: '前镜头', videoPrompt: '前动作' },
    ],
  });

  assert.equal(result.global.story, '人物走进房间');
  assert.equal(result.global.aspectRatio, '9:16');
  assert.match(result.global.globalPromptPrefix, /主角/);
  assert.deepEqual(result.shots.map(shot => shot.id), ['a', 'b']);
  assert.equal(result.shots[0].imagePrompt, '前镜头');
  assert.equal(result.shots[0].videoPrompt, '前动作');
});

test('input changes stale only the dependent analysis graph', () => {
  const nodes = [
    analysisNode({
      videoAnalysis: createVideoAnalysisNodeData({
        status: 'completed',
        result: { shots: [{ id: 'shot-1', imagePrompt: '图', videoPrompt: '视频' }] },
        inputRefs: { videoNodeId: 'video-1', productNodeIds: [], characterNodeIds: [], sceneNodeIds: [] },
      }),
      origin: undefined,
    }),
    { id: 'analysis-2', type: 'Video Analysis', videoAnalysis: createVideoAnalysisNodeData({ status: 'completed', result: { shots: [{ id: 'shot-2' }] }, inputRefs: { videoNodeId: 'video-2', productNodeIds: [], characterNodeIds: [], sceneNodeIds: [] } }) },
    { id: 'video-1-shot', type: 'Video', origin: { type: 'video-remix', analysisNodeId: 'analysis-1', shotId: 'shot-1', role: 'video' }, needsUpdate: false },
    { id: 'video-2-shot', type: 'Video', origin: { type: 'video-remix', analysisNodeId: 'analysis-2', shotId: 'shot-2', role: 'video' }, needsUpdate: false },
  ];

  const changed = markVideoAnalysisDependentsStale(nodes, 'video-1');
  assert.equal(changed[0].videoAnalysis.status, 'outdated');
  assert.equal(changed[1].videoAnalysis.status, 'completed');
  assert.equal(changed[2].needsUpdate, true);
  assert.equal(changed[3].needsUpdate, false);
});

test('legacy remix analysis is reduced to generation-ready prompts', () => {
  const result = buildVideoAnalysisResultFromRemix({
    source: { orientation: 'portrait' },
    globalAnalysis: {
      story: { summary: '展示产品' },
      style: '真实广告',
      characters: [{ id: 'c1', name: '模特', identity: '白衬衫' }],
      scenes: [{ id: 's1', name: '厨房', visualDescription: '明亮' }],
      props: [{ id: 'p1', name: '水杯', category: 'hero', description: '透明' }],
    },
    shotAnalyses: [{
      shotId: 'shot-1',
      start: 0,
      end: 3,
      duration: 3,
      storyBeat: { value: '模特拿起水杯' },
      scene: { sceneId: 's1' },
      frameBlueprint: {
        shotSize: { value: '中景' },
        cameraAngle: { value: '平视' },
        subjects: [{ id: 'c1', pose: '站立', facing: '正面', scale: 0.6 }],
        props: [{ id: 'p1' }],
      },
      motionBlueprint: { subjects: [{ actionSequence: [{ action: '拿起' }] }], propInteractions: [] },
      cameraBlueprint: { movement: [{ type: 'dolly_in' }] },
      audioBlueprint: { dialogue: [], environment: { value: '室内' }, soundEvents: [] },
    }],
  });

  assert.equal(result.global.story, '展示产品');
  assert.equal(result.shots.length, 1);
  assert.match(result.shots[0].imagePrompt, /模特/);
  assert.match(result.shots[0].videoPrompt, /拿起/);
  assert.equal(result.global.assetPrompts.characters.length, 1);
  assert.equal(result.global.assetPrompts.characters[0].profiles.length, 3);
  assert.deepEqual(
    result.global.assetPrompts.characters[0].profiles.map(profile => profile.profileId),
    ['image-identity-front', 'image-identity-angles', 'image-identity-board'],
  );
  for (const profile of result.global.assetPrompts.characters[0].profiles) {
    assert.match(profile.prompt, /人物实体保留正面身份照、面部多角度、全身综合设定板 3 张资产图/);
    assert.doesNotMatch(profile.prompt, /每个人物实体只生成并引用 1 张面部多角度身份图/);
  }
  assert.equal(result.global.assetPrompts.characters[0].primaryProfileId, 'image-identity-board');
  assert.equal(result.global.assetPrompts.scenes[0].profiles.length, 1);
  assert.equal(result.global.assetPrompts.scenes[0].profiles[0].profileId, 'image-scene-establishing');
  assert.equal(result.global.assetPrompts.props[0].profiles.length, 1);
  assert.equal(result.global.assetPrompts.props[0].profiles[0].profileId, 'image-prop-front');
  assert.match(result.global.assetPrompts.scenes[0].profiles[0].prompt, /画布参考图规则/);
});

test('资产提示词节点选项默认关闭，人物三图、场景道具单图', () => {
  const data = createVideoAnalysisNodeData({
    assetGeneration: {
      characters: { enabled: true, count: 3 },
    },
  });
  assert.equal(data.assetGeneration.characters.enabled, true);
  assert.equal(data.assetGeneration.characters.count, 3);
  assert.equal(data.assetGeneration.scenes.enabled, false);
  assert.equal(data.assetGeneration.scenes.count, 1);
  assert.equal(data.assetGeneration.props.enabled, false);
  assert.equal(data.assetGeneration.props.count, 1);
});

test('资产提示词开关只在对应参考图接入时置灰', () => {
  const source = fs.readFileSync(new URL('../src/features/video-analysis/VideoAnalysisNode.tsx', import.meta.url), 'utf8');
  assert.match(source, /kind === 'characters' \? 'character-reference' : kind === 'scenes' \? 'scene-reference' : 'product-reference'/);
  assert.match(source, /disabled=\{hasConnectedReference\}/);
  assert.doesNotMatch(source, /disabled=\{hasConnectedReference \|\| promptCount === 0\}/);
});

test('资产节点按类别单列纵向布局，并作为关键帧真实参考输入', () => {
  const graph = fs.readFileSync(new URL('../src/features/video-analysis/remixGraphBuilder.ts', import.meta.url), 'utf8');
  assert.match(graph, /version: 5/);
  assert.match(graph, /assetProfileRowGap: 420/);
  assert.match(graph, /assetReferenceNodeIds/);
  assert.match(graph, /VIDEO_ANALYSIS_ASSET_REFERENCE_PROFILE_IDS/);
  assert.match(graph, /const selectedAssetNodeIds = new Set\(assetNodeIds\)/);
  assert.match(graph, /assetNodeIds\.length > 0 \? REMIX_LAYOUT\.assetColumnGap/);
  assert.match(graph, /parentIds: \[analysisNodeId, \.\.\.assetReferenceNodeIds\]/);
  assert.match(graph, /'asset-reference'/);
  assert.match(graph, /assetReferenceNodeIds\.forEach\(assetId => edgeIds\.push\(`\$\{assetId\}->\$\{keyframe\.id\}`\)\)/);
});

test('选定人物资产作为引用边界，不把人物三图父链展开到关键帧视频请求', () => {
  const types = fs.readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
  const generation = fs.readFileSync(new URL('../src/hooks/useGeneration.ts', import.meta.url), 'utf8');
  assert.match(types, /videoAnalysisAssetReferenceBoundary\?: boolean/);
  assert.match(generation, /if \(!parent\.videoAnalysisAssetReferenceBoundary\)/);
});

test('关键帧依赖执行不会把已完成的视频分析节点当成可生成媒体', () => {
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /parent\.type !== NodeType\.TEXT && parent\.type !== NodeType\.VIDEO_ANALYSIS/);
});

test('普通视频节点提供参考视频链接解析导入', () => {
  const controls = fs.readFileSync(new URL('../src/components/canvas/NodeControls.tsx', import.meta.url), 'utf8');
  assert.match(controls, /resolveUrlReferenceVideo/);
  assert.match(controls, /aria-label="参考视频链接"/);
  assert.match(controls, /aria-label="解析并导入视频链接"/);
  assert.match(controls, /videoSourceType: 'url'/);
});

test('removing a connection re-syncs denormalized input refs', () => {
  const node = syncVideoAnalysisInputRefs(analysisNode(), {
    'video-1': 'source-video',
    'scene-1': 'scene-reference',
  });
  assert.equal(node.videoAnalysis.inputRefs.videoNodeId, 'video-1');
  const cleared = syncVideoAnalysisInputRefs(node, { 'scene-1': 'scene-reference' });
  assert.equal(cleared.videoAnalysis.inputRefs.videoNodeId, undefined);
  assert.equal(cleared.videoAnalysis.status, 'idle');
});
