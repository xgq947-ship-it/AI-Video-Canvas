import sharp from 'sharp';

const clamp01 = value => Math.max(0, Math.min(1, value));

function rowFeatures(data, width, height, channels) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    let luminanceSum = 0;
    let luminanceSquares = 0;
    let red = 0;
    let green = 0;
    let blue = 0;
    let verticalGradient = 0;
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * channels;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      red += r;
      green += g;
      blue += b;
      luminanceSum += luminance;
      luminanceSquares += luminance * luminance;
      if (y > 0) {
        const previous = index - width * channels;
        const previousLuminance = 0.2126 * data[previous]
          + 0.7152 * data[previous + 1]
          + 0.0722 * data[previous + 2];
        verticalGradient += Math.abs(luminance - previousLuminance);
      }
    }
    const mean = luminanceSum / width;
    rows.push({
      mean,
      variance: Math.max(0, luminanceSquares / width - mean * mean),
      gradient: verticalGradient / width,
      color: [red / width, green / width, blue / width],
    });
  }
  return rows;
}

const average = values => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : 0;

function meanColor(rows, start, end) {
  const window = rows.slice(Math.max(0, start), Math.min(rows.length, end));
  if (!window.length) return [0, 0, 0];
  return [0, 1, 2].map(channel => average(window.map(row => row.color[channel])));
}

/** Downsample and score safe horizontal seams without any perspective transform. */
export async function detectDetailSections(fullImagePath, options = {}) {
  const metadata = await sharp(fullImagePath, { limitInputPixels: false, failOn: 'none' }).metadata();
  const originalWidth = Math.round(Number(metadata.width) || 0);
  const originalHeight = Math.round(Number(metadata.height) || 0);
  if (originalWidth <= 0 || originalHeight <= 0) throw new Error('无法读取拼接长图');
  const analysisWidth = Math.min(originalWidth, Math.max(64, Number(options.analysisWidth) || 200));
  const { data, info } = await sharp(fullImagePath, { limitInputPixels: false, failOn: 'none' })
    .resize({ width: analysisWidth, kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rows = rowFeatures(data, info.width, info.height, info.channels);
  const radius = Math.max(2, Number(options.windowRadius) || 4);
  const scoreRows = rows.map((row, y) => {
    const window = rows.slice(Math.max(0, y - radius), Math.min(rows.length, y + radius + 1));
    const variance = average(window.map(item => item.variance));
    const gradient = average(window.map(item => item.gradient));
    const flatness = 1 - clamp01(Math.sqrt(variance) / 48);
    const lowEdge = 1 - clamp01(gradient / 42);
    const above = meanColor(rows, y - radius * 3, y - radius);
    const below = meanColor(rows, y + radius, y + radius * 3);
    const colorTransition = Math.sqrt(above.reduce(
      (sum, value, channel) => sum + (value - below[channel]) ** 2,
      0,
    )) / (Math.sqrt(3) * 255);
    const localBand = 1 - clamp01(average(window.map(item => Math.abs(item.mean - row.mean))) / 38);
    return clamp01(flatness * 0.46 + lowEdge * 0.30 + localBand * 0.16 + colorTransition * 0.08);
  });
  const scaleY = originalHeight / info.height;
  const minimumSpacing = Math.max(12, Math.round((Number(options.minimumSpacing) || 36) / scaleY));
  const threshold = Number(options.scoreThreshold) || 0.54;
  const peaks = [];
  for (let y = radius * 2; y < scoreRows.length - radius * 2; y += 1) {
    const score = scoreRows[y];
    if (score < threshold) continue;
    const local = scoreRows.slice(Math.max(0, y - 2), y + 3);
    if (score < Math.max(...local)) continue;
    const previous = peaks.at(-1);
    if (previous && y - previous.sampleY < minimumSpacing) {
      if (score > previous.score) peaks[peaks.length - 1] = { sampleY: y, score };
    } else {
      peaks.push({ sampleY: y, score });
    }
  }
  return peaks.map(candidate => ({
    y: Math.max(1, Math.min(originalHeight - 1, Math.round(candidate.sampleY * scaleY))),
    score: Number(candidate.score.toFixed(4)),
  }));
}

export const __detailSectionDetectorTest = { rowFeatures };
