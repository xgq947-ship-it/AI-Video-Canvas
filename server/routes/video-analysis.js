import express from 'express';
import { analyzeVideoAnalysisNode } from '../services/videoAnalysisService.js';

const router = express.Router();

function requestContext(req) {
  return {
    libraryDir: req.app.locals.LIBRARY_DIR,
    projectsDir: req.app.locals.PROJECTS_DIR,
    workflowsDir: req.app.locals.WORKFLOWS_DIR,
  };
}

function sendError(res, error) {
  const status = Number(error?.status);
  const safeStatus = status >= 400 && status <= 599 ? status : 500;
  if (safeStatus >= 500) console.error('[Video Analysis]', error);
  res.status(safeStatus).json({
    error: error?.message || '视频分析失败',
    code: error?.code || 'VIDEO_ANALYSIS_FAILED',
    retryable: error?.retryable !== false,
    authRequired: ['AUTH_EXPIRED', 'RECAPTCHA_REQUIRED'].includes(error?.code),
  });
}

router.post('/analyze', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await analyzeVideoAnalysisNode({
      workflowId: String(body.workflowId || ''),
      nodeId: String(body.nodeId || ''),
      sourceUrl: String(body.sourceUrl || ''),
      title: body.title ? String(body.title) : undefined,
      referenceImages: body.referenceImages,
    }, requestContext(req));
    res.json({ success: true, ...result });
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
