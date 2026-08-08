import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPromptOptimizerProvider, listPromptOptimizerProviders } from './promptOptimizerProviders.js';
import { browserSessionState } from './browserSessionState.js';
import { RUNTIME_PATHS } from '../runtime/paths.js';
import { getVideoGenerationProvider } from '../../shared/generationProviders.js';
import {
  CINEMATIC_ASPECT_RATIOS,
  getCinematicVideoModel,
  normalizeCinematicCast,
  normalizeCinematicDirectorOutput,
  normalizeCinematicSettings,
  parseCinematicDirectorJson,
  validateCinematicCast,
  validateCinematicDirectorOutput,
  validateCinematicReferenceBudget,
} from '../../shared/cinematicDirector.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_SKILL_ROOT = path.resolve(__dirname, '../../src/skills/cinematic-director');
const PACKAGED_SKILL_ROOT = path.join(RUNTIME_PATHS.resourcesDir, 'src', 'skills', 'cinematic-director');

const readSkillFile = filename => {
  const candidates = [path.join(PACKAGED_SKILL_ROOT, filename), path.join(DEV_SKILL_ROOT, filename)];
  for (const candidate of candidates) {
    try {
      return fs.readFileSync(candidate, 'utf8');
    } catch {
      // The packaged desktop build and dev server intentionally use the same
      // source resources, so try the other root before failing.
    }
  }
  throw new Error(`电影导演 Skill 资源缺失：${filename}`);
};

// 知识库原文是增强材料：缺失时降级为空字符串，不让导演主流程崩溃。
const readOptionalSkillFile = filename => {
  try {
    return readSkillFile(filename);
  } catch {
    return '';
  }
};

export const loadCinematicDirectorSkill = () => ({
  systemPrompt: readSkillFile('system-prompt.md'),
  rules: readSkillFile('director-rules.md'),
  schema: readSkillFile('shot-schema.json'),
  // 完整导演知识库原文（CINEDANCE / ACTING / LIRA 三份 skill 逐字保留，
  // 已翻译为中文，专业术语保留英文）。供导演模型深度吸收方法论，
  // 与精简规则互补：规则负责"必须执行"，原文负责"理解为什么、案例长什么样"。
  knowledge: {
    cinedance: readOptionalSkillFile('knowledge-cinedance.md'),
    acting: readOptionalSkillFile('knowledge-acting.md'),
    lira: readOptionalSkillFile('knowledge-lira.md'),
  },
});

// 知识库原文的身份与输出指令以英文 skill 人格为背景，与 Evan 的中文 JSON
// 分镜输出契约冲突。注入时必须带这段中文护栏，声明优先级。
export const DIRECTOR_KNOWLEDGE_FRAMING = `
# 导演知识库原文（完整 skill，已译中文）

以下是 CINEDANCE V4 导演系统与 ACTING 表演系统的完整原文。请深度吸收其中的
方法论、案例与细节标准，并在生成分镜时逐条应用。

重要约束（优先级最高）：
- 你的身份与输出格式以本系统提示开头部分和 shot-schema.json 为准：
  最终输出必须是 CinematicDirectorOutput JSON，不是单独的 Seedance prompt。
- 知识库原文中凡是要求"只输出 prompt""输出英文 prompt""除非用户要求否则不输出
  分析"之类的指令，在本任务中一律不生效——你始终输出符合 schema 的中文 JSON 分镜。
- 知识库中的专业术语（FOV、@tag、Seedance、reference 等）在输出 prompt 时可
  保留英文原词，其余内容使用中文。
`;

const providerLabel = providerId => {
  const item = listPromptOptimizerProviders().find(provider => provider.id === providerId);
  return item?.label || providerId;
};

const alternateProvider = providerId => providerId === 'gemini-web' ? 'codex-cli' : 'gemini-web';

const outputModel = (providerId, modelId) => ({
  provider: providerId === 'codex-cli' ? 'codex' : providerId === 'deepseek' ? 'deepseek' : 'gemini',
  modelId: modelId || providerId,
});

const requestModelFor = (providerId, settings) => {
  const provider = getPromptOptimizerProvider(providerId);
  return String(settings?.modelId || provider?.defaultModel || '').trim();
};

const buildUserPrompt = ({ script, cast, settings, skill }) => [
  '请根据电影导演规则返回 CinematicDirectorOutput JSON。',
  'sourceType: script',
  `settings: ${JSON.stringify(settings)}`,
  // AI 自动分镜：镜头数量与每镜头时长由剧情决定，不要求等于设置值。
  `分镜要求：镜头数量与每镜头时长由 AI 根据剧情节奏自行决定，无需等于设置中的 shotCount/durationPerShot。` +
  `目标总时长约 ${settings.totalDuration} 秒（允许 ±20% 浮动）。` +
  `每镜头时长必须使用当前视频模型 ${settings.videoModel} 支持的档位（${(getCinematicVideoModel(settings.videoModel)?.supportedDurations || []).join('/')} 秒），` +
  `动作密度高、信息量大的镜头用长档位，对白、反应、过渡镜头用短档位，总时长尽量接近目标。`,
  // 台词模式：auto=AI 按剧情自动创作台词；preserve=只保留剧本已有对白；none=不生成任何台词。
  `台词要求：dialogueMode=${settings.dialogueMode || 'auto'}。` +
  (settings.dialogueMode === 'none'
    ? '本片不需要台词：所有镜头的 dialogue 留空，声音只保留明确音效或环境声。'
    : settings.dialogueMode === 'preserve'
      ? '只保留剧本中已有对白（原样引用），剧本没有的对白一律不创作。'
      : 'AI 自动创作台词：为适合的镜头生成贴合剧情与角色的口语化台词。' +
        '规则：①说话者必须是该镜头 cast 中出场的角色，禁止场外音与画外旁白；②每镜头 0-2 句，' +
        '短镜头（4s 内）最多 1 句或不说，8s 以上镜头最多 2 句；③台词口语化、简短有力，' +
        '避免书面腔与长篇大论；④台词字数与镜头时长匹配（约每秒 3-4 字）；⑤连续镜头里同一角色' +
        '避免连说两镜（除非剧情强需求）；⑥情绪或情节关键镜头必须有台词，纯过场/氛围镜头可无台词。'),
  `cast: ${JSON.stringify(cast)}`,
  `script: ${JSON.stringify({
    title: script?.title || '',
    content: script?.content || '',
    notes: script?.notes || '',
  })}`,
  `schema: ${skill.schema}`,
].join('\n\n');

const buildRepairPrompt = ({ raw, script, cast, settings, skill, errors = [] }) => [
  '上一次输出没有通过 JSON/Schema 校验。只返回修复后的完整 JSON，不要解释。',
  `校验错误: ${errors.join('；') || 'JSON 结构无效'}`,
  `settings: ${JSON.stringify(settings)}`,
  `cast: ${JSON.stringify(cast)}`,
  `script: ${JSON.stringify(script || {})}`,
  `上一次输出: ${String(raw || '').slice(0, 50000)}`,
  `schema: ${skill.schema}`,
].join('\n\n');

const runProvider = async ({ providerId, script, cast, settings, skill, repairRaw, repairErrors, apiKey }) => {
  const provider = getPromptOptimizerProvider(providerId);
  if (!provider) throw new Error(`未知导演执行模型：${providerId}`);
  const modelId = requestModelFor(providerId, settings);
  // 知识库原文：CINEDANCE + ACTING 是导演生成领域，逐字注入；
  // LIRA 是图片提示词领域，导演分镜不注入（图片优化路径另行挂载）。
  const knowledge = skill.knowledge?.cinedance || skill.knowledge?.acting
    ? `${DIRECTOR_KNOWLEDGE_FRAMING}\n\n${skill.knowledge.cinedance}\n\n${skill.knowledge.acting}`
    : '';
  const systemInstruction = repairRaw
    ? `${skill.systemPrompt}\n\n${skill.rules}\n\n${knowledge}\n\n你现在只负责修复 JSON。`
    : `${skill.systemPrompt}\n\n${skill.rules}\n\n${knowledge}`;
  const raw = await provider.run({
    systemInstruction,
    userPrompt: repairRaw
      ? buildRepairPrompt({ raw: repairRaw, script, cast, settings, skill, errors: repairErrors })
      : buildUserPrompt({ script, cast, settings, skill }),
    apiKey,
    model: modelId,
    effort: provider.defaultEffort || '',
    temperature: 0.2,
    maxTokens: 16000,
    libraryDir: RUNTIME_PATHS.libraryDir,
  });
  return { raw: String(raw || ''), model: outputModel(providerId, modelId) };
};

const normalizeProviderId = provider => {
  const value = String(provider || 'auto').trim().toLowerCase();
  if (value === 'deepseek') return 'deepseek';
  if (value === 'codex' || value === 'codex-cli') return 'codex-cli';
  return 'gemini-web';
};

const validateRunInput = ({ script, cast, settings }) => {
  const errors = [];
  if (!String(script?.content || '').trim()) errors.push('请先填写剧本正文');
  const castValidation = validateCinematicCast(cast);
  errors.push(...castValidation.errors);
  cast.forEach(member => {
    if (!member.referenceImages?.length) errors.push(`${member.name} 缺少角色参考图`);
  });
  const model = getCinematicVideoModel(settings.videoModel);
  if (!model) errors.push(`未知视频模型：${settings.videoModel}`);
  if (model && !model.supportedAspectRatios?.includes(settings.aspectRatio)) {
    errors.push(`${model.name} 不支持 ${settings.aspectRatio} 画幅；支持 ${model.supportedAspectRatios.join(' / ')}`);
  }
  const budget = validateCinematicReferenceBudget(cast, settings.videoModel);
  errors.push(...budget.errors);
  if (!CINEMATIC_ASPECT_RATIOS.includes(settings.aspectRatio)) errors.push('电影导演画幅无效');
  return { valid: errors.length === 0, errors, cast: castValidation.cast };
};

/**
 * Execute the real director provider. An invalid provider response gets one
 * repair pass; it is never silently converted into a fake storyboard.
 */
export const runCinematicDirector = async ({
  input = {},
  cast: rawCast = [],
  settings: rawSettings = {},
  provider = 'auto',
  allowFallback = true,
  providerRunner = runProvider,
  skill = loadCinematicDirectorSkill(),
  apiKey,
} = {}) => {
  const requestedVideoModel = String(rawSettings?.videoModel || '').trim();
  if (requestedVideoModel && !getVideoGenerationProvider(requestedVideoModel)) {
    throw new Error(`未知视频模型：${requestedVideoModel}`);
  }
  const settings = normalizeCinematicSettings(rawSettings);
  const cast = normalizeCinematicCast(rawCast);
  const inputScript = {
    title: String(input?.title || ''),
    content: String(input?.content || ''),
    notes: String(input?.notes || ''),
  };
  const inputValidation = validateRunInput({ script: inputScript, cast, settings });
  if (!inputValidation.valid) throw new Error(`电影导演输入无效：${inputValidation.errors.join('；')}`);

  const preferred = normalizeProviderId(provider);
  const providerIds = [preferred];
  if (allowFallback) providerIds.push(alternateProvider(preferred));
  const errors = [];

  for (const providerId of [...new Set(providerIds)]) {
    let firstRaw = '';
    try {
      const first = await providerRunner({ providerId, script: inputScript, cast, settings, skill, apiKey });
      firstRaw = first.raw;
      let parsed;
      let repairedFromStructure = false;
      try {
        parsed = parseCinematicDirectorJson(firstRaw);
      } catch (error) {
        const repaired = await providerRunner({
          providerId,
          script: inputScript,
          cast,
          settings,
          skill,
          repairRaw: firstRaw,
          repairErrors: [error instanceof Error ? error.message : 'JSON 无效'],
          apiKey,
        });
        parsed = parseCinematicDirectorJson(repaired.raw);
        repairedFromStructure = true;
      }
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.shots) || parsed.shots.length === 0) {
        const repaired = await providerRunner({
          providerId,
          script: inputScript,
          cast,
          settings,
          skill,
          repairRaw: firstRaw,
          repairErrors: ['导演模型输出缺少非空 shots'],
          apiKey,
        });
        parsed = parseCinematicDirectorJson(repaired.raw);
        repairedFromStructure = true;
      }
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.shots) || parsed.shots.length === 0) {
        throw new Error('导演模型修复后仍缺少非空 shots，已拒绝生成伪分镜');
      }

      const model = first.model || outputModel(providerId, requestModelFor(providerId, settings));
      const output = normalizeCinematicDirectorOutput(parsed, { settings, model, cast });
      const validation = validateCinematicDirectorOutput(output, { targetTotalDuration: settings.totalDuration });
      if (!validation.valid) {
        const repaired = await providerRunner({
          providerId,
          script: inputScript,
          cast,
          settings,
          skill,
          repairRaw: firstRaw,
          repairErrors: validation.errors,
          apiKey,
        });
        const repairedOutput = normalizeCinematicDirectorOutput(parseCinematicDirectorJson(repaired.raw), {
          settings,
          model: repaired.model || model,
          cast,
        });
        const repairedValidation = validateCinematicDirectorOutput(repairedOutput, { targetTotalDuration: settings.totalDuration });
        if (!repairedValidation.valid) throw new Error(`导演输出校验失败：${repairedValidation.errors.join('；')}`);
        return { output: repairedOutput, providerId, model: repaired.model || model, repaired: true };
      }
      return { output, providerId, model, repaired: repairedFromStructure };
    } catch (error) {
      errors.push(`${providerLabel(providerId)}：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`电影导演执行失败：${errors.join('；') || '未知错误'}`);
};

export const listCinematicDirectorModels = app => {
  const codex = app?.locals?.CODEX_INTEGRATION?.getStatus?.() || {};
  const geminiState = browserSessionState.get('gemini-web');
  return listPromptOptimizerProviders()
    .filter(provider => ['deepseek', 'gemini-web', 'codex-cli'].includes(provider.id))
    .map(provider => ({
    id: provider.id === 'gemini-web' ? 'gemini' : provider.id === 'codex-cli' ? 'codex' : provider.id,
    providerId: provider.id,
    name: provider.label,
    modelId: provider.defaultModel,
    available: provider.id === 'codex-cli'
      ? Boolean(codex.available && codex.authenticated)
      : provider.id === 'gemini-web'
        ? geminiState?.state === 'authenticated'
        : Boolean(provider.apiKeyField ? app?.locals?.[provider.apiKeyField] : true),
    customModel: true,
    }));
};
