import type { VideoAnalysisResult } from '../../../shared/videoAnalysis.js';

export class VideoAnalysisRequestError extends Error {
  code?: string;
  retryable: boolean;
  authRequired: boolean;

  constructor(message: string, payload: any = {}) {
    super(message);
    this.name = 'VideoAnalysisRequestError';
    this.code = payload.code;
    this.retryable = payload.retryable !== false;
    this.authRequired = payload.authRequired === true;
  }
}

export async function analyzeVideoAnalysisNode({
  workflowId,
  nodeId,
  sourceUrl,
  title,
  referenceImages,
}: {
  workflowId: string;
  nodeId: string;
  sourceUrl: string;
  title?: string;
  referenceImages: Array<{ url: string; label: string }>;
}): Promise<{ result: VideoAnalysisResult; source: Record<string, any> }> {
  const response = await fetch('/api/video-analysis/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflowId,
      nodeId,
      sourceUrl,
      title,
      referenceImages,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new VideoAnalysisRequestError(
      payload.error || `视频分析失败（HTTP ${response.status}）`,
      payload
    );
  }
  if (!payload.result || !Array.isArray(payload.result.shots)) {
    throw new VideoAnalysisRequestError('视频分析没有返回可用镜头结果', {
      code: 'VIDEO_ANALYSIS_EMPTY',
      retryable: true,
    });
  }
  return payload as { result: VideoAnalysisResult; source: Record<string, any> };
}
