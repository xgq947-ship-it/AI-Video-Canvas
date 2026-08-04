export interface ImageGenerationProvider {
  id: string; name: string; provider: string; browserProvider: string | null;
  supportsImageToImage: boolean; supportsMultipleReferenceImages: boolean; maxReferenceImages: number;
  supportsMultipleOutputs: boolean; maxOutputCount: number; resolutions: string[]; defaultResolution?: string;
  supportedAspectRatios: string[];
}
export interface VideoGenerationProvider {
  id: string; name: string; provider: string; browserProvider: string | null;
  supportsTextToVideo: boolean; supportsImageToVideo: boolean; supportsVideoReference?: boolean; supportsMultipleReferenceImages: boolean;
  maxReferenceImages: number; supportsNativeAudio: boolean; supportsExtend: boolean;
  supportedDurations: number[]; resolutions: string[]; defaultResolution?: string; supportedAspectRatios: string[];
}
export interface VideoProviderCapabilities {
  imageToVideo: boolean;
  startFrame: boolean;
  endFrame: boolean;
  multiReference: boolean;
  characterReference: boolean;
  audioGeneration: boolean;
  maxDuration: number;
  maxReferenceImages: number;
  referenceMode: 'start-frame' | 'start-end' | 'reference-materials';
}
export const IMAGE_GENERATION_PROVIDERS: readonly ImageGenerationProvider[];
export const VIDEO_GENERATION_PROVIDERS: readonly VideoGenerationProvider[];
/** 后端 /api/settings/models 返回的运行时模型注册表。 */
export interface DiscoveredModelDefinition {
  provider: string; id: string; displayName: string; type: 'image' | 'video';
  inputModes?: string[]; aspectRatios?: string[]; resolutions?: string[]; durations?: number[];
  defaultResolution?: string;
  maxReferenceImages?: number; maxBatchCount?: number; supportsAudio?: boolean;
  supportsPromptEnhancement?: boolean; supportsSeed?: boolean; discovered?: boolean;
  metadata?: Record<string, unknown>;
}
export interface DiscoveredModelRegistry {
  updatedAt: string;
  providers: Record<string, { discovered: boolean }>;
  models: DiscoveredModelDefinition[];
}
export function applyDiscoveredModelRegistry(registry: DiscoveredModelRegistry | null | undefined): void;
export function resetDiscoveredModelRegistry(): void;
export function listImageGenerationProviders(): ImageGenerationProvider[];
export function listVideoRemixConsistencyImageProviders(): ImageGenerationProvider[];
export function listVideoGenerationProviders(): VideoGenerationProvider[];
export function getImageGenerationProvider(id?: string): ImageGenerationProvider | null;
export function getVideoGenerationProvider(id?: string): VideoGenerationProvider | null;
export function clampImageOutputCount(modelId: string, requestedCount: unknown): number;
export function supportedImageOutputCounts(modelId: string): number[];
export function resolveVideoModelForAspectRatio(aspectRatio: string, preferredModelId?: string): { modelId: string; switched: boolean; from: string } | null;
export function videoModelsForAspectRatio(aspectRatio: string): VideoGenerationProvider[];
export function getVideoProviderCapabilities(modelId?: string): VideoProviderCapabilities | null;
export function normalizeImageAspectRatio(modelId: string, value?: string): string | undefined;
export function normalizeImageResolution(modelId: string, value?: string): string | undefined;
export function normalizeVideoParameters(modelId: string, values?: { aspectRatio?: string; duration?: number }): { aspectRatio?: string; duration?: number };
