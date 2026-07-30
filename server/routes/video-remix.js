import express from 'express';

import {
  copyCanvasVideoAsReference,
  resolveReferenceVideoFromUrl,
  saveReferenceVideoStream,
} from '../services/videoRemix/referenceVideo.js';

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
  const status = Number(error?.status);
  const safeStatus = status >= 400 && status <= 599 ? status : 500;
  if (safeStatus >= 500) {
    console.error('[Video Remix Reference]', error);
  }
  res.status(safeStatus).json({
    error: error?.message || '参考视频处理失败',
    code: error?.code || 'REFERENCE_VIDEO_FAILED',
  });
}

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
