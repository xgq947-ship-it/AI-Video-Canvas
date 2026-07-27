/**
 * generationService.ts
 * 
 * Frontend service layer for AI content generation.
 * Proxies requests to backend API which handles multiple providers:
 * - Image: Gemini, OpenAI, Google Flow, Codex
 * - Video: Seedance, 即梦工作流, Google Flow
 */

export interface GenerateImageParams {
  workflowId: string;
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  imageBase64?: string | string[]; // Supports single image or array of images
  imageModel?: string; // Image model version
  nodeId?: string; // ID of the node initiating generation
  count?: number; // Batch size for providers that support one-request multi-image generation
}

export interface GenerateVideoParams {
  workflowId: string;
  prompt: string;
  imageBase64?: string; // For Image-to-Video (start frame)
  lastFrameBase64?: string; // For frame-to-frame interpolation (end frame)
  referenceImages?: string[]; // 多参考图/参考素材（Google Flow Ingredients、即梦参考素材）
  // 每张参考素材在生成平台页面上的显示名，与 referenceImages 一一对应。
  // 即梦用它当上传文件名，从而让提示词里的 @xxx 精确指到这张图。
  referenceImageLabels?: string[];
  aspectRatio?: string;
  resolution?: string; // Add resolution to params
  duration?: number; // Video duration in seconds (e.g., 5, 6, 8, 10)
  videoModel?: string;
  referenceAudioUrls?: string[]; // Seedance 2.0 reference audio (voice/tone anchor)
  generateAudio?: boolean; // 支持原生音频的视频模型，默认开启
  nodeId?: string; // ID of the node initiating generation
}

export type CodexImageJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface CodexImageJob {
  id: string;
  nodeId: string;
  attempt: number;
  status: CodexImageJobStatus;
  prompt: string;
  aspectRatio: string;
  resolution: string;
  outputSpec?: {
    aspectRatio: string;
    ratioWidth?: number;
    ratioHeight?: number;
    orientation?: 'square' | 'landscape' | 'portrait';
    resolution: string;
    enforceExactAspectRatio: boolean;
    tolerance?: number;
    instruction: string;
  };
  sourceDimensions?: { width: number; height: number };
  outputDimensions?: { width: number; height: number };
  aspectRatioVerified?: boolean;
  aspectRatioAdjusted?: boolean;
  aspectRatioAdjustmentMode?: string;
  resultUrl?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface QueueCodexImageParams {
  workflowId: string;
  nodeId: string;
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  referenceImages?: string[];
}

export interface ProductSceneJob {
  id: string;
  workflowId: string;
  nodeId: string;
  resultNodeId: string;
  status: 'pending' | 'processing' | 'completed' | 'partial_failed' | 'failed' | 'cancelled';
  stage: 'queued' | 'analyzing' | 'generating_images' | 'images_completed' | 'generating_videos' | 'completed' | 'partial_failed' | 'failed' | 'cancelled';
  stageLabel: string;
  recognitionProvider: 'codex-cli' | 'gemini-web';
  recognitionModel: string;
  imageModel: string;
  aspectRatio: string;
  prompt?: string;
  sceneAnalysis?: string;
  personaAnalysis?: string;
  compositionAnalysis?: string;
  productAnalysis?: string;
  resultUrl?: string;
  resultNodeIds?: string[];
  resultUrls?: string[];
  imageCount?: number;
  autoGenerateVideo?: boolean;
  videoPrompt?: string;
  videoPromptSourceId?: string;
  videoModel?: string;
  videoAspectRatio?: string;
  videoDuration?: number;
  currentVideoIndex?: number;
  videoTasks?: Array<{ index: number; imageNodeId: string; videoNodeId: string; status: 'waiting' | 'running' | 'success' | 'failed' | 'cancelled'; resultUrl?: string; error?: string; errorCode?: string; retryBlocked?: boolean }>;
  error?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateProductSceneJobParams {
  jobId?: string;
  workflowId: string;
  nodeId: string;
  retryJobId?: string;
  sceneImage: string;
  productImage: string;
  dimensions: { length: number; width: number; height: number; unit: 'mm' | 'cm' };
  productCategory?: string;
  preserveProductMarkings: boolean;
  personaBrief?: string;
  imageModel: string;
  aspectRatio: string;
  imageCount?: number;
  imageResolution?: string;
  recognitionProvider?: 'codex-cli' | 'gemini-web';
  videoPrompt?: string;
  videoPromptSourceId?: string;
  videoModel?: string;
  videoAspectRatio?: string;
  videoDuration?: number;
  videoResolution?: string;
  videoGenerateAudio?: boolean;
  autoGenerateVideo?: boolean;
}

export const createProductSceneJob = async (params: CreateProductSceneJobParams): Promise<ProductSceneJob> => {
  const response = await fetch('/api/product-scene-jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '无法创建产品场景替换任务');
  return data;
};

export const getProductSceneJob = async (jobId: string, workflowId: string): Promise<ProductSceneJob> => {
  const response = await fetch(`/api/product-scene-jobs/${encodeURIComponent(jobId)}?workflowId=${encodeURIComponent(workflowId)}`, { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '无法读取产品场景替换任务');
  return data;
};

export const getLatestProductSceneJob = async (nodeId: string, workflowId: string): Promise<ProductSceneJob | null> => {
  const response = await fetch(`/api/product-scene-jobs/latest?workflowId=${encodeURIComponent(workflowId)}&nodeId=${encodeURIComponent(nodeId)}`);
  if (response.status === 404) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '无法读取最新产品场景替换任务');
  return data;
};

export const cancelProductSceneJob = async (jobId: string, workflowId: string): Promise<ProductSceneJob> => {
  const response = await fetch(`/api/product-scene-jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workflowId })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '取消产品短视频任务失败');
  return data;
};

export const queueCodexImage = async (params: QueueCodexImageParams): Promise<CodexImageJob> => {
  const response = await fetch('/api/codex-image-jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || response.statusText);
  }
  return response.json();
};

export const getCodexImageJob = async (jobId: string): Promise<CodexImageJob> => {
  const response = await fetch(`/api/codex-image-jobs/${encodeURIComponent(jobId)}`, {
    cache: 'no-store'
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || response.statusText);
  }
  return response.json();
};

/**
 * Generates an image by calling the backend API
 */
export const generateImageBatch = async (params: GenerateImageParams): Promise<string[]> => {
  try {
    const response = await fetch('/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || response.statusText);
    }

    const data = await response.json();
    const resultUrls = Array.isArray(data.resultUrls)
      ? data.resultUrls.filter((value: unknown): value is string => typeof value === 'string' && value.length > 0)
      : data.resultUrl
        ? [data.resultUrl]
        : [];
    if (resultUrls.length === 0) {
      throw new Error("No image data returned from server");
    }
    return resultUrls;

  } catch (error) {
    console.error("Image Generation Error:", error);
    throw error;
  }
};

export const generateImage = async (params: GenerateImageParams): Promise<string> => {
  const resultUrls = await generateImageBatch({ ...params, count: 1 });
  return resultUrls[0];
};

/**
 * Generates a video by calling the backend API
 */
export const generateVideo = async (params: GenerateVideoParams): Promise<string> => {
  try {
    const response = await fetch('/api/generate-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || response.statusText);
    }

    const data = await response.json();
    if (!data.resultUrl) {
      throw new Error("No video data returned from server");
    }
    return data.resultUrl;

  } catch (error) {
    console.error("Video Generation Error:", error);
    throw error;
  }
};
