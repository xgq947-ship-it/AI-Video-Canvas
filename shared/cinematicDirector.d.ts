export type CinematicCastRole = 'protagonist' | 'supporting';
export type CinematicReferenceSource = 'upload' | 'library' | 'ai';
export type CinematicShotStatus = 'pending' | 'queued' | 'generating' | 'completed' | 'failed' | 'cancelled' | 'submission_unknown';

export interface CinematicReferenceImage {
  id: string;
  url: string;
  source: CinematicReferenceSource;
  label: string;
  usage?: string;
  nodeId?: string;
}

export interface CinematicCastMember {
  id: string;
  name: string;
  role: CinematicCastRole;
  description: string;
  referenceImages: CinematicReferenceImage[];
}

export interface CinematicDirectorSettings {
  provider?: 'auto' | 'gemini' | 'codex' | 'deepseek' | string;
  modelId?: string;
  platform?: string;
  visualStyle?: string;
  customVisualStyle?: string;
  aspectRatio?: string;
  width?: number;
  height?: number;
  totalDuration?: number;
  shotCount?: number;
  durationPerShot?: number;
  language?: string;
  pace?: string;
  videoModel?: string;
  videoResolution?: string;
  audioEnabled?: boolean;
  allowDirectorOptimization?: boolean;
  [key: string]: unknown;
}

export interface CinematicCamera {
  shotType: string;
  fov: string;
  angle: string;
  motion: string;
  transition?: 'hard_cut' | 'fade';
}

export interface CinematicShot {
  id: string;
  order: number;
  title: string;
  duration: number;
  aspectRatio: string;
  width: number;
  height: number;
  scene: string;
  action: string;
  dialogue?: { speaker?: string; text: string; emotion?: string };
  cast: string[];
  camera: CinematicCamera;
  space?: string;
  firstFrame?: string;
  performance?: string;
  physics?: string;
  lighting?: string;
  color?: string;
  wardrobe?: string;
  prompt: string;
  generation: {
    provider: string;
    modelId: string;
    status: CinematicShotStatus;
    progress?: number;
    taskId?: string;
    videoUrl?: string;
    thumbnailUrl?: string;
    error?: string;
    retryCount?: number;
    queuedAt?: number;
    startedAt?: number;
    finishedAt?: number;
    elapsedMs?: number;
  };
}

export interface CinematicDirectorOutput {
  version: '1.0';
  title: string;
  sourceType: 'script';
  model: { provider: 'gemini' | 'codex' | 'deepseek'; modelId: string };
  global: {
    platform: string;
    visualStyle: string;
    aspectRatio: string;
    width: number;
    height: number;
    totalDuration: number;
    shotCount: number;
    language: string;
    pace: string;
    videoModel: string;
    audioEnabled: boolean;
  };
  cast: CinematicCastMember[];
  shots: CinematicShot[];
}

export const CINEMATIC_SCHEMA_VERSION: '1.0';
export const CINEMATIC_ASPECT_RATIOS: readonly string[];
export const CINEMATIC_RESOLUTION_PRESETS: Record<string, readonly { width: number; height: number; label: string }[]>;
export const CINEMATIC_VISUAL_STYLES: readonly { id: string; label: string; prompt: string }[];
export const CINEMATIC_PACES: readonly string[];
export const CINEMATIC_PLATFORMS: readonly string[];
export const CINEMATIC_CAST_ROLES: readonly CinematicCastRole[];
export const CINEMATIC_REFERENCE_SOURCES: readonly CinematicReferenceSource[];
export const CINEMATIC_FOVS: readonly string[];
export const CINEMATIC_SHOT_TYPES: readonly string[];
export const CINEMATIC_DEFAULT_VIDEO_MODEL: string;

export function nearestCinematicAspectRatio(width: number, height: number, fallback?: string): string;
export function resolveCinematicResolution(aspectRatio: string, width?: number, height?: number): { width: number; height: number; label: string; aspectRatio: string; custom: boolean; mappedFrom?: { width: number; height: number } };
export function cinematicVisualStyle(settings?: CinematicDirectorSettings): string;
export function getCinematicVideoModel(modelId?: string): any;
export function cinematicModelUsesReferenceTags(modelId?: string): boolean;
export function resolveCinematicDuration(duration: number, modelId?: string, fallback?: number): number;
export function normalizeCinematicSettings(input?: CinematicDirectorSettings): Required<CinematicDirectorSettings>;
export function normalizeCinematicCast(input?: unknown[]): CinematicCastMember[];
export function countCinematicReferences(cast?: unknown[]): number;
export function validateCinematicCast(cast?: unknown[], options?: { requireProtagonist?: boolean }): { valid: boolean; errors: string[]; cast: CinematicCastMember[] };
export function validateCinematicReferenceBudget(cast?: unknown[], videoModel?: string): { valid: boolean; errors: string[]; count: number; maxReferenceImages: number; modelId: string };
export function compileCinematicPrompt(shot: Partial<CinematicShot>, global?: CinematicDirectorSettings, cast?: CinematicCastMember[]): string;
export function normalizeCinematicDirectorOutput(value: unknown, options?: { settings?: CinematicDirectorSettings; model?: { provider?: string; modelId?: string }; cast?: CinematicCastMember[] }): CinematicDirectorOutput;
export function validateCinematicDirectorOutput(value: unknown): { valid: boolean; errors: string[] };
export function mergeCinematicShotsPreservingGeneration(previousShots?: CinematicShot[], nextShots?: CinematicShot[]): CinematicShot[];
export function rollupCinematicGenerationStatus(shots?: CinematicShot[]): { total: number; completed: number; failed: number; batchStatus: string; storyboardStatus: string };
export function parseCinematicDirectorJson(value: string): unknown;
export function buildCinematicReferenceBundle(cast?: CinematicCastMember[], options?: { maxReferenceImages?: number }): { referenceImages: string[]; referenceImageLabels: string[]; references: Array<{ url: string; label: string; castId: string; source: CinematicReferenceSource; imageId: string }> };
export function buildCinematicVideoRequest(options: { workflowId: string; nodeId: string; shot: CinematicShot; cast: CinematicCastMember[]; settings: CinematicDirectorSettings }): Record<string, unknown>;
export function buildCinematicMergeManifest(options: Record<string, unknown>): Record<string, unknown>;
