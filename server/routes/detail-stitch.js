import crypto from 'crypto';
import path from 'path';
import express from 'express';

import {
  DETAIL_STITCH_SCHEMA_VERSION,
  normalizeDetailStitchCuts,
} from '../../shared/detailStitch.js';
import { getImageGenerationProvider } from '../../shared/generationProviders.js';
import { detectDetailSections } from '../services/detailStitch/sectionDetector.js';
import { planDetailSlices } from '../services/detailStitch/slicePlanner.js';
import { sliceDetailImage } from '../services/detailStitch/slicer.js';
import {
  detailStitchImageUrl,
  getDetailStitchStorage,
  readDetailStitchRecord,
  resolveDetailStitchImagePath,
  writeDetailStitchRecord,
} from '../services/detailStitch/store.js';
import { stitchDetailImages } from '../services/detailStitch/stitcher.js';

const router = express.Router();

function requestContext(appLocals) {
  return {
    dirs: {
      workflowsDir: appLocals.WORKFLOWS_DIR,
      projectsDir: appLocals.PROJECTS_DIR,
    },
    libraryDir: appLocals.LIBRARY_DIR,
  };
}

function requestProvider(imageModel) {
  const provider = getImageGenerationProvider(String(imageModel || ''));
  if (!provider?.supportsImageToImage || !provider.supportedAspectRatios?.length) {
    const error = new Error('当前详情图模型不支持智能重切片');
    error.code = 'IMAGE_MODEL_UNSUPPORTED';
    throw error;
  }
  return provider;
}

function sendError(res, error, fallback, defaultStatus = 400) {
  const statusByCode = {
    PROJECT_REQUIRED: 400,
    PROJECT_NOT_FOUND: 404,
    STITCH_NOT_FOUND: 404,
    IMAGE_MODEL_UNSUPPORTED: 422,
    SOURCE_IMAGE_NOT_FOUND: 404,
  };
  const candidate = Number(error?.status || statusByCode[error?.code] || defaultStatus);
  const status = candidate >= 400 && candidate <= 599 ? candidate : defaultStatus;
  if (status >= 500) console.error('[Detail Stitch]', error);
  return res.status(status).json({
    error: error?.message || fallback,
    ...(error?.code ? { code: error.code } : {}),
  });
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function requiredString(value, message) {
  const result = String(value || '').trim();
  if (!result) throw badRequest(message);
  return result;
}

router.post('/detail-stitch/stitch', async (req, res) => {
  try {
    const workflowId = requiredString(req.body?.workflowId, '缺少 workflowId');
    const controllerNodeId = requiredString(req.body?.controllerNodeId, '缺少详情复刻节点');
    const provider = requestProvider(req.body?.imageModel);
    const sources = Array.isArray(req.body?.sources) ? req.body.sources : [];
    if (sources.length === 0) throw badRequest('请先导入竞品详情图');
    const context = requestContext(req.app.locals);
    const storage = getDetailStitchStorage(workflowId, context.dirs);
    const normalizedSources = sources.map((source, index) => {
      const url = requiredString(source?.url, `第 ${index + 1} 张竞品图缺少路径`);
      const filePath = resolveDetailStitchImagePath(url, {
        libraryDir: context.libraryDir,
        projectRoot: storage.projectRoot,
      });
      if (!filePath) {
        const error = new Error(`第 ${index + 1} 张竞品图不在当前素材库中`);
        error.code = 'SOURCE_IMAGE_NOT_FOUND';
        throw error;
      }
      return {
        nodeId: requiredString(source?.nodeId, `第 ${index + 1} 张竞品图缺少节点 ID`),
        url,
        filePath,
      };
    });
    if (new Set(normalizedSources.map(source => source.nodeId)).size !== normalizedSources.length) {
      throw badRequest('竞品详情图节点不能重复');
    }
    const stitchId = `stitch_${crypto.randomUUID()}`;
    const filename = `${stitchId}_full.png`;
    const outputPath = path.join(storage.imageTarget.targetDir, filename);
    const stitched = await stitchDetailImages({
      sources: normalizedSources,
      outputPath,
      temporaryDir: path.join(storage.jobsDir, `.tmp-${stitchId}`),
    });
    const now = new Date().toISOString();
    const record = writeDetailStitchRecord({
      schemaVersion: DETAIL_STITCH_SCHEMA_VERSION,
      stitchId,
      workflowId,
      controllerNodeId,
      imageModel: provider.id,
      createdAt: now,
      updatedAt: now,
      widthPolicy: 'scale-to-mode',
      canvasWidth: stitched.canvasWidth,
      canvasHeight: stitched.canvasHeight,
      fullImageUrl: detailStitchImageUrl(storage.imageTarget, filename),
      widthAdjustedCount: stitched.widthAdjustedCount,
      sources: stitched.sources,
      candidates: [],
      cuts: [],
      slices: [],
    }, context.dirs);
    return res.status(201).json(record);
  } catch (error) {
    return sendError(res, error, '竞品详情图拼接失败', 500);
  }
});

router.post('/detail-stitch/plan', async (req, res) => {
  try {
    const workflowId = requiredString(req.body?.workflowId, '缺少 workflowId');
    const stitchId = requiredString(req.body?.stitchId, '缺少 stitchId');
    const context = requestContext(req.app.locals);
    const record = readDetailStitchRecord(workflowId, stitchId, context.dirs);
    if (!record) {
      const error = new Error('拼接任务不存在');
      error.code = 'STITCH_NOT_FOUND';
      throw error;
    }
    const provider = requestProvider(req.body?.imageModel || record.imageModel);
    const fullImagePath = resolveDetailStitchImagePath(record.fullImageUrl, {
      libraryDir: context.libraryDir,
    });
    if (!fullImagePath) {
      const error = new Error('拼接长图已丢失');
      error.code = 'SOURCE_IMAGE_NOT_FOUND';
      throw error;
    }
    const candidates = await detectDetailSections(fullImagePath);
    const plan = planDetailSlices({
      canvasWidth: record.canvasWidth,
      canvasHeight: record.canvasHeight,
      candidates,
      supportedAspectRatios: provider.supportedAspectRatios,
    });
    const next = writeDetailStitchRecord({
      ...record,
      imageModel: provider.id,
      candidates,
      cuts: plan.cuts,
      slices: plan.slices,
      targetHeights: plan.targetHeights,
      preferredTargetHeight: plan.preferredTargetHeight,
    }, context.dirs);
    return res.json(next);
  } catch (error) {
    return sendError(res, error, '智能识别切割点失败', 500);
  }
});

router.post('/detail-stitch/slice', async (req, res) => {
  try {
    const workflowId = requiredString(req.body?.workflowId, '缺少 workflowId');
    const stitchId = requiredString(req.body?.stitchId, '缺少 stitchId');
    const context = requestContext(req.app.locals);
    const record = readDetailStitchRecord(workflowId, stitchId, context.dirs);
    if (!record) {
      const error = new Error('拼接任务不存在');
      error.code = 'STITCH_NOT_FOUND';
      throw error;
    }
    const provider = requestProvider(req.body?.imageModel || record.imageModel);
    let cuts;
    try {
      cuts = normalizeDetailStitchCuts(req.body?.cuts, record.canvasHeight);
    } catch (error) {
      error.status = 400;
      throw error;
    }
    const nodeIds = Array.isArray(req.body?.nodeIds)
      ? req.body.nodeIds.map(value => String(value || '').trim())
      : [];
    if (nodeIds.some(value => !value) || new Set(nodeIds).size !== nodeIds.length) {
      throw badRequest('新切片节点 ID 无效或重复');
    }
    if (nodeIds.length !== cuts.length + 1) {
      throw badRequest('新切片节点数量与切片方案不一致');
    }
    const storage = getDetailStitchStorage(workflowId, context.dirs);
    const fullImagePath = resolveDetailStitchImagePath(record.fullImageUrl, {
      libraryDir: context.libraryDir,
    });
    if (!fullImagePath) {
      const error = new Error('拼接长图已丢失');
      error.code = 'SOURCE_IMAGE_NOT_FOUND';
      throw error;
    }
    const slices = await sliceDetailImage({
      record,
      fullImagePath,
      imageTarget: storage.imageTarget,
      cuts,
      supportedAspectRatios: provider.supportedAspectRatios,
      nodeIds,
    });
    const next = writeDetailStitchRecord({
      ...record,
      imageModel: provider.id,
      cuts,
      slices,
    }, context.dirs);
    return res.json(next);
  } catch (error) {
    return sendError(res, error, '导出新竞品切片失败', 500);
  }
});

router.get('/detail-stitch/:stitchId', (req, res) => {
  try {
    const workflowId = requiredString(req.query.workflowId, '缺少 workflowId');
    const record = readDetailStitchRecord(
      workflowId,
      requiredString(req.params.stitchId, '缺少 stitchId'),
      requestContext(req.app.locals).dirs,
    );
    if (!record) return res.status(404).json({ error: '拼接任务不存在', code: 'STITCH_NOT_FOUND' });
    return res.json(record);
  } catch (error) {
    return sendError(res, error, '读取拼接任务失败', 500);
  }
});

export default router;
