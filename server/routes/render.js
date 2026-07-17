/**
 * server/routes/render.js
 *
 * 通用 Remotion 渲染任务 API。
 *   POST /api/render/remotion            提交渲染，返回 jobId
 *   GET  /api/render/remotion/:jobId     查询进度/状态
 *   POST /api/render/remotion/:jobId/cancel  取消
 *   GET  /api/render/remotion/:jobId/output  下载/预览成片
 *   POST /api/render/validate            仅校验清单与素材，不渲染
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { validateManifestShape } from '../../shared/manifest.js';
import { findMissingAssets } from '../utils/manifestAssets.js';
import { createJob, getJob, getJobRaw, cancelJob } from '../services/renderJobs.js';

const router = express.Router();

const getDirs = (req) => {
  const libraryDir = req.app.locals.LIBRARY_DIR;
  const rendersDir = path.join(libraryDir, 'renders');
  fs.mkdirSync(rendersDir, { recursive: true });
  return { libraryDir, rendersDir };
};

// 校验清单（结构 + 素材存在性），不启动渲染
router.post('/validate', (req, res) => {
  const { manifest } = req.body || {};
  const shape = validateManifestShape(manifest);
  const { libraryDir } = getDirs(req);
  const missing = shape.valid ? findMissingAssets(libraryDir, manifest) : [];
  res.json({ valid: shape.valid && missing.length === 0, errors: shape.errors, missing });
});

// 提交渲染
router.post('/remotion', (req, res) => {
  const { manifest } = req.body || {};
  const shape = validateManifestShape(manifest);
  if (!shape.valid) {
    return res.status(400).json({ error: '清单校验失败', errors: shape.errors });
  }
  const { libraryDir, rendersDir } = getDirs(req);
  const missing = findMissingAssets(libraryDir, manifest);
  if (missing.length > 0) {
    return res.status(400).json({ error: '缺失素材', missing });
  }
  const result = createJob({ manifest, libraryDir, rendersDir });
  if (result.error) {
    return res.status(result.code || 500).json({ error: result.error, existing: result.existing });
  }
  res.json(result.job);
});

// 查询进度
router.get('/remotion/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: '任务不存在' });
  res.json(job);
});

// 取消
router.post('/remotion/:jobId/cancel', (req, res) => {
  const result = cancelJob(req.params.jobId);
  if (result.error) return res.status(result.code || 500).json({ error: result.error });
  res.json(result.job);
});

// 下载/预览成片
router.get('/remotion/:jobId/output', (req, res) => {
  const job = getJobRaw(req.params.jobId);
  if (!job) return res.status(404).json({ error: '任务不存在' });
  if (job.status !== 'success' || !job.outputPath || !fs.existsSync(job.outputPath)) {
    return res.status(409).json({ error: '成片尚不可用', status: job.status });
  }
  res.sendFile(path.resolve(job.outputPath));
});

// 在 Finder / 文件管理器中显示成片（参数数组调用，不拼接 shell）
router.post('/remotion/:jobId/reveal', (req, res) => {
  const job = getJobRaw(req.params.jobId);
  if (!job || !job.outputPath || !fs.existsSync(job.outputPath)) {
    return res.status(404).json({ error: '成片不存在' });
  }
  const target = path.resolve(job.outputPath);
  const command = process.platform === 'darwin'
    ? '/usr/bin/open'
    : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
  const args = process.platform === 'darwin'
    ? ['-R', target]
    : process.platform === 'win32' ? ['/select,', target] : [path.dirname(target)];

  // spawn 的错误是异步事件，必须等命令真实执行完再向前端报告成功。
  const child = spawn(command, args, { stdio: 'ignore' });
  let replied = false;
  const fail = (message) => {
    if (replied) return;
    replied = true;
    res.status(500).json({ error: '无法在文件管理器中显示成片', detail: message });
  };

  child.once('error', (error) => fail(error.message));
  child.once('exit', (code, signal) => {
    if (replied) return;
    if (code !== 0) {
      fail(signal ? `命令被信号 ${signal} 中止` : `命令退出码 ${code}`);
      return;
    }
    replied = true;
    res.json({ ok: true, path: target });
  });
});

export default router;
