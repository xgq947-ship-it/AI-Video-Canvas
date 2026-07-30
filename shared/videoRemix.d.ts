export const VIDEO_REMIX_SCHEMA_VERSION: 1;

export type VideoRemixStage =
  | 'source'
  | 'analyzing'
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
}

export interface VoiceDescription {
  language?: string;
  gender?: string;
  ageFeel?: string;
  tone?: string;
  pitch?: string;
  speakingStyle?: string;
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
}

export interface PropAsset {
  id: string;
  name: string;
  category: 'hero' | 'interactive' | 'background';
  description: string;
  referenceImages: string[];
  appearsInShots: string[];
  source: AssetSource;
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
  characters: Array<{ characterId: string; lookId?: string }>;
  scene: { sceneId?: string; sceneZone?: string };
  props: Array<{ propId: string; role?: string }>;
  frameBlueprint: FrameBlueprint;
  motionBlueprint: MotionBlueprint;
  cameraBlueprint: CameraBlueprint;
  timingBlueprint: TimingBlueprint;
  audioBlueprint: AudioBlueprint;
  motionComplexity: MotionComplexity;
  startState?: ContinuityState;
  endState?: ContinuityState;
  transition?: 'hard_cut' | 'fade' | 'flash' | 'zoom' | 'match_motion' | 'other';
}

export interface ShotPromptState {
  analysis: ShotAnalysis;
  rawPrompt: string;
  resolvedPrompt: string;
  optimizedPrompt: string;
  imagePrompt?: string;
  assetHash?: string;
  promptHash?: string;
}

export interface KeyframeResult {
  id: string;
  shotId: string;
  position: 'start' | 'middle' | 'end';
  url?: string;
  status: 'pending' | 'generating' | 'ready' | 'confirmed' | 'failed';
  error?: string;
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
  errors: Array<{ scope: string; id?: string; message: string; retryable: boolean }>;
  createdAt: string;
  updatedAt: string;
}

export const VIDEO_REMIX_STAGES: readonly VideoRemixStage[];
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
