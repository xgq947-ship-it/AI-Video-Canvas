export type StickmanSourceType = 'script' | 'reference_video';
export type StickmanModelProvider = 'gemini' | 'codex' | 'deepseek';
export type StickmanShotStatus = 'pending' | 'queued' | 'generating' | 'completed' | 'failed' | 'cancelled';

export interface StickmanDirectorSettings {
  platform?: string;
  visualTheme?: string;
  aspectRatio?: string;
  width?: number;
  height?: number;
  totalDuration?: number;
  shotCount?: number;
  durationPerShot?: number;
  language?: string;
  promptLanguage?: string;
  pace?: string;
  dialogueLanguage?: string;
  voiceGender?: string;
  voiceStyle?: string;
  includeDialogue?: boolean;
  includeVoiceover?: boolean;
  includeAmbience?: boolean;
  includeSfx?: boolean;
  includeMusic?: boolean;
  nativeAudio?: boolean;
  preserveReferenceStructure?: boolean;
  allowDirectorOptimization?: boolean;
  [key: string]: unknown;
}

export interface StickmanShot {
  id: string;
  order: number;
  title: string;
  sourceShotId?: string;
  sourceStartTime?: number;
  sourceEndTime?: number;
  sourceKeyframeUrl?: string;
  duration: number;
  aspectRatio: string;
  width: number;
  height: number;
  visual: {
    scene: string;
    action: string;
    emotion?: string;
    composition?: string;
    shotType?: string;
    cameraAngle?: string;
    cameraMotion?: string;
    transition?: string;
  };
  audio: {
    dialogue?: { speaker?: string; text: string; voice?: string; emotion?: string };
    voiceover?: { text: string; voice?: string; emotion?: string };
    ambience: string[];
    sfx: string[];
    music?: string;
  };
  prompt: string;
  generation: {
    provider: 'flow';
    modelId?: string;
    status: StickmanShotStatus;
    progress?: number;
    taskId?: string;
    videoUrl?: string;
    thumbnailUrl?: string;
    error?: string;
    retryCount?: number;
  };
}

export interface StickmanDirectorOutput {
  version: '1.0';
  title: string;
  sourceType: StickmanSourceType;
  model: { provider: StickmanModelProvider; modelId: string };
  global: {
    platform: string;
    visualTheme: string;
    aspectRatio: string;
    width: number;
    height: number;
    totalDuration: number;
    shotCount: number;
    language: string;
    pace: string;
    audioEnabled: boolean;
  };
  shots: StickmanShot[];
}

export const STICKMAN_SCHEMA_VERSION: '1.0';
export const STICKMAN_ASPECT_RATIOS: readonly string[];
export const STICKMAN_RESOLUTION_PRESETS: Record<string, readonly { width: number; height: number; label: string }[]>;
export const STICKMAN_VISUAL_THEMES: readonly { id: string; label: string; background: string; stickman: string; accent: string }[];
export const STICKMAN_PACES: readonly string[];
export const STICKMAN_PLATFORMS: readonly string[];
export function nearestStickmanAspectRatio(width: number, height: number, fallback?: string): string;
export function resolveStickmanResolution(aspectRatio: string, width: number, height: number): { width: number; height: number; label: string; aspectRatio: string; custom: boolean; mappedFrom?: { width: number; height: number } };
export function normalizeStickmanSettings(input?: StickmanDirectorSettings): Required<StickmanDirectorSettings>;
export function resolveDirectorModel(input?: { provider?: string; sourceType?: StickmanSourceType; hasVideo?: boolean }): { provider: StickmanModelProvider; providerId: string };
export function compileFlowPrompt(shot: Partial<StickmanShot>, global?: StickmanDirectorSettings): string;
export function normalizeStickmanDirectorOutput(value: unknown, options?: { sourceType?: StickmanSourceType; settings?: StickmanDirectorSettings; model?: { provider?: StickmanModelProvider; modelId?: string }; sourceShots?: unknown[] }): StickmanDirectorOutput;
export function validateStickmanDirectorOutput(value: unknown): { valid: boolean; errors: string[] };
export function mergeStickmanShotsPreservingGeneration(previousShots?: StickmanShot[], nextShots?: StickmanShot[]): StickmanShot[];
export function rollupStickmanGenerationStatus(shots?: Array<{ generation?: { status?: StickmanShotStatus } }>): {
  total: number;
  completed: number;
  failed: number;
  batchStatus: 'idle' | 'running' | 'completed' | 'partial_failed' | 'failed' | 'ready';
  storyboardStatus: 'completed' | 'failed' | 'generating' | 'ready';
};
export function parseStickmanDirectorJson(value: string): unknown;
export function createStickmanScriptFromAnalysis(analysis: unknown, options?: { settings?: StickmanDirectorSettings; title?: string }): {
  title: string;
  content: string;
  notes: string;
  platform: string;
  aspectRatio: string;
  width: number;
  height: number;
  totalDuration: number;
  shotCount: number;
  durationPerShot: number;
};
