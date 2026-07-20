export type PromptOptimizationNodeType = 'image' | 'video';

export interface PromptOptimizationProfile {
  id: string;
  nodeType: PromptOptimizationNodeType;
  label: string;
  description: string;
  aspectRatio?: string;
  systemInstruction: string;
}

export const PROMPT_OPTIMIZATION_PROFILES: Record<string, PromptOptimizationProfile>;
export const IMAGE_PROMPT_OPTIMIZATION_PROFILES: PromptOptimizationProfile[];
export function getPromptOptimizationProfile(profileId?: string): PromptOptimizationProfile | null;
export function buildPromptOptimizationInstruction(
  profile: PromptOptimizationProfile,
  context?: { targetModel?: string; aspectRatio?: string; duration?: number }
): string;
export function formatOptimizedPrompt(text: string, profile: PromptOptimizationProfile): string;
