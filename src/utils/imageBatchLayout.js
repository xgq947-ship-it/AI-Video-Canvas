export const IMAGE_BATCH_HORIZONTAL_STEP = 420;
export const IMAGE_BATCH_VERTICAL_GAP = 32;
export const IMAGE_NODE_WIDTH = 365;

function parseAspectRatio(value) {
  if (!value || value === 'Auto') return undefined;

  const separator = value.includes('/') ? '/' : ':';
  const [width, height] = value.split(separator).map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  return width / height;
}

export function getImageBatchVerticalStep(sourceNode, verticalGap = IMAGE_BATCH_VERTICAL_GAP) {
  const aspectRatio =
    parseAspectRatio(sourceNode.resultAspectRatio) ??
    parseAspectRatio(sourceNode.aspectRatio) ??
    (4 / 3);
  return IMAGE_NODE_WIDTH / aspectRatio + verticalGap;
}

export function createAdditionalImagePlacements(
  sourceNode,
  resultUrls,
  options = {}
) {
  const {
    layout = 'horizontal',
    parentIds = [],
    horizontalStep = IMAGE_BATCH_HORIZONTAL_STEP,
    verticalStep = getImageBatchVerticalStep(sourceNode)
  } = options;
  const connectedParentIds = [...new Set(parentIds)];

  return resultUrls.slice(1).map((resultUrl, index) => ({
    resultUrl,
    x: layout === 'vertical'
      ? sourceNode.x
      : sourceNode.x + horizontalStep * (index + 1),
    y: layout === 'vertical'
      ? sourceNode.y + verticalStep * (index + 1)
      : sourceNode.y,
    parentIds: [...connectedParentIds]
  }));
}
