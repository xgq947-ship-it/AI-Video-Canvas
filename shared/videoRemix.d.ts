export const VIDEO_REMIX_SCHEMA_VERSION: 1;

export type VideoRemixStage =
  | 'source'
  | 'preprocessing'
  | 'shots_ready'
  | 'analyzing'
  | 'analysis_partial'
  | 'analysis_ready'
  | 'assets_ready'
  | 'keyframes_generating'
  | 'keyframes_ready'
  | 'videos_generating'
  | 'videos_ready'
  | 'rendering'
  | 'completed'
  | 'error';

export type VideoRemixWorkspaceTab =
  | 'source'
  | 'analysis'
  | 'assets'
  | 'shots'
  | 'keyframes'
  | 'videos'
  | 'final';

export type MotionComplexity = 'simple' | 'medium' | 'complex';
export type AssetSource = 'analysis' | 'generated' | 'upload' | 'library';
export type ShotAnalysisFramePosition =
  | 'start'
  | 'quarter'
  | 'middle'
  | 'three_quarter'
  | 'end';

export interface EditableField<T> {
  value: T;
  source: 'ai' | 'user';
  confidence?: number;
  locked: boolean;
}

export interface ReferenceVideo {
  id: string;
  sourceType: 'local' | 'canvas' | 'url';
  platform?: string;
  sourceUrl?: string;
  localUrl: string;
  originalFilename?: string;
  title?: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec?: string;
  audioCodec?: string;
  hasAudio: boolean;
  orientation: 'landscape' | 'portrait' | 'square';
  proxyUrl?: string;
  previewUrl?: string;
  sourceHash?: string;
}

export interface CharacterLook {
  id: string;
  name: string;
  description: string;
  referenceImages: string[];
  source?: AssetSource;
  replacement?: VideoRemixAssetReplacement;
}

export interface VoiceDescription {
  language?: string;
  gender?: string;
  ageFeel?: string;
  tone?: string;
  pitch?: string;
  speakingStyle?: string;
}

export interface VideoRemixAssetReplacement {
  source: AssetSource;
  name?: string;
  description?: string;
  identity?: string;
  visualDescription?: string;
  audioDescription?: string;
  voiceDescription?: VoiceDescription;
  zones?: SceneZone[];
  category?: 'hero' | 'interactive' | 'background';
  referenceImages?: string[];
  libraryAssetId?: string;
  libraryCharacterId?: string;
  libraryLookId?: string;
  generatedPrompt?: string;
  updatedAt: string;
}

export interface CharacterAsset {
  id: string;
  name: string;
  identity: string;
  looks: CharacterLook[];
  voiceDescription?: VoiceDescription;
  referenceImages: string[];
  appearsInShots: string[];
  source: AssetSource;
  replacement?: VideoRemixAssetReplacement;
}

export interface SceneZone {
  id: string;
  name: string;
  description: string;
}

export interface SceneAsset {
  id: string;
  name: string;
  visualDescription: string;
  audioDescription?: string;
  zones: SceneZone[];
  referenceImages: string[];
  appearsInShots: string[];
  source: AssetSource;
  replacement?: VideoRemixAssetReplacement;
}

export interface PropAsset {
  id: string;
  name: string;
  category: 'hero' | 'interactive' | 'background';
  description: string;
  referenceImages: string[];
  appearsInShots: string[];
  source: AssetSource;
  replacement?: VideoRemixAssetReplacement;
  removed?: boolean;
}

export interface FrameSubject {
  id: string;
  x: number;
  y: number;
  scale: number;
  facing?: string;
  pose?: string;
}

export interface FrameProp {
  id: string;
  x: number;
  y: number;
  scale?: number;
}

export interface FrameBlueprint {
  shotSize: EditableField<string>;
  cameraAngle: EditableField<string>;
  subjects: FrameSubject[];
  props: FrameProp[];
}

export interface TimedAction {
  start: number;
  end: number;
  action: string;
  category?: 'body' | 'pose' | 'hand' | 'facial' | 'object';
}

export interface PropInteraction {
  actor: string;
  prop: string;
  action: string;
  hand?: 'left' | 'right' | 'both';
  start: number;
  end: number;
}

export interface MotionBlueprint {
  subjects: Array<{
    characterId: string;
    actionSequence: TimedAction[];
    movementDirection?: string;
  }>;
  propInteractions: PropInteraction[];
}

export interface CameraMovement {
  type:
    | 'static'
    | 'pan_left'
    | 'pan_right'
    | 'tilt_up'
    | 'tilt_down'
    | 'dolly_in'
    | 'dolly_out'
    | 'truck_left'
    | 'truck_right'
    | 'orbit'
    | 'handheld'
    | 'zoom_in'
    | 'zoom_out';
  start?: number;
  end?: number;
}

export interface CameraBlueprint {
  shotSize: EditableField<string>;
  angle: EditableField<string>;
  movement: CameraMovement[];
  lensFeel?: EditableField<string>;
}

export interface TimingBlueprint {
  phases: Array<{ phase: string; start: number; end: number }>;
}

export interface AudioBlueprint {
  dialogue: Array<{
    characterId: string;
    text: EditableField<string>;
    emotion?: string;
    start?: number;
    end?: number;
  }>;
  environment: EditableField<string>;
  soundEvents: Array<{ start: number; end: number; description: string }>;
}

export interface ContinuityState {
  characterStates: Record<string, {
    holding?: string;
    position?: string;
    direction?: string;
    emotion?: string;
    lookId?: string;
  }>;
  sceneId?: string;
  sceneZone?: string;
  lighting?: string;
  time?: string;
}

export interface ShotAnalysis {
  shotId: string;
  start: number;
  end: number;
  duration: number;
  storyBeat: EditableField<string>;
  characters: Array<{
    characterId: string;
    lookId?: string;
    lookOverride?: {
      lookId: string;
      source: 'user';
      locked: true;
    };
  }>;
  scene: { sceneId?: string; sceneZone?: string };
  props: Array<{ propId: string; role?: string }>;
  frameBlueprint: FrameBlueprint;
  motionBlueprint: MotionBlueprint;
  cameraBlueprint: CameraBlueprint;
  timingBlueprint: TimingBlueprint;
  audioBlueprint: AudioBlueprint;
  motionComplexity: MotionComplexity;
  motionComplexityConfidence?: number;
  startState?: ContinuityState;
  endState?: ContinuityState;
  transition?: 'hard_cut' | 'fade' | 'flash' | 'zoom' | 'match_motion' | 'other';
  analysisFrames: Array<{
    position: ShotAnalysisFramePosition;
    time: number;
    url: string;
  }>;
  detection: {
    source: 'ffmpeg' | 'manual';
    score?: number;
  };
  analysisStatus?: 'pending' | 'analyzing' | 'ready' | 'failed';
  analysisError?: string;
  analyzedAt?: string;
}

export interface VideoRemixGlobalAnalysis {
  story: {
    summary: string;
    genre?: string;
    structure: string[];
  };
  characters: CharacterAsset[];
  scenes: SceneAsset[];
  props: PropAsset[];
  style?: string;
  shotComplexities: Array<{
    shotId: string;
    motionComplexity: MotionComplexity;
    confidence: number;
  }>;
  analysisKey?: string;
  mode?: 'fast' | 'deep';
}

export interface ShotPromptState {
  analysis: ShotAnalysis;
  analysisHash: string;
  rawPrompt: string;
  rawSource: 'analysis' | 'user';
  resolvedPrompt: string;
  rawImagePrompt: string;
  optimizedTemplate?: string;
  optimizedPrompt: string;
  optimizedSource?: 'optimizer' | 'user' | '';
  imagePromptTemplate?: string;
  imagePrompt: string;
  imagePromptSource: 'analysis' | 'optimizer' | 'user';
  targetModel: string;
  assetHash: string;
  videoOptimizationHash: string;
  imageOptimizationHash: string;
  promptHash: string;
  videoProfileId?: string;
  imageProfileId?: string;
  optimizationStatus: 'draft' | 'optimizing' | 'ready' | 'failed';
  optimizationError?: string;
  updatedAt?: string;
}

export interface KeyframeResult {
  id: string;
  shotId: string;
  position: 'start' | 'middle' | 'end';
  sourceFrameUrl?: string;
  sourceFrameTime?: number;
  generatedPrompt: string;
  prompt: string;
  promptSource: 'pipeline' | 'user';
  sourcePromptHash: string;
  inputHash: string;
  imageModel: string;
  aspectRatio: string;
  resolution: string;
  referenceImages: string[];
  url?: string;
  status: 'pending' | 'generating' | 'ready' | 'confirmed' | 'failed';
  attempt: number;
  error?: string;
  errorCode?: string;
  retryable?: boolean;
  submitted?: boolean;
  retryBlocked?: boolean;
  generationStartedAt?: string;
  generatedAt?: string;
  confirmedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface GeneratedShotVideo {
  id: string;
  shotId: string;
  url?: string;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  sourceDuration?: number;
  targetDuration?: number;
  trimStart?: number;
  trimEnd?: number;
  speed?: number;
  error?: string;
}

export interface TimelineShot {
  shotId: string;
  order: number;
  start: number;
  end: number;
  transition: 'hard_cut' | 'fade';
  videoUrl?: string;
}

export interface VideoRemixLocks {
  story: boolean;
  motion: boolean;
  composition: boolean;
  camera: boolean;
  duration: boolean;
  characters: boolean;
  scenes: boolean;
  props: boolean;
  style: boolean;
}

export interface VideoRemixState {
  schemaVersion: 1;
  remixId: string;
  mode: 'high_fidelity';
  stage: VideoRemixStage;
  source: ReferenceVideo | null;
  analysisRun: {
    mode: 'fast' | 'deep';
    globalStatus: 'idle' | 'analyzing' | 'ready' | 'failed';
    completedShots: number;
    totalShots: number;
    analysisKey?: string;
    updatedAt?: string;
  };
  assetReview: {
    confirmed: boolean;
    confirmedAt?: string;
    updatedAt?: string;
  };
  promptReview: {
    confirmed: boolean;
    confirmedAt?: string;
    updatedAt?: string;
    targetModel?: string;
  };
  keyframeReview: {
    confirmed: boolean;
    confirmedAt?: string;
    updatedAt?: string;
    imageModel?: string;
    aspectRatio?: string;
    resolution?: string;
  };
  story: {
    summary: string;
    genre?: string;
    structure: string[];
    style?: string;
  } | null;
  assets: {
    characters: CharacterAsset[];
    scenes: SceneAsset[];
    props: PropAsset[];
  };
  shots: ShotAnalysis[];
  prompts: Record<string, ShotPromptState>;
  keyframes: KeyframeResult[];
  generatedVideos: GeneratedShotVideo[];
  timeline: TimelineShot[];
  bgm: { mode: 'none' | 'original' | 'upload'; url?: string };
  subtitles: { enabled: boolean; style: string };
  output: { url: string; duration: number } | null;
  locks: VideoRemixLocks;
  errors: Array<{ scope: string; id?: string; message: string; retryable: boolean; code?: string }>;
  createdAt: string;
  updatedAt: string;
}

export const VIDEO_REMIX_STAGES: readonly VideoRemixStage[];
export const SHOT_ANALYSIS_FRAME_POSITIONS: readonly ShotAnalysisFramePosition[];
export const VIDEO_REMIX_KEYFRAME_POSITIONS: Readonly<{
  simple: readonly ['start'];
  medium: readonly ['start', 'end'];
  complex: readonly ['start', 'middle', 'end'];
}>;
export const VIDEO_REMIX_WORKSPACE_TABS: readonly {
  id: VideoRemixWorkspaceTab;
  label: string;
}[];
export const HIGH_FIDELITY_LOCKS: Readonly<VideoRemixLocks>;

export function createVideoRemixState(
  overrides?: Partial<VideoRemixState> & { remixId?: string }
): VideoRemixState;
export function isVideoRemixState(value: unknown): value is VideoRemixState;
export function workspaceTabForStage(stage: VideoRemixStage): VideoRemixWorkspaceTab;
export function summarizeVideoRemixState(state: unknown): {
  shots: number;
  characters: number;
  scenes: number;
  props: number;
  confirmedKeyframes: number;
  requiredKeyframes: number;
  completedVideos: number;
};
export function replaceVideoRemixSource(
  state: unknown,
  source: ReferenceVideo
): VideoRemixState;
export function setVideoRemixSourceError(
  state: unknown,
  message: string,
  retryable?: boolean
): VideoRemixState;
export function createVideoRemixShot(input: {
  shotId: string;
  start: number;
  end: number;
  detectionSource?: 'ffmpeg' | 'manual';
  detectionScore?: number;
  analysisFrames?: ShotAnalysis['analysisFrames'];
}): ShotAnalysis;
export function normalizeVideoRemixCutPoints(
  duration: number,
  cutPoints?: number[],
  options?: { minShotDuration?: number }
): number[];
export function buildVideoRemixShots(input?: {
  duration?: number;
  cutPoints?: number[];
  previousShots?: ShotAnalysis[];
  detectionSource?: 'ffmpeg' | 'manual';
  detections?: Array<{ time: number; score?: number }>;
  minShotDuration?: number;
}): ShotAnalysis[];
export function beginVideoRemixPreprocessing(state: unknown): VideoRemixState;
export function completeVideoRemixPreprocessing(
  state: unknown,
  result: {
    source?: ReferenceVideo;
    proxyUrl: string;
    shots: ShotAnalysis[];
  }
): VideoRemixState;
export function setVideoRemixPreprocessingError(
  state: unknown,
  message: string,
  retryable?: boolean
): VideoRemixState;
export function beginVideoRemixAnalysis(
  state: unknown,
  mode?: 'fast' | 'deep'
): VideoRemixState;
export function applyVideoRemixGlobalAnalysis(
  state: unknown,
  result: VideoRemixGlobalAnalysis
): VideoRemixState;
export function applyVideoRemixShotAnalysis(
  state: unknown,
  analyzedShot: ShotAnalysis
): VideoRemixState;
export function setVideoRemixShotAnalysisError(
  state: unknown,
  shotId: string,
  message: string,
  options?: { code?: string; retryable?: boolean }
): VideoRemixState;
export function setVideoRemixGlobalAnalysisError(
  state: unknown,
  message: string,
  options?: { code?: string; retryable?: boolean }
): VideoRemixState;
export function restoreVideoRemixAnalysis(
  state: unknown,
  snapshot: {
    global: VideoRemixGlobalAnalysis;
    shots?: ShotAnalysis[];
    analysisKey?: string;
    mode?: 'fast' | 'deep';
  }
): VideoRemixState;
export function resolveVideoRemixAsset(asset: CharacterAsset): CharacterAsset;
export function resolveVideoRemixAsset(asset: SceneAsset): SceneAsset;
export function resolveVideoRemixAsset(asset: PropAsset): PropAsset;
export function resolveVideoRemixCharacterLook(look: CharacterLook): CharacterLook;
export function replaceVideoRemixAsset(
  state: unknown,
  kind: 'characters' | 'scenes' | 'props',
  assetId: string,
  replacement: VideoRemixAssetReplacement | null
): VideoRemixState;
export function replaceVideoRemixCharacterLook(
  state: unknown,
  characterId: string,
  lookId: string,
  replacement: VideoRemixAssetReplacement | null
): VideoRemixState;
export function addVideoRemixCharacterLook(
  state: unknown,
  characterId: string,
  look: CharacterLook
): VideoRemixState;
export function setVideoRemixShotCharacterLook(
  state: unknown,
  shotId: string,
  characterId: string,
  lookId: string
): VideoRemixState;
export function setVideoRemixPropRemoved(
  state: unknown,
  propId: string,
  removed?: boolean
): VideoRemixState;
export function confirmVideoRemixAssets(state: unknown): VideoRemixState;
export function resolveVideoRemixShotCharacter(
  state: unknown,
  shotId: string,
  characterId: string
): { character: CharacterAsset; look?: CharacterLook } | null;
export function validateVideoRemixPromptTemplate(
  sourceTemplate: string,
  candidateTemplate: string
): { valid: boolean; missing: string[]; unknown: string[] };
export function buildVideoRemixRawPrompt(state: unknown, shotId: string): string;
export function buildVideoRemixImagePrompt(state: unknown, shotId: string): string;
export function resolveVideoRemixPromptTemplate(
  state: unknown,
  shotId: string,
  template: string,
  options?: { targetModel?: string; imagePrompt?: boolean }
): string;
export function buildVideoRemixShotPrompts(
  state: unknown,
  shotId: string,
  targetModel?: string,
  options?: {
    resetVideoOptimization?: boolean;
    resetImageOptimization?: boolean;
  }
): VideoRemixState;
export function buildAllVideoRemixPrompts(
  state: unknown,
  targetModel?: string,
  options?: {
    resetVideoOptimization?: boolean;
    resetImageOptimization?: boolean;
  }
): VideoRemixState;
export function updateVideoRemixPromptLayer(
  state: unknown,
  shotId: string,
  layer: 'rawPrompt' | 'optimizedPrompt' | 'imagePrompt',
  value: string
): VideoRemixState;
export function beginVideoRemixPromptOptimization(
  state: unknown,
  shotId: string
): VideoRemixState;
export function applyVideoRemixPromptOptimization(
  state: unknown,
  shotId: string,
  result: {
    optimizedTemplate?: string;
    imagePromptTemplate?: string;
    videoProfileId?: string;
    imageProfileId?: string;
  }
): VideoRemixState;
export function setVideoRemixPromptOptimizationError(
  state: unknown,
  shotId: string,
  message: string,
  retryable?: boolean
): VideoRemixState;
export function invalidateVideoRemixShotPrompts(
  state: unknown,
  shotIds?: string | string[]
): VideoRemixState;
export function getVideoRemixPromptReadiness(state: unknown): {
  total: number;
  ready: number;
  failed: number;
  confirmed: boolean;
};
export function confirmVideoRemixPrompts(state: unknown): VideoRemixState;
export function keyframePositionsForComplexity(
  complexity?: MotionComplexity
): Array<'start' | 'middle' | 'end'>;
export function getVideoRemixKeyframeSourceFrame(
  state: unknown,
  shotId: string,
  position: 'start' | 'middle' | 'end'
): ShotAnalysis['analysisFrames'][number] | null;
export function buildVideoRemixKeyframePrompt(
  state: unknown,
  shotId: string,
  position?: 'start' | 'middle' | 'end'
): string;
export function getVideoRemixKeyframeReferenceImages(
  state: unknown,
  shotId: string,
  position?: 'start' | 'middle' | 'end'
): string[];
export function prepareVideoRemixKeyframes(
  state: unknown,
  options?: {
    imageModel?: string;
    aspectRatio?: string;
    resolution?: string;
  }
): VideoRemixState;
export function beginVideoRemixKeyframeGeneration(
  state: unknown,
  keyframeId: string
): VideoRemixState;
export function applyVideoRemixKeyframeResult(
  state: unknown,
  keyframeId: string,
  result: { url?: string; inputHash?: string }
): VideoRemixState;
export function setVideoRemixKeyframeError(
  state: unknown,
  keyframeId: string,
  message: string,
  options?: {
    code?: string;
    retryable?: boolean;
    submitted?: boolean;
    inputHash?: string;
  }
): VideoRemixState;
export function finalizeVideoRemixKeyframeBatch(state: unknown): VideoRemixState;
export function updateVideoRemixKeyframePrompt(
  state: unknown,
  keyframeId: string,
  value: string
): VideoRemixState;
export function getVideoRemixKeyframeReadiness(state: unknown): {
  total: number;
  ready: number;
  confirmed: number;
  pending: number;
  generating: number;
  failed: number;
  reviewConfirmed: boolean;
};
export function confirmVideoRemixKeyframe(
  state: unknown,
  keyframeId: string
): VideoRemixState;
export function confirmVideoRemixKeyframes(state: unknown): VideoRemixState;
export function recoverStaleVideoRemixKeyframes(
  state: unknown,
  now?: number,
  staleAfterMs?: number
): VideoRemixState;
