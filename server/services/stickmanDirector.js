import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPromptOptimizerProvider, listPromptOptimizerProviders } from './promptOptimizerProviders.js';
import { browserSessionState } from './browserSessionState.js';
import { RUNTIME_PATHS } from '../runtime/paths.js';
import {
  createStickmanScriptFromAnalysis,
  normalizeStickmanDirectorOutput,
  normalizeStickmanSettings,
  parseStickmanDirectorJson,
  resolveDirectorModel,
  validateStickmanDirectorOutput,
} from '../../shared/stickmanDirector.js';
import { validateManifestShape } from '../../shared/manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_SKILL_ROOT = path.resolve(__dirname, '../../src/skills/stickman-video-director');
const PACKAGED_SKILL_ROOT = path.join(RUNTIME_PATHS.resourcesDir, 'src', 'skills', 'stickman-video-director');

const readSkillFile = filename => {
  const candidates = [path.join(PACKAGED_SKILL_ROOT, filename), path.join(DEV_SKILL_ROOT, filename)];
  for (const candidate of candidates) {
    try {
      return fs.readFileSync(candidate, 'utf8');
    } catch {
      // Try the next resource root. The packaged desktop build and dev server
      // intentionally use the same source files.
    }
  }
  throw new Error(`火柴人导演 Skill 资源缺失：${filename}`);
};

export const loadStickmanDirectorSkill = () => ({
  systemPrompt: readSkillFile('system-prompt.md'),
  rules: readSkillFile('director-rules.md'),
  flowTemplate: readSkillFile('flow-prompt-template.md'),
  schema: readSkillFile('shot-schema.json'),
});

const providerLabel = providerId => {
  const item = listPromptOptimizerProviders().find(provider => provider.id === providerId);
  return item?.label || providerId;
};

const alternateProvider = providerId => providerId === 'gemini-web' ? 'codex-cli' : 'gemini-web';

const requestModelFor = (providerId, settings) => {
  const provider = getPromptOptimizerProvider(providerId);
  return String(settings?.modelId || provider?.defaultModel || '').trim();
};

const buildUserPrompt = ({ sourceType, input, settings, skill }) => {
  const source = sourceType === 'reference_video'
    ? {
        analysis: input?.analysis || {},
        sourceVideo: input?.sourceVideo || {},
        instruction: '将分析结果转换为火柴人镜头，保留源镜头顺序、时长、景别、构图和运镜，不要无理由改写剧情。',
      }
    : {
        script: {
          title: input?.title || '',
          content: input?.content || '',
          notes: input?.notes || '',
        },
        instruction: '将剧本拆成清晰可执行的火柴人镜头，并让镜头总时长接近 settings.totalDuration。',
      };
  return [
    '请根据以下内部导演规则返回 StickmanDirectorOutput JSON。',
    `sourceType: ${sourceType}`,
    `settings: ${JSON.stringify(settings)}`,
    `input: ${JSON.stringify(source)}`,
    `schema: ${skill.schema}`,
  ].join('\n\n');
};

const buildRepairPrompt = ({ raw, sourceType, input, settings, skill }) => [
  '上一次输出没有通过 JSON/Schema 校验。请只返回修复后的完整 JSON，不要解释。',
  `校验目标 sourceType: ${sourceType}`,
  `settings: ${JSON.stringify(settings)}`,
  `原始输入: ${JSON.stringify(input || {})}`,
  `上一次输出: ${String(raw || '').slice(0, 50000)}`,
  `schema: ${skill.schema}`,
].join('\n\n');

const outputModel = (providerId, modelId) => ({
  provider: providerId === 'codex-cli' ? 'codex' : providerId === 'deepseek' ? 'deepseek' : 'gemini',
  modelId: modelId || providerId,
});

const runProvider = async ({ providerId, sourceType, input, settings, skill, repairRaw, apiKey }) => {
  const provider = getPromptOptimizerProvider(providerId);
  if (!provider) throw new Error(`未知导演执行模型：${providerId}`);
  const modelId = requestModelFor(providerId, settings);
  const systemInstruction = repairRaw
    ? `${skill.systemPrompt}\n\n${skill.rules}\n\n你现在只负责修复 JSON。`
    : `${skill.systemPrompt}\n\n${skill.rules}\n\n${skill.flowTemplate}`;
  const raw = await provider.run({
    systemInstruction,
    userPrompt: repairRaw
      ? buildRepairPrompt({ raw: repairRaw, sourceType, input, settings, skill })
      : buildUserPrompt({ sourceType, input, settings, skill }),
    apiKey,
    model: modelId,
    effort: provider.defaultEffort || '',
    temperature: 0.2,
    maxTokens: 12000,
    libraryDir: RUNTIME_PATHS.libraryDir,
  });
  return { raw: String(raw || ''), model: outputModel(providerId, modelId) };
};

const normalizeProviderRequest = ({ provider, sourceType, input }) => {
  const resolved = resolveDirectorModel({
    provider,
    sourceType,
    hasVideo: Boolean(input?.sourceVideo?.url || input?.sourceVideo?.assetId),
  });
  return resolved;
};

/**
 * Execute the internal skill through the selected real Provider. Reference
 * video analysis is converted into a script first; the Director Skill remains
 * the only component that decides the final shot boundaries and storyboard.
 */
export const runStickmanDirector = async ({
  sourceType = 'script',
  input = {},
  settings: rawSettings = {},
  provider = 'auto',
  allowFallback = true,
  providerRunner = runProvider,
  skill = loadStickmanDirectorSkill(),
  apiKey,
} = {}) => {
  if (!['script', 'reference_video'].includes(sourceType)) throw new Error('sourceType 必须是 script 或 reference_video');
  const settings = normalizeStickmanSettings(rawSettings);
  let effectiveSourceType = sourceType;
  let effectiveInput = input;
  let scriptDerived = false;
  if (sourceType === 'reference_video') {
    if (!input?.analysis?.shots?.length) throw new Error('参考视频必须先完成视频分析并生成剧本');
    const script = createStickmanScriptFromAnalysis(input.analysis, {
      settings,
      title: input?.sourceVideo?.title,
    });
    effectiveSourceType = 'script';
    effectiveInput = {
      title: script.title,
      content: script.content,
      notes: script.notes,
    };
    scriptDerived = true;
  }
  const preferred = normalizeProviderRequest({ provider, sourceType: effectiveSourceType, input: effectiveInput });

  const providerIds = [preferred.providerId];
  if (allowFallback) providerIds.push(alternateProvider(preferred.providerId));
  const errors = [];

  for (const providerId of [...new Set(providerIds)]) {
    let firstRaw = '';
    let wasRepaired = false;
    try {
      const first = await providerRunner({ providerId, sourceType: effectiveSourceType, input: effectiveInput, settings, skill, apiKey });
      firstRaw = first.raw;
      let parsed;
      try {
        parsed = parseStickmanDirectorJson(firstRaw);
      } catch (error) {
        wasRepaired = true;
        const repaired = await providerRunner({ providerId, sourceType: effectiveSourceType, input: effectiveInput, settings, skill, repairRaw: firstRaw, apiKey });
        parsed = parseStickmanDirectorJson(repaired.raw);
      }
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.shots) || parsed.shots.length === 0) {
        wasRepaired = true;
        const repaired = await providerRunner({
          providerId,
          sourceType: effectiveSourceType,
          input: effectiveInput,
          settings,
          skill,
          repairRaw: `${firstRaw}\n\n校验错误：导演模型输出缺少非空 shots。`,
          apiKey,
        });
        parsed = parseStickmanDirectorJson(repaired.raw);
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.shots) || parsed.shots.length === 0) {
          throw new Error('导演模型输出缺少非空 shots');
        }
      }
      const model = first.model || outputModel(providerId, requestModelFor(providerId, settings));
      const output = normalizeStickmanDirectorOutput(parsed, {
        sourceType: effectiveSourceType,
        settings,
        model,
        sourceShots: [],
      });
      const validation = validateStickmanDirectorOutput(output);
      if (!validation.valid) {
        const repaired = await providerRunner({
          providerId,
          sourceType: effectiveSourceType,
          input: effectiveInput,
          settings,
          skill,
          repairRaw: `${firstRaw}\n\n校验错误：${validation.errors.join('；')}`,
          apiKey,
        });
        const repairedOutput = normalizeStickmanDirectorOutput(parseStickmanDirectorJson(repaired.raw), {
          sourceType: effectiveSourceType,
          settings,
          model: repaired.model || model,
          sourceShots: [],
        });
        const repairedValidation = validateStickmanDirectorOutput(repairedOutput);
        if (!repairedValidation.valid) throw new Error(`导演输出校验失败：${repairedValidation.errors.join('；')}`);
        return { output: repairedOutput, providerId, model: repaired.model || model, repaired: true, scriptDerived };
      }
      return { output, providerId, model, repaired: wasRepaired, scriptDerived };
    } catch (error) {
      errors.push(`${providerLabel(providerId)}：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`火柴人导演执行失败：${errors.join('；') || '未知错误'}`);
};

export const listStickmanDirectorModels = app => {
  const codex = app?.locals?.CODEX_INTEGRATION?.getStatus?.() || {};
  const geminiState = browserSessionState.get('gemini-web');
  return listPromptOptimizerProviders().map(provider => ({
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

export const buildStickmanMergeManifest = ({
  workflowId,
  title = '火柴人视频成片',
  shots = [],
  width = 1080,
  height = 1920,
  fps = 30,
  skipFailed = true,
} = {}) => {
  const selected = (Array.isArray(shots) ? shots : [])
    .filter(shot => shot && typeof shot.videoUrl === 'string' && shot.videoUrl.trim())
    .filter(shot => !skipFailed || shot.status === 'completed' || !shot.status)
    .sort((left, right) => Number(left.order || 0) - Number(right.order || 0))
    .map((shot, index) => ({
      id: String(shot.id || `shot_${index + 1}`),
      name: String(shot.title || shot.id || `镜头 ${index + 1}`),
      file: shot.videoUrl,
      start: 0,
      end: Math.max(0.1, Number(shot.duration) || 5),
      // 视频生成节点的原片音频默认保留；只有明确传入 0 才静音。
      volume: Number.isFinite(Number(shot.volume))
        ? Math.max(0, Math.min(1, Number(shot.volume)))
        : 1,
      order: index + 1,
      transition: shot.transition === 'fade' ? 'fade' : 'hard_cut',
    }));
  const manifest = {
    project: { id: String(workflowId || 'stickman-project'), title: String(title || '火柴人视频成片') },
    composition: { width: Math.max(256, Math.round(Number(width) || 1080)), height: Math.max(256, Math.round(Number(height) || 1920)), fps: Math.max(1, Math.round(Number(fps) || 30)) },
    shots: selected,
    audioTracks: [],
    subtitles: [],
    output: { endFadeToBlack: 0.6, subtitleStyle: 'default' },
  };
  const validation = validateManifestShape(manifest);
  if (!validation.valid) throw new Error(`视频拼接清单无效：${validation.errors.join('；')}`);
  if (selected.length === 0) throw new Error('没有可拼接的已完成镜头');
  return manifest;
};
