import { runGeminiWebStructuredMediaTask } from '../geminiWebWorkflow.js';
import {
  GLOBAL_ANALYSIS_OUTPUT_CONTRACT,
  SHOT_ANALYSIS_OUTPUT_CONTRACT,
  StructuredAnalysisError,
  normalizeGlobalVideoAnalysis,
  normalizeShotVideoAnalysis,
  parseStrictStructuredJson,
} from './videoAnalysisSchemas.js';

export const VIDEO_ANALYSIS_TIMEOUT_SECONDS = Object.freeze({
  fast: 10 * 60,
  deep: 15 * 60,
});

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
        timeoutSeconds: VIDEO_ANALYSIS_TIMEOUT_SECONDS[mode] || VIDEO_ANALYSIS_TIMEOUT_SECONDS.fast,
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
    referenceFiles = [],
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
      '一次建立全局故事、人物身份（身份与造型分离）、场景身份与区域、重要道具，以及每个镜头的动作复杂度。',
      referenceFiles.length > 0
        ? `附件中另有 ${referenceFiles.length} 张用户提供的参考图。按附件顺序和标注使用：${referenceFiles.map((file, index) => `${index + 1}号为${file.label || `参考图 ${index + 1}`}`).join('；')}。它们只用于识别与保持用户资产，不要把它们误判为参考视频镜帧。`
        : '没有额外用户参考图，按参考视频中的可见内容完成分析。',
      '除固定 ASCII ID 外，所有给用户阅读的字段必须使用自然、清晰的简体中文，包括人物/造型/场景/区域/道具名称、描述、声音、故事和风格；不得输出整句英文。',
      '资产分析的目标不是识别或照搬原视频中的真人/影视角色，也不是截取分镜画面。请根据剧情功能给出可重新生成的“选角与美术需求”：人物 name 使用功能性中文角色名（如“冷静的主驾驶”），identity 说明年龄段、气质、脸型五官、发型、体型和辨识点；不得使用演员、明星或影视角色真名。',
      '场景 name 使用功能性中文名称，visualDescription 说明空间结构、区域关系、固定构件、材质、色彩、时间与光线；道具 name 使用功能性中文名称，description 说明剧情用途、外形结构、比例、材质、颜色和不可变细节。描述必须足够支持用户直接 AI 生成或改为自己的上传资产。',
      '每个人物、场景、道具都必须输出中文 masterPrompt 和 anchorBlock。masterPrompt 用于生成跨镜头一致性参考图：人物写固定五官、骨骼、发型、身体比例与造型；场景写空间拓扑、功能区、固定构件、材质、色彩和光线；道具写轮廓、长宽厚比例、组件与开孔数量、材质、颜色、标志位置和真实尺度。',
      'anchorBlock 必须是可以逐字复制进每个镜头提示词的中文冻结段落，使用正面陈述，明确哪些身份、空间或结构特征在机位和动作变化时仍保持一致。不得只写“保持一致”这类空泛句子。',
      'ID 只能使用 ASCII 字母、数字、下划线或连字符；人物按 CHAR_01，造型按 LOOK_01，场景按 SCENE_01，区域按 ZONE_01，道具按 PROP_01。',
      'appearsInShots 与 shotComplexities 只能引用给定镜头 ID；shotComplexities 必须恰好覆盖每个镜头一次。',
      '复杂度规则：simple=静态/说话/产品特写/简单回头；medium=走路/坐下/拿取/转身；complex=舞蹈/打斗/复杂手部/多人高速互动/高速运镜。',
      `视频元数据：${JSON.stringify({
        duration: source.duration,
        width: source.width,
        height: source.height,
        fps: source.fps,
        hasAudio: source.hasAudio,
        orientation: source.orientation,
      })}`,
      `本地算法确定的镜头时间线：${JSON.stringify(shotTimeline)}`,
      '只返回一个纯 JSON 对象；禁止 Markdown、代码围栏、注释和 JSON 前后说明。',
      '必须严格符合：',
      GLOBAL_ANALYSIS_OUTPUT_CONTRACT,
    ].join('\n');

    return this.#runStructured({
      prompt,
      files: [proxyFile, ...referenceFiles],
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
      ? '附件是这个复杂镜头的完整小视频。'
      : inputKind === 'three_frames'
        ? '附件依次是起始、中间、结束三帧。'
        : '附件依次是起始、25%、50%、75%、结束五帧。';
    const prompt = [
      `你是短视频逐镜结构化分析器。当前镜头 ID 是 ${shot.shotId}，时长 ${shot.duration.toFixed(3)} 秒。`,
      inputDescription,
      modeInstruction(mode),
      '所有动作、运镜、对白、音效和 timing 的 start/end 都使用当前镜头内从 0 开始的相对秒数，不得超过镜头时长。',
      'characters/scene/props 只能引用全片阶段已经建立的资产 ID。没有人物、场景或道具时使用空数组或空 scene 对象，不得发明新 ID。',
      'frameBlueprint 坐标 x/y 使用 0..1 归一化画面坐标。动作要拆成可执行的时间片，明确手部、姿态、表情、道具交互与移动方向。',
      `全片故事：${JSON.stringify(globalAnalysis.story)}`,
      `允许引用的资产：${JSON.stringify(assetCatalog)}`,
      `本地镜头边界与复杂度：${JSON.stringify({
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
  const error = new Error(`不支持的视频分析服务：${providerId}`);
  error.code = 'UNSUPPORTED_VIDEO_ANALYZER';
  error.status = 400;
  throw error;
}
