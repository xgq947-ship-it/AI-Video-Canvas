import express from 'express';
import { resolveProjectMediaTarget } from '../utils/projectAssets.js';
import {
  cancelSubtitleVideoJob,
  createSubtitleVideoJob,
  getSubtitleVideoJob,
} from '../services/subtitleVideoJobs.js';

const router = express.Router();

router.post('/', (req, res) => {
  const { workflowId, sourceNodeId, resultNodeId, sourceVideoUrl } = req.body || {};
  if (!sourceNodeId || !resultNodeId || !sourceVideoUrl) {
    return res.status(400).json({ error: '缺少源视频或结果节点信息' });
  }
  let target;
  try {
    target = resolveProjectMediaTarget(workflowId, 'videos', {
      workflowsDir: req.app.locals.WORKFLOWS_DIR,
      projectsDir: req.app.locals.PROJECTS_DIR,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  const result = createSubtitleVideoJob({
    workflowId,
    sourceNodeId,
    resultNodeId,
    sourceVideoUrl,
    libraryDir: req.app.locals.LIBRARY_DIR,
    outputDir: target.targetDir,
    outputUrlPrefix: target.urlPrefix,
    openaiApiKey: req.app.locals.OPENAI_API_KEY,
  });
  if (result.error) return res.status(result.code || 500).json(result);
  res.json(result.job);
});

router.get('/:jobId', (req, res) => {
  const job = getSubtitleVideoJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: '自动字幕任务不存在' });
  res.json(job);
});

router.post('/:jobId/cancel', (req, res) => {
  const result = cancelSubtitleVideoJob(req.params.jobId);
  if (result.error) return res.status(result.code || 500).json(result);
  res.json(result.job);
});

export default router;
