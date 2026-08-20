import type { DetailStitchRecord } from '../../shared/detailStitch';
import type { NodeData } from '../types';

export interface DetailStitchNodeOptions {
  now?: () => string;
}

export function applyDetailStitchSlices(
  nodes: NodeData[],
  controllerNodeId: string,
  record: DetailStitchRecord,
  options?: DetailStitchNodeOptions,
): NodeData[];

export function canRestoreDetailStitchOriginals(controller?: NodeData): boolean;

export function restoreDetailStitchOriginals(
  nodes: NodeData[],
  controllerNodeId: string,
  options?: DetailStitchNodeOptions,
): NodeData[];
