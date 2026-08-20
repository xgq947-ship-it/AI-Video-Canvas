import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const WIDTH_TOLERANCE = 0.02;
const DEFAULT_MAX_DEDUP_ROWS = 300;
const DEFAULT_MIN_DEDUP_ROWS = 24;
const MIN_REMAINING_ROWS = 96;

const orientedDimensions = metadata => {
  const swaps = [5, 6, 7, 8].includes(Number(metadata.orientation));
  return {
    width: Math.round(Number(swaps ? metadata.height : metadata.width) || 0),
    height: Math.round(Number(swaps ? metadata.width : metadata.height) || 0),
  };
};

function modeWidth(entries) {
  const counts = new Map();
  for (const entry of entries) counts.set(entry.width, (counts.get(entry.width) || 0) + 1);
  return entries.reduce((best, entry) => (
    (counts.get(entry.width) || 0) > (counts.get(best.width) || 0) ? entry : best
  )).width;
}

async function overlapSamples(filePath, top, rows, sampleWidth) {
  const { data, info } = await sharp(filePath, { limitInputPixels: false, failOn: 'none' })
    .extract({ left: 0, top, width: (await sharp(filePath, { limitInputPixels: false }).metadata()).width, height: rows })
    .resize({ width: sampleWidth, height: rows, fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function overlapError(previous, current, rows, sampleWidth) {
  const previousStart = (previous.height - rows) * sampleWidth;
  let difference = 0;
  let sum = 0;
  let sumSquares = 0;
  let gradient = 0;
  let rowDifference = 0;
  let maxRowDifference = 0;
  const count = rows * sampleWidth;
  for (let index = 0; index < count; index += 1) {
    const left = previous.data[previousStart + index];
    const right = current.data[index];
    const pixelDifference = Math.abs(left - right);
    difference += pixelDifference;
    rowDifference += pixelDifference;
    if ((index + 1) % sampleWidth === 0) {
      maxRowDifference = Math.max(maxRowDifference, rowDifference / sampleWidth / 255);
      rowDifference = 0;
    }
    const average = (left + right) / 2;
    sum += average;
    sumSquares += average * average;
    if (index >= sampleWidth) {
      gradient += Math.abs(left - previous.data[previousStart + index - sampleWidth]);
      gradient += Math.abs(right - current.data[index - sampleWidth]);
    }
  }
  const mean = sum / count;
  const variance = Math.max(0, sumSquares / count - mean * mean);
  return {
    normalizedDifference: difference / count / 255,
    maxRowDifference,
    standardDeviation: Math.sqrt(variance),
    meanVerticalGradient: gradient / Math.max(1, (count - sampleWidth) * 2),
  };
}

/** Conservative exact-translation overlap detector; flat white bands do not count. */
export async function detectAdjacentDuplicateRows(previousPath, currentPath, options = {}) {
  const previousMetadata = await sharp(previousPath, { limitInputPixels: false }).metadata();
  const currentMetadata = await sharp(currentPath, { limitInputPixels: false }).metadata();
  const previousHeight = Math.round(Number(previousMetadata.height) || 0);
  const currentHeight = Math.round(Number(currentMetadata.height) || 0);
  const maxRows = Math.min(
    Math.max(DEFAULT_MIN_DEDUP_ROWS, Number(options.maxRows) || DEFAULT_MAX_DEDUP_ROWS),
    previousHeight,
    Math.max(0, currentHeight - MIN_REMAINING_ROWS),
  );
  const minRows = Math.min(maxRows, Math.max(8, Number(options.minRows) || DEFAULT_MIN_DEDUP_ROWS));
  if (maxRows < minRows) return 0;
  const sampleWidth = Math.max(16, Number(options.sampleWidth) || 64);
  const previous = await overlapSamples(previousPath, previousHeight - maxRows, maxRows, sampleWidth);
  const current = await overlapSamples(currentPath, 0, maxRows, sampleWidth);
  const threshold = Number(options.differenceThreshold) || 0.032;
  for (let rows = maxRows; rows >= minRows; rows -= 1) {
    const metrics = overlapError(previous, current, rows, sampleWidth);
    const textured = metrics.standardDeviation >= 6 || metrics.meanVerticalGradient >= 2.5;
    if (
      textured
      && metrics.normalizedDifference <= threshold
      && metrics.maxRowDifference <= Math.max(0.08, threshold * 2.5)
    ) return rows;
  }
  return 0;
}

/**
 * Normalize every source to the mode width, trim true adjacent duplicates and
 * composite path-backed PNG inputs into one lossless long PNG.
 */
export async function stitchDetailImages({ sources, outputPath, temporaryDir, dedup = {} }) {
  if (!Array.isArray(sources) || sources.length === 0) throw new Error('请至少提供一张竞品详情图');
  const metadataEntries = [];
  for (const source of sources) {
    const metadata = await sharp(source.filePath, { limitInputPixels: false, failOn: 'none' }).metadata();
    const dimensions = orientedDimensions(metadata);
    if (dimensions.width <= 0 || dimensions.height <= 0) throw new Error(`无法识别图片尺寸：${source.url || source.filePath}`);
    metadataEntries.push({ ...source, ...dimensions });
  }
  const canvasWidth = modeWidth(metadataEntries);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.mkdirSync(temporaryDir, { recursive: true });
  const normalized = [];

  try {
    for (let index = 0; index < metadataEntries.length; index += 1) {
      const source = metadataEntries[index];
      const normalizedPath = path.join(temporaryDir, `${String(index).padStart(4, '0')}.png`);
      const pipeline = sharp(source.filePath, { limitInputPixels: false, failOn: 'none' }).rotate();
      if (source.width !== canvasWidth) {
        pipeline.resize({ width: canvasWidth, kernel: sharp.kernel.lanczos3 });
      }
      await pipeline.png({ compressionLevel: 9 }).toFile(normalizedPath);
      let currentPath = normalizedPath;
      let currentMetadata = await sharp(currentPath, { limitInputPixels: false }).metadata();
      const scaledHeight = Math.round(Number(currentMetadata.height) || 0);
      let dedupTrimmedTop = 0;
      if (normalized.length > 0) {
        dedupTrimmedTop = await detectAdjacentDuplicateRows(
          normalized.at(-1).filePath,
          currentPath,
          dedup,
        );
        if (dedupTrimmedTop > 0) {
          const trimmedPath = path.join(temporaryDir, `${String(index).padStart(4, '0')}-trimmed.png`);
          await sharp(currentPath, { limitInputPixels: false, failOn: 'none' })
            .extract({
              left: 0,
              top: dedupTrimmedTop,
              width: canvasWidth,
              height: Number(currentMetadata.height) - dedupTrimmedTop,
            })
            .png({ compressionLevel: 9 })
            .toFile(trimmedPath);
          currentPath = trimmedPath;
          currentMetadata = await sharp(currentPath, { limitInputPixels: false }).metadata();
        }
      }
      normalized.push({
        ...source,
        filePath: currentPath,
        scaledHeight,
        effectiveHeight: Math.round(Number(currentMetadata.height) || 0),
        dedupTrimmedTop,
        widthAdjusted: Math.abs(source.width - canvasWidth) / canvasWidth > WIDTH_TOLERANCE,
      });
    }

    let offsetY = 0;
    const placements = normalized.map(source => {
      const placement = { ...source, offsetY };
      offsetY += source.effectiveHeight;
      return placement;
    });
    await sharp({
      create: { width: canvasWidth, height: offsetY, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite(placements.map(source => ({
        input: source.filePath,
        left: 0,
        top: source.offsetY,
        limitInputPixels: false,
      })))
      .png({ compressionLevel: 9 })
      .toFile(outputPath);

    return {
      canvasWidth,
      canvasHeight: offsetY,
      widthAdjustedCount: placements.filter(source => source.widthAdjusted).length,
      sources: placements.map(source => ({
        nodeId: source.nodeId,
        url: source.url,
        originalWidth: source.width,
        originalHeight: source.height,
        scaledHeight: source.scaledHeight,
        offsetY: source.offsetY,
        dedupTrimmedTop: source.dedupTrimmedTop,
        widthAdjusted: source.widthAdjusted,
      })),
    };
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}

export const __detailStitcherTest = { modeWidth, overlapError, orientedDimensions };
