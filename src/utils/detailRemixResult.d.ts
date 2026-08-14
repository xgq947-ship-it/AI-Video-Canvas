import type { NodeData } from '../types';
import type { DetailRemixJob } from '../services/detailRemixService';

export function getDetailRemixResultRowStep(job: DetailRemixJob): number;
export function upsertDetailRemixResultNodes(
  nodes: NodeData[],
  sourceNode: NodeData,
  job: DetailRemixJob,
  now?: number,
): NodeData[];
export const upsertDetailRemixResultNode: typeof upsertDetailRemixResultNodes;
