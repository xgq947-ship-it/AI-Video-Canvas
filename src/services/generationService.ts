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

export interface GenerationRequestError extends Error {
  code?: string;
  submitted?: boolean;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

const readGenerationError = async (response: Response): Promise<GenerationRequestError> => {
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  const error = new Error(String(data.error || response.statusText)) as GenerationRequestError;
  if (typeof data.code === 'string') error.code = data.code;
  if (typeof data.submitted === 'boolean') error.submitted = data.submitted;
  if (typeof data.retryable === 'boolean') error.retryable = data.retryable;
  if (data.details && typeof data.details === 'object') {
    error.details = data.details as Record<string, unknown>;
  }
  return error;
};

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
  imageResolution?: string;
  aspectRatio: string;
  prompt?: string;
  sceneAnalysis?: string;
  personaAnalysis?: string;
  compositionAnalysis?: string;
  productAnalysis?: string;
  resultUrl?: string;
  resultNodeIds?: string[];
  resultUrls?: string[];
  imageResults?: Array<{
    index: number;
    nodeId: string;
    resultUrl: string;
    requestedResolution?: string;
    actualWidth?: number;
    actualHeight?: number;
  }>;
  imageCount?: number;
  version?: number;
  autoGenerateVideo?: boolean;
  videoPrompt?: string;
  videoPromptSourceId?: string;
  videoModel?: string;
  videoAspectRatio?: string;
  videoDuration?: number;
  currentVideoIndex?: number;
  videoTasks?: Array<{ index: number; imageNodeId: string; videoNodeId: string; status: 'waiting' | 'running' | 'success' | 'failed' | 'cancelled'; resultUrl?: string; error?: string; errorCode?: string; retryBlocked?: boolean }>;
  error?: string;
  /** 用户已删除的结果节点 id：恢复逻辑不再把它们补回画布。 */
  dismissedResultNodeIds?: string[];
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

/** 告诉后端这些结果节点是用户删掉的，别再恢复回画布。失败只记日志：删除本身已经成功。 */
export const dismissProductSceneResultNodes = async (nodeIds: string[], workflowId: string): Promise<void> => {
  if (!nodeIds.length || !workflowId) return;
  try {
    await fetch('/api/product-scene-jobs/dismiss-results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflowId, nodeIds })
    });
  } catch (error) {
    console.error('Failed to dismiss product scene result nodes:', error);
  }
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

const waitForCodexImageResult = async (
  initialJob: CodexImageJob,
  timeoutMs = 60 * 60 * 1000
): Promise<string> => {
  const startedAt = Date.now();
  let job = initialJob;
  while (Date.now() - startedAt < timeoutMs) {
    if (job.status === 'completed' && job.resultUrl) return job.resultUrl;
    if (job.status === 'failed') {
      throw new Error(job.error || 'Codex CLI 生图任务失败');
    }
    await new Promise(resolve => globalThis.setTimeout(resolve, 1_500));
    job = await getCodexImageJob(job.id);
  }
  throw new Error('Codex CLI 生图等待超时，任务可能仍在后台；请先到“设置 → Codex 服务”检查状态，不要重复提交');
};

/**
 * Generates an image by calling the backend API
 */
export const generateImageBatch = async (params: GenerateImageParams): Promise<string[]> => {
  try {
    if (params.imageModel === 'codex-imagegen') {
      const requestedCount = Math.max(1, Number(params.count) || 1);
      if (requestedCount !== 1) {
        throw new Error('Codex CLI 生图当前每次生成 1 张图片');
      }
      if (!params.nodeId) throw new Error('Codex CLI 生图缺少节点 ID');
      const referenceImages = params.imageBase64
        ? (Array.isArray(params.imageBase64) ? params.imageBase64 : [params.imageBase64])
            .filter(Boolean)
        : undefined;
      const job = await queueCodexImage({
        workflowId: params.workflowId,
        nodeId: params.nodeId,
        prompt: params.prompt,
        aspectRatio: params.aspectRatio || 'Auto',
        resolution: params.resolution || 'Auto',
        referenceImages,
      });
      return [await waitForCodexImageResult(job)];
    }

    const response = await fetch('/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      throw await readGenerationError(response);
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
      throw await readGenerationError(response);
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
