import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

import { buildDetailStitchSlices } from '../../../shared/detailStitch.js';
import { detailStitchImageUrl } from './store.js';

export async function sliceDetailImage({
  record,
  fullImagePath,
  imageTarget,
  cuts,
  supportedAspectRatios,
  nodeIds,
}) {
  const planned = buildDetailStitchSlices({
    cuts,
    canvasWidth: record.canvasWidth,
    canvasHeight: record.canvasHeight,
    supportedAspectRatios,
    nodeIds,
  });
  if (Array.isArray(nodeIds) && nodeIds.length > 0 && nodeIds.length !== planned.length) {
    throw new Error('切片节点数量与切片方案不一致');
  }
  const written = [];
  try {
    const withUrls = [];
    for (const slice of planned) {
      const filename = `${record.stitchId}_${slice.id}.png`;
      const outputPath = path.join(imageTarget.targetDir, filename);
      const temporaryPath = `${outputPath}.${process.pid}.tmp.png`;
      await sharp(fullImagePath, { limitInputPixels: false, failOn: 'none' })
        .extract({
          left: 0,
          top: slice.startY,
          width: slice.width,
          height: slice.height,
        })
        .png({ compressionLevel: 9 })
        .toFile(temporaryPath);
      fs.renameSync(temporaryPath, outputPath);
      written.push(outputPath);
      withUrls.push({ ...slice, url: detailStitchImageUrl(imageTarget, filename) });
    }
    return withUrls;
  } catch (error) {
    for (const filePath of written) fs.rmSync(filePath, { force: true });
    throw error;
  }
}
