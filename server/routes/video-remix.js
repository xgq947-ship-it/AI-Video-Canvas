import express from 'express';

import {
  copyCanvasVideoAsReference,
  resolveReferenceVideoFromUrl,
  saveReferenceVideoStream,
} from '../services/videoRemix/referenceVideo.js';
import {
  preprocessReferenceVideo,
  updateVideoRemixShotTimeline,
} from '../services/videoRemix/shotPreprocessing.js';
import {
  analyzeVideoRemixGlobal,
  analyzeVideoRemixShot,
  loadVideoRemixAnalysisSnapshot,
} from '../services/videoRemix/videoAnalysis.js';
import {
  calibrateVideoRemixShot,
} from '../services/videoRemix/shotVideo.js';

const router = express.Router();

function requestContext(req) {
  return {
    libraryDir: req.app.locals.LIBRARY_DIR,
    projectsDir: req.app.locals.PROJECTS_DIR,
    workflowsDir: req.app.locals.WORKFLOWS_DIR,
  };
}

function decodeHeader(value) {
  if (!value) return '';
  try {
    return decodeURIComponent(String(value));
  } catch {
    return String(value);
  }
}

function sendError(res, error) {
  const statusByCode = {
    AUTH_EXPIRED: 401,
    RECAPTCHA_REQUIRED: 401,
    RATE_LIMIT: 429,
    QUOTA_EXHAUSTED: 402,
    CONTENT_POLICY: 422,
  };
  const status = Number(error?.status || statusByCode[error?.code]);
  const safeStatus = status >= 400 && status <= 599 ? status : 500;
  if (safeStatus >= 500) {
    console.error('[Video Remix]', error);
  }
  res.status(safeStatus).json({
    error: error?.message || '参考视频处理失败',
    code: error?.code || 'REFERENCE_VIDEO_FAILED',
    retryable: error?.retryable !== false,
    authRequired: ['AUTH_EXPIRED', 'RECAPTCHA_REQUIRED'].includes(error?.code),
  });
}

router.post('/analysis/global', async (req, res) => {
  try {
    const {
      workflowId,
      remixId,
      source,
      shots,
      mode,
    } = req.body || {};
    const global = await analyzeVideoRemixGlobal({
      workflowId: String(workflowId || ''),
      remixId: String(remixId || ''),
      source,
      shots,
      mode,
    }, requestContext(req));
    res.json({ success: true, global });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/analysis/shot', async (req, res) => {
  try {
    const {
      workflowId,
      remixId,
      source,
      shots,
      shotId,
      mode,
      analysisKey,
    } = req.body || {};
    const result = await analyzeVideoRemixShot({
      workflowId: String(workflowId || ''),
      remixId: String(remixId || ''),
      source,
      shots,
      shotId: String(shotId || ''),
      mode,
      analysisKey,
    }, requestContext(req));
    res.json({ success: true, ...result });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/analysis/restore', async (req, res) => {
  try {
    const {
      workflowId,
      remixId,
      source,
      shots,
      mode,
      analysisKey,
    } = req.body || {};
    const snapshot = await loadVideoRemixAnalysisSnapshot({
      workflowId: String(workflowId || ''),
      remixId: String(remixId || ''),
      source,
      shots,
      mode,
      analysisKey,
    }, requestContext(req));
    res.json({ success: true, snapshot });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/preprocess', async (req, res) => {
  try {
    const {
      workflowId,
      remixId,
      source,
      threshold,
    } = req.body || {};
    const result = await preprocessReferenceVideo({
      workflowId: String(workflowId || ''),
      remixId: String(remixId || ''),
      source,
      threshold,
    }, requestContext(req));
    res.json({ success: true, ...result });
  } catch (error) {
    sendError(res, error);
  }
});

router.put('/shots', async (req, res) => {
  try {
    const {
      workflowId,
      remixId,
      source,
      cutPoints,
      previousShots,
    } = req.body || {};
    const result = await updateVideoRemixShotTimeline({
      workflowId: String(workflowId || ''),
      remixId: String(remixId || ''),
      source,
      cutPoints,
      previousShots,
    }, requestContext(req));
    res.json({ success: true, ...result });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/videos/calibrate', async (req, res) => {
  try {
    const {
      workflowId,
      remixId,
      shotId,
      sourceUrl,
      targetDuration,
      trimStart,
    } = req.body || {};
    const result = await calibrateVideoRemixShot({
      workflowId: String(workflowId || ''),
      remixId: String(remixId || ''),
      shotId: String(shotId || ''),
      sourceUrl: String(sourceUrl || ''),
      targetDuration: Number(targetDuration),
      trimStart: Number(trimStart) || 0,
    }, requestContext(req));
    res.json({ success: true, ...result });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/reference/import', async (req, res) => {
  try {
    const workflowId = decodeHeader(req.get('x-evan-workflow-id'));
    const remixId = decodeHeader(req.get('x-evan-remix-id'));
    const originalFilename = decodeHeader(req.get('x-evan-filename'));
    const source = await saveReferenceVideoStream(req, {
      workflowId,
      remixId,
      originalFilename,
      mimeType: req.get('content-type'),
      contentLength: req.get('content-length'),
    }, requestContext(req));
    res.json({ success: true, source });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/reference/resolve', async (req, res) => {
  try {
    const { workflowId, remixId, input } = req.body || {};
    const source = await resolveReferenceVideoFromUrl({
      workflowId: String(workflowId || ''),
      remixId: String(remixId || ''),
      input: String(input || ''),
    }, requestContext(req));
    res.json({ success: true, source });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/reference/canvas', async (req, res) => {
  try {
    const { workflowId, remixId, sourceUrl, title } = req.body || {};
    const source = await copyCanvasVideoAsReference({
      workflowId: String(workflowId || ''),
      remixId: String(remixId || ''),
      sourceUrl: String(sourceUrl || ''),
      title: title ? String(title) : undefined,
    }, requestContext(req));
    res.json({ success: true, source });
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
