import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createJob, getJob, cancelJob, _reset } from '../server/services/renderJobs.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-'));
const libraryDir = tmp;
const rendersDir = path.join(tmp, 'renders');

// 用一个「结构非法」的清单：createJob 同步返回 queued，异步任务会在校验阶段快速失败，
// 因此不会触发真正的 Remotion 渲染（不产生付费/重负载）。
const badManifest = {
  project: { id: 'p1', title: '锁测试' },
  composition: { width: 1280, height: 720, fps: 24 },
  shots: [],
  audioTracks: [],
};

test('同一项目只允许一个进行中的渲染任务（单项目锁）', () => {
  _reset();
  const r1 = createJob({ manifest: badManifest, libraryDir, rendersDir });
  assert.ok(r1.job, '首个任务应创建成功');
  assert.equal(r1.job.status, 'queued');

  // 同步再次提交（此时首个任务仍为 queued）→ 应 409
  const r2 = createJob({ manifest: badManifest, libraryDir, rendersDir });
  assert.equal(r2.code, 409);
  assert.ok(r2.existing);
  assert.equal(r2.existing.jobId, r1.job.jobId);
});

test('不同项目可并行创建任务', () => {
  _reset();
  const a = createJob({ manifest: { ...badManifest, project: { id: 'A', title: 'A' } }, libraryDir, rendersDir });
  const b = createJob({ manifest: { ...badManifest, project: { id: 'B', title: 'B' } }, libraryDir, rendersDir });
  assert.ok(a.job && b.job);
  assert.notEqual(a.job.jobId, b.job.jobId);
});

test('getJob 未知任务返回 null；cancel 未知任务 404', () => {
  _reset();
  assert.equal(getJob('nope'), null);
  const r = cancelJob('nope');
  assert.equal(r.code, 404);
});

test('取消进行中的任务 → 状态变为 cancelled', () => {
  _reset();
  const r = createJob({ manifest: badManifest, libraryDir, rendersDir });
  const c = cancelJob(r.job.jobId);
  assert.ok(c.ok);
  assert.equal(c.job.status, 'cancelled');
  // 取消后不能再次取消
  const c2 = cancelJob(r.job.jobId);
  assert.equal(c2.code, 400);
});

test.after(() => { _reset(); });
