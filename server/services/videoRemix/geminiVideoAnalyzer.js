import { runGeminiWebStructuredMediaTask } from '../geminiWebWorkflow.js';
import {
  GLOBAL_ANALYSIS_OUTPUT_CONTRACT,
  SHOT_ANALYSIS_OUTPUT_CONTRACT,
  StructuredAnalysisError,
  normalizeGlobalVideoAnalysis,
  normalizeShotVideoAnalysis,
  parseStrictStructuredJson,
} from './videoAnalysisSchemas.js';

function correctionPrompt(error, contract) {
  const issues = Array.isArray(error?.issues) && error.issues.length > 0
    ? error.issues.slice(0, 12)
    : [error?.message || '结构无效'];
  return [
    '上一条回答未通过机器结构校验。只修正 JSON，不要解释，不要使用 Markdown。',
    '校验错误：',
    ...issues.map((issue, index) => `${index + 1}. ${issue}`),
    '必须严格符合此结构（没有内容的数组用 []，没有可选对象时省略该字段）：',
    contract,
  ].join('\n');
}

function modeInstruction(mode) {
  return mode === 'deep'
    ? '分析档位：deep。逐帧核对细微动作、手部/道具交互、运镜、声音与连续性，宁可具体，不要泛化。'
    : '分析档位：fast。保持结构完整，用简洁、可执行的描述覆盖主要故事、动作、构图、运镜和声音。';
}

export class VideoAnalyzerProvider {
  async analyzeVideo() {
    throw new Error('VideoAnalyzerProvider.analyzeVideo 尚未实现');
  }

  async analyzeShot() {
    throw new Error('VideoAnalyzerProvider.analyzeShot 尚未实现');
  }
}

export class GeminiVideoAnalyzer extends VideoAnalyzerProvider {
  constructor({
    taskRunner = runGeminiWebStructuredMediaTask,
  } = {}) {
    super();
    this.taskRunner = taskRunner;
  }

  async #runStructured({
    prompt,
    files,
    contract,
    normalize,
    mode,
    workflowId,
    nodeId,
    signal,
    label,
  }) {
    const attempts = mode === 'deep' ? 3 : 2;
    let conversation = {};
    let nextPrompt = prompt;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const response = await this.taskRunner({
        prompt: nextPrompt,
        files: attempt === 1 ? files : [],
        conversation,
        workflowId,
        nodeId,
        signal,
        label,
      });
      const text = typeof response === 'string' ? response : response?.text;
      if (response?.conversation) conversation = response.conversation;
      try {
        return normalize(parseStrictStructuredJson(text));
      } catch (error) {
        if (!(error instanceof StructuredAnalysisError)) throw error;
        lastError = error;
        if (attempt >= attempts) break;
        if (!conversation?.conversationId) {
          throw new StructuredAnalysisError(
            `${label}返回无效结构且没有可继续纠错的 conversationId`,
            {
              code: 'ANALYSIS_CONVERSATION_MISSING',
              issues: error.issues,
              cause: error,
            }
          );
        }
        nextPrompt = correctionPrompt(error, contract);
      }
    }
    throw new StructuredAnalysisError(
      `${label}连续 ${attempts} 次未通过结构校验`,
      {
        code: 'ANALYSIS_SCHEMA_RETRY_EXHAUSTED',
        issues: lastError?.issues || [],
        cause: lastError,
      }
    );
  }

  async analyzeVideo({
    source,
    shots,
    proxyFile,
    mode = 'fast',
    workflowId,
    nodeId,
    signal,
  }) {
    const shotTimeline = shots.map((shot, index) => ({
      order: index + 1,
      shotId: shot.shotId,
      start: shot.start,
      end: shot.end,
      duration: shot.duration,
    }));
    const prompt = [
      '你是短视频结构化分析器。附件是完整参考视频的低码率分析代理，只分析真实可见/可听内容，不推测画外设定。',
      modeInstruction(mode),
      '一次建立全局故事、Character Identity（身份与 Look 分离）、Scene Identity/Zone、重要 Prop，以及每个 Shot 的动作复杂度。',
      'ID 只能使用 ASCII 字母、数字、下划线或连字符；人物按 CHAR_01，造型按 LOOK_01，场景按 SCENE_01，区域按 ZONE_01，道具按 PROP_01。',
      'appearsInShots 与 shotComplexities 只能引用给定 Shot ID；shotComplexities 必须恰好覆盖每个 Shot 一次。',
      '复杂度规则：simple=静态/说话/产品特写/简单回头；medium=走路/坐下/拿取/转身；complex=舞蹈/打斗/复杂手部/多人高速互动/高速运镜。',
      `视频元数据：${JSON.stringify({
        duration: source.duration,
        width: source.width,
        height: source.height,
        fps: source.fps,
        hasAudio: source.hasAudio,
        orientation: source.orientation,
      })}`,
      `本地算法确定的 Shot 时间线：${JSON.stringify(shotTimeline)}`,
      '只返回一个纯 JSON 对象；禁止 Markdown、代码围栏、注释和 JSON 前后说明。',
      '必须严格符合：',
      GLOBAL_ANALYSIS_OUTPUT_CONTRACT,
    ].join('\n');

    return this.#runStructured({
      prompt,
      files: [proxyFile],
      contract: GLOBAL_ANALYSIS_OUTPUT_CONTRACT,
      normalize: raw => normalizeGlobalVideoAnalysis(raw, shots.map(shot => shot.shotId)),
      mode,
      workflowId,
      nodeId,
      signal,
      label: 'Gemini 全片结构化分析',
    });
  }

  async analyzeShot({
    shot,
    globalAnalysis,
    files,
    inputKind,
    mode = 'fast',
    workflowId,
    nodeId,
    signal,
  }) {
    const assetCatalog = {
      characters: globalAnalysis.characters.map(item => ({
        id: item.id,
        name: item.name,
        looks: item.looks.map(look => ({ id: look.id, name: look.name })),
      })),
      scenes: globalAnalysis.scenes.map(item => ({
        id: item.id,
        name: item.name,
        zones: item.zones.map(zone => ({ id: zone.id, name: zone.name })),
      })),
      props: globalAnalysis.props.map(item => ({
        id: item.id,
        name: item.name,
        category: item.category,
      })),
    };
    const inputDescription = inputKind === 'video'
      ? '附件是这个 complex Shot 的完整小视频。'
      : inputKind === 'three_frames'
        ? '附件依次是 Start、Middle、End 三帧。'
        : '附件依次是 Start、25%、50%、75%、End 五帧。';
    const prompt = [
      `你是短视频逐镜结构化分析器。当前 Shot ID 是 ${shot.shotId}，时长 ${shot.duration.toFixed(3)} 秒。`,
      inputDescription,
      modeInstruction(mode),
      '所有动作、运镜、对白、音效和 timing 的 start/end 都使用当前 Shot 内从 0 开始的相对秒数，不得超过 Shot 时长。',
      'characters/scene/props 只能引用全片阶段已经建立的资产 ID。没有人物、场景或道具时使用空数组或空 scene 对象，不得发明新 ID。',
      'frameBlueprint 坐标 x/y 使用 0..1 归一化画面坐标。动作要拆成可执行的时间片，明确手部、姿态、表情、道具交互与移动方向。',
      `全片故事：${JSON.stringify(globalAnalysis.story)}`,
      `允许引用的资产：${JSON.stringify(assetCatalog)}`,
      `本地 Shot 边界与复杂度：${JSON.stringify({
        shotId: shot.shotId,
        start: shot.start,
        end: shot.end,
        duration: shot.duration,
        motionComplexity: shot.motionComplexity,
      })}`,
      '只返回一个纯 JSON 对象；禁止 Markdown、代码围栏、注释和 JSON 前后说明。',
      '必须严格符合：',
      SHOT_ANALYSIS_OUTPUT_CONTRACT.replaceAll('shot_001', shot.shotId),
    ].join('\n');

    return this.#runStructured({
      prompt,
      files,
      contract: SHOT_ANALYSIS_OUTPUT_CONTRACT.replaceAll('shot_001', shot.shotId),
      normalize: raw => normalizeShotVideoAnalysis(raw, { shot, globalAnalysis }),
      mode,
      workflowId,
      nodeId,
      signal,
      label: `Gemini ${shot.shotId} 结构化分析`,
    });
  }
}

export function createVideoAnalyzerProvider(providerId = 'gemini', options) {
  if (providerId === 'gemini') return new GeminiVideoAnalyzer(options);
  const error = new Error(`不支持的视频分析 Provider：${providerId}`);
  error.code = 'UNSUPPORTED_VIDEO_ANALYZER';
  error.status = 400;
  throw error;
}
