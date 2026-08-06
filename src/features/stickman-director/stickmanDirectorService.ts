import { generateVideo } from '../../services/generationService';
import { getVideoGenerationProvider } from '../../../shared/generationProviders.js';
import type { StickmanDirectorOutput, StickmanDirectorSettings, StickmanShot } from '../../../shared/stickmanDirector.js';

export interface RunStickmanDirectorRequest {
  sourceType: 'script' | 'reference_video';
  input: Record<string, unknown>;
  settings: StickmanDirectorSettings & { modelId?: string };
  provider: 'auto' | 'gemini' | 'codex' | 'deepseek';
  allowFallback?: boolean;
}

export interface RunStickmanDirectorResponse {
  output: StickmanDirectorOutput;
  providerId: string;
  repaired?: boolean;
  fallback?: boolean;
}

export interface StickmanMergeJob {
  jobId: string;
  status: string;
  stage?: string;
  progress?: number;
  output?: string | null;
  error?: string | null;
}

export const runStickmanDirector = async (request: RunStickmanDirectorRequest): Promise<RunStickmanDirectorResponse> => {
  const response = await fetch('/api/skills/stickman-video-director/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceType: request.sourceType,
      input: request.input,
      settings: request.settings,
      model: { provider: request.provider, modelId: request.settings.modelId },
      allowFallback: request.allowFallback !== false,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '火柴人导演执行失败');
  return data as RunStickmanDirectorResponse;
};

export const generateStickmanShotVideo = async ({
  workflowId,
  shot,
  modelId,
  nodeId,
  nativeAudio = true,
  resolution,
  signal,
}: {
  workflowId: string;
  shot: StickmanShot;
  modelId: string;
  nodeId: string;
  nativeAudio?: boolean;
  resolution?: string;
  signal?: AbortSignal;
}) => generateVideo({
  workflowId,
  prompt: shot.prompt,
  aspectRatio: shot.aspectRatio,
  resolution: resolution || getVideoGenerationProvider(modelId)?.resolutions?.[0] || 'Auto',
  duration: shot.duration,
  videoModel: modelId,
  generateAudio: nativeAudio,
  nodeId,
  signal,
});

export const submitStickmanMerge = async ({
  workflowId,
  title,
  shots,
  width,
  height,
  fps = 30,
  skipFailed = true,
}: {
  workflowId: string;
  title: string;
  shots: Array<{ id: string; order: number; title?: string; duration?: number; videoUrl?: string; status?: string; transition?: string }>;
  width: number;
  height: number;
  fps?: number;
  skipFailed?: boolean;
}): Promise<StickmanMergeJob> => {
  const response = await fetch('/api/videos/merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflowId, title, shots, width, height, fps, skipFailed }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '视频拼接任务提交失败');
  return data.job as StickmanMergeJob;
};

export const getStickmanMergeJob = async (jobId: string): Promise<StickmanMergeJob> => {
  const response = await fetch(`/api/videos/merge/${encodeURIComponent(jobId)}`, { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '读取视频拼接任务失败');
  return data as StickmanMergeJob;
};
