export const IMAGE_BATCH_HORIZONTAL_STEP = 420;

export function createAdditionalImagePlacements(
  sourceNode,
  resultUrls,
  horizontalStep = IMAGE_BATCH_HORIZONTAL_STEP
) {
  return resultUrls.slice(1).map((resultUrl, index) => ({
    resultUrl,
    x: sourceNode.x + horizontalStep * (index + 1),
    y: sourceNode.y,
    parentIds: []
  }));
}
