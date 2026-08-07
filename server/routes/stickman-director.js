import express from 'express';
import { createJob, getJob, cancelJob } from '../services/renderJobs.js';
import {
  buildStickmanMergeManifest,
  listStickmanDirectorModels,
  runStickmanDirector,
} from '../services/stickmanDirector.js';
import { resolveProjectMediaTarget } from '../utils/projectAssets.js';
import { requireFeature } from '../services/licenseGuard.js';
import { FEATURE_KEYS } from '../../shared/licenseFeatures.js';

const router = express.Router();

router.get('/skills/stickman-video-director/models', (req, res) => {
  res.json({ models: listStickmanDirectorModels(req.app) });
});

// 火柴人导演是本期高级节点（导演工作流），执行前必须再次校验——不可绕过（文档 §13）。
router.post('/skills/stickman-video-director/run', requireFeature(FEATURE_KEYS.DIRECTOR_WORKFLOW), async (req, res) => {
  try {
    const body = req.body || {};
    const provider = body.model?.provider || body.provider || 'auto';
    if (provider === 'deepseek' && !req.app.locals.DEEPSEEK_API_KEY) {
      return res.status(400).json({ error: '未配置 DEEPSEEK_API_KEY，请先在 API 密钥设置中添加 DeepSeek API Key' });
    }
    const result = await runStickmanDirector({
      sourceType: body.sourceType,
      input: body.input,
      settings: body.settings,
      provider,
      allowFallback: body.allowFallback !== false,
      apiKey: req.app.locals.DEEPSEEK_API_KEY,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[Stickman Director] run failed:', error);
    res.status(error?.status || 502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// 这个接口被两种节点共用：免费的「Video Merge」和「Cinematic Video Merge」。
// 两者都只是把已经生成好的镜头用本地 ffmpeg 拼成一条成片，不调用云端模型、不产生
// 新内容——属于文档 §14.4 明确允许试用到期后继续使用的“导出已有文件”，所以这里
// 不设权限守卫（见 shared/nodeFeatures.js 顶部注释）。
router.post('/videos/merge', (req, res) => {
  try {
    const body = req.body || {};
    if (!body.workflowId) return res.status(400).json({ error: '缺少 workflowId' });
    const manifest = buildStickmanMergeManifest({
      workflowId: body.workflowId,
      title: body.title,
      shots: body.shots,
      width: body.width,
      height: body.height,
      fps: body.fps,
      skipFailed: body.skipFailed !== false,
    });
    const target = resolveProjectMediaTarget(body.workflowId, 'videos', {
      workflowsDir: req.app.locals.WORKFLOWS_DIR,
      projectsDir: req.app.locals.PROJECTS_DIR,
    });
    const result = createJob({
      manifest,
      libraryDir: req.app.locals.LIBRARY_DIR,
      rendersDir: target.targetDir,
      outputUrlPrefix: target.urlPrefix,
    });
    if (result.error) return res.status(result.code || 500).json({ error: result.error, existing: result.existing });
    res.status(202).json({ success: true, job: result.job });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

router.get('/videos/merge/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: '拼接任务不存在' });
  res.json(job);
});

router.post('/videos/merge/:jobId/cancel', (req, res) => {
  const result = cancelJob(req.params.jobId);
  if (result.error) return res.status(result.code || 400).json({ error: result.error });
  res.json(result.job);
});

export default router;
