import express from 'express';

import {
  cancelDetailRemixJob,
  composeDetailRemixProducts,
  createDetailRemixJob,
  dismissDetailRemixResultNodes,
  getDetailRemixExportManifest,
  getDetailRemixJob,
  getLatestDetailRemixJob,
  retryFailedDetailRemixPages,
} from '../services/detailRemixJobs.js';

const router = express.Router();

function requestContext(appLocals) {
  return {
    dirs: {
      workflowsDir: appLocals.WORKFLOWS_DIR,
      projectsDir: appLocals.PROJECTS_DIR,
    },
    libraryDir: appLocals.LIBRARY_DIR,
    codexJobsDir: appLocals.CODEX_IMAGE_JOBS_DIR,
    codexAutomation: appLocals.CODEX_IMAGE_AUTOMATION,
    recognitionModel: appLocals.PROMPT_OPTIMIZER_PROVIDER === 'codex-cli'
      ? (appLocals.PROMPT_OPTIMIZER_MODEL || 'gpt-5.6-luna')
      : 'gpt-5.6-luna',
  };
}

function sendError(res, error, fallback, defaultStatus = 400) {
  const statusByCode = {
    PROJECT_REQUIRED: 400,
    PROJECT_NOT_FOUND: 404,
    AUTH_EXPIRED: 401,
    RECAPTCHA_REQUIRED: 401,
    WAF_BLOCKED: 403,
    QUOTA_EXHAUSTED: 402,
    RATE_LIMIT: 429,
    CONTENT_POLICY: 422,
  };
  const candidate = Number(error?.status || statusByCode[error?.code] || defaultStatus);
  const status = candidate >= 400 && candidate <= 599 ? candidate : defaultStatus;
  if (status >= 500) console.error('[Detail Remix]', error);
  return res.status(status).json({
    error: error?.message || fallback,
    ...(error?.code ? { code: error.code } : {}),
    ...(typeof error?.submitted === 'boolean' ? { submitted: error.submitted } : {}),
    ...(typeof error?.retryable === 'boolean' ? { retryable: error.retryable } : {}),
  });
}

function isTrustedDesktopRequest(req) {
  return Boolean(
    process.env.EVAN_DESKTOP_TOKEN
    && req.get('X-Evan-Desktop-Token') === process.env.EVAN_DESKTOP_TOKEN
  );
}

function codexUnavailableResponse(req) {
  const usesCodexRecognition = req.body?.recognitionProvider === 'codex-cli';
  const usesCodexImage = req.body?.imageModel === 'codex-imagegen';
  if (!usesCodexRecognition && !usesCodexImage) return null;
  const status = req.app.locals.CODEX_INTEGRATION?.getStatus?.();
  const basicReady = status?.available && status.authenticated;
  const imageBridgeReady = !usesCodexImage || (status?.skillInstalled && status.queueBridgeReady);
  if (basicReady && imageBridgeReady) return null;
  return {
    status: status?.available ? (status.authenticated ? 503 : 401) : 503,
    error: !status?.available
      ? '未检测到 Codex CLI，请先在设置 → Codex 服务中完成配置'
      : !status.authenticated
        ? 'Codex 尚未登录，请先在设置 → Codex 服务中登录 ChatGPT'
        : 'Codex 生图桥接尚未准备完成，请重启 Evan 后重试',
  };
}

router.post('/detail-remix-jobs', (req, res) => {
  try {
    const unavailable = codexUnavailableResponse(req);
    if (unavailable) return res.status(unavailable.status).json({ error: unavailable.error });
    const job = createDetailRemixJob(req.body || {}, requestContext(req.app.locals));
    return res.status(202).json(job);
  } catch (error) {
    return sendError(res, error, '无法创建商品详情复刻任务');
  }
});

router.get('/detail-remix-jobs/latest', (req, res) => {
  try {
    const workflowId = String(req.query.workflowId || '');
    const nodeId = String(req.query.nodeId || '');
    if (!workflowId || !nodeId) return res.status(400).json({ error: '缺少 workflowId 或 nodeId' });
    const job = getLatestDetailRemixJob(nodeId, workflowId, requestContext(req.app.locals));
    if (!job) return res.status(404).json({ error: '该节点尚无商品详情复刻任务' });
    return res.json(job);
  } catch (error) {
    return sendError(res, error, '读取最新商品详情复刻任务失败', 500);
  }
});

router.get('/detail-remix-jobs/:jobId', (req, res) => {
  try {
    const workflowId = String(req.query.workflowId || '');
    if (!workflowId) return res.status(400).json({ error: '缺少 workflowId' });
    const job = getDetailRemixJob(req.params.jobId, workflowId, requestContext(req.app.locals));
    if (!job) return res.status(404).json({ error: '商品详情复刻任务不存在' });
    return res.json(job);
  } catch (error) {
    return sendError(res, error, '读取商品详情复刻任务失败', 500);
  }
});

router.get('/detail-remix-jobs/:jobId/export-manifest', (req, res) => {
  if (!isTrustedDesktopRequest(req)) {
    return res.status(403).json({ error: '详情图导出必须通过桌面应用选择位置' });
  }
  try {
    const workflowId = String(req.query.workflowId || '');
    if (!workflowId) return res.status(400).json({ error: '缺少 workflowId' });
    const manifest = getDetailRemixExportManifest(
      req.params.jobId,
      workflowId,
      requestContext(req.app.locals)
    );
    if (!manifest) return res.status(404).json({ error: '商品详情复刻任务不存在' });
    return res.json(manifest);
  } catch (error) {
    return sendError(res, error, '无法准备详情图导出清单');
  }
});

router.post('/detail-remix-jobs/:jobId/compose-products', (req, res) => {
  try {
    const workflowId = String(req.body?.workflowId || '');
    if (!workflowId) return res.status(400).json({ error: '缺少 workflowId' });
    const job = composeDetailRemixProducts(
      req.params.jobId,
      workflowId,
      req.body || {},
      requestContext(req.app.locals)
    );
    if (!job) return res.status(404).json({ error: '商品详情复刻任务不存在' });
    return res.status(202).json(job);
  } catch (error) {
    return sendError(res, error, '无法开始产品合成');
  }
});

router.post('/detail-remix-jobs/:jobId/retry-failed', (req, res) => {
  try {
    const workflowId = String(req.body?.workflowId || '');
    if (!workflowId) return res.status(400).json({ error: '缺少 workflowId' });
    const unavailable = codexUnavailableResponse(req);
    if (unavailable) return res.status(unavailable.status).json({ error: unavailable.error });
    const job = retryFailedDetailRemixPages(
      req.params.jobId,
      workflowId,
      req.body || {},
      requestContext(req.app.locals)
    );
    if (!job) return res.status(404).json({ error: '商品详情复刻任务不存在' });
    return res.status(202).json(job);
  } catch (error) {
    return sendError(res, error, '无法重试失败详情页');
  }
});

router.post('/detail-remix-jobs/:jobId/cancel', (req, res) => {
  try {
    const workflowId = String(req.body?.workflowId || '');
    if (!workflowId) return res.status(400).json({ error: '缺少 workflowId' });
    const job = cancelDetailRemixJob(
      req.params.jobId,
      workflowId,
      requestContext(req.app.locals)
    );
    if (!job) return res.status(404).json({ error: '商品详情复刻任务不存在' });
    return res.json(job);
  } catch (error) {
    return sendError(res, error, '取消商品详情复刻任务失败');
  }
});

router.post('/detail-remix-jobs/dismiss-results', (req, res) => {
  try {
    const workflowId = String(req.body?.workflowId || '');
    if (!workflowId) return res.status(400).json({ error: '缺少 workflowId' });
    const nodeIds = Array.isArray(req.body?.nodeIds) ? req.body.nodeIds : [];
    return res.json(dismissDetailRemixResultNodes(
      nodeIds,
      workflowId,
      requestContext(req.app.locals)
    ));
  } catch (error) {
    return sendError(res, error, '标记商品详情结果删除失败', 500);
  }
});

export default router;
