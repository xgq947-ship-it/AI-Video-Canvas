export type DetailStitchCutSource = 'auto' | 'manual';

export interface DetailStitchCut {
  y: number;
  source: DetailStitchCutSource;
}

export interface DetailStitchTargetHeight {
  aspectRatio: string;
  ratio: number;
  height: number;
}

export interface DetailStitchSource {
  nodeId: string;
  url: string;
  originalWidth: number;
  originalHeight: number;
  scaledHeight: number;
  offsetY: number;
  dedupTrimmedTop: number;
  widthAdjusted: boolean;
}

export interface DetailStitchCandidate {
  y: number;
  score: number;
}

export interface DetailStitchSlice {
  index: number;
  id: string;
  startY: number;
  endY: number;
  width: number;
  height: number;
  targetAspectRatio: string;
  expectedCropLoss: number;
  source: DetailStitchCutSource;
  url?: string;
  nodeId?: string;
}

export interface DetailStitchRecord {
  schemaVersion: 1;
  stitchId: string;
  workflowId: string;
  controllerNodeId: string;
  imageModel: string;
  createdAt: string;
  updatedAt: string;
  widthPolicy: 'scale-to-mode';
  canvasWidth: number;
  canvasHeight: number;
  fullImageUrl: string;
  widthAdjustedCount: number;
  sources: DetailStitchSource[];
  candidates: DetailStitchCandidate[];
  cuts: DetailStitchCut[];
  slices: DetailStitchSlice[];
}

export const DETAIL_STITCH_SCHEMA_VERSION: 1;
export const DETAIL_STITCH_MIN_SLICE_HEIGHT: 96;
export const DETAIL_STITCH_MAX_SLICE_HEIGHT: 1500;
export function parseDetailStitchAspectRatio(value: unknown): number | null;
export function detailStitchTargetHeights(width: number, ratios?: string[]): DetailStitchTargetHeight[];
export function closestDetailStitchAspectRatio(width: number, height: number, ratios?: string[]): DetailStitchTargetHeight | null;
export function expectedDetailStitchCropLoss(width: number, height: number, ratio: string): number;
export function normalizeDetailStitchCuts(
  cuts: Array<number | Partial<DetailStitchCut>>,
  height: number,
  minHeight?: number,
  maxHeight?: number,
): DetailStitchCut[];
export function buildDetailStitchSlices(options?: {
  cuts?: Array<number | Partial<DetailStitchCut>>;
  canvasWidth?: number;
  canvasHeight?: number;
  supportedAspectRatios?: string[];
  minSliceHeight?: number;
  maxSliceHeight?: number;
  nodeIds?: string[];
  urls?: string[];
}): DetailStitchSlice[];
