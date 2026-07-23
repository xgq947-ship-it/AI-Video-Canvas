import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createProductSceneJob, getLatestProductSceneJob, getProductSceneJob } from '../server/services/productSceneJobs.js';

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'product-scene-job-'));
  const workflowsDir = path.join(root, 'workflows');
  const projectsDir = path.join(root, 'projects');
  fs.mkdirSync(workflowsDir, { recursive: true });
  fs.mkdirSync(projectsDir, { recursive: true });
  fs.writeFileSync(path.join(workflowsDir, 'workflow-1.json'), JSON.stringify({
    id: 'workflow-1', title: '测试项目', nodes: [], groups: [], projectDirName: '测试项目_workflow'
  }));
  return { root, dirs: { workflowsDir, projectsDir } };
};

const waitForTerminalJob = async (jobId, context) => {
  for (let index = 0; index < 100; index += 1) {
    const job = getProductSceneJob(jobId, 'workflow-1', context);
    if (job?.status === 'completed' || job?.status === 'failed') return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('job did not reach terminal state');
};

const payload = {
  workflowId: 'workflow-1',
  nodeId: 'control-node',
  sceneImage: PIXEL,
  productImage: PIXEL,
  dimensions: { length: 22.5, width: 20, height: 13.7, unit: 'cm' },
  productCategory: '揉腹仪',
  preserveProductMarkings: true,
  personaBrief: '30 岁左右女性，短发',
  imageModel: 'google-flow-nano-banana-pro',
  aspectRatio: '3:4',
};

test('产品场景任务一次识别两张图、持久化阶段并输出独立图片素材', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  let recognitionRequest;
  let generationRequest;
  const context = {
    dirs: env.dirs,
    libraryDir: env.root,
    recognitionModel: 'gpt-5.6-sol',
    runRecognition: async request => {
      recognitionRequest = request;
      return JSON.stringify({
        sceneSpec: '人物手持产品的室内场景',
        personaSpec: '25-30 岁女性，中长发，浅灰家居服',
        compositionSpec: '半身入画，产品贴在腹部由双手扶住，占画面约三成',
        productSpec: '白色圆形揉腹仪与灰色绑带',
      });
    },
    generateImage: async request => {
      generationRequest = request;
      return { buffer: Buffer.from('generated-image'), extension: 'png' };
    },
  };

  const created = createProductSceneJob(payload, context);
  const completed = await waitForTerminalJob(created.id, context);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.stage, 'completed');
  assert.equal(completed.recognitionModel, 'gpt-5.6-sol');
  assert.match(completed.prompt, /产品类别：揉腹仪/);
  assert.match(completed.prompt, /构图与姿势：半身入画/);
  assert.match(completed.prompt, /人物设定以此为准.*30 岁左右女性，短发/);
  assert.match(recognitionRequest.systemInstruction, /personaSpec 规则/);
  assert.match(recognitionRequest.systemInstruction, /compositionSpec 规则/);
  // 竞品场景图只用于识图，绝不能进生图模型——一旦进去，成图里的人就是原视频那个人。
  assert.deepEqual(recognitionRequest.imageDataUrls.length, 2);
  assert.deepEqual(generationRequest.referenceImageInputs, [PIXEL]);
  assert.equal(completed.personaAnalysis, '25-30 岁女性，中长发，浅灰家居服');
  assert.match(completed.resultUrl, /\/images\/img_/);
  assert.ok(fs.existsSync(path.join(env.dirs.projectsDir, '测试项目_workflow', 'images', `${completed.resultNodeId}.json`)));
  assert.ok(fs.existsSync(path.join(env.dirs.projectsDir, '测试项目_workflow', '.jobs', 'product-scene', `${completed.id}.json`)));
});

test('Google Flow 失败后重试复用已完成的 Codex 分析', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  let recognitionCalls = 0;
  let generationCalls = 0;
  const context = {
    dirs: env.dirs,
    libraryDir: env.root,
    runRecognition: async () => {
      recognitionCalls += 1;
      return JSON.stringify({
        sceneSpec: '卧室场景',
        personaSpec: '通用女性形象',
        compositionSpec: '半身入画，产品在腹部',
        productSpec: '白色揉腹仪',
      });
    },
    generateImage: async () => {
      generationCalls += 1;
      if (generationCalls === 1) throw new Error('Google Flow 页面中断');
      return { buffer: Buffer.from('retry-result'), extension: 'png' };
    },
  };

  const first = createProductSceneJob(payload, context);
  const failed = await waitForTerminalJob(first.id, context);
  assert.equal(failed.status, 'failed');
  assert.equal(recognitionCalls, 1);

  const retry = createProductSceneJob({ ...payload, retryJobId: failed.id }, context);
  const completed = await waitForTerminalJob(retry.id, context);
  assert.equal(completed.status, 'completed');
  assert.equal(recognitionCalls, 1);
  assert.equal(generationCalls, 2);
});

test('客户端预分配任务 ID 可幂等创建，最新任务可用于页面恢复', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  let recognitionCalls = 0;
  let generationCalls = 0;
  const context = {
    dirs: env.dirs,
    libraryDir: env.root,
    runRecognition: async () => {
      recognitionCalls += 1;
      return JSON.stringify({
        sceneSpec: '固定场景',
        personaSpec: '通用女性形象',
        compositionSpec: '固定构图',
        productSpec: '我方产品',
      });
    },
    generateImage: async () => {
      generationCalls += 1;
      return { buffer: Buffer.from('idempotent-result'), extension: 'png' };
    },
  };
  const jobId = '9ee207c9-c187-4e49-95c7-c0048c363a20';
  const created = createProductSceneJob({ ...payload, jobId }, context);
  const completed = await waitForTerminalJob(created.id, context);
  const repeated = createProductSceneJob({ ...payload, jobId }, context);
  const latest = getLatestProductSceneJob(payload.nodeId, payload.workflowId, context);

  assert.equal(completed.id, jobId);
  assert.equal(repeated.id, jobId);
  assert.equal(latest?.id, jobId);
  assert.equal(latest?.status, 'completed');
  assert.equal(recognitionCalls, 1);
  assert.equal(generationCalls, 1);
});
