/**
 * Pure contracts for the competitor-detail stitch + re-slice preprocessor.
 *
 * This module intentionally has no sharp/fs dependency so the planner and the
 * modal use exactly the same aspect-ratio and crop-loss maths.
 */

export const DETAIL_STITCH_SCHEMA_VERSION = 1;
export const DETAIL_STITCH_MIN_SLICE_HEIGHT = 96;
export const DETAIL_STITCH_MAX_SLICE_HEIGHT = 1500;

const text = value => String(value ?? '').trim();

export function parseDetailStitchAspectRatio(value) {
  const parts = text(value).split(/[/:x×]/i).map(Number);
  return parts.length >= 2
    && Number.isFinite(parts[0])
    && Number.isFinite(parts[1])
    && parts[0] > 0
    && parts[1] > 0
    ? parts[0] / parts[1]
    : null;
}
/** Provider-derived target heights. Never hard-code a model's ratio table. */
export function detailStitchTargetHeights(canvasWidth, supportedAspectRatios = []) {
  const width = Math.round(Number(canvasWidth) || 0);
  if (width <= 0) return [];
  const seen = new Set();
  return (Array.isArray(supportedAspectRatios) ? supportedAspectRatios : [])
    .flatMap(value => {
      const label = text(value);
      if (!label || ['auto', '自动'].includes(label.toLowerCase())) return [];
      const ratio = parseDetailStitchAspectRatio(label);
      if (!ratio) return [];
      const key = ratio.toFixed(8);
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        aspectRatio: label,
        ratio,
        height: Math.max(1, Math.round(width / ratio)),
      }];
    });
}

export function closestDetailStitchAspectRatio(
  width,
  height,
  supportedAspectRatios = [],
) {
  const target = Number(width) > 0 && Number(height) > 0
    ? Number(width) / Number(height)
    : null;
  const options = detailStitchTargetHeights(width, supportedAspectRatios);
  if (!target || options.length === 0) return null;
  return options.reduce((best, current) => (
    Math.abs(Math.log(current.ratio / target)) < Math.abs(Math.log(best.ratio / target))
      ? current
      : best
  ));
}

/** Fraction discarded by a cover crop from generated ratio to target box. */
export function expectedDetailStitchCropLoss(width, height, generationAspectRatio) {
  const target = Number(width) > 0 && Number(height) > 0
    ? Number(width) / Number(height)
    : null;
  const generated = parseDetailStitchAspectRatio(generationAspectRatio);
  if (!target || !generated) return 0;
  return 1 - Math.min(target, generated) / Math.max(target, generated);
}

const normalizedCut = cut => ({
  y: Math.round(Number(typeof cut === 'object' && cut !== null ? cut.y : cut) || 0),
  source: typeof cut === 'object' && cut?.source === 'manual' ? 'manual' : 'auto',
});

/**
 * Sort and validate interior cut lines. Invalid/overlapping plans are rejected
 * instead of silently producing zero-height files.
 */
export function normalizeDetailStitchCuts(
  cuts,
  canvasHeight,
  minSliceHeight = DETAIL_STITCH_MIN_SLICE_HEIGHT,
  maxSliceHeight = DETAIL_STITCH_MAX_SLICE_HEIGHT,
) {
  const height = Math.round(Number(canvasHeight) || 0);
  const minimum = Math.max(1, Math.round(Number(minSliceHeight) || 1));
  const maximum = Math.max(minimum, Math.round(Number(maxSliceHeight) || minimum));
  if (height <= 0) throw new Error('拼接长图高度无效');
  const unique = new Map();
  for (const input of Array.isArray(cuts) ? cuts : []) {
    const cut = normalizedCut(input);
    if (cut.y <= 0 || cut.y >= height) continue;
    const previous = unique.get(cut.y);
    unique.set(cut.y, previous?.source === 'manual' ? previous : cut);
  }
  const result = [...unique.values()].sort((left, right) => left.y - right.y);
  const boundaries = [0, ...result.map(cut => cut.y), height];
  for (let index = 1; index < boundaries.length; index += 1) {
    if (boundaries[index] - boundaries[index - 1] < minimum) {
      throw new Error(`切片高度不能小于 ${minimum}px`);
    }
    if (boundaries[index] - boundaries[index - 1] > maximum) {
      throw new Error(`切片高度不能大于 ${maximum}px`);
    }
  }
  return result;
}

/** Build the authoritative ordered slice manifest from interior cut lines. */
export function buildDetailStitchSlices({
  cuts,
  canvasWidth,
  canvasHeight,
  supportedAspectRatios,
  minSliceHeight = DETAIL_STITCH_MIN_SLICE_HEIGHT,
  maxSliceHeight = DETAIL_STITCH_MAX_SLICE_HEIGHT,
  nodeIds = [],
  urls = [],
} = {}) {
  const width = Math.round(Number(canvasWidth) || 0);
  const height = Math.round(Number(canvasHeight) || 0);
  if (width <= 0) throw new Error('拼接长图宽度无效');
  const normalizedCuts = normalizeDetailStitchCuts(
    cuts,
    height,
    minSliceHeight,
    maxSliceHeight,
  );
  const boundaries = [0, ...normalizedCuts.map(cut => cut.y), height];
  return boundaries.slice(0, -1).map((startY, index) => {
    const endY = boundaries[index + 1];
    const sliceHeight = endY - startY;
    const target = closestDetailStitchAspectRatio(width, sliceHeight, supportedAspectRatios);
    const id = `slice_${String(index + 1).padStart(3, '0')}`;
    const boundary = normalizedCuts[index];
    return {
      index,
      id,
      startY,
      endY,
      width,
      height: sliceHeight,
      targetAspectRatio: target?.aspectRatio || `${width}:${sliceHeight}`,
      expectedCropLoss: target
        ? expectedDetailStitchCropLoss(width, sliceHeight, target.aspectRatio)
        : 0,
      source: boundary?.source || 'auto',
      ...(text(urls[index]) ? { url: text(urls[index]) } : {}),
      ...(text(nodeIds[index]) ? { nodeId: text(nodeIds[index]) } : {}),
    };
  });
}
