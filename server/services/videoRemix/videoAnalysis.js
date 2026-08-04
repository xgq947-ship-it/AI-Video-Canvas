import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { FFMPEG_PATH } from '../../runtime/mediaTools.js';
import { resolveAssetPath } from '../../utils/manifestAssets.js';
import { resolveProjectMediaTarget } from '../../utils/projectAssets.js';
import { MAX_BRIDGE_BODY_BYTES } from '../webhttp/bridge.js';
import { createVideoAnalyzerProvider } from './geminiVideoAnalyzer.js';
import { runMediaProcess } from './shotPreprocessing.js';

// The authenticated page bridge deliberately caps binary request bodies at
// 24MB. Fail before loading an oversized proxy into memory so the user gets a
// deterministic, retryable message instead of a late bridge protocol error.
const MAX_ANALYSIS_PROXY_BYTES = MAX_BRIDGE_BODY_BYTES;
const MAX_ANALYSIS_FRAME_BYTES = 25 * 1024 * 1024;

export class VideoRemixAnalysisError extends Error {
  constructor(message, {
    code = 'VIDEO_REMIX_ANALYSIS_FAILED',
    status = 400,
    retryable = true,
    cause,
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'VideoRemixAnalysisError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function safeIdentifier(value, label) {
  const raw = String(value || '').trim();
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
  if (!safe || safe !== raw) {
    throw new VideoRemixAnalysisError(`${label}无效`, {
      code: 'INVALID_ANALYSIS_ID',
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
    } catch {
      throw new VideoRemixAnalysisError('分析素材地址无效', {
        code: 'INVALID_ANALYSIS_ASSET',
        status: 400,
      });
    }
  }
  try {
    return decodeURIComponent(pathname);
  } catch {
    throw new VideoRemixAnalysisError('分析素材地址编码无效', {
      code: 'INVALID_ANALYSIS_ASSET',
      status: 400,
    });
  }
}

async function assertFileWithin(filePath, expectedDirectory, {
  code = 'ANALYSIS_ASSET_NOT_FOUND',
  message = '分析素材不存在',
  maximumBytes,
} = {}) {
  let fileRealPath;
  let directoryRealPath;
  try {
    [fileRealPath, directoryRealPath] = await Promise.all([
      fsp.realpath(filePath),
      fsp.realpath(expectedDirectory),
    ]);
  } catch (error) {
    throw new VideoRemixAnalysisError(message, {
      code,
      status: 404,
      cause: error,
    });
  }
  const prefix = directoryRealPath.endsWith(path.sep)
    ? directoryRealPath
    : `${directoryRealPath}${path.sep}`;
  if (fileRealPath === directoryRealPath || !fileRealPath.startsWith(prefix)) {
    throw new VideoRemixAnalysisError('分析素材路径超出当前 Remix 项目', {
      code: 'UNSAFE_ANALYSIS_ASSET_PATH',
      status: 400,
    });
  }
  const stat = await fsp.stat(fileRealPath);
  if (!stat.isFile()) {
    throw new VideoRemixAnalysisError(message, { code, status: 404 });
  }
  if (maximumBytes && stat.size > maximumBytes) {
    throw new VideoRemixAnalysisError('分析素材过大，请缩短参考视频或重新生成代理', {
      code: 'ANALYSIS_ASSET_TOO_LARGE',
      status: 413,
    });
  }
  return { path: fileRealPath, size: stat.size };
}

function resolveAnalysisTarget(workflowId, remixId, context) {
  const safeRemixId = safeIdentifier(remixId, 'remixId');
  let projectMedia;
  try {
    projectMedia = resolveProjectMediaTarget(workflowId, 'videos', {
      workflowsDir: context.workflowsDir,
      projectsDir: context.projectsDir,
    });
  } catch (error) {
    throw new VideoRemixAnalysisError(error?.message || '当前项目不可用', {
      code: error?.code || 'PROJECT_REQUIRED',
      status: error?.code === 'PROJECT_NOT_FOUND' ? 404 : 400,
      cause: error,
    });
  }
  const remixDirectory = path.join(
    path.dirname(projectMedia.targetDir),
    'video-remix',
    safeRemixId
  );
  const preprocessDirectory = path.join(remixDirectory, 'preprocess');
  const analysisDirectory = path.join(remixDirectory, 'analysis');
  fs.mkdirSync(analysisDirectory, { recursive: true });
  return {
    remixDirectory,
    preprocessDirectory,
    analysisDirectory,
  };
}

async function resolveProxy(source, target, context) {
  if (!source?.proxyUrl) {
    throw new VideoRemixAnalysisError('请先生成分析代理并确认镜头时间线', {
      code: 'ANALYSIS_PROXY_REQUIRED',
      status: 409,
    });
  }
  let candidate;
  try {
    candidate = resolveAssetPath(context.libraryDir, decodeAssetUrl(source.proxyUrl));
  } catch (error) {
    throw error instanceof VideoRemixAnalysisError
      ? error
      : new VideoRemixAnalysisError('分析代理地址无效', {
        code: 'INVALID_ANALYSIS_PROXY',
        status: 400,
        cause: error,
      });
  }
  const resolved = await assertFileWithin(candidate, target.preprocessDirectory, {
    code: 'ANALYSIS_PROXY_NOT_FOUND',
    message: '分析代理不存在，请重新执行自动拆镜',
    maximumBytes: MAX_ANALYSIS_PROXY_BYTES,
  });
  if (path.basename(resolved.path) !== 'analysis_proxy.mp4') {
    throw new VideoRemixAnalysisError('分析代理地址无效', {
      code: 'INVALID_ANALYSIS_PROXY',
      status: 400,
    });
  }
  return {
    ...resolved,
    runDirectory: path.dirname(resolved.path),
  };
}

function normalizeMode(value) {
  return value === 'deep' ? 'deep' : 'fast';
}

function validateShotTimeline(shots, source) {
  if (!Array.isArray(shots) || shots.length === 0) {
    throw new VideoRemixAnalysisError('请先完成自动拆镜', {
      code: 'SHOTS_REQUIRED',
      status: 409,
    });
  }
  let previousEnd = 0;
  return shots.map((shot, index) => {
    const shotId = safeIdentifier(shot?.shotId, 'shotId');
    const start = Number(shot?.start);
    const end = Number(shot?.end);
    if (
      !Number.isFinite(start)
      || !Number.isFinite(end)
      || end <= start
      || Math.abs(start - previousEnd) > 0.02
      || end > Number(source?.duration) + 0.05
    ) {
      throw new VideoRemixAnalysisError(`镜头 ${index + 1} 时间边界无效`, {
        code: 'INVALID_SHOT_TIMELINE',
        status: 400,
      });
    }
    previousEnd = end;
    return {
      ...shot,
      shotId,
      start,
      end,
      duration: Math.round((end - start) * 1000) / 1000,
    };
  });
}

function analysisSignature(source, shots, mode) {
  const value = JSON.stringify({
    sourceHash: source?.sourceHash || source?.id || '',
    mode,
    shots: shots.map(shot => [shot.shotId, shot.start, shot.end]),
  });
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temporaryPath, JSON.stringify(value, null, 2));
  await fsp.rename(temporaryPath, filePath);
}

function analyzerFor(context) {
  if (context.analyzer) return context.analyzer;
  if (typeof context.analyzerFactory === 'function') return context.analyzerFactory();
  return createVideoAnalyzerProvider('gemini');
}

function analysisRunDirectory(target, analysisKey) {
  return path.join(target.analysisDirectory, safeIdentifier(analysisKey, 'analysisKey'));
}

async function readJson(filePath, message) {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch (error) {
    throw new VideoRemixAnalysisError(message, {
      code: 'ANALYSIS_RESULT_NOT_FOUND',
      status: 409,
      cause: error,
    });
  }
}

async function resolveRun({
  target,
  source,
  shots,
  mode,
  analysisKey,
}) {
  const signature = analysisSignature(source, shots, mode);
  let key = analysisKey ? safeIdentifier(analysisKey, 'analysisKey') : '';
  if (!key) {
    const pointer = await readJson(
      path.join(target.analysisDirectory, 'current.json'),
      '没有可恢复的全片分析结果'
    );
    if (pointer.signature !== signature) {
      throw new VideoRemixAnalysisError('已保存分析与当前视频或切点不一致，请重新执行全片分析', {
        code: 'ANALYSIS_STALE',
        status: 409,
      });
    }
    key = safeIdentifier(pointer.analysisKey, 'analysisKey');
  }
  const runDirectory = analysisRunDirectory(target, key);
  const manifest = await readJson(
    path.join(runDirectory, 'global.json'),
    '请先完成全片分析'
  );
  if (manifest.signature !== signature) {
    throw new VideoRemixAnalysisError('全片分析结果与当前视频或切点不一致', {
      code: 'ANALYSIS_STALE',
      status: 409,
    });
  }
  return {
    analysisKey: key,
    signature,
    runDirectory,
    global: manifest.global,
    mode: manifest.mode,
  };
}

function portableShot(shot) {
  return {
    ...shot,
    analysisFrames: [],
  };
}

export async function analyzeVideoRemixGlobal({
  workflowId,
  remixId,
  source,
  shots,
  mode,
  referenceFiles = [],
}, context) {
  const normalizedMode = normalizeMode(mode);
  const target = resolveAnalysisTarget(workflowId, remixId, context);
  const normalizedShots = validateShotTimeline(shots, source);
  const proxy = await resolveProxy(source, target, context);
  const analyzer = analyzerFor(context);
  const global = await analyzer.analyzeVideo({
    source,
    shots: normalizedShots,
    proxyFile: {
      buffer: await fsp.readFile(proxy.path),
      fileName: 'analysis_proxy.mp4',
      mimeType: 'video/mp4',
    },
    referenceFiles,
    mode: normalizedMode,
    workflowId,
    nodeId: remixId,
    signal: context.signal,
  });

  const signature = analysisSignature(source, normalizedShots, normalizedMode);
  const analysisKey = `run_${Date.now()}_${crypto.randomUUID()}`;
  const runDirectory = analysisRunDirectory(target, analysisKey);
  await fsp.mkdir(path.join(runDirectory, 'shots'), { recursive: true });
  await atomicWriteJson(path.join(runDirectory, 'global.json'), {
    schemaVersion: 1,
    analysisKey,
    signature,
    mode: normalizedMode,
    sourceHash: source?.sourceHash || undefined,
    shotTimeline: normalizedShots.map(shot => ({
      shotId: shot.shotId,
      start: shot.start,
      end: shot.end,
    })),
    global,
    createdAt: new Date().toISOString(),
  });
  await atomicWriteJson(path.join(target.analysisDirectory, 'current.json'), {
    schemaVersion: 1,
    analysisKey,
    signature,
    mode: normalizedMode,
    updatedAt: new Date().toISOString(),
  });
  return {
    ...global,
    analysisKey,
    mode: normalizedMode,
  };
}

async function resolveFrameFiles(shot, proxy, context, positions) {
  const byPosition = new Map(
    (shot.analysisFrames || []).map(frame => [frame.position, frame])
  );
  const expectedDirectory = path.join(
    proxy.runDirectory,
    'shots',
    safeIdentifier(shot.shotId, 'shotId'),
    'frames'
  );
  const files = [];
  for (const position of positions) {
    const frame = byPosition.get(position);
    if (!frame?.url) {
      throw new VideoRemixAnalysisError(`${shot.shotId} 缺少 ${position} 分析帧`, {
        code: 'SHOT_FRAME_REQUIRED',
        status: 409,
      });
    }
    let candidate;
    try {
      candidate = resolveAssetPath(context.libraryDir, decodeAssetUrl(frame.url));
    } catch (error) {
      throw new VideoRemixAnalysisError(`${shot.shotId} 分析帧地址无效`, {
        code: 'INVALID_SHOT_FRAME',
        status: 400,
        cause: error,
      });
    }
    const resolved = await assertFileWithin(candidate, expectedDirectory, {
      code: 'SHOT_FRAME_NOT_FOUND',
      message: `${shot.shotId} 分析帧不存在，请重建镜头时间线`,
      maximumBytes: MAX_ANALYSIS_FRAME_BYTES,
    });
    if (!/\.jpe?g$/i.test(resolved.path)) {
      throw new VideoRemixAnalysisError(`${shot.shotId} 分析帧格式无效`, {
        code: 'INVALID_SHOT_FRAME',
        status: 400,
      });
    }
    files.push({
      buffer: await fsp.readFile(resolved.path),
      fileName: `${position}.jpg`,
      mimeType: 'image/jpeg',
    });
  }
  return files;
}

async function createComplexShotClip(shot, proxyPath, context) {
  if (typeof context.clipBuilder === 'function') {
    return context.clipBuilder({ shot, proxyPath });
  }
  const temporaryDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'evan-remix-shot-'));
  const outputPath = path.join(temporaryDirectory, `${safeIdentifier(shot.shotId, 'shotId')}.mp4`);
  try {
    const runner = context.runProcessImpl || runMediaProcess;
    await runner(context.ffmpegPath || FFMPEG_PATH, [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', proxyPath,
      '-ss', Number(shot.start).toFixed(3),
      '-t', Number(shot.duration).toFixed(3),
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '24',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      outputPath,
    ], {
      timeoutMs: context.clipTimeoutMs || 3 * 60_000,
      label: `提取 ${shot.shotId} 分析视频`,
    });
    return {
      buffer: await fsp.readFile(outputPath),
      fileName: `${shot.shotId}.mp4`,
      mimeType: 'video/mp4',
    };
  } finally {
    await fsp.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

function classificationForShot(global, shotId) {
  return global.shotComplexities.find(item => item.shotId === shotId) || {
    shotId,
    motionComplexity: 'medium',
    confidence: 0,
  };
}

export async function analyzeVideoRemixShot({
  workflowId,
  remixId,
  source,
  shots,
  shotId,
  mode,
  analysisKey,
}, context) {
  const normalizedMode = normalizeMode(mode);
  const target = resolveAnalysisTarget(workflowId, remixId, context);
  const normalizedShots = validateShotTimeline(shots, source);
  const shot = normalizedShots.find(item => item.shotId === String(shotId || ''));
  if (!shot) {
    throw new VideoRemixAnalysisError('要分析的镜头不存在', {
      code: 'SHOT_NOT_FOUND',
      status: 404,
    });
  }
  const run = await resolveRun({
    target,
    source,
    shots: normalizedShots,
    mode: normalizedMode,
    analysisKey,
  });
  const proxy = await resolveProxy(source, target, context);
  const classification = classificationForShot(run.global, shot.shotId);
  const classifiedShot = {
    ...shot,
    motionComplexity: classification.motionComplexity,
    motionComplexityConfidence: classification.confidence,
  };
  let files;
  let inputKind;
  if (classification.motionComplexity === 'complex') {
    files = [await createComplexShotClip(classifiedShot, proxy.path, context)];
    inputKind = 'video';
  } else {
    const positions = classification.motionComplexity === 'simple'
      ? ['start', 'middle', 'end']
      : ['start', 'quarter', 'middle', 'three_quarter', 'end'];
    files = await resolveFrameFiles(classifiedShot, proxy, context, positions);
    inputKind = classification.motionComplexity === 'simple' ? 'three_frames' : 'five_frames';
  }

  const analyzedShot = await analyzerFor(context).analyzeShot({
    shot: classifiedShot,
    globalAnalysis: run.global,
    files,
    inputKind,
    mode: normalizedMode,
    workflowId,
    nodeId: remixId,
    signal: context.signal,
  });
  await atomicWriteJson(
    path.join(run.runDirectory, 'shots', `${safeIdentifier(shot.shotId, 'shotId')}.json`),
    {
      schemaVersion: 1,
      analysisKey: run.analysisKey,
      shot: portableShot(analyzedShot),
      updatedAt: new Date().toISOString(),
    }
  );
  return {
    analysisKey: run.analysisKey,
    mode: normalizedMode,
    shot: analyzedShot,
    inputKind,
  };
}

export async function loadVideoRemixAnalysisSnapshot({
  workflowId,
  remixId,
  source,
  shots,
  mode,
  analysisKey,
}, context) {
  const normalizedMode = normalizeMode(mode);
  const target = resolveAnalysisTarget(workflowId, remixId, context);
  const normalizedShots = validateShotTimeline(shots, source);
  const run = await resolveRun({
    target,
    source,
    shots: normalizedShots,
    mode: normalizedMode,
    analysisKey,
  });
  const savedShots = [];
  for (const shot of normalizedShots) {
    const filePath = path.join(
      run.runDirectory,
      'shots',
      `${safeIdentifier(shot.shotId, 'shotId')}.json`
    );
    if (!fs.existsSync(filePath)) continue;
    try {
      const payload = JSON.parse(await fsp.readFile(filePath, 'utf8'));
      if (payload?.analysisKey !== run.analysisKey || payload?.shot?.shotId !== shot.shotId) continue;
      savedShots.push({
        ...shot,
        ...payload.shot,
        analysisFrames: shot.analysisFrames || [],
        detection: shot.detection || payload.shot.detection,
      });
    } catch {
      // One corrupt Shot must not hide all other recoverable analysis results.
    }
  }
  return {
    analysisKey: run.analysisKey,
    mode: run.mode,
    global: run.global,
    shots: savedShots,
  };
}
