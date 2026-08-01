import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createJob, getJob, cancelJob, pruneFinishedJobs, retainedJobCount, _reset } from '../server/services/renderJobs.js';

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
  const r1 = createJob({
    manifest: { ...badManifest, inputHash: 'timeline-hash-1' },
    libraryDir,
    rendersDir,
  });
  assert.ok(r1.job, '首个任务应创建成功');
  assert.equal(r1.job.status, 'queued');
  assert.equal(r1.job.inputHash, 'timeline-hash-1');

  // 同步再次提交（此时首个任务仍为 queued）→ 应 409
  const r2 = createJob({ manifest: badManifest, libraryDir, rendersDir });
  assert.equal(r2.code, 409);
  assert.ok(r2.existing);
  assert.equal(r2.existing.jobId, r1.job.jobId);
  assert.equal(r2.existing.inputHash, 'timeline-hash-1');
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

test('已结束的任务超过保留期后会被清掉（jobs Map 不再无界增长）', async () => {
  _reset();
  const job = createJob({ manifest: badManifest, libraryDir, rendersDir }).job;
  cancelJob(job.jobId);

  // 保留期内仍可查询：前端要靠轮询拿到最终状态。
  pruneFinishedJobs(Date.now());
  assert.ok(getJob(job.jobId), '刚结束的任务不能立刻清掉');

  // 超过 30 分钟之后清理。
  pruneFinishedJobs(Date.now() + 31 * 60_000);
  assert.equal(getJob(job.jobId), null);
  assert.equal(retainedJobCount(), 0);
});

test('短时间内大量渲染只保留最近若干条已结束任务', () => {
  _reset();
  for (let i = 0; i < 40; i += 1) {
    const job = createJob({
      manifest: { ...badManifest, project: { id: `p${i}`, title: `p${i}` } },
      libraryDir,
      rendersDir
    }).job;
    cancelJob(job.jobId);
  }

  pruneFinishedJobs(Date.now());
  assert.ok(retainedJobCount() <= 20, `已结束任务应被裁剪，实际 ${retainedJobCount()}`);
});

test('进行中的任务绝不会被清理掉', () => {
  _reset();
  const job = createJob({ manifest: badManifest, libraryDir, rendersDir }).job;
  assert.equal(job.status, 'queued');

  // 即使时间推得很远，进行中的任务也必须留着。
  pruneFinishedJobs(Date.now() + 24 * 60 * 60_000);
  assert.ok(getJob(job.jobId), '进行中的任务被误删会让前端永远等不到结果');
});

test.after(() => { _reset(); });
