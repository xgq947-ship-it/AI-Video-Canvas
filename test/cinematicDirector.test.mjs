import assert from 'node:assert/strict';
import test from 'node:test';

import { NODE, isValidNodeConnection } from '../shared/connectionRules.js';
import {
  buildCinematicMergeManifest,
  buildCinematicReferenceBundle,
  buildCinematicVideoRequest,
  compileCinematicPrompt,
  mergeCinematicShotsPreservingGeneration,
  normalizeCinematicDirectorOutput,
  normalizeCinematicSettings,
  parseCinematicDirectorJson,
  rollupCinematicGenerationStatus,
  validateCinematicDirectorOutput,
  validateCinematicReferenceBudget,
} from '../shared/cinematicDirector.js';
import { runCinematicDirector } from '../server/services/cinematicDirector.js';

const cast = [
  {
    id: 'CAST_01',
    name: '林深',
    role: 'protagonist',
    description: '28 岁咖啡师，深色短发，黑色围巾',
    referenceImages: [
      { id: 'front', url: '/library/projects/demo/images/front.png', source: 'ai', label: '正面身份照' },
      { id: 'board', url: '/library/projects/demo/images/board.png', source: 'ai', label: '综合设定板' },
    ],
  },
  {
    id: 'CAST_02',
    name: '周宁',
    role: 'supporting',
    description: '短发店员，米色外套',
    referenceImages: [
      { id: 'supporting', url: '/library/projects/demo/images/supporting.png', source: 'upload', label: '上传参考图' },
    ],
  },
];

const shot = (id = 'shot_01', order = 1, prompt = '雨夜咖啡店里，林深推门进入并看向窗边。') => ({
  id,
  order,
  title: `镜头 ${order}`,
  duration: 8,
  scene: '深夜街角咖啡店，雨势逐渐增大',
  action: '林深推开玻璃门走进店内，抖落肩头雨水并看向窗边',
  dialogue: { speaker: '林深', text: '还营业吗？' },
  cast: ['CAST_01'],
  camera: { shotType: '中景', fov: '47°自然人眼', angle: '平视', motion: '缓慢推近' },
  prompt,
  generation: { provider: 'google-flow', modelId: 'google-flow-omni-flash', status: 'pending', retryCount: 0 },
});

test('电影导演默认规格使用 9:16 1080×1920，并随视频模型同步原生音频', () => {
  const flow = normalizeCinematicSettings({});
  assert.deepEqual([flow.aspectRatio, flow.width, flow.height], ['9:16', 1080, 1920]);
  assert.equal(flow.videoModel, 'google-flow-omni-flash');
  assert.equal(flow.audioEnabled, true);

  const jimeng = normalizeCinematicSettings({
    videoModel: 'jimeng-seedance-2-0',
    aspectRatio: '1:1',
    width: 1080,
    height: 1080,
    audioEnabled: true,
    durationPerShot: 13,
  });
  assert.equal(jimeng.audioEnabled, false);
  assert.equal(jimeng.durationPerShot, 13);
  assert.deepEqual([jimeng.width, jimeng.height], [1080, 1080]);
});

test('角色参考图预算和真实请求会携带全部角色图及 Provider 标签', () => {
  assert.equal(validateCinematicReferenceBudget(cast, 'google-flow-omni-flash').valid, true);
  assert.equal(validateCinematicReferenceBudget([...cast, {
    id: 'CAST_03', name: '超额角色', role: 'supporting', description: '', referenceImages: [
      { id: 'a', url: '/a.png', source: 'upload', label: 'a' },
      { id: 'b', url: '/b.png', source: 'upload', label: 'b' },
      { id: 'c', url: '/c.png', source: 'upload', label: 'c' },
      { id: 'd', url: '/d.png', source: 'upload', label: 'd' },
      { id: 'e', url: '/e.png', source: 'upload', label: 'e' },
    ],
  }], 'google-flow-omni-flash').valid, false);

  const request = buildCinematicVideoRequest({
    workflowId: 'demo',
    nodeId: 'shot_01',
    shot: shot(),
    cast,
    settings: { videoModel: 'jimeng-seedance-2-0', aspectRatio: '16:9', width: 1920, height: 1080 },
  });
  assert.deepEqual(request.referenceImages, cast.flatMap(member => member.referenceImages.map(image => image.url)));
  assert.deepEqual(request.referenceImageLabels, ['林深', '林深', '周宁']);
  assert.equal(request.generateAudio, false);
  assert.deepEqual(buildCinematicReferenceBundle(cast).referenceImageLabels, ['林深', '林深', '周宁']);
});

test('电影提示词按 Flow / 即梦分别使用外观描述和角色 @ 标签', () => {
  const flowPrompt = compileCinematicPrompt(shot(), { videoModel: 'google-flow-omni-flash' }, cast);
  assert.match(flowPrompt, /林深：/);
  assert.doesNotMatch(flowPrompt, /@林深/);
  const jimengPrompt = compileCinematicPrompt(shot(), { videoModel: 'jimeng-seedance-2-0' }, cast);
  assert.match(jimengPrompt, /@林深/);
  assert.match(jimengPrompt, /中景/);
  assert.match(jimengPrompt, /47°自然人眼/);
});

test('导演输出 JSON 可修复、可校验，重新规划保留未变镜头的付费结果', () => {
  const parsed = parseCinematicDirectorJson('```json\n{"title":"测试","shots":[{}]}\n```');
  assert.equal(parsed.title, '测试');
  const output = normalizeCinematicDirectorOutput({ title: '雨夜咖啡店', cast, shots: [shot()] }, {
    settings: { shotCount: 1, aspectRatio: '9:16', width: 1080, height: 1920 },
    model: { provider: 'gemini', modelId: 'gemini-test' },
    cast,
  });
  const validation = validateCinematicDirectorOutput(output);
  assert.equal(validation.valid, true, validation.errors.join('; '));
  assert.equal(output.global.audioEnabled, true);

  const prior = [{ ...output.shots[0], generation: { ...output.shots[0].generation, status: 'completed', videoUrl: '/video/paid.mp4' } }];
  const preserved = mergeCinematicShotsPreservingGeneration(prior, output.shots);
  assert.equal(preserved[0].generation.videoUrl, '/video/paid.mp4');
  assert.equal(rollupCinematicGenerationStatus(preserved).batchStatus, 'completed');
  const manifest = buildCinematicMergeManifest({ workflowId: 'demo', shots: [{ id: 'shot_02', order: 2, status: 'completed', videoUrl: '/2.mp4' }, { id: 'shot_01', order: 1, status: 'completed', videoUrl: '/1.mp4' }] });
  assert.deepEqual(manifest.shots.map(item => item.id), ['shot_01', 'shot_02']);
  assert.deepEqual(manifest.shots.map(item => item.volume), [1, 1], '电影拼接默认继承每个原片音频');
});

test('电影工作流连接规则固定为剧本 + 角色 → 导演 → 分镜 → 拼接', () => {
  assert.equal(isValidNodeConnection(NODE.SCRIPT_INPUT, NODE.CINEMATIC_DIRECTOR), true);
  assert.equal(isValidNodeConnection(NODE.CINEMATIC_CAST, NODE.CINEMATIC_DIRECTOR), true);
  assert.equal(isValidNodeConnection(NODE.CINEMATIC_DIRECTOR, NODE.CINEMATIC_STORYBOARD), true);
  assert.equal(isValidNodeConnection(NODE.CINEMATIC_STORYBOARD, NODE.CINEMATIC_VIDEO_MERGE), true);
  assert.equal(isValidNodeConnection(NODE.STICKMAN_DIRECTOR, NODE.CINEMATIC_STORYBOARD), false);
});

test('电影导演 Skill Runner 对无 shots 的真实 Provider 输出执行一次修复', async () => {
  const calls = [];
  const result = await runCinematicDirector({
    input: { title: '测试', content: '林深在雨夜推开咖啡店玻璃门。' },
    cast,
    settings: { shotCount: 1, totalDuration: 8 },
    provider: 'gemini',
    allowFallback: false,
    providerRunner: async request => {
      calls.push(request);
      return calls.length === 1
        ? { raw: JSON.stringify({ title: '不完整' }), model: { provider: 'gemini', modelId: 'gemini-test' } }
        : { raw: JSON.stringify({ title: '已修复', cast, shots: [shot()] }), model: { provider: 'gemini', modelId: 'gemini-test' } };
    },
  });
  assert.equal(result.repaired, true);
  assert.equal(result.output.title, '已修复');
  assert.equal(calls.length, 2);
  assert.match(calls[1].repairRaw, /不完整/);
  assert.match(calls[1].repairErrors.join(';'), /shots/);
});

test('导演修复仍无 shots 时拒绝生成默认伪分镜', async () => {
  let calls = 0;
  await assert.rejects(
    runCinematicDirector({
      input: { title: '测试', content: '林深在雨夜推开咖啡店玻璃门。' },
      cast,
      settings: { shotCount: 1 },
      provider: 'gemini',
      allowFallback: false,
      providerRunner: async () => {
        calls += 1;
        return { raw: JSON.stringify({ title: calls === 1 ? '不完整' : '仍不完整' }), model: { provider: 'gemini', modelId: 'gemini-test' } };
      },
    }),
    /伪分镜/,
  );
  assert.equal(calls, 2);
});
