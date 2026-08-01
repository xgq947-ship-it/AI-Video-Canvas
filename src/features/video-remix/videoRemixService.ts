import type {
  ReferenceVideo,
  ShotAnalysis,
  VideoRemixGlobalAnalysis,
} from '../../../shared/videoRemix.js';
import type { ProjectManifest } from '../../../shared/manifest.js';
import { generateImage, generateVideo } from '../../services/generationService';

interface ReferenceResponse {
  success: boolean;
  source: ReferenceVideo;
  error?: string;
  code?: string;
}

interface ShotPreprocessingResponse {
  success: boolean;
  source: ReferenceVideo;
  proxyUrl: string;
  shots: ShotAnalysis[];
  error?: string;
  code?: string;
}

interface AnalysisErrorPayload {
  error?: string;
  code?: string;
  retryable?: boolean;
  authRequired?: boolean;
}

export interface VideoRemixLibraryAsset {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  url: string;
  type: 'image' | 'video';
  description?: string;
  characterId?: string;
  characterName?: string;
  characterAssetRole?:
    | 'identity-face'
    | 'identity-angles'
    | 'identity-board'
    | 'identity-fullbody'
    | 'identity-expression'
    | 'look-fullbody'
    | 'look-board';
  lookId?: string;
  lookName?: string;
}

export class VideoRemixRequestError extends Error {
  code: string;
  retryable: boolean;
  authRequired: boolean;

  constructor(message: string, {
    code = 'VIDEO_REMIX_REQUEST_FAILED',
    retryable = true,
    authRequired = false,
  }: AnalysisErrorPayload = {}) {
    super(message);
    this.name = 'VideoRemixRequestError';
    this.code = code;
    this.retryable = retryable;
    this.authRequired = authRequired;
  }
}

const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

function mimeTypeForFile(file: File) {
  if (file.type) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  return MIME_BY_EXTENSION[extension] || 'application/octet-stream';
}

async function readReferenceResponse(response: Response): Promise<ReferenceVideo> {
  const payload = await response.json().catch(() => ({})) as Partial<ReferenceResponse>;
  if (!response.ok || !payload.source) {
    throw new Error(payload.error || `参考视频处理失败（HTTP ${response.status}）`);
  }
  return payload.source;
}

async function readShotPreprocessingResponse(response: Response) {
  const payload = await response.json().catch(() => ({})) as Partial<ShotPreprocessingResponse>;
  if (
    !response.ok
    || !payload.source
    || !payload.proxyUrl
    || !Array.isArray(payload.shots)
  ) {
    throw new Error(payload.error || `镜头预处理失败（HTTP ${response.status}）`);
  }
  return {
    source: payload.source,
    proxyUrl: payload.proxyUrl,
    shots: payload.shots,
  };
}

async function readAnalysisPayload<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as AnalysisErrorPayload & T;
  if (!response.ok) {
    throw new VideoRemixRequestError(
      payload.error || `视频分析失败（HTTP ${response.status}）`,
      payload
    );
  }
  return payload;
}

export async function importLocalReferenceVideo({
  workflowId,
  remixId,
  file,
}: {
  workflowId: string;
  remixId: string;
  file: File;
}) {
  const response = await fetch('/api/video-remix/reference/import', {
    method: 'POST',
    headers: {
      'Content-Type': mimeTypeForFile(file),
      'x-evan-workflow-id': encodeURIComponent(workflowId),
      'x-evan-remix-id': encodeURIComponent(remixId),
      'x-evan-filename': encodeURIComponent(file.name),
    },
    body: file,
  });
  return readReferenceResponse(response);
}

export async function resolveUrlReferenceVideo({
  workflowId,
  remixId,
  input,
}: {
  workflowId: string;
  remixId: string;
  input: string;
}) {
  const response = await fetch('/api/video-remix/reference/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflowId, remixId, input }),
  });
  return readReferenceResponse(response);
}

export async function useCanvasVideoAsReference({
  workflowId,
  remixId,
  sourceUrl,
  title,
}: {
  workflowId: string;
  remixId: string;
  sourceUrl: string;
  title?: string;
}) {
  const response = await fetch('/api/video-remix/reference/canvas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflowId, remixId, sourceUrl, title }),
  });
  return readReferenceResponse(response);
}

export async function preprocessReferenceVideo({
  workflowId,
  remixId,
  source,
  threshold = 0.3,
}: {
  workflowId: string;
  remixId: string;
  source: ReferenceVideo;
  threshold?: number;
}) {
  const response = await fetch('/api/video-remix/preprocess', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflowId, remixId, source, threshold }),
  });
  return readShotPreprocessingResponse(response);
}

export async function updateVideoRemixShotTimeline({
  workflowId,
  remixId,
  source,
  cutPoints,
  previousShots,
}: {
  workflowId: string;
  remixId: string;
  source: ReferenceVideo;
  cutPoints: number[];
  previousShots: ShotAnalysis[];
}) {
  const response = await fetch('/api/video-remix/shots', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflowId,
      remixId,
      source,
      cutPoints,
      previousShots,
    }),
  });
  return readShotPreprocessingResponse(response);
}

export async function analyzeVideoRemixGlobal({
  workflowId,
  remixId,
  source,
  shots,
  mode,
}: {
  workflowId: string;
  remixId: string;
  source: ReferenceVideo;
  shots: ShotAnalysis[];
  mode: 'fast' | 'deep';
}) {
  const response = await fetch('/api/video-remix/analysis/global', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflowId, remixId, source, shots, mode }),
  });
  const payload = await readAnalysisPayload<{
    success: boolean;
    global: VideoRemixGlobalAnalysis;
  }>(response);
  if (!payload.global) throw new Error('全片分析没有返回结构化结果');
  return payload.global;
}

export async function analyzeVideoRemixShot({
  workflowId,
  remixId,
  source,
  shots,
  shotId,
  mode,
  analysisKey,
}: {
  workflowId: string;
  remixId: string;
  source: ReferenceVideo;
  shots: ShotAnalysis[];
  shotId: string;
  mode: 'fast' | 'deep';
  analysisKey: string;
}) {
  const response = await fetch('/api/video-remix/analysis/shot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflowId,
      remixId,
      source,
      shots,
      shotId,
      mode,
      analysisKey,
    }),
  });
  const payload = await readAnalysisPayload<{
    success: boolean;
    shot: ShotAnalysis;
    inputKind: 'three_frames' | 'five_frames' | 'video';
  }>(response);
  if (!payload.shot) throw new Error(`${shotId} 没有返回结构化结果`);
  return payload;
}

export async function restoreVideoRemixAnalysis({
  workflowId,
  remixId,
  source,
  shots,
  mode,
  analysisKey,
}: {
  workflowId: string;
  remixId: string;
  source: ReferenceVideo;
  shots: ShotAnalysis[];
  mode: 'fast' | 'deep';
  analysisKey?: string;
}) {
  const response = await fetch('/api/video-remix/analysis/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflowId,
      remixId,
      source,
      shots,
      mode,
      analysisKey,
    }),
  });
  const payload = await readAnalysisPayload<{
    success: boolean;
    snapshot: {
      analysisKey: string;
      mode: 'fast' | 'deep';
      global: VideoRemixGlobalAnalysis;
      shots: ShotAnalysis[];
    };
  }>(response);
  return payload.snapshot;
}

export async function openGeminiLogin() {
  const response = await fetch('/api/browser-sessions/gemini-web/reauthenticate', {
    method: 'POST',
  });
  return readAnalysisPayload<{ success: boolean }>(response);
}

export async function listVideoRemixLibraryAssets(): Promise<VideoRemixLibraryAsset[]> {
  const response = await fetch('/api/library', { cache: 'no-store' });
  const payload = await response.json().catch(() => []);
  if (!response.ok) {
    throw new VideoRemixRequestError(
      (payload as AnalysisErrorPayload)?.error || '素材库读取失败'
    );
  }
  return Array.isArray(payload) ? payload : [];
}

export async function importVideoRemixLibraryAsset({
  workflowId,
  sourceUrl,
}: {
  workflowId: string;
  sourceUrl: string;
}): Promise<string> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(workflowId)}/assets/import`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceUrl }),
    }
  );
  const payload = await readAnalysisPayload<{ success: boolean; url?: string }>(response);
  if (!payload.url) throw new Error('素材没有返回项目内地址');
  return payload.url;
}

export async function uploadVideoRemixAssetImage({
  workflowId,
  file,
  prompt,
}: {
  workflowId: string;
  file: File;
  prompt: string;
}): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new VideoRemixRequestError('请选择图片文件', {
      code: 'UNSUPPORTED_IMAGE',
      retryable: false,
    });
  }
  if (file.size > 100 * 1024 * 1024) {
    throw new VideoRemixRequestError('图片不能超过 100MB', {
      code: 'IMAGE_TOO_LARGE',
      retryable: false,
    });
  }
  const response = await fetch(
    `/api/projects/${encodeURIComponent(workflowId)}/assets/upload-image-binary`,
    {
      method: 'POST',
      headers: {
        'Content-Type': file.type,
        'X-Evan-Mime': file.type,
        'X-Evan-Filename': encodeURIComponent(file.name),
        'X-Evan-Prompt': encodeURIComponent(prompt),
      },
      body: file,
    }
  );
  const payload = await readAnalysisPayload<{ success: boolean; url?: string }>(response);
  if (!payload.url) throw new Error('上传没有返回项目内地址');
  return payload.url;
}

export async function optimizeVideoRemixPrompt({
  prompt,
  profileId,
  targetModel,
  aspectRatio,
  duration,
}: {
  prompt: string;
  profileId: string;
  targetModel: string;
  aspectRatio: string;
  duration: number;
}): Promise<string> {
  const response = await fetch('/api/prompt/optimize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      profileId,
      context: {
        task: profileId === 'image-remix-keyframe'
          ? 'optimize_video_remix_keyframe_prompt'
          : 'optimize_video_remix_video_prompt',
        targetModel,
        aspectRatio,
        duration,
        preservePlaceholders: true,
      },
    }),
  });
  const payload = await response.json().catch(() => ({})) as {
    optimizedPrompt?: string;
    error?: string;
    code?: string;
    retryable?: boolean;
  };
  if (!response.ok || !payload.optimizedPrompt) {
    throw new VideoRemixRequestError(
      payload.error || `Prompt 优化失败（HTTP ${response.status}）`,
      {
        code: payload.code || 'PROMPT_OPTIMIZATION_FAILED',
        retryable: payload.retryable ?? response.status >= 500,
      }
    );
  }
  return payload.optimizedPrompt;
}

export async function generateVideoRemixKeyframe({
  workflowId,
  nodeId,
  prompt,
  referenceImages,
  imageModel,
  aspectRatio,
  resolution,
}: {
  workflowId: string;
  nodeId: string;
  prompt: string;
  referenceImages: string[];
  imageModel: string;
  aspectRatio: string;
  resolution: string;
}): Promise<string> {
  return generateImage({
    workflowId,
    nodeId,
    prompt,
    imageBase64: referenceImages.length > 0 ? referenceImages : undefined,
    imageModel,
    aspectRatio,
    resolution,
  });
}

export async function generateVideoRemixShot({
  workflowId,
  nodeId,
  prompt,
  imageBase64,
  lastFrameBase64,
  referenceImages,
  referenceImageLabels,
  videoModel,
  aspectRatio,
  resolution,
  duration,
  generateAudio,
}: {
  workflowId: string;
  nodeId: string;
  prompt: string;
  imageBase64?: string;
  lastFrameBase64?: string;
  referenceImages: string[];
  referenceImageLabels: string[];
  videoModel: string;
  aspectRatio: string;
  resolution: string;
  duration: number;
  generateAudio: boolean;
}): Promise<string> {
  return generateVideo({
    workflowId,
    nodeId,
    prompt,
    imageBase64,
    lastFrameBase64,
    referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
    referenceImageLabels: referenceImageLabels.length > 0
      ? referenceImageLabels
      : undefined,
    videoModel,
    aspectRatio,
    resolution,
    duration,
    generateAudio,
  });
}

export interface VideoRemixCalibrationResult {
  url: string;
  sourceDuration: number;
  targetDuration: number;
  trimStart: number;
  trimEnd: number;
  speed: number;
  calibration: 'none' | 'trim' | 'speed';
  cached: boolean;
}

export async function calibrateVideoRemixGeneratedShot({
  workflowId,
  remixId,
  shotId,
  sourceUrl,
  targetDuration,
  trimStart,
}: {
  workflowId: string;
  remixId: string;
  shotId: string;
  sourceUrl: string;
  targetDuration: number;
  trimStart?: number;
}): Promise<VideoRemixCalibrationResult> {
  const response = await fetch('/api/video-remix/videos/calibrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflowId,
      remixId,
      shotId,
      sourceUrl,
      targetDuration,
      trimStart,
    }),
  });
  const payload = await response.json().catch(() => ({})) as (
    AnalysisErrorPayload & Partial<VideoRemixCalibrationResult>
  );
  if (!response.ok || !payload.url) {
    throw new VideoRemixRequestError(
      payload.error || `镜头视频校准失败（HTTP ${response.status}）`,
      payload
    );
  }
  return payload as VideoRemixCalibrationResult;
}

export async function findVideoRemixGeneratedVideo(
  workflowId: string,
  generationNodeId: string
): Promise<string | null> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(workflowId)}/assets`,
    { cache: 'no-store' }
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as AnalysisErrorPayload;
    throw new VideoRemixRequestError(
      payload.error || '无法检查项目视频素材',
      payload
    );
  }
  const assets = await response.json() as Array<{
    id?: string;
    type?: string;
    url?: string;
  }>;
  return assets.find(asset => (
    asset.type === 'video'
    && asset.id === generationNodeId
    && asset.url
  ))?.url || null;
}

export interface VideoRemixProjectAsset {
  id: string;
  type: 'image' | 'video' | 'audio';
  url: string;
  name?: string;
  filename?: string;
  createdAt?: string;
}

export async function listVideoRemixProjectAssets(
  workflowId: string
): Promise<VideoRemixProjectAsset[]> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(workflowId)}/assets`,
    { cache: 'no-store' }
  );
  const payload = await response.json().catch(() => []) as (
    AnalysisErrorPayload | VideoRemixProjectAsset[]
  );
  if (!response.ok) {
    throw new VideoRemixRequestError(
      !Array.isArray(payload) && payload.error
        ? payload.error
        : '无法读取当前项目素材'
    );
  }
  return Array.isArray(payload) ? payload : [];
}

const readFileAsDataUrl = (file: File): Promise<string> => new Promise(
  (resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('无法读取音频文件'));
    reader.readAsDataURL(file);
  }
);

export async function uploadVideoRemixBgm({
  workflowId,
  file,
}: {
  workflowId: string;
  file: File;
}): Promise<{ url: string; filename: string }> {
  const supported = (
    file.type.startsWith('audio/')
    || /\.(mp3|wav|aac|ogg|m4a)$/i.test(file.name)
  );
  if (!supported) {
    throw new VideoRemixRequestError('请选择 MP3、WAV、AAC、OGG 或 M4A 音频', {
      code: 'UNSUPPORTED_AUDIO',
      retryable: false,
    });
  }
  if (file.size > 100 * 1024 * 1024) {
    throw new VideoRemixRequestError('BGM 文件不能超过 100MB', {
      code: 'AUDIO_TOO_LARGE',
      retryable: false,
    });
  }
  const dataUrl = await readFileAsDataUrl(file);
  const response = await fetch('/api/audio/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dataUrl,
      filename: file.name,
      subtype: 'bgm',
      provider: 'import',
      workflowId,
    }),
  });
  const payload = await response.json().catch(() => ({})) as (
    AnalysisErrorPayload & { url?: string; filename?: string }
  );
  if (!response.ok || !payload.url) {
    throw new VideoRemixRequestError(
      payload.error || `BGM 上传失败（HTTP ${response.status}）`,
      payload
    );
  }
  return {
    url: payload.url,
    filename: payload.filename || file.name,
  };
}

export interface VideoRemixRenderJobResponse {
  jobId: string;
  projectId?: string;
  inputHash?: string;
  status: 'queued' | 'rendering' | 'success' | 'failed' | 'cancelled';
  stage: string;
  progress: number;
  output?: string;
  error?: string;
  missing?: Array<{ kind: string; raw: string; reason: string }>;
  createdAt?: string;
  updatedAt?: string;
}

async function readRenderResponse(
  response: Response,
  fallback: string
): Promise<VideoRemixRenderJobResponse> {
  const payload = await response.json().catch(() => ({})) as (
    AnalysisErrorPayload
    & Partial<VideoRemixRenderJobResponse>
    & { existing?: VideoRemixRenderJobResponse }
  );
  if (!response.ok) {
    if (response.status === 409 && payload.existing?.jobId) {
      return payload.existing;
    }
    const error = new VideoRemixRequestError(
      payload.error || `${fallback}（HTTP ${response.status}）`,
      {
        ...payload,
        retryable: response.status >= 500,
      }
    );
    Object.assign(error, { missing: payload.missing });
    throw error;
  }
  if (!payload.jobId) {
    throw new VideoRemixRequestError(`${fallback}：响应缺少 jobId`);
  }
  return payload as VideoRemixRenderJobResponse;
}

export async function validateVideoRemixManifest(
  manifest: ProjectManifest
): Promise<{
  valid: boolean;
  errors: string[];
  missing: Array<{ kind: string; raw: string; reason: string }>;
}> {
  const response = await fetch('/api/render/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ manifest }),
  });
  const payload = await response.json().catch(() => ({})) as {
    valid?: boolean;
    errors?: string[];
    missing?: Array<{ kind: string; raw: string; reason: string }>;
    error?: string;
  };
  if (!response.ok) {
    throw new VideoRemixRequestError(
      payload.error || `成片清单校验失败（HTTP ${response.status}）`
    );
  }
  return {
    valid: Boolean(payload.valid),
    errors: payload.errors || [],
    missing: payload.missing || [],
  };
}

export async function startVideoRemixRender({
  workflowId,
  manifest,
}: {
  workflowId: string;
  manifest: ProjectManifest;
}): Promise<VideoRemixRenderJobResponse> {
  const response = await fetch('/api/render/remotion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflowId, manifest }),
  });
  return readRenderResponse(response, '无法提交成片渲染');
}

export async function getVideoRemixRenderJob(
  jobId: string
): Promise<VideoRemixRenderJobResponse | null> {
  const response = await fetch(
    `/api/render/remotion/${encodeURIComponent(jobId)}`,
    { cache: 'no-store' }
  );
  if (response.status === 404) return null;
  return readRenderResponse(response, '无法读取渲染任务');
}

export async function cancelVideoRemixRender(
  jobId: string
): Promise<VideoRemixRenderJobResponse> {
  const response = await fetch(
    `/api/render/remotion/${encodeURIComponent(jobId)}/cancel`,
    { method: 'POST' }
  );
  return readRenderResponse(response, '无法取消渲染任务');
}

export async function revealVideoRemixRender(
  jobId: string,
  workflowId?: string
): Promise<void> {
  const response = await fetch(
    `/api/render/remotion/${encodeURIComponent(jobId)}/reveal`,
    { method: 'POST' }
  );
  const payload = await response.json().catch(() => ({})) as AnalysisErrorPayload;
  // Render jobs are intentionally in-memory. After an app restart the output
  // remains in the project, but the old job id can no longer reveal it. Fall
  // back to the existing project-folder action so a recovered result stays
  // discoverable without weakening path validation.
  if (!response.ok && response.status === 404 && workflowId) {
    const fallback = await fetch(
      `/api/workflows/${encodeURIComponent(workflowId)}/reveal-assets`,
      { method: 'POST' }
    );
    if (fallback.ok) return;
    const fallbackPayload = await fallback.json().catch(() => ({})) as AnalysisErrorPayload;
    throw new VideoRemixRequestError(
      fallbackPayload.error || payload.error || '无法打开成片所在项目目录',
      fallbackPayload
    );
  }
  if (!response.ok) {
    throw new VideoRemixRequestError(
      payload.error || '无法在文件管理器中显示成片',
      payload
    );
  }
}
