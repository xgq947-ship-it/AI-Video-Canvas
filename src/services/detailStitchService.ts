import type {
  DetailStitchCut,
  DetailStitchRecord,
} from '../../shared/detailStitch';

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data?.error || fallback);
  return data;
}
export interface DetailStitchSourceInput {
  nodeId: string;
  url: string;
}

export async function stitchCompetitorDetails(params: {
  workflowId: string;
  controllerNodeId: string;
  imageModel: string;
  sources: DetailStitchSourceInput[];
}): Promise<DetailStitchRecord> {
  const response = await fetch('/api/detail-stitch/stitch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return readJson(response, '拼接竞品详情图失败');
}

export async function planCompetitorDetailSlices(params: {
  workflowId: string;
  stitchId: string;
  imageModel: string;
}): Promise<DetailStitchRecord> {
  const response = await fetch('/api/detail-stitch/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return readJson(response, '智能识别切割点失败');
}

export async function exportCompetitorDetailSlices(params: {
  workflowId: string;
  stitchId: string;
  imageModel: string;
  cuts: DetailStitchCut[];
  nodeIds: string[];
}): Promise<DetailStitchRecord> {
  const response = await fetch('/api/detail-stitch/slice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return readJson(response, '导出新竞品切片失败');
}
