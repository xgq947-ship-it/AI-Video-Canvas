import { generateImage, generateVideo } from '../../services/generationService';
import { getImageGenerationProvider, getVideoGenerationProvider } from '../../../shared/generationProviders.js';
import {
  buildCinematicMergeManifest,
  buildCinematicVideoRequest,
  compileCinematicPrompt,
  normalizeCinematicSettings,
} from '../../../shared/cinematicDirector.js';
import type {
  CinematicCastMember,
  CinematicDirectorOutput,
  CinematicDirectorSettings,
  CinematicShot,
} from '../../../shared/cinematicDirector.js';

export interface RunCinematicDirectorRequest {
  input: { title?: string; content: string; notes?: string };
  cast: CinematicCastMember[];
  settings: CinematicDirectorSettings;
  provider: 'auto' | 'gemini' | 'codex' | 'deepseek' | string;
  allowFallback?: boolean;
}

export interface RunCinematicDirectorResponse {
  output: CinematicDirectorOutput;
  providerId: string;
  repaired?: boolean;
  model?: { provider: string; modelId: string };
}

export interface CinematicMergeJob {
  jobId: string;
  status: string;
  stage?: string;
  progress?: number;
  output?: string | null;
  error?: string | null;
}

export const runCinematicDirector = async (request: RunCinematicDirectorRequest): Promise<RunCinematicDirectorResponse> => {
  const response = await fetch('/api/skills/cinematic-director/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: request.input,
      cast: request.cast,
      settings: request.settings,
      model: { provider: request.provider, modelId: request.settings.modelId },
      allowFallback: request.allowFallback !== false,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '电影导演执行失败');
  return data as RunCinematicDirectorResponse;
};

const identityPrompt = (character: CinematicCastMember, kind: 'front' | 'board' | 'angles') => {
  const description = character.description || '根据角色名称建立清晰、稳定、可复用的角色身份';
  const task = kind === 'front'
    ? '正面身份照，脸部清晰，肩部以上，均匀光线，纯净背景'
    : kind === 'board'
      ? '全身综合设定板，正面站立，同时展示脸部、发型、体型、服装和固定配件'
      : '身份多角度设定图，正面、四分之三侧面和侧面，保持同一人物身份与服装';
  return `角色名：${character.name}\n角色描述：${description}\n本图任务：${task}\n写实电影角色设定图，禁止改变年龄、脸型、发型、服装主色和固定配件。`;
};

export const generateCinematicIdentityImages = async ({
  workflowId,
  nodeId,
  character,
  imageModel = 'google-flow-nano-banana-pro',
  includeAngles = false,
}: {
  workflowId: string;
  nodeId: string;
  character: CinematicCastMember;
  imageModel?: string;
  includeAngles?: boolean;
}) => {
  const provider = getImageGenerationProvider(imageModel);
  const resolution = provider?.defaultResolution || provider?.resolutions?.[0] || '2K';
  const front = await generateImage({
    workflowId,
    nodeId: `${nodeId}-${character.id}-front`,
    prompt: identityPrompt(character, 'front'),
    imageModel,
    aspectRatio: '1:1',
    resolution,
  });
  const board = await generateImage({
    workflowId,
    nodeId: `${nodeId}-${character.id}-board`,
    prompt: identityPrompt(character, 'board'),
    imageModel,
    aspectRatio: '3:4',
    resolution,
    imageBase64: front,
  });
  const references = [
    { id: `${character.id}-front`, url: front, source: 'ai' as const, label: 'AI 正面身份照', usage: 'identity-front' },
    { id: `${character.id}-board`, url: board, source: 'ai' as const, label: 'AI 全身综合设定板', usage: 'identity-board' },
  ];
  if (includeAngles) {
    const angles = await generateImage({
      workflowId,
      nodeId: `${nodeId}-${character.id}-angles`,
      prompt: identityPrompt(character, 'angles'),
      imageModel,
      aspectRatio: '3:4',
      resolution,
      imageBase64: [front, board],
    });
    references.push({ id: `${character.id}-angles`, url: angles, source: 'ai' as const, label: 'AI 多角度身份图', usage: 'identity-angles' });
  }
  return references;
};

export const generateCinematicShotVideo = async ({
  workflowId,
  shot,
  cast,
  settings,
  nodeId,
  signal,
}: {
  workflowId: string;
  shot: CinematicShot;
  cast: CinematicCastMember[];
  settings: CinematicDirectorSettings;
  nodeId: string;
  signal?: AbortSignal;
}) => {
  const request = buildCinematicVideoRequest({ workflowId, nodeId, shot, cast, settings });
  return generateVideo({ ...request, signal } as unknown as Parameters<typeof generateVideo>[0]);
};

export const optimizeCinematicPrompt = async ({
  prompt,
  videoModel,
  aspectRatio,
  duration,
}: {
  prompt: string;
  videoModel?: string;
  aspectRatio?: string;
  duration?: number;
}) => {
  const profileId = String(videoModel || '').startsWith('jimeng-') ? 'video' : 'video-flow';
  const response = await fetch('/api/prompt/optimize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, profileId, context: { targetModel: videoModel, aspectRatio, duration } }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.optimizedPrompt) throw new Error(data.error || '提示词优化失败');
  return String(data.optimizedPrompt);
};

export const submitCinematicMerge = async ({
  workflowId,
  title,
  shots,
  settings,
  fps = 30,
  skipFailed = true,
}: {
  workflowId: string;
  title: string;
  shots: Array<{ id: string; order: number; title?: string; duration?: number; videoUrl?: string; status?: string; volume?: number; transition?: string }>;
  settings: CinematicDirectorSettings;
  fps?: number;
  skipFailed?: boolean;
}): Promise<CinematicMergeJob> => {
  const normalized = normalizeCinematicSettings(settings);
  const manifest = buildCinematicMergeManifest({
    workflowId,
    title,
    shots,
    width: normalized.width,
    height: normalized.height,
    fps,
    skipFailed,
  }) as { shots?: Array<{ id: string; order: number; name?: string; file: string; end?: number; volume?: number; transition?: string }>; composition?: { width: number; height: number; fps: number } };
  const selectedShots = Array.isArray(manifest.shots) ? manifest.shots : [];
  const response = await fetch('/api/videos/merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflowId,
      title,
      shots: selectedShots.map(shot => ({
        id: shot.id,
        order: shot.order,
        title: shot.name,
        duration: Math.max(0.1, Number(shot.end) || 5),
        videoUrl: shot.file,
        status: 'completed',
        volume: shot.volume,
        transition: shot.transition,
      })),
      width: manifest.composition?.width,
      height: manifest.composition?.height,
      fps: manifest.composition?.fps,
      skipFailed,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '视频拼接任务提交失败');
  return data.job as CinematicMergeJob;
};

export const getCinematicMergeJob = async (jobId: string): Promise<CinematicMergeJob> => {
  const response = await fetch(`/api/videos/merge/${encodeURIComponent(jobId)}`, { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '读取视频拼接任务失败');
  return data as CinematicMergeJob;
};

export const recompileCinematicShotPrompt = (shot: CinematicShot, settings: CinematicDirectorSettings, cast: CinematicCastMember[]) =>
  compileCinematicPrompt(shot, settings, cast);

// Keep the capability lookup in this module so UI callers do not invent a
// resolution/model combination that the server registry will reject.
export const cinematicVideoModelInfo = (modelId?: string) => getVideoGenerationProvider(modelId || normalizeCinematicSettings({}).videoModel);
