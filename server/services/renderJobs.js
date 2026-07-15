/**
 * server/services/renderJobs.js
 *
 * 渲染任务管理（内存态，非阻塞）。
 * - 同一 projectId 默认只允许一个进行中的渲染任务。
 * - 任务异步执行，前端通过轮询 getJob 获取进度/状态。
 * - 保存 stage / progress / stdout+stderr 日志 / 退出结果 / 输出路径。
 */
import crypto from 'crypto';
import path from 'path';
import { renderManifest } from './remotionRender.js';

/** @type {Map<string, any>} */
const jobs = new Map();
/** @type {Map<string, string>} projectId -> 当前活跃 jobId */
const activeByProject = new Map();

const ACTIVE = new Set(['queued', 'rendering']);
const MAX_LOG_LINES = 400;

const sanitizeName = (s) =>
  String(s || 'project')
    .replace(/[^\w一-龥-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'project';

const publicView = (job) => ({
  jobId: job.id,
  projectId: job.projectId,
  status: job.status,
  stage: job.stage,
  progress: job.progress,
  output: job.outputUrl,
  error: job.error,
  missing: job.missing,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  logs: job.logs.slice(-40),
});

export const getJob = (id) => {
  const job = jobs.get(id);
  return job ? publicView(job) : null;
};

export const getJobRaw = (id) => jobs.get(id) || null;

/**
 * 创建并启动一个渲染任务。
 * @param {object} opts
 * @param {any} opts.manifest
 * @param {string} opts.libraryDir  素材根目录（= publicDir）
 * @param {string} opts.rendersDir  成片输出目录
 * @returns {{job:any}|{error:string, code:number, existing?:any}}
 */
export const createJob = ({ manifest, libraryDir, rendersDir }) => {
  const projectId = (manifest && manifest.project && manifest.project.id) || 'default';

  // 单项目单任务
  const existingId = activeByProject.get(projectId);
  if (existingId) {
    const existing = jobs.get(existingId);
    if (existing && ACTIVE.has(existing.status)) {
      return { error: '该项目已有渲染任务在进行中', code: 409, existing: publicView(existing) };
    }
  }

  const id = crypto.randomUUID();
  const title = (manifest && manifest.project && manifest.project.title) || projectId;
  const fileName =
    (manifest && manifest.output && manifest.output.fileName) ||
    `${sanitizeName(title)}_${Date.now()}.mp4`;
  const outputPath = path.join(rendersDir, path.basename(fileName));

  const job = {
    id,
    projectId,
    status: 'queued',
    stage: 'queued',
    progress: 0,
    outputPath,
    outputUrl: null,
    error: null,
    missing: null,
    logs: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    canceller: null,
  };
  jobs.set(id, job);
  activeByProject.set(projectId, id);

  const pushLog = (line) => {
    job.logs.push(`[${new Date().toISOString()}] ${line}`);
    if (job.logs.length > MAX_LOG_LINES) job.logs.splice(0, job.logs.length - MAX_LOG_LINES);
  };

  // 异步执行，绝不阻塞路由
  (async () => {
    try {
      // Remotion 取消信号（动态载入重依赖）
      let cancelSignal;
      try {
        const { makeCancelSignal } = await import('@remotion/renderer');
        const c = makeCancelSignal();
        cancelSignal = c.cancelSignal;
        job.canceller = c.cancel;
      } catch (e) {
        pushLog('warn: 无法创建取消信号 ' + e.message);
      }

      job.status = 'rendering';
      job.updatedAt = new Date().toISOString();

      const res = await renderManifest({
        manifest,
        libraryDir,
        outputPath,
        cancelSignal,
        onProgress: ({ stage, progress }) => {
          job.stage = stage;
          job.progress = progress;
          job.updatedAt = new Date().toISOString();
        },
        onLog: pushLog,
      });

      job.status = 'success';
      job.stage = 'done';
      job.progress = 1;
      job.outputUrl = '/library/renders/' + path.basename(res.output);
      job.updatedAt = new Date().toISOString();
      pushLog('渲染成功: ' + job.outputUrl);
    } catch (err) {
      const cancelled = job.status === 'cancelled' || /cancel/i.test(err && err.message || '');
      job.status = cancelled ? 'cancelled' : 'failed';
      job.error = err && err.message ? err.message : String(err);
      if (err && err.missing) job.missing = err.missing;
      job.updatedAt = new Date().toISOString();
      pushLog((cancelled ? '已取消: ' : '失败: ') + job.error);
    } finally {
      if (activeByProject.get(projectId) === id) activeByProject.delete(projectId);
    }
  })();

  return { job: publicView(job) };
};

export const cancelJob = (id) => {
  const job = jobs.get(id);
  if (!job) return { error: '任务不存在', code: 404 };
  if (!ACTIVE.has(job.status)) return { error: `任务状态为 ${job.status}，无法取消`, code: 400 };
  job.status = 'cancelled';
  job.updatedAt = new Date().toISOString();
  if (typeof job.canceller === 'function') {
    try { job.canceller(); } catch { /* ignore */ }
  }
  return { ok: true, job: publicView(job) };
};

// 测试辅助：清空所有任务
export const _reset = () => { jobs.clear(); activeByProject.clear(); };
