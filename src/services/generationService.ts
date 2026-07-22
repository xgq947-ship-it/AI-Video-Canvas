/**
 * generationService.ts
 * 
 * Frontend service layer for AI content generation.
 * Proxies requests to backend API which handles multiple providers:
 * - Image: Gemini, OpenAI, Google Flow, Codex
 * - Video: Seedance, 即梦工作流, Google Flow
 */

export interface GenerateImageParams {
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  imageBase64?: string | string[]; // Supports single image or array of images
  imageModel?: string; // Image model version
  nodeId?: string; // ID of the node initiating generation
}

export interface GenerateVideoParams {
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
  nodeId: string;
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  referenceImages?: string[];
}

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
export const generateImage = async (params: GenerateImageParams): Promise<string> => {
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
    if (!data.resultUrl) {
      throw new Error("No image data returned from server");
    }
    return data.resultUrl;

  } catch (error) {
    console.error("Image Generation Error:", error);
    throw error;
  }
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
