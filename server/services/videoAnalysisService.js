import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveAssetPath } from '../utils/manifestAssets.js';
import { copyCanvasVideoAsReference } from './videoRemix/referenceVideo.js';
import { preprocessReferenceVideo } from './videoRemix/shotPreprocessing.js';
import {
  analyzeVideoRemixGlobal,
  analyzeVideoRemixShot,
} from './videoRemix/videoAnalysis.js';
import { buildVideoAnalysisResultFromRemix } from '../../shared/videoAnalysis.js';

const MAX_REFERENCE_IMAGE_BYTES = 25 * 1024 * 1024;

export class VideoAnalysisServiceError extends Error {
  constructor(message, { code = 'VIDEO_ANALYSIS_FAILED', status = 400, retryable = true, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'VideoAnalysisServiceError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function safeNodeId(value) {
  const raw = String(value || '').trim();
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
  if (!safe || safe !== raw) {
    throw new VideoAnalysisServiceError('视频分析节点 ID 无效', {
      code: 'INVALID_VIDEO_ANALYSIS_NODE',
      status: 400,
      retryable: false,
    });
  }
  return safe;
}

function decodePath(value) {
  const raw = String(value || '').split('?')[0];
  try {
    return decodeURIComponent(raw);
  } catch (error) {
    throw new VideoAnalysisServiceError('参考素材地址编码无效', {
      code: 'INVALID_VIDEO_ANALYSIS_ASSET',
      status: 400,
      retryable: false,
      cause: error,
    });
  }
}

async function resolveReferenceFiles(referenceImages, context) {
  const files = [];
  const entries = Array.isArray(referenceImages) ? referenceImages : [];
  for (let index = 0; index < Math.min(entries.length, 12); index += 1) {
    const entry = entries[index];
    const url = typeof entry === 'string' ? entry : entry?.url;
    if (!url || String(url).startsWith('data:')) {
      throw new VideoAnalysisServiceError('参考图必须先保存到当前项目', {
        code: 'VIDEO_ANALYSIS_ASSET_NOT_SAVED',
        status: 409,
      });
    }
    let filePath;
    try {
      filePath = resolveAssetPath(context.libraryDir, decodePath(url));
    } catch (error) {
      throw new VideoAnalysisServiceError('参考图地址不属于当前项目', {
        code: 'UNSAFE_VIDEO_ANALYSIS_ASSET',
        status: 400,
        retryable: false,
        cause: error,
      });
    }
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch (error) {
      throw new VideoAnalysisServiceError('参考图不存在，请重新保存素材', {
        code: 'VIDEO_ANALYSIS_ASSET_NOT_FOUND',
        status: 404,
        cause: error,
      });
    }
    if (!stat.isFile() || stat.size > MAX_REFERENCE_IMAGE_BYTES) {
      throw new VideoAnalysisServiceError('参考图不存在或超过 25MB', {
        code: 'VIDEO_ANALYSIS_ASSET_TOO_LARGE',
        status: 413,
      });
    }
    const extension = path.extname(filePath).toLowerCase();
    const mimeType = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
    files.push({
      buffer: await fs.readFile(filePath),
      fileName: `reference-${String(index + 1).padStart(2, '0')}${extension || '.jpg'}`,
      mimeType,
      label: typeof entry === 'object' && entry?.label ? String(entry.label) : `参考图 ${index + 1}`,
    });
  }
  return files;
}

/**
 * Canvas-native analysis adapter. It reuses the existing authenticated Gemini
 * HTTP analyzer and the existing FFmpeg preprocessing path, but returns the
 * lightweight prompt contract consumed by ordinary canvas nodes.
 */
export async function analyzeVideoAnalysisNode({
  workflowId,
  nodeId,
  sourceUrl,
  title,
  referenceImages = [],
}, context) {
  const safeId = safeNodeId(nodeId);
  if (!workflowId) {
    throw new VideoAnalysisServiceError('请先新建或打开项目', { code: 'PROJECT_REQUIRED', status: 400 });
  }
  if (!sourceUrl) {
    throw new VideoAnalysisServiceError('请连接一个已有视频结果的参考视频节点', {
      code: 'VIDEO_ANALYSIS_SOURCE_REQUIRED',
      status: 409,
    });
  }

  const remixId = `canvas_${safeId}`;
  const source = await copyCanvasVideoAsReference({
    workflowId,
    remixId,
    sourceUrl: String(sourceUrl).split('?')[0],
    title,
  }, context);
  const prepared = await preprocessReferenceVideo({
    workflowId,
    remixId,
    source,
  }, context);
  const analysisSource = prepared.source;
  const referenceFiles = await resolveReferenceFiles(referenceImages, context);
  const global = await analyzeVideoRemixGlobal({
    workflowId,
    remixId,
    source: analysisSource,
    shots: prepared.shots,
    mode: 'fast',
    referenceFiles,
  }, context);

  const analyzedShots = [];
  for (const shot of prepared.shots) {
    const result = await analyzeVideoRemixShot({
      workflowId,
      remixId,
      source: analysisSource,
      shots: prepared.shots,
      shotId: shot.shotId,
      mode: 'fast',
      analysisKey: global.analysisKey,
    }, context);
    analyzedShots.push(result.shot);
  }

  return {
    source: analysisSource,
    result: buildVideoAnalysisResultFromRemix({
      globalAnalysis: global,
      shotAnalyses: analyzedShots,
      source: analysisSource,
    }),
  };
}
