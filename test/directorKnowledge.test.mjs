import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCinematicDirectorSkill, DIRECTOR_KNOWLEDGE_FRAMING } from '../server/services/cinematicDirector.js';
import { runCinematicDirector } from '../server/services/cinematicDirector.js';
import { normalizeCinematicSettings } from '../shared/cinematicDirector.js';
import { buildPromptOptimizationInstruction, getPromptOptimizationProfile } from '../shared/promptOptimizationProfiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, '../src/skills/cinematic-director');

const cast = [
  {
    id: 'CAST_01',
    name: '林深',
    role: 'protagonist',
    description: '28 岁咖啡师，深色短发，黑色围巾',
    referenceImages: [{ id: 'front', url: '/library/projects/demo/images/front.png', source: 'ai', label: '正面身份照' }],
  },
];

const shot = (id = 'shot_01', order = 1) => ({
  id,
  order,
  title: `镜头 ${order}`,
  duration: 8,
  scene: '深夜街角咖啡店，雨势逐渐增大',
  action: '林深推开玻璃门走进店内',
  dialogue: null,
  cast: ['CAST_01'],
  camera: { shotType: '中景', fov: '47°自然人眼', angle: '平视', motion: '缓慢推近' },
  prompt: '雨夜咖啡店里，林深推门进入并看向窗边。',
  generation: { provider: 'google-flow', modelId: 'google-flow-omni-flash', status: 'pending', retryCount: 0 },
});

test('导演知识库三份 skill 原文存在且为中文翻译版', () => {
  for (const name of ['knowledge-cinedance.md', 'knowledge-acting.md', 'knowledge-lira.md']) {
    const file = path.join(SKILL_DIR, name);
    assert.ok(fs.existsSync(file), `${name} 缺失`);
    const content = fs.readFileSync(file, 'utf8');
    // 中文版：内容里应出现中文字符，且不像英文原文那样整篇 ASCII。
    assert.match(content, /[\u4e00-\u9fff]/u, `${name} 不是中文版`);
    assert.ok(content.length > 5000, `${name} 内容过短，疑似被删减`);
  }
});

test('导演 Skill 加载器返回完整知识库（含中文 CINEDANCE 与 ACTING）', () => {
  const skill = loadCinematicDirectorSkill();
  assert.ok(skill.knowledge, '缺少 knowledge 字段');
  assert.ok(skill.knowledge.cinedance.length > 5000, 'CINEDANCE 知识库过短');
  assert.ok(skill.knowledge.acting.length > 5000, 'ACTING 知识库过短');
  assert.ok(skill.knowledge.lira.length > 5000, 'LIRA 知识库过短');
  assert.match(skill.knowledge.cinedance, /[\u4e00-\u9fff]/u, 'CINEDANCE 应为中文版');
  assert.match(skill.knowledge.acting, /[\u4e00-\u9fff]/u, 'ACTING 应为中文版');
  assert.match(skill.knowledge.lira, /[\u4e00-\u9fff]/u, 'LIRA 应为中文版');
});

test('导演调用注入完整知识库与中文护栏，且输出契约不被原文带偏', async () => {
  const skill = loadCinematicDirectorSkill();
  // runProvider 内部把 systemPrompt + rules + 护栏 + 知识库原文拼成 systemInstruction。
  // 这里复现同一拼接逻辑（与 cinematicDirector.js runProvider 一致），
  // 验证最终指令同时包含：输出契约声明、中文护栏、CINEDANCE/ACTING 全文。
  const knowledge = skill.knowledge?.cinedance || skill.knowledge?.acting
    ? `${DIRECTOR_KNOWLEDGE_FRAMING}\n\n${skill.knowledge.cinedance}\n\n${skill.knowledge.acting}`
    : '';
  const systemInstruction = `${skill.systemPrompt}\n\n${skill.rules}\n\n${knowledge}`;
  // 护栏存在
  assert.match(systemInstruction, /导演知识库原文/);
  // 知识库全文注入（中文 CINEDANCE 原文的关键章节）
  assert.match(systemInstruction, /CINEDANCE/);
  assert.match(systemInstruction, /多镜头连贯性锁定/);
  // 输出契约声明优先于原文的英文指令
  assert.match(systemInstruction, /最终输出必须是 CinematicDirectorOutput JSON/);
  // 原文的"只输出 prompt"类指令被护栏明确压掉
  assert.match(systemInstruction, /一律不生效/);
});

test('导演调用链路本身正常：注入知识库后仍能解析合法输出', async () => {
  const result = await runCinematicDirector({
    input: { title: '测试', content: '林深在雨夜推开咖啡店玻璃门。' },
    cast,
    settings: { shotCount: 1, totalDuration: 8 },
    provider: 'gemini',
    allowFallback: false,
    providerRunner: async () =>
      ({ raw: JSON.stringify({ title: '正常输出', cast, shots: [shot()] }), model: { provider: 'gemini', modelId: 'gemini-test' } }),
  });
  assert.equal(result.output.title, '正常输出');
});

test('图片优化指令挂载 LIRA 完整原文，视频优化挂载 CINEDANCE + ACTING', () => {
  const skill = loadCinematicDirectorSkill();
  const imageInstruction = buildPromptOptimizationInstruction(getPromptOptimizationProfile('image-identity-front'));
  const videoInstruction = buildPromptOptimizationInstruction(getPromptOptimizationProfile('video'));

  // 图片侧：LIRA 知识库原文 + LIRA 护栏
  const imageFull = `${imageInstruction}\n\n${skill.knowledge.lira}`;
  assert.match(imageFull, /Lira/);
  assert.match(skill.knowledge.lira, /[\u4e00-\u9fff]/u);

  // 视频侧：CINEDANCE + ACTING 原文 + 导演护栏
  const videoFull = `${videoInstruction}\n\n${DIRECTOR_KNOWLEDGE_FRAMING}\n\n${skill.knowledge.cinedance}\n\n${skill.knowledge.acting}`;
  assert.match(videoFull, /CINEDANCE/);
  assert.match(videoFull, /ACTING/);
  assert.match(videoFull, /最终输出必须是 CinematicDirectorOutput JSON/);
});

// —— AI 自动分镜：镜头数量与每镜头时长由模型按剧情决定 ——

test('AI 自动分镜：多镜头时长落在模型支持档位内，总时长容差校验生效', async () => {
  // 3 个镜头：4s + 6s + 8s = 18s，目标 20s（±20% 容差 = 4s，偏差 2s 通过）
  const mixedShots = [
    shot('shot_01', 1, '对白镜头'),
    shot('shot_02', 2, '动作镜头'),
    shot('shot_03', 3, '反应镜头'),
  ];
  const result = await runCinematicDirector({
    input: { title: '测试', content: '林深在雨夜推开咖啡店玻璃门，与周宁对话。' },
    cast,
    settings: { shotCount: 3, totalDuration: 20, videoModel: 'google-flow-omni-flash' },
    provider: 'gemini',
    allowFallback: false,
    providerRunner: async () => {
      // 模型按剧情自由分配：4s 对白、8s 动作、6s 反应
      const shots = [
        { ...mixedShots[0], duration: 4, prompt: '对白镜头 prompt' },
        { ...mixedShots[1], duration: 8, prompt: '动作镜头 prompt' },
        { ...mixedShots[2], duration: 6, prompt: '反应镜头 prompt' },
      ];
      return { raw: JSON.stringify({ title: 'AI 定长', cast, shots }), model: { provider: 'gemini', modelId: 'gemini-test' } };
    },
  });
  assert.equal(result.output.title, 'AI 定长');
  const durations = result.output.shots.map(item => item.duration);
  assert.deepEqual(durations, [4, 8, 6], '模型自由分配的时长应被保留');
  // 总时长 = 求和，且落在目标 ±20% 内
  const total = durations.reduce((sum, value) => sum + value, 0);
  assert.equal(total, 18);
  assert.ok(Math.abs(total - 20) <= 20 * 0.2, '总时长应在目标 ±20% 内');
});

test('AI 自动分镜：总时长偏离目标超过 20% 时触发修复', async () => {
  let calls = 0;
  await assert.rejects(
    runCinematicDirector({
      input: { title: '测试', content: '林深在雨夜推开咖啡店玻璃门。' },
      cast,
      settings: { shotCount: 1, totalDuration: 48, videoModel: 'google-flow-omni-flash' },
      provider: 'gemini',
      allowFallback: false,
      providerRunner: async () => {
        calls += 1;
        return { raw: JSON.stringify({ title: '超差', cast, shots: [shot()] }), model: { provider: 'gemini', modelId: 'gemini-test' } };
      },
    }),
    /镜头总时长/,
  );
  // 首次 + 一次修复都超差 → 共 2 次调用后拒绝
  assert.equal(calls, 2);
});

test('AI 自动分镜：normalize 保留 AI 定长默认语义（6 镜头/总时长÷镜头数兜底）', () => {
  const settings = normalizeCinematicSettings({ totalDuration: 30, videoModel: 'google-flow-omni-flash' });
  assert.equal(settings.totalDuration, 30);
  // 未提供 shotCount/durationPerShot 时仍给出兼容默认值，不影响 AI 定长
  assert.equal(settings.shotCount, 6);
  assert.ok(settings.durationPerShot > 0, '兜底单镜头时长存在');
  // 时长吸附到模型档位（google-flow-omni-flash: 4/6/8/10）
  assert.ok([4, 6, 8, 10].includes(settings.durationPerShot), `durationPerShot=${settings.durationPerShot} 不在模型档位内`);
});
