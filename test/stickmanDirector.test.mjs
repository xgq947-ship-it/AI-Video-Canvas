import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NODE,
  isValidNodeConnection,
} from '../shared/connectionRules.js';
import {
  compileFlowPrompt,
  createStickmanScriptFromAnalysis,
  mergeStickmanShotsPreservingGeneration,
  normalizeStickmanDirectorOutput,
  normalizeStickmanSettings,
  parseStickmanDirectorJson,
  resolveDirectorModel,
  rollupStickmanGenerationStatus,
  validateStickmanDirectorOutput,
} from '../shared/stickmanDirector.js';
import {
  buildStickmanMergeManifest,
  runStickmanDirector,
} from '../server/services/stickmanDirector.js';

const validShot = (id = 'shot_01', order = 1) => ({
  id,
  order,
  title: `镜头 ${order}`,
  duration: 6,
  visual: { scene: '白底房间', action: '火柴人抬手并转身' },
  audio: { ambience: ['轻微室内环境音'], sfx: ['脚步声'] },
  prompt: '极简火柴人动画。白底黑色火柴人。火柴人抬手并转身。',
  generation: { provider: 'flow', status: 'pending', retryCount: 0 },
});

test('火柴人设置会收敛比例、尺寸、镜头数量和时长', () => {
  const settings = normalizeStickmanSettings({
    aspectRatio: '9:16',
    width: 999,
    height: 999,
    shotCount: 100,
    totalDuration: 0,
    durationPerShot: -1,
  });

  assert.equal(settings.aspectRatio, '9:16');
  assert.deepEqual([settings.width, settings.height], [1080, 1920]);
  assert.equal(settings.shotCount, 30);
  assert.equal(settings.totalDuration, 48);
  assert.equal(settings.durationPerShot, 1.6);
});

test('每个镜头都编译成独立 Flow Prompt，包含画幅、声音和禁止项', () => {
  const prompt = compileFlowPrompt({
    duration: 8,
    visual: { scene: '空旷车站', action: '角色冲向出口', cameraMotion: '跟拍' },
    audio: { dialogue: { speaker: '甲', text: '快走！' }, sfx: ['脚步声'] },
  }, { aspectRatio: '16:9', width: 1920, height: 1080, nativeAudio: true });

  assert.match(prompt, /1920 × 1080/);
  assert.match(prompt, /甲/);
  assert.match(prompt, /跟拍/);
  assert.match(prompt, /禁止/);
});

test('导演输出 JSON 支持代码围栏，归一化后通过 Schema 校验', () => {
  const parsed = parseStickmanDirectorJson('```json\n{"title":"测试","shots":[{}]}\n```');
  assert.equal(parsed.title, '测试');

  const output = normalizeStickmanDirectorOutput({
    title: '测试剧本',
    shots: [validShot()],
  }, {
    sourceType: 'script',
    settings: { shotCount: 1, aspectRatio: '16:9', width: 1920, height: 1080 },
    model: { provider: 'gemini', modelId: 'gemini-test' },
  });

  const validation = validateStickmanDirectorOutput(output);
  assert.equal(validation.valid, true, validation.errors.join('; '));
  assert.deepEqual(output.global, {
    platform: '抖音',
    visualTheme: 'white-black',
    aspectRatio: '16:9',
    width: 1920,
    height: 1080,
    totalDuration: 6,
    shotCount: 1,
    language: 'zh-CN',
    pace: '标准',
    audioEnabled: true,
  });

  const deepseekOutput = normalizeStickmanDirectorOutput({ title: 'DeepSeek 输出', shots: [validShot()] }, {
    sourceType: 'script',
    settings: { shotCount: 1 },
    model: { provider: 'deepseek', modelId: 'deepseek-v4-pro' },
  });
  assert.equal(deepseekOutput.model.provider, 'deepseek');
  assert.equal(validateStickmanDirectorOutput(deepseekOutput).valid, true);
});

test('视频分析结果只转换成剧本素材，不直接生成最终分镜', () => {
  const script = createStickmanScriptFromAnalysis({
    title: '源视频',
    global: { story: '人物寻找出口', visualStyle: '极简黑白' },
    shots: [
      { id: 'source_1', startTime: 0, endTime: 2, summary: '人物进入房间', videoPrompt: '人物推门进入', soundPrompt: '门轴声' },
    ],
  }, { title: '参考视频剧本' });

  assert.equal(script.title, '参考视频剧本');
  assert.match(script.content, /不是最终分镜/);
  assert.match(script.content, /人物推门进入/);
  assert.match(script.content, /门轴声/);
  assert.match(script.notes, /最终分镜由火柴人视频导演 Skill 重新推导/);
});

test('Skill Runner 使用真实 Provider 适配接口，并在空 shots 时走修复调用', async () => {
  const calls = [];
  const result = await runStickmanDirector({
    sourceType: 'script',
    input: { title: '测试', content: '角色从左走到右' },
    settings: { shotCount: 1 },
    provider: 'gemini',
    allowFallback: false,
    providerRunner: async request => {
      calls.push(request);
      return calls.length === 1
        ? { raw: JSON.stringify({ title: '不完整' }), model: { provider: 'gemini', modelId: 'gemini-test' } }
        : { raw: JSON.stringify({ title: '已修复', shots: [validShot()] }), model: { provider: 'gemini', modelId: 'gemini-test' } };
    },
  });

  assert.equal(result.repaired, true);
  assert.equal(result.output.title, '已修复');
  assert.equal(calls.length, 2);
  assert.ok(calls[1].repairRaw.includes('缺少非空 shots'));
});

test('Skill Runner 支持 DeepSeek，并把自定义模型 ID 和 API Key 传给 Provider', async () => {
  let request;
  const result = await runStickmanDirector({
    sourceType: 'script',
    input: { title: 'DeepSeek 测试', content: '角色抬手' },
    settings: { shotCount: 1, modelId: 'deepseek-v4-flash' },
    provider: 'deepseek',
    apiKey: 'test-key',
    allowFallback: false,
    providerRunner: async next => {
      request = next;
      return { raw: JSON.stringify({ title: 'DeepSeek 分镜', shots: [validShot()] }), model: { provider: 'deepseek', modelId: 'deepseek-v4-flash' } };
    },
  });

  assert.equal(request.providerId, 'deepseek');
  assert.equal(request.apiKey, 'test-key');
  assert.equal(request.settings.modelId, 'deepseek-v4-flash');
  assert.equal(result.output.model.provider, 'deepseek');
});

test('参考视频先转成剧本，再调用导演 Skill 决定最终镜头', async () => {
  const calls = [];
  const result = await runStickmanDirector({
    sourceType: 'reference_video',
    input: {
      analysis: { shots: [{ id: 'source_1', startTime: 0, endTime: 2, summary: '挥手' }] },
      sourceVideo: { url: '/library/projects/demo/videos/source.mp4' },
    },
    settings: { shotCount: 1 },
    provider: 'gemini',
    allowFallback: false,
    providerRunner: async request => {
      calls.push(request);
      return { raw: JSON.stringify({ title: '导演重新推导', shots: [validShot()] }), model: { provider: 'gemini', modelId: 'gemini-test' } };
    },
  });

  assert.equal(calls[0].sourceType, 'script');
  assert.match(calls[0].input.content, /不是最终分镜/);
  assert.equal(result.output.sourceType, 'script');
  assert.equal(result.output.shots[0].sourceShotId, undefined);
  assert.equal(result.scriptDerived, true);
});

test('模型路由：DeepSeek 可显式执行，参考视频自动仍优先 Gemini', () => {
  assert.deepEqual(resolveDirectorModel({ sourceType: 'reference_video', provider: 'auto', hasVideo: true }), { provider: 'gemini', providerId: 'gemini-web' });
  assert.deepEqual(resolveDirectorModel({ sourceType: 'script', provider: 'codex' }), { provider: 'codex', providerId: 'codex-cli' });
  assert.deepEqual(resolveDirectorModel({ sourceType: 'script', provider: 'deepseek' }), { provider: 'deepseek', providerId: 'deepseek' });
});

test('拼接清单按分镜顺序排序并跳过失败镜头', () => {
  const manifest = buildStickmanMergeManifest({
    workflowId: 'demo',
    shots: [
      { id: 'shot_02', order: 2, status: 'completed', videoUrl: '/library/projects/demo/videos/2.mp4', duration: 4 },
      { id: 'shot_01', order: 1, status: 'completed', videoUrl: '/library/projects/demo/videos/1.mp4', duration: 5 },
      { id: 'shot_03', order: 3, status: 'failed', videoUrl: '/library/projects/demo/videos/3.mp4', duration: 6 },
    ],
    width: 1080,
    height: 1920,
  });

  assert.deepEqual(manifest.shots.map(shot => shot.id), ['shot_01', 'shot_02']);
  assert.equal(manifest.composition.height, 1920);
  assert.equal(manifest.shots[0].transition, 'hard_cut');
});

test('重新规划分镜时保留内容未变镜头的已生成结果，避免孤立已付费视频', () => {
  const previous = [
    { id: 'shot_01', prompt: 'A', generation: { provider: 'flow', status: 'completed', videoUrl: '/v/1.mp4', retryCount: 0 } },
    { id: 'shot_02', prompt: 'B', generation: { provider: 'flow', status: 'completed', videoUrl: '/v/2.mp4', retryCount: 0 } },
    { id: 'shot_03', prompt: 'C', generation: { provider: 'flow', status: 'failed', retryCount: 1 } },
  ];
  const next = [
    { id: 'shot_01', prompt: 'A', generation: { provider: 'flow', status: 'pending', retryCount: 0 } }, // 同 id 同内容 → 保留
    { id: 'shot_02', prompt: 'B-改写', generation: { provider: 'flow', status: 'pending', retryCount: 0 } }, // 同 id 但内容变了 → 重置
    { id: 'shot_03', prompt: 'C', generation: { provider: 'flow', status: 'pending', retryCount: 0 } }, // 之前失败无结果 → 重置
  ];
  const merged = mergeStickmanShotsPreservingGeneration(previous, next);

  assert.equal(merged[0].generation.status, 'completed');
  assert.equal(merged[0].generation.videoUrl, '/v/1.mp4');
  assert.equal(merged[1].generation.status, 'pending', '内容改写的镜头必须重置，不能挂错旧视频');
  assert.equal(merged[1].generation.videoUrl, undefined);
  assert.equal(merged[2].generation.status, 'pending');
});

test('状态汇总反映全部镜头，单镜头重生不会误报全部完成', () => {
  const shots = [
    { generation: { status: 'completed' } },
    { generation: { status: 'pending' } },
    { generation: { status: 'pending' } },
  ];
  const rollup = rollupStickmanGenerationStatus(shots);
  assert.equal(rollup.batchStatus, 'ready');
  assert.equal(rollup.storyboardStatus, 'ready');
  assert.equal(rollup.completed, 1);
  assert.equal(rollup.total, 3);

  assert.equal(rollupStickmanGenerationStatus([
    { generation: { status: 'completed' } }, { generation: { status: 'completed' } },
  ]).batchStatus, 'completed');
  assert.equal(rollupStickmanGenerationStatus([
    { generation: { status: 'completed' } }, { generation: { status: 'failed' } },
  ]).batchStatus, 'partial_failed');
  assert.equal(rollupStickmanGenerationStatus([
    { generation: { status: 'failed' } }, { generation: { status: 'pending' } },
  ]).batchStatus, 'failed');
  assert.equal(rollupStickmanGenerationStatus([
    { generation: { status: 'generating' } }, { generation: { status: 'pending' } },
  ]).batchStatus, 'running');
});

test('画布连接规则覆盖剧本链路、参考视频分析链路和拼接终点', () => {
  assert.equal(isValidNodeConnection(NODE.SCRIPT_INPUT, NODE.STICKMAN_DIRECTOR), true);
  assert.equal(isValidNodeConnection(NODE.REFERENCE_VIDEO, NODE.SCRIPT_INPUT), true);
  assert.equal(isValidNodeConnection(NODE.VIDEO, NODE.SCRIPT_INPUT), true);
  assert.equal(isValidNodeConnection(NODE.REFERENCE_VIDEO, NODE.VIDEO_ANALYSIS), true);
  assert.equal(isValidNodeConnection(NODE.VIDEO_ANALYSIS, NODE.STICKMAN_DIRECTOR), true);
  assert.equal(isValidNodeConnection(NODE.STICKMAN_DIRECTOR, NODE.STORYBOARD_COMPARE), true);
  assert.equal(isValidNodeConnection(NODE.STORYBOARD, NODE.FLOW_BATCH_VIDEO), true);
  assert.equal(isValidNodeConnection(NODE.FLOW_BATCH_VIDEO, NODE.VIDEO_MERGE), true);
  assert.equal(isValidNodeConnection(NODE.VIDEO_MERGE, NODE.VIDEO), false);
});
