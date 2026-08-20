import {
  DETAIL_STITCH_MAX_SLICE_HEIGHT,
  DETAIL_STITCH_MIN_SLICE_HEIGHT,
  buildDetailStitchSlices,
  detailStitchTargetHeights,
} from '../../../shared/detailStitch.js';

/** Greedy planner: prefer 3:4-ish provider height, then snap to the safest nearby seam. */
export function planDetailSlices({
  canvasWidth,
  canvasHeight,
  candidates,
  supportedAspectRatios,
  minSliceHeight = DETAIL_STITCH_MIN_SLICE_HEIGHT,
  maxSliceHeight = DETAIL_STITCH_MAX_SLICE_HEIGHT,
} = {}) {
  const width = Math.round(Number(canvasWidth) || 0);
  const height = Math.round(Number(canvasHeight) || 0);
  const targets = detailStitchTargetHeights(width, supportedAspectRatios);
  if (!targets.length) throw new Error('当前图片模型没有可用的宽高比');
  const preferred = targets.reduce((best, current) => (
    Math.abs(Math.log(current.ratio / 0.75)) < Math.abs(Math.log(best.ratio / 0.75))
      ? current
      : best
  ));
  const maximum = Math.max(minSliceHeight, Number(maxSliceHeight) || DETAIL_STITCH_MAX_SLICE_HEIGHT);
  const targetHeight = Math.min(maximum, Math.max(minSliceHeight, preferred.height));
  const orderedCandidates = [...(Array.isArray(candidates) ? candidates : [])]
    .filter(candidate => Number(candidate?.y) > 0 && Number(candidate?.y) < height)
    .sort((left, right) => left.y - right.y);
  const cuts = [];
  let startY = 0;
  while (height - startY > Math.min(maximum, targetHeight * 1.35)) {
    const idealY = startY + targetHeight;
    const lower = startY + Math.max(minSliceHeight, Math.round(targetHeight * 0.65));
    const upper = Math.min(
      height - minSliceHeight,
      startY + Math.round(targetHeight * 1.35),
      startY + maximum,
    );
    const nearby = orderedCandidates.filter(candidate => candidate.y >= lower && candidate.y <= upper);
    const chosen = nearby.reduce((best, candidate) => {
      const utility = Number(candidate.score || 0)
        - Math.abs(candidate.y - idealY) / targetHeight * 0.22;
      return !best || utility > best.utility ? { ...candidate, utility } : best;
    }, null);
    const y = chosen?.y || Math.max(lower, Math.min(upper, idealY));
    if (!(y > startY && y < height)) break;
    cuts.push({ y: Math.round(y), source: 'auto' });
    startY = y;
  }
  // A high-scoring seam can sit at the far edge of the search window. Merge a
  // too-short tail into its predecessor instead of emitting an invalid sliver.
  while (cuts.length && height - cuts.at(-1).y < minSliceHeight) cuts.pop();
  return {
    cuts,
    slices: buildDetailStitchSlices({
      cuts,
      canvasWidth: width,
      canvasHeight: height,
      supportedAspectRatios,
      minSliceHeight,
      maxSliceHeight: maximum,
    }),
    targetHeights: targets,
    preferredTargetHeight: targetHeight,
  };
}
