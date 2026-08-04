import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  SHOT_ANALYSIS_FRAME_POSITIONS,
  buildVideoRemixShots,
  normalizeVideoRemixCutPoints,
} from '../../../shared/videoRemix.js';
import { FFMPEG_PATH } from '../../runtime/mediaTools.js';
import { resolveAssetPath } from '../../utils/manifestAssets.js';
import { resolveProjectMediaTarget } from '../../utils/projectAssets.js';
import { probeReferenceVideo } from './referenceVideo.js';

const DEFAULT_SCENE_THRESHOLD = 0.3;
const DEFAULT_MIN_SHOT_DURATION = 0.35;
const PROCESS_OUTPUT_LIMIT = 8 * 1024 * 1024;

const FRAME_FILE_BY_POSITION = Object.freeze({
  start: 'start.jpg',
  quarter: 'quarter.jpg',
  middle: 'middle.jpg',
  three_quarter: 'three_quarter.jpg',
  end: 'end.jpg',
});

export class ShotPreprocessingError extends Error {
  constructor(message, {
    code = 'SHOT_PREPROCESSING_FAILED',
    status = 400,
    cause,
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ShotPreprocessingError';
    this.code = code;
    this.status = status;
  }
}

function safeIdentifier(value, label) {
  const raw = String(value || '').trim();
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
  if (!safe || safe !== raw) {
    throw new ShotPreprocessingError(`${label}无效`, {
      code: 'INVALID_VIDEO_REMIX_ID',
      status: 400,
    });
  }
  return safe;
}

function appendProcessOutput(current, chunk) {
  const next = `${current}${String(chunk)}`;
  return next.length > PROCESS_OUTPUT_LIMIT
    ? next.slice(-PROCESS_OUTPUT_LIMIT)
    : next;
}

export function runMediaProcess(command, args, {
  spawnImpl = spawn,
  timeoutMs = 5 * 60_000,
  label = 'FFmpeg',
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = callback => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new ShotPreprocessingError(`${label}超时，请重试`, {
        code: 'MEDIA_PROCESS_TIMEOUT',
        status: 504,
      })));
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on('data', chunk => {
      stdout = appendProcessOutput(stdout, chunk);
    });
    child.stderr?.on('data', chunk => {
      stderr = appendProcessOutput(stderr, chunk);
    });
    child.once('error', error => finish(() => reject(new ShotPreprocessingError(
      `Evan 内置 FFmpeg 不可用：${error.message}`,
      { code: 'FFMPEG_UNAVAILABLE', status: 500, cause: error }
    ))));
    child.once('close', code => finish(() => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new ShotPreprocessingError(
        `${label}失败：${stderr.slice(-600) || `FFmpeg 退出码 ${code}`}`,
        { code: 'MEDIA_PROCESS_FAILED', status: 422 }
      ));
    }));
  });
}

async function executeFfmpeg(context, args, options) {
  const runner = context.runProcessImpl || runMediaProcess;
  return runner(context.ffmpegPath || FFMPEG_PATH, args, {
    spawnImpl: context.spawnImpl || spawn,
    ...options,
  });
}

function decodeAssetUrl(value) {
  let pathname = String(value || '').split('?')[0];
  if (/^https?:\/\//i.test(pathname)) {
    try {
      pathname = new URL(pathname).pathname;
    } catch {
      throw new ShotPreprocessingError('参考视频地址无效', {
        code: 'INVALID_REFERENCE_VIDEO',
        status: 400,
      });
    }
  }
  try {
    return decodeURIComponent(pathname);
  } catch {
    throw new ShotPreprocessingError('参考视频地址编码无效', {
      code: 'INVALID_REFERENCE_VIDEO',
      status: 400,
    });
  }
}

async function assertFileInside(filePath, expectedDirectory, message) {
  let fileRealPath;
  let directoryRealPath;
  try {
    [fileRealPath, directoryRealPath] = await Promise.all([
      fsp.realpath(filePath),
      fsp.realpath(expectedDirectory),
    ]);
  } catch (error) {
    throw new ShotPreprocessingError(message, {
      code: 'REFERENCE_VIDEO_NOT_FOUND',
      status: 404,
      cause: error,
    });
  }
  const prefix = directoryRealPath.endsWith(path.sep)
    ? directoryRealPath
    : `${directoryRealPath}${path.sep}`;
  if (fileRealPath === directoryRealPath || !fileRealPath.startsWith(prefix)) {
    throw new ShotPreprocessingError('参考视频路径超出当前视频复刻项目', {
      code: 'UNSAFE_REFERENCE_VIDEO_PATH',
      status: 400,
    });
  }
  const stat = await fsp.stat(fileRealPath);
  if (!stat.isFile()) {
    throw new ShotPreprocessingError(message, {
      code: 'REFERENCE_VIDEO_NOT_FOUND',
      status: 404,
    });
  }
  return fileRealPath;
}

function resolveRemixTarget(workflowId, remixId, context) {
  const safeRemixId = safeIdentifier(remixId, 'remixId');
  let projectMedia;
  try {
    projectMedia = resolveProjectMediaTarget(workflowId, 'videos', {
      workflowsDir: context.workflowsDir,
      projectsDir: context.projectsDir,
    });
  } catch (error) {
    throw new ShotPreprocessingError(error?.message || '当前项目不可用', {
      code: error?.code || 'PROJECT_REQUIRED',
      status: error?.code === 'PROJECT_NOT_FOUND' ? 404 : 400,
      cause: error,
    });
  }
  const directory = path.join(
    path.dirname(projectMedia.targetDir),
    'video-remix',
    safeRemixId
  );
  fs.mkdirSync(path.join(directory, 'preprocess'), { recursive: true });
  return {
    directory,
    preprocessDirectory: path.join(directory, 'preprocess'),
    publicPrefix: `/library/projects/${encodeURIComponent(projectMedia.projectDirName)}/video-remix/${encodeURIComponent(safeRemixId)}`,
  };
}

async function resolveReferenceSourcePath(source, target, context) {
  if (!source || typeof source !== 'object' || !source.localUrl) {
    throw new ShotPreprocessingError('请先导入参考视频', {
      code: 'REFERENCE_VIDEO_REQUIRED',
      status: 400,
    });
  }
  const sourceId = safeIdentifier(source.id, 'referenceId');
  let sourcePath;
  try {
    sourcePath = resolveAssetPath(context.libraryDir, decodeAssetUrl(source.localUrl));
  } catch (error) {
    throw error instanceof ShotPreprocessingError
      ? error
      : new ShotPreprocessingError('参考视频地址无效', {
        code: 'INVALID_REFERENCE_VIDEO',
        status: 400,
        cause: error,
      });
  }
  const expectedDirectory = path.join(target.directory, 'source', sourceId);
  const resolved = await assertFileInside(
    sourcePath,
    expectedDirectory,
    '参考视频原文件不存在，请重新导入'
  );
  if (!/\/original\.(?:mp4|mov|webm)$/i.test(resolved.replaceAll(path.sep, '/'))) {
    throw new ShotPreprocessingError('只能预处理已保存的原始参考视频', {
      code: 'INVALID_REFERENCE_VIDEO',
      status: 400,
    });
  }
  return resolved;
}

async function resolveAnalysisProxyPath(source, target, context) {
  if (!source?.proxyUrl) {
    throw new ShotPreprocessingError('请先生成分析代理并自动拆镜', {
      code: 'ANALYSIS_PROXY_REQUIRED',
      status: 400,
    });
  }
  let proxyPath;
  try {
    proxyPath = resolveAssetPath(context.libraryDir, decodeAssetUrl(source.proxyUrl));
  } catch (error) {
    throw error instanceof ShotPreprocessingError
      ? error
      : new ShotPreprocessingError('分析代理地址无效', {
        code: 'INVALID_ANALYSIS_PROXY',
        status: 400,
        cause: error,
      });
  }
  const resolved = await assertFileInside(
    proxyPath,
    target.preprocessDirectory,
    '分析代理不存在，请重新执行自动拆镜'
  );
  if (path.basename(resolved) !== 'analysis_proxy.mp4') {
    throw new ShotPreprocessingError('分析代理地址无效', {
      code: 'INVALID_ANALYSIS_PROXY',
      status: 400,
    });
  }
  return resolved;
}

function normalizeThreshold(value) {
  const threshold = Number(value);
  if (!Number.isFinite(threshold)) return DEFAULT_SCENE_THRESHOLD;
  return Math.min(0.9, Math.max(0.05, threshold));
}

export function parseSceneDetectionOutput(output) {
  const detections = [];
  let pendingTime = null;
  for (const line of String(output || '').split(/\r?\n/)) {
    const timeMatch = line.match(/\bpts_time:([0-9]+(?:\.[0-9]+)?)/);
    if (timeMatch) pendingTime = Number(timeMatch[1]);
    const scoreMatch = line.match(/\blavfi\.scene_score=([0-9]+(?:\.[0-9]+)?)/);
    if (scoreMatch && Number.isFinite(pendingTime)) {
      detections.push({
        time: Math.round(pendingTime * 1000) / 1000,
        score: Number(scoreMatch[1]),
      });
      pendingTime = null;
    }
  }
  const unique = new Map();
  for (const detection of detections) {
    const key = detection.time.toFixed(3);
    const previous = unique.get(key);
    if (!previous || detection.score > previous.score) unique.set(key, detection);
  }
  return [...unique.values()].sort((left, right) => left.time - right.time);
}

async function createAnalysisProxy(inputPath, outputPath, source, context) {
  const audioArgs = source.hasAudio
    ? ['-map', '0:a:0?', '-c:a', 'aac', '-ac', '1', '-ar', '24000', '-b:a', '48k']
    : ['-an'];
  await executeFfmpeg(context, [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', inputPath,
    '-map', '0:v:0',
    '-vf', "scale=w='if(gt(iw,ih),1280,-2)':h='if(gt(iw,ih),-2,1280)',fps=15",
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '26',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    ...audioArgs,
    outputPath,
  ], {
    timeoutMs: context.proxyTimeoutMs || 15 * 60_000,
    label: '生成分析代理',
  });
}

async function detectScenes(proxyPath, threshold, context) {
  const result = await executeFfmpeg(context, [
    '-hide_banner',
    '-i', proxyPath,
    '-filter:v', `select='gt(scene,${threshold})',metadata=print`,
    '-an',
    '-f', 'null',
    '-',
  ], {
    timeoutMs: context.detectionTimeoutMs || 5 * 60_000,
    label: '自动镜头检测',
  });
  return parseSceneDetectionOutput(result.stderr);
}

function analysisFrameTimes(shot) {
  const duration = Math.max(0, Number(shot.end) - Number(shot.start));
  // The proxy's declared duration can end slightly after its last decodable
  // frame. A 40ms inset is not enough for short/VFR clips: the bundled FFmpeg
  // may exit successfully while writing no JPEG at all. Keep the sample near
  // the end, but leave enough decode room for the final real frame.
  const endInset = Math.min(
    duration * 0.45,
    Math.max(0.08, Math.min(0.2, duration * 0.05)),
  );
  const ratios = [0, 0.25, 0.5, 0.75, 1];
  return SHOT_ANALYSIS_FRAME_POSITIONS.map((position, index) => ({
    position,
    time: Math.round((
      index === ratios.length - 1
        ? Math.max(Number(shot.start), Number(shot.end) - endInset)
        : Number(shot.start) + duration * ratios[index]
    ) * 1000) / 1000,
  }));
}

async function runWithConcurrency(tasks, concurrency) {
  let index = 0;
  const worker = async () => {
    while (index < tasks.length) {
      const taskIndex = index;
      index += 1;
      await tasks[taskIndex]();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(tasks.length, Math.max(1, concurrency)) }, worker)
  );
}

async function extractAnalysisFrames(shots, proxyPath, runDirectory, publicRunPrefix, context) {
  const framesByShot = new Map();
  const tasks = [];
  for (const shot of shots) {
    const shotId = safeIdentifier(shot.shotId, 'shotId');
    const frameDirectory = path.join(runDirectory, 'shots', shotId, 'frames');
    await fsp.mkdir(frameDirectory, { recursive: true });
    const frames = analysisFrameTimes(shot).map(frame => {
      const filename = FRAME_FILE_BY_POSITION[frame.position];
      const outputPath = path.join(frameDirectory, filename);
      tasks.push(async () => {
        await executeFfmpeg(context, [
          '-hide_banner',
          '-loglevel', 'error',
          '-y',
          '-i', proxyPath,
          '-ss', frame.time.toFixed(3),
          '-frames:v', '1',
          '-q:v', '2',
          outputPath,
        ], {
          timeoutMs: context.frameTimeoutMs || 45_000,
          label: `提取 ${shotId} 分析帧`,
        });
        let stat;
        try {
          stat = await fsp.stat(outputPath);
        } catch (error) {
          throw new ShotPreprocessingError(`提取 ${shotId} ${frame.position} 分析帧失败，请重试`, {
            code: 'SHOT_FRAME_NOT_CREATED',
            status: 422,
            cause: error,
          });
        }
        if (!stat.isFile() || stat.size === 0) {
          throw new ShotPreprocessingError(`提取 ${shotId} ${frame.position} 分析帧失败，请重试`, {
            code: 'SHOT_FRAME_NOT_CREATED',
            status: 422,
          });
        }
      });
      return {
        ...frame,
        url: `${publicRunPrefix}/shots/${encodeURIComponent(shotId)}/frames/${filename}`,
      };
    });
    framesByShot.set(shotId, frames);
  }
  await runWithConcurrency(tasks, Number(context.frameConcurrency) || 2);
  return shots.map(shot => ({
    ...shot,
    analysisFrames: framesByShot.get(shot.shotId) || [],
  }));
}

async function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temporaryPath, JSON.stringify(value, null, 2));
  await fsp.rename(temporaryPath, filePath);
}

function portableShots(shots) {
  return shots.map(shot => ({
    ...shot,
    analysisFrames: shot.analysisFrames.map(({ url: _url, ...frame }) => ({
      ...frame,
      file: path.posix.join(
        'shots',
        shot.shotId,
        'frames',
        FRAME_FILE_BY_POSITION[frame.position]
      ),
    })),
  }));
}

async function copyOrLink(sourcePath, targetPath) {
  try {
    await fsp.link(sourcePath, targetPath);
  } catch {
    // Network drives and some Windows project locations do not support hard
    // links. A normal copy keeps the same versioned/atomic behavior.
    await fsp.copyFile(sourcePath, targetPath);
  }
}

async function materializeShotRun({
  target,
  source,
  duration,
  cutPoints,
  detections = [],
  detectionSource,
  previousShots = [],
  makeProxy,
  threshold,
}, context) {
  const runId = `run_${Date.now()}_${crypto.randomUUID()}`;
  const stagingDirectory = path.join(target.preprocessDirectory, `.${runId}.tmp`);
  const finalDirectory = path.join(target.preprocessDirectory, runId);
  const proxyPath = path.join(stagingDirectory, 'analysis_proxy.mp4');
  const publicRunPrefix = `${target.publicPrefix}/preprocess/${encodeURIComponent(runId)}`;
  await fsp.mkdir(stagingDirectory, { recursive: true });

  try {
    await makeProxy(proxyPath);
    const shots = buildVideoRemixShots({
      duration,
      cutPoints,
      previousShots,
      detectionSource,
      detections,
      minShotDuration: DEFAULT_MIN_SHOT_DURATION,
    });
    if (shots.length === 0) {
      throw new ShotPreprocessingError('视频时长不足，无法创建镜头', {
        code: 'VIDEO_TOO_SHORT',
        status: 422,
      });
    }
    const shotsWithFrames = await extractAnalysisFrames(
      shots,
      proxyPath,
      stagingDirectory,
      publicRunPrefix,
      context
    );
    await atomicWriteJson(path.join(stagingDirectory, 'shots.json'), {
      schemaVersion: 1,
      duration,
      cutPoints: normalizeVideoRemixCutPoints(duration, cutPoints, {
        minShotDuration: DEFAULT_MIN_SHOT_DURATION,
      }),
      ...(Number.isFinite(Number(threshold)) ? { sceneThreshold: Number(threshold) } : {}),
      proxyFile: 'analysis_proxy.mp4',
      shots: portableShots(shotsWithFrames),
      createdAt: new Date().toISOString(),
    });
    await fsp.rename(stagingDirectory, finalDirectory);
    await atomicWriteJson(path.join(target.preprocessDirectory, 'current.json'), {
      schemaVersion: 1,
      runId,
      createdAt: new Date().toISOString(),
    });
    const proxyUrl = `${publicRunPrefix}/analysis_proxy.mp4`;
    return {
      source: {
        ...source,
        proxyUrl,
      },
      proxyUrl,
      shots: shotsWithFrames,
    };
  } catch (error) {
    await fsp.rm(stagingDirectory, { recursive: true, force: true }).catch(() => {});
    throw error instanceof ShotPreprocessingError
      ? error
      : new ShotPreprocessingError(error?.message || '视频预处理失败', {
        code: 'SHOT_PREPROCESSING_FAILED',
        status: 500,
        cause: error,
      });
  }
}

export async function preprocessReferenceVideo({
  workflowId,
  remixId,
  source,
  threshold,
}, context) {
  const target = resolveRemixTarget(workflowId, remixId, context);
  const sourcePath = await resolveReferenceSourcePath(source, target, context);
  const probe = await (context.probeImpl || probeReferenceVideo)(sourcePath);
  const normalizedSource = { ...source, ...probe };
  const sceneThreshold = normalizeThreshold(threshold);
  const runId = `probe_${crypto.randomUUID()}`;
  const temporaryDirectory = path.join(target.preprocessDirectory, `.${runId}.tmp`);
  const temporaryProxyPath = path.join(temporaryDirectory, 'analysis_proxy.mp4');
  await fsp.mkdir(temporaryDirectory, { recursive: true });

  try {
    await createAnalysisProxy(sourcePath, temporaryProxyPath, normalizedSource, context);
    const detections = await detectScenes(temporaryProxyPath, sceneThreshold, context);
    return await materializeShotRun({
      target,
      source: normalizedSource,
      duration: probe.duration,
      cutPoints: detections.map(item => item.time),
      detections,
      detectionSource: 'ffmpeg',
      makeProxy: outputPath => copyOrLink(temporaryProxyPath, outputPath),
      threshold: sceneThreshold,
    }, context);
  } finally {
    await fsp.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

export async function updateVideoRemixShotTimeline({
  workflowId,
  remixId,
  source,
  cutPoints,
  previousShots = [],
}, context) {
  const target = resolveRemixTarget(workflowId, remixId, context);
  const sourcePath = await resolveReferenceSourcePath(source, target, context);
  const proxyPath = await resolveAnalysisProxyPath(source, target, context);
  const probe = await (context.probeImpl || probeReferenceVideo)(sourcePath);
  if (!Array.isArray(cutPoints)) {
    throw new ShotPreprocessingError('镜头切点格式无效', {
      code: 'INVALID_SHOT_CUTS',
      status: 400,
    });
  }
  return materializeShotRun({
    target,
    source: { ...source, ...probe },
    duration: probe.duration,
    cutPoints,
    previousShots: Array.isArray(previousShots) ? previousShots : [],
    detectionSource: 'manual',
    makeProxy: outputPath => copyOrLink(proxyPath, outputPath),
  }, context);
}
