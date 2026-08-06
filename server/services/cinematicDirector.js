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

export const loadCinematicDirectorSkill = () => ({
  systemPrompt: readSkillFile('system-prompt.md'),
  rules: readSkillFile('director-rules.md'),
  schema: readSkillFile('shot-schema.json'),
});

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
  const systemInstruction = repairRaw
    ? `${skill.systemPrompt}\n\n${skill.rules}\n\n你现在只负责修复 JSON。`
    : `${skill.systemPrompt}\n\n${skill.rules}`;
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
      const validation = validateCinematicDirectorOutput(output);
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
        const repairedValidation = validateCinematicDirectorOutput(repairedOutput);
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
