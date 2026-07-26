export const IMAGE_BATCH_HORIZONTAL_STEP: number;
export const IMAGE_BATCH_VERTICAL_GAP: number;
export const IMAGE_NODE_WIDTH: number;

interface ImageBatchSourceNode {
    x: number;
    y: number;
    aspectRatio?: string;
    resultAspectRatio?: string;
}

export interface ImageBatchPlacement {
    resultUrl: string;
    x: number;
    y: number;
    parentIds: string[];
}

export interface ImageBatchPlacementOptions {
    layout?: 'horizontal' | 'vertical';
    parentIds?: string[];
    horizontalStep?: number;
    verticalStep?: number;
}

export function getImageBatchVerticalStep(
    sourceNode: ImageBatchSourceNode,
    verticalGap?: number
): number;

export function createAdditionalImagePlacements(
    sourceNode: ImageBatchSourceNode,
    resultUrls: string[],
    options?: ImageBatchPlacementOptions
): ImageBatchPlacement[];
