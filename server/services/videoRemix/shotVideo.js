import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { FFMPEG_PATH } from '../../runtime/mediaTools.js';
import { resolveAssetPath } from '../../utils/manifestAssets.js';
import { resolveProjectMediaTarget } from '../../utils/projectAssets.js';
import { probeReferenceVideo } from './referenceVideo.js';
import { runMediaProcess } from './shotPreprocessing.js';

const MIN_PLAYBACK_SPEED = 0.85;
const roundTime = value => Math.round(Number(value) * 1000) / 1000;

export class VideoRemixShotVideoError extends Error {
  constructor(message, {
    code = 'VIDEO_REMIX_CALIBRATION_FAILED',
    status = 400,
    cause,
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'VideoRemixShotVideoError';
    this.code = code;
    this.status = status;
    this.retryable = true;
    this.submitted = false;
  }
}

function safeIdentifier(value, label) {
  const raw = String(value || '').trim();
  const safe = raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100);
  if (!safe || safe !== raw) {
    throw new VideoRemixShotVideoError(`${label}无效`, {
      code: 'INVALID_VIDEO_REMIX_ID',
      status: 400,
    });
  }
  return safe;
}

function decodeAssetUrl(value) {
  let pathname = String(value || '').split('?')[0];
  if (/^https?:\/\//i.test(pathname)) {
    try {
      pathname = new URL(pathname).pathname;
    } catch (error) {
      throw new VideoRemixShotVideoError('镜头视频地址无效', {
        code: 'INVALID_SHOT_VIDEO',
        status: 400,
        cause: error,
      });
    }
  }
  try {
    return decodeURIComponent(pathname);
  } catch (error) {
    throw new VideoRemixShotVideoError('镜头视频地址编码无效', {
      code: 'INVALID_SHOT_VIDEO',
      status: 400,
      cause: error,
    });
  }
}

async function assertFileInside(filePath, directory) {
  try {
    const [fileRealPath, directoryRealPath] = await Promise.all([
      fsp.realpath(filePath),
      fsp.realpath(directory),
    ]);
    const prefix = directoryRealPath.endsWith(path.sep)
      ? directoryRealPath
      : `${directoryRealPath}${path.sep}`;
    if (fileRealPath === directoryRealPath || !fileRealPath.startsWith(prefix)) {
      throw new VideoRemixShotVideoError('镜头视频路径超出当前项目', {
        code: 'UNSAFE_SHOT_VIDEO_PATH',
        status: 400,
      });
    }
    const stat = await fsp.stat(fileRealPath);
    if (!stat.isFile()) throw new Error('not a file');
    return { filePath: fileRealPath, stat };
  } catch (error) {
    if (error instanceof VideoRemixShotVideoError) throw error;
    throw new VideoRemixShotVideoError('生成的镜头视频不存在，请重新生成', {
      code: 'SHOT_VIDEO_NOT_FOUND',
      status: 404,
      cause: error,
    });
  }
}

export function buildVideoRemixCalibrationPlan({
  sourceDuration,
  targetDuration,
  trimStart = 0,
}) {
  const source = Number(sourceDuration);
  const target = Number(targetDuration);
  if (!(source > 0) || !(target > 0)) {
    throw new VideoRemixShotVideoError('镜头视频时长无效', {
      code: 'INVALID_SHOT_VIDEO_DURATION',
      status: 400,
    });
  }
  if (source + 0.02 >= target) {
    const maximumTrimStart = Math.max(0, source - target);
    const start = Math.min(
      maximumTrimStart,
      Math.max(0, Number(trimStart) || 0)
    );
    return {
      sourceDuration: source,
      targetDuration: target,
      trimStart: roundTime(start),
      trimEnd: roundTime(Math.min(source, start + target)),
      speed: 1,
      calibration: source - target > 0.02 ? 'trim' : 'none',
    };
  }
  const speed = source / target;
  if (speed < MIN_PLAYBACK_SPEED) {
    throw new VideoRemixShotVideoError(
      `生成结果只有 ${source.toFixed(2)}s，恢复到 ${target.toFixed(2)}s 需要低于 0.85x，已拒绝大幅变速`,
      {
        code: 'SHOT_VIDEO_TOO_SHORT',
        status: 422,
      }
    );
  }
  return {
    sourceDuration: source,
    targetDuration: target,
    trimStart: 0,
    trimEnd: source,
    speed: Math.round(speed * 1000) / 1000,
    calibration: 'speed',
  };
}

function calibrationHash({
  sourceUrl,
  stat,
  targetDuration,
  trimStart,
}) {
  return crypto.createHash('sha256').update(JSON.stringify({
    sourceUrl,
    size: stat.size,
    modifiedAt: stat.mtimeMs,
    targetDuration,
    trimStart,
  })).digest('hex').slice(0, 16);
}

async function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temporaryPath, JSON.stringify(value, null, 2));
  await fsp.rename(temporaryPath, filePath);
}

export async function calibrateVideoRemixShot({
  workflowId,
  remixId,
  shotId,
  sourceUrl,
  targetDuration,
  trimStart = 0,
}, context) {
  const safeRemixId = safeIdentifier(remixId, 'remixId');
  const safeShotId = safeIdentifier(shotId, 'shotId');
  let projectMedia;
  try {
    projectMedia = resolveProjectMediaTarget(workflowId, 'videos', {
      workflowsDir: context.workflowsDir,
      projectsDir: context.projectsDir,
    });
  } catch (error) {
    throw new VideoRemixShotVideoError(
      error?.message || '当前项目不可用',
      {
        code: error?.code || 'PROJECT_REQUIRED',
        status: error?.code === 'PROJECT_NOT_FOUND' ? 404 : 400,
        cause: error,
      }
    );
  }
  const projectRoot = path.dirname(projectMedia.targetDir);
  let sourcePath;
  try {
    sourcePath = resolveAssetPath(
      context.libraryDir,
      decodeAssetUrl(sourceUrl)
    );
  } catch (error) {
    throw error instanceof VideoRemixShotVideoError
      ? error
      : new VideoRemixShotVideoError('镜头视频地址无效', {
        code: 'INVALID_SHOT_VIDEO',
        status: 400,
        cause: error,
      });
  }
  const resolvedSource = await assertFileInside(sourcePath, projectRoot);
  let probe;
  try {
    probe = await (context.probeImpl || probeReferenceVideo)(
      resolvedSource.filePath,
      {
        ffprobePath: context.ffprobePath,
        spawnImpl: context.spawnImpl || spawn,
      }
    );
  } catch (error) {
    throw new VideoRemixShotVideoError(
      error?.message || '无法读取生成视频时长',
      {
        code: error?.code || 'SHOT_VIDEO_PROBE_FAILED',
        status: 422,
        cause: error,
      }
    );
  }
  const plan = buildVideoRemixCalibrationPlan({
    sourceDuration: probe.duration,
    targetDuration,
    trimStart,
  });
  const hash = calibrationHash({
    sourceUrl,
    stat: resolvedSource.stat,
    targetDuration: plan.targetDuration,
    trimStart: plan.trimStart,
  });
  const directory = path.join(
    projectRoot,
    'video-remix',
    safeRemixId,
    'videos'
  );
  await fsp.mkdir(directory, { recursive: true });
  const filename = `${safeShotId}_${hash}.mp4`;
  const outputPath = path.join(directory, filename);
  const metadataPath = path.join(directory, `${safeShotId}_${hash}.json`);
  const publicPrefix = `/library/projects/${encodeURIComponent(
    projectMedia.projectDirName
  )}/video-remix/${encodeURIComponent(safeRemixId)}/videos`;
  const url = `${publicPrefix}/${encodeURIComponent(filename)}`;
  if (fs.existsSync(outputPath) && fs.existsSync(metadataPath)) {
    return {
      ...JSON.parse(await fsp.readFile(metadataPath, 'utf8')),
      url,
      cached: true,
    };
  }

  const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp.mp4`;
  const args = [
    '-y',
    '-i', resolvedSource.filePath,
    '-ss', plan.trimStart.toFixed(3),
    '-map', '0:v:0',
    '-map', '0:a?',
  ];
  if (plan.calibration === 'speed') {
    args.push('-filter:v', `setpts=PTS/${plan.speed.toFixed(6)}`);
    if (probe.hasAudio) {
      args.push('-filter:a', `atempo=${plan.speed.toFixed(6)}`);
    }
  }
  args.push(
    '-t', plan.targetDuration.toFixed(3),
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-sn',
    temporaryPath
  );
  try {
    const runner = context.runProcessImpl || runMediaProcess;
    await runner(context.ffmpegPath || FFMPEG_PATH, args, {
      spawnImpl: context.spawnImpl || spawn,
      timeoutMs: 10 * 60_000,
      label: `Shot ${safeShotId} 时长校准`,
    });
    await fsp.rename(temporaryPath, outputPath);
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true }).catch(() => {});
    throw error instanceof VideoRemixShotVideoError
      ? error
      : new VideoRemixShotVideoError(
        error?.message || '镜头视频时长校准失败',
        {
          code: error?.code || 'VIDEO_REMIX_CALIBRATION_FAILED',
          status: error?.status || 422,
          cause: error,
        }
      );
  }
  const metadata = {
    shotId: safeShotId,
    sourceUrl: String(sourceUrl),
    ...plan,
    url,
    createdAt: new Date().toISOString(),
  };
  await writeJsonAtomic(metadataPath, metadata);
  return { ...metadata, cached: false };
}
