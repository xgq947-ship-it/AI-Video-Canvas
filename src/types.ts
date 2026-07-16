
export enum NodeType {
  TEXT = 'Text',
  IMAGE = 'Image',
  VIDEO = 'Video',
  AUDIO = 'Audio',
  IMAGE_EDITOR = 'Image Editor',
  VIDEO_EDITOR = 'Video Editor',
  STORYBOARD = 'Storyboard Manager',
  CAMERA_ANGLE = 'Camera Angle',
  // Local open-source model nodes
  LOCAL_IMAGE_MODEL = 'Local Image Model',
  LOCAL_VIDEO_MODEL = 'Local Video Model',
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
  x: number;
  y: number;
  prompt: string;
  status: NodeStatus;
  resultUrl?: string; // Image URL or Video URL
  lastFrame?: string; // For Video nodes: base64/url of the last frame to use as input for next node
  parentIds?: string[]; // For connecting lines (supports multiple inputs)
  groupId?: string; // ID of the group this node belongs to
  errorMessage?: string;

  // Text node specific
  textMode?: 'menu' | 'editing'; // For Text nodes: current mode
  linkedVideoNodeId?: string; // For Text nodes: linked video node for prompt sync

  // Video node specific
  videoMode?: 'standard' | 'frame-to-frame' | 'motion-control'; // Video generation mode
  frameInputs?: { nodeId: string; order: 'start' | 'end' }[]; // For frame-to-frame: connected image nodes
  videoModel?: string; // Video model version (e.g., 'veo-3.1', 'kling-v2-1')
  videoDuration?: number; // Video duration in seconds (e.g., 5, 6, 8, 10)
  generateAudio?: boolean; // Whether to generate native audio (Kling 2.6, Veo 3.1)
  inputUrl?: string; // Input URL for video generation (image-to-video)

  // Video Editor specific
  trimStart?: number; // Trim start time in seconds
  trimEnd?: number; // Trim end time in seconds

  // Settings
  model: string;
  imageModel?: string; // Image model version (e.g., 'gemini-pro', 'kling-v2')
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

  // Kling V1.5 Image Reference Settings
  klingReferenceMode?: 'subject' | 'face'; // Reference type for image-to-image
  klingFaceIntensity?: number; // Face reference intensity (0-100)
  klingSubjectIntensity?: number; // Subject reference intensity (0-100)
  detectedFaces?: { x: number; y: number; width: number; height: number }[]; // Detected face bounding boxes
  faceDetectionStatus?: 'idle' | 'loading' | 'success' | 'error'; // Face detection status

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
    wideAngle: boolean; // Whether to use wide-angle lens perspective
  };

  // Local Model node specific
  localModelId?: string;        // ID of the selected local model
  localModelPath?: string;      // Absolute path to model file on disk
  localModelType?: 'diffusion' | 'controlnet' | 'lora' | 'camera-control';
  localModelArchitecture?: string; // Model architecture (e.g., 'sd15', 'sdxl', 'qwen')

  // Storyboard Generator specific
  characterReferenceUrls?: string[]; // URLs of character images for reference in generation

  // Character identity + wardrobe pack metadata
  characterId?: string;
  characterName?: string;
  characterAssetRole?: 'identity-face' | 'identity-fullbody' | 'identity-expression' | 'identity-board' | 'look-fullbody' | 'look-board';
  lookId?: string;
  lookName?: string;

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
  storyContext?: {
    story: string;
    scripts: any[];
    selectedCharacters?: any[]; // CharacterAsset[]
    sceneCount?: number;
    styleAnchor?: string;
    characterDNA?: Record<string, string>;
    compositeImageUrl?: string | null;
  };
}
