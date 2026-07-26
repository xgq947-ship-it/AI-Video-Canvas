export interface ImageGenerationProvider {
  id: string; name: string; provider: string; browserProvider: string | null;
  supportsImageToImage: boolean; supportsMultipleReferenceImages: boolean; maxReferenceImages: number;
  supportsMultipleOutputs: boolean; maxOutputCount: number; resolutions: string[]; supportedAspectRatios: string[];
}
export interface VideoGenerationProvider {
  id: string; name: string; provider: string; browserProvider: string | null;
  supportsTextToVideo: boolean; supportsImageToVideo: boolean; supportsMultipleReferenceImages: boolean;
  maxReferenceImages: number; supportsNativeAudio: boolean; supportsExtend: boolean;
  supportedDurations: number[]; resolutions: string[]; supportedAspectRatios: string[];
}
export const IMAGE_GENERATION_PROVIDERS: readonly ImageGenerationProvider[];
export const VIDEO_GENERATION_PROVIDERS: readonly VideoGenerationProvider[];
export function getImageGenerationProvider(id?: string): ImageGenerationProvider | null;
export function getVideoGenerationProvider(id?: string): VideoGenerationProvider | null;
export function clampImageOutputCount(modelId: string, requestedCount: unknown): number;
export function supportedImageOutputCounts(modelId: string): number[];
export function normalizeImageAspectRatio(modelId: string, value?: string): string | undefined;
export function normalizeVideoParameters(modelId: string, values?: { aspectRatio?: string; duration?: number }): { aspectRatio?: string; duration?: number };
