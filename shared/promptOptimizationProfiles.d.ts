export type PromptOptimizationNodeType =
  | 'image'
  | 'video'
  | 'image-remix'
  | 'video-remix';

export interface PromptOptimizationProfile {
  id: string;
  nodeType: PromptOptimizationNodeType;
  label: string;
  description: string;
  aspectRatio?: string;
  /**
   * 不出现在图片节点的手动下拉里，但仍可按 id 取用。
   * 场景与道具那六套就是这样：视频混剪的资产管线依赖它们，只是不需要手选。
   */
  hiddenInMenu?: boolean;
  /** 视频 profile 专用：这套提示词是给哪个供应商写的（两者的参考图约定不通用）。 */
  videoProvider?: 'jimeng' | 'google-flow' | 'generic';
  preserveReferenceTags?: boolean;
  systemInstruction: string;
}

export const PROMPT_OPTIMIZATION_PROFILES: Record<string, PromptOptimizationProfile>;
export const IMAGE_PROMPT_OPTIMIZATION_PROFILES: PromptOptimizationProfile[];
export const VIDEO_PROMPT_OPTIMIZATION_PROFILES: PromptOptimizationProfile[];
export function resolveVideoProfileForModel(videoModel?: string): PromptOptimizationProfile;
export function resolveVideoRemixPromptProfileForModel(
  videoModel?: string
): PromptOptimizationProfile;
export function getPromptOptimizationProfile(profileId?: string): PromptOptimizationProfile | null;
export function buildPromptOptimizationInstruction(
  profile: PromptOptimizationProfile,
  context?: {
    task?: string;
    targetModel?: string;
    aspectRatio?: string;
    duration?: number;
    preservePlaceholders?: boolean;
  }
): string;
export function formatOptimizedPrompt(text: string, profile: PromptOptimizationProfile): string;
