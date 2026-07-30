import type {
  ReferenceVideo,
  ShotAnalysis,
} from '../../../shared/videoRemix.js';

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
