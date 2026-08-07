
import type { VideoRemixState } from '../shared/videoRemix.js';
import type {
  VideoAnalysisInputPort,
  VideoAnalysisNodeData,
} from '../shared/videoAnalysis.js';
import type {
  StickmanDirectorOutput,
  StickmanDirectorSettings,
  StickmanShot,
} from '../shared/stickmanDirector.js';
import type {
  CinematicCastMember,
  CinematicDirectorOutput,
  CinematicDirectorSettings,
  CinematicShot,
} from '../shared/cinematicDirector.js';

export enum NodeType {
  TEXT = 'Text',
  IMAGE = 'Image',
  VIDEO = 'Video',
  AUDIO = 'Audio',
  IMAGE_EDITOR = 'Image Editor',
  CAMERA_ANGLE = 'Camera Angle',
  PRODUCT_SCENE_REPLACE = 'Product Scene Replace',
  VIDEO_ANALYSIS = 'Video Analysis',
  VIDEO_REMIX = 'Video Remix',
  REFERENCE_VIDEO = 'Reference Video',
  SCRIPT_INPUT = 'Script Input',
  STICKMAN_DIRECTOR = 'Stickman Director',
  STORYBOARD = 'Storyboard',
  STORYBOARD_COMPARE = 'Storyboard Compare',
  FLOW_BATCH_VIDEO = 'Flow Batch Video',
  VIDEO_MERGE = 'Video Merge',
  CINEMATIC_CAST = 'Cinematic Cast',
  CINEMATIC_DIRECTOR = 'Cinematic Director',
  CINEMATIC_STORYBOARD = 'Cinematic Storyboard',
  CINEMATIC_VIDEO_MERGE = 'Cinematic Video Merge',
  // Local open-source model nodes
  // AI 漫剧 0-1 生产节点（取值需与 shared/manifest.js 的 MANGA_NODE_TYPES 一致）
  SFX = 'SFX',            // 音效
  BGM = 'BGM',            // 背景音乐
  SUBTITLE = 'Subtitle',  // 字幕
  RENDER = 'Render'       // Remotion 成片
}

/** 判断是否为漫剧生产节点（AUDIO 复用为配音节点） */
export const MANGA_NODE_TYPES_SET = new Set<NodeType>([
  NodeType.AUDIO,
  NodeType.SFX,
  NodeType.BGM,
  NodeType.SUBTITLE,
  NodeType.RENDER,
]);
export const isMangaNode = (t: NodeType) => MANGA_NODE_TYPES_SET.has(t);

export interface StickmanScriptInput {
  title: string;
  content: string;
  notes?: string;
  platform: string;
}

export interface StickmanReferenceVideoInput {
  assetId?: string;
  url?: string;
  title?: string;
  duration?: number;
  width?: number;
  height?: number;
  aspectRatio?: string;
  fps?: number;
  sizeBytes?: number;
  sourceType?: 'upload' | 'url' | 'library' | 'canvas';
}

export interface StickmanDirectorNodeState extends StickmanDirectorSettings {
  provider: 'auto' | 'gemini' | 'codex' | 'deepseek';
  modelId?: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  sourceType?: 'script' | 'reference_video';
  /** 新流程把参考视频分析保存在导演节点内部，不再创建独立分析节点。 */
  analysis?: VideoAnalysisNodeData;
  /** 视频分析完成后生成的剧本草案，交给导演 Skill 重新推导分镜。 */
  scriptInput?: StickmanScriptInput;
  output?: StickmanDirectorOutput;
  error?: string;
  repaired?: boolean;
  fallback?: boolean;
}

export interface StickmanStoryboardState {
  shots: StickmanShot[];
  expanded: boolean;
  compareMode?: boolean;
  status: 'idle' | 'ready' | 'generating' | 'paused' | 'completed' | 'failed';
  error?: string;
}

export interface StickmanFlowBatchTask {
  shotId: string;
  taskId: string;
  status: 'waiting' | 'generating' | 'success' | 'failed' | 'cancelled';
  progress?: number;
  retryCount: number;
  resultUrl?: string;
  error?: string;
}

export interface StickmanFlowBatchState {
  modelId?: string;
  resolution?: string;
  concurrency: 1 | 2 | 3 | 4;
  aspectRatio: string;
  width: number;
  height: number;
  duration?: number;
  nativeAudio: boolean;
  autoRetry: boolean;
  maxRetries: number;
  continueOnFailure: boolean;
  autoMerge: boolean;
  status: 'idle' | 'queued' | 'running' | 'paused' | 'completed' | 'partial_failed' | 'failed' | 'cancelled';
  tasks: StickmanFlowBatchTask[];
  error?: string;
}

export interface StickmanVideoMergeState {
  jobId?: string;
  status: 'idle' | 'queued' | 'rendering' | 'success' | 'failed' | 'cancelled';
  outputUrl?: string;
  outputFormat: 'mp4' | 'mov' | 'webm';
  fps: number;
  skipFailed: boolean;
  error?: string;
}

export interface CinematicCastNodeState {
  characters: CinematicCastMember[];
  imageProvider?: string;
  videoModel?: string;
  error?: string;
}

export interface CinematicDirectorNodeState extends CinematicDirectorSettings {
  provider: 'auto' | 'gemini' | 'codex' | 'deepseek' | string;
  modelId?: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  output?: CinematicDirectorOutput;
  error?: string;
  repaired?: boolean;
}

export interface CinematicStoryboardState {
  shots: CinematicShot[];
  cast: CinematicCastMember[];
  expanded: boolean;
  concurrency: 1 | 2 | 3 | 4;
  status: 'idle' | 'ready' | 'generating' | 'paused' | 'completed' | 'partial_failed' | 'failed' | 'recovery_required';
  error?: string;
}

export interface CinematicVideoMergeState {
  jobId?: string;
  status: 'idle' | 'queued' | 'rendering' | 'success' | 'failed' | 'cancelled';
  outputUrl?: string;
  outputFormat: 'mp4' | 'mov' | 'webm';
  fps: number;
  skipFailed: boolean;
  error?: string;
}

export enum NodeStatus {
  IDLE = 'idle',
  LOADING = 'loading',
  SUCCESS = 'success',
  ERROR = 'error'
}

export interface NodeData {
  id: string;
  type: NodeType;
  title?: string; // Custom title for the node (defaults to type if not set)
  displayName?: string; // Sidebar-only user label; never renames the underlying media file.
  resultName?: string; // Optional provider/task result name used after a real filename.
  x: number;
  y: number;
  prompt: string;
  status: NodeStatus;
  resultUrl?: string; // Image URL or Video URL
  lastFrame?: string; // For Video nodes: base64/url of the last frame to use as input for next node
  parentIds?: string[]; // For connecting lines (supports multiple inputs)
  groupId?: string; // ID of the group this node belongs to
  errorMessage?: string;
  // True when the failed request was already accepted by the provider (quota
  // consumed / task submitted). The result may exist in the provider's history,
  // so blindly regenerating would spend quota a second time.
  errorSubmitted?: boolean;

  // Text node specific
  textMode?: 'menu' | 'editing'; // For Text nodes: current mode
  linkedVideoNodeId?: string; // For Text nodes: linked video node for prompt sync

  // Video node specific
  videoMode?: 'standard' | 'frame-to-frame'; // Video generation mode
  frameInputs?: { nodeId: string; order: 'start' | 'end' }[]; // For frame-to-frame: connected image nodes
  videoModel?: string; // Video model version
  videoDuration?: number; // Video duration in seconds (e.g., 5, 6, 8, 10)
  generateAudio?: boolean; // 是否生成原生音频（如 Seedance）
  inputUrl?: string; // Input URL for video generation (image-to-video)
  // 参考视频链接导入后保留来源元数据，节点可直接连接到视频分析。
  videoSourceType?: 'url' | 'upload' | 'canvas' | 'library' | 'generated';
  videoSourceUrl?: string;
  videoSourceLocalUrl?: string;
  videoSourceId?: string;
  videoSourcePlatform?: string;
  videoSourceTitle?: string;
  subtitleSourceNodeId?: string; // 带字幕视频对应的源视频节点
  subtitleJobId?: string;
  subtitleJobStatus?: 'queued' | 'extracting' | 'transcribing' | 'aligning' | 'punctuating' | 'rendering' | 'success' | 'failed' | 'cancelled';
  subtitleJobStage?: string;
  subtitleJobProgress?: number;
  subtitleAlignmentQuality?: 'word' | 'estimated';
  subtitleTranscriptionEngine?: string;
  subtitleFormat?: 'ass';
  subtitleSegments?: Array<{ id: string; text: string; start: number; end: number }>;

  // Video timing/edit metadata
  trimStart?: number; // Trim start time in seconds
  trimEnd?: number; // Trim end time in seconds

  // Settings
  model: string;
  imageModel?: string; // Image model version
  imageGenerationCount?: number; // 浏览器工作流单次生图数量（Google Flow / 即梦，1-4）
  aspectRatio: string;
  resolution: string;
  isPromptExpanded?: boolean; // Whether the prompt editing area is expanded
  resultAspectRatio?: string; // Actual aspect ratio of the generated image (e.g., '16/9')
  generationStartTime?: number; // Timestamp when generation started (for recovery race condition prevention)
  codexJobId?: string; // Active local Codex image-generation job
  codexJobStatus?: 'pending' | 'processing' | 'completed' | 'failed';
  imageVersions?: Array<{
    jobId: string;
    url: string;
    prompt: string;
    attempt: number;
    createdAt: string;
  }>;

  // Image Editor state persistence
  editorElements?: Array<{
    id: string;
    type: 'arrow' | 'text';
    // Arrow properties
    startX?: number;
    startY?: number;
    endX?: number;
    endY?: number;
    color?: string;
    lineWidth?: number;
    // Text properties
    x?: number;
    y?: number;
    text?: string;
    fontSize?: number;
    fontFamily?: string;
  }>; // Elements (arrows, text) drawn in image editor
  editorCanvasData?: string; // Base64 brush/eraser canvas data
  editorCanvasSize?: { width: number; height: number }; // Size of the canvas when elements were saved (for scaling)
  editorBackgroundUrl?: string; // Clean background image URL (without elements) for re-editing

  // Change Angle mode (Image nodes only)
  angleMode?: boolean; // Whether the node is in angle editing mode
  angleSettings?: {
    rotation: number;  // Horizontal rotation in degrees (-180 to 180)
    tilt: number;      // Vertical tilt in degrees (-90 to 90)
    scale: number;     // Scale factor (0 to 100)
  };

  // Local Model node specific
  localModelId?: string;        // ID of the selected local model
  localModelPath?: string;      // Absolute path to model file on disk
  localModelType?: 'diffusion' | 'controlnet' | 'lora' | 'camera-control';
  localModelArchitecture?: string; // Model architecture (e.g., 'sd15', 'sdxl', 'qwen')

  // Character identity references used by the asset library and downstream generation.
  characterReferenceUrls?: string[];

  // Character identity + wardrobe pack metadata
  characterId?: string;
  characterName?: string;
  // identity-fullbody / identity-expression are retained for legacy project compatibility.
  characterAssetRole?: 'identity-face' | 'identity-angles' | 'identity-board' | 'identity-fullbody' | 'identity-expression' | 'look-fullbody' | 'look-board';
  lookId?: string;
  lookName?: string;

  // 素材库命名：节点输出被保存为素材后，下游连线用素材名代替「参考图N」
  assetId?: string;
  assetName?: string;
  assetDescription?: string;

  // 产品场景替换节点：两张参考图分别承担场景与产品外观职责。
  productSceneInputMapping?: {
    version: 1;
    sceneReferenceNodeId?: string;
    productImageNodeId?: string;
    promptSourceNodeId?: string;
  };
  sceneReferenceId?: string;
  sceneAspectReferenceId?: string;
  productReferenceId?: string;
  productCategory?: string;
  productDimensions?: {
    length: number;
    width: number;
    height: number;
    unit: 'mm' | 'cm';
  };
  preserveProductMarkings?: boolean;
  personaBrief?: string;
  sceneAnalysis?: string;
  personaAnalysis?: string;
  compositionAnalysis?: string;
  productAnalysis?: string;
  productSceneStage?: 'analyzing' | 'generating_images' | 'images_completed' | 'generating_videos' | 'completed' | 'partial_failed' | 'cancelled';
  productSceneJobId?: string;
  productSceneJobStatus?: 'pending' | 'processing' | 'completed' | 'partial_failed' | 'failed' | 'cancelled';
  productSceneStageLabel?: string;
  productSceneRecognitionModel?: string;
  productSceneRecognitionProvider?: 'codex-cli' | 'gemini-web';
  productSceneImageCount?: number;
  productSceneVideoPromptSourceId?: string;
  productSceneAutoGenerateVideo?: boolean;
  productSceneVideoModel?: string;
  productSceneVideoAspectRatio?: string;
  productSceneVideoDuration?: number;
  productSceneVideoResolution?: string;
  productSceneVideoGenerateAudio?: boolean;
  productSceneQueueCurrent?: number;
  productSceneQueueTotal?: number;
  productSceneVideoTasks?: Array<{
    index: number;
    imageNodeId: string;
    videoNodeId: string;
    status: 'waiting' | 'running' | 'success' | 'failed' | 'cancelled';
    resultUrl?: string;
    error?: string;
    errorCode?: string;
    retryBlocked?: boolean;
  }>;
  productSceneResultNodeId?: string;
  productSceneSourceJobId?: string; // 普通图片结果节点用于防止恢复时重复创建
  batchIndex?: number; // Original batch order; independent from async completion order.
  batchCount?: number;
  productSceneLayoutVersion?: number;
  productSceneLayoutSourceNodeId?: string;
  productSceneBatchJobId?: string;
  productSceneBatchVersion?: number;
  productSceneLayoutRowStep?: number;

  // 仅兼容旧项目与项目级工作台适配器；新状态持久化在 workflow.videoRemixes[]。
  videoRemix?: VideoRemixState;

  // 统一画布中的视频分析工作流节点。
  videoAnalysis?: VideoAnalysisNodeData;

  // 内部「火柴人视频导演」工作流节点。
  scriptInput?: StickmanScriptInput;
  referenceVideo?: StickmanReferenceVideoInput;
  director?: StickmanDirectorNodeState;
  storyboard?: StickmanStoryboardState;
  flowBatch?: StickmanFlowBatchState;
  videoMerge?: StickmanVideoMergeState;
  // 电影短片工作流节点状态。
  cinematicCast?: CinematicCastNodeState;
  cinematicDirector?: CinematicDirectorNodeState;
  cinematicStoryboard?: CinematicStoryboardState;
  cinematicVideoMerge?: CinematicVideoMergeState;
  /** parentId -> 固定目标端口，连接语义不能依赖 parentIds 数组顺序。 */
  inputPortByParentId?: Record<string, VideoAnalysisInputPort | string>;
  outputPortId?: string;
  inheritedReferences?: {
    productNodeIds: string[];
    characterNodeIds: string[];
    sceneNodeIds: string[];
  };
  // 视频分析节点按可选资产提示词生成的三图一致性节点。
  videoAnalysisAssetKind?: 'characters' | 'scenes' | 'props';
  videoAnalysisAssetId?: string;
  videoAnalysisAssetProfileId?: string;
  videoAnalysisAssetRole?: 'main' | 'angle';
  videoAnalysisAssetMainNodeId?: string;
  videoAnalysisAssetMainLocked?: boolean;
  // 该资产作为关键帧/视频的唯一选定参考图时，生成时不继续把它的
  // 人物资产父链展开，避免把同一人物的三张图一起送入视频请求。
  videoAnalysisAssetReferenceBoundary?: boolean;
  origin?: {
    type: 'video-remix';
    analysisNodeId: string;
    shotId?: string;
    assetKind?: 'characters' | 'scenes' | 'props';
    assetId?: string;
    assetProfileId?: string;
    assetRole?: 'main' | 'angle';
    layoutVersion?: number;
    order?: number;
    role: 'keyframe' | 'video' | 'asset' | 'final';
  };
  promptSource?: 'analysis' | 'user';
  promptLocked?: boolean;
  needsUpdate?: boolean;

  // ==========================================================================
  // AI 漫剧生产节点字段（配音/音效/BGM/字幕/成片）
  // ==========================================================================
  mediaUrl?: string;        // 音频/视频素材地址（音频类节点用）
  durationSec?: number;     // 素材真实时长（秒），由音频探测或 TTS 返回

  // 镜头(Video)在成片中的参数
  order?: number;           // 镜头顺序（成片节点排序用）
  shotVolume?: number;      // 镜头原声音量（默认 0 静音）

  // 音轨(Audio/SFX/BGM)时间轴与混音参数（时间轴绝对秒）
  timelineStart?: number;
  timelineEnd?: number;
  audioVolume?: number;
  fadeIn?: number;
  fadeOut?: number;
  loop?: boolean;
  ducking?: boolean;        // 仅 BGM：对白期间自动压低
  speaker?: string;         // 角色名（配音/字幕）

  // 配音(TTS)参数
  ttsText?: string;
  ttsProvider?: 'chatcut-elevenlabs' | 'doubao' | 'fish-audio' | 'qwen-local' | 'import';
  ttsModel?: string;
  ttsVoiceName?: string;
  ttsSource?: 'generated' | 'imported';
  voiceId?: string;
  voiceSpeed?: number;
  voiceEmotion?: string;

  // 字幕
  subtitleText?: string;

  // 成片(Render)节点状态
  compWidth?: number;
  compHeight?: number;
  compFps?: number;
  endFadeToBlack?: number;
  renderJobId?: string;
  renderStatus?: string;      // queued|rendering|success|failed|cancelled
  renderStage?: string;
  renderProgress?: number;
  renderOutputUrl?: string;
  renderError?: string;
  renderMissing?: { kind: string; raw: string; reason: string }[];
}

export interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  type: 'global' | 'node-connector' | 'node-options' | 'add-nodes'; // 'global' = right click on canvas, 'add-nodes' = double click
  /** 节点实际生成位置。工具栏菜单可固定在左上方，但节点仍生成在画布中央。 */
  canvasX?: number;
  canvasY?: number;
  sourceNodeId?: string; // If 'node-connector' or 'node-options', which node originated the click
  connectorSide?: 'left' | 'right';
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface SelectionBox {
  isActive: boolean;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface NodeGroup {
  id: string;
  nodeIds: string[];
  label: string;
}
