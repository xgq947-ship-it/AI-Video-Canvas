export type PromptOptimizationNodeType = 'image' | 'video';

export interface PromptOptimizationProfile {
  id: string;
  nodeType: PromptOptimizationNodeType;
  label: string;
  description: string;
  aspectRatio?: string;
  /** 视频 profile 专用：这套提示词是给哪个供应商写的（两者的参考图约定不通用）。 */
  videoProvider?: 'jimeng' | 'google-flow';
  systemInstruction: string;
}

export const PROMPT_OPTIMIZATION_PROFILES: Record<string, PromptOptimizationProfile>;
export const IMAGE_PROMPT_OPTIMIZATION_PROFILES: PromptOptimizationProfile[];
export const VIDEO_PROMPT_OPTIMIZATION_PROFILES: PromptOptimizationProfile[];
export function resolveVideoProfileForModel(videoModel?: string): PromptOptimizationProfile;
export function getPromptOptimizationProfile(profileId?: string): PromptOptimizationProfile | null;
export function buildPromptOptimizationInstruction(
  profile: PromptOptimizationProfile,
  context?: { targetModel?: string; aspectRatio?: string; duration?: number }
): string;
export function formatOptimizedPrompt(text: string, profile: PromptOptimizationProfile): string;
