import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';

import {
  __detailRemixTest,
  cancelDetailRemixJob,
  composeDetailRemixProducts,
  createDetailRemixJob,
  dismissDetailRemixResultNodes,
  getDetailRemixJob,
  getDetailRemixExportManifest,
  getLatestDetailRemixJob,
  retryFailedDetailRemixPages,
} from '../server/services/detailRemixJobs.js';
import {
  createCodexImageJob,
  getCodexImageJob,
  listCodexImageJobs,
} from '../server/services/codexImageJobs.js';

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const OWN_DETAIL = `${PIXEL.slice(0, -2)}AA`;
const COMPETITOR = `${PIXEL.slice(0, -2)}BB`;
const CHARACTER = `${PIXEL.slice(0, -2)}CC`;
const PRODUCT = `${PIXEL.slice(0, -2)}DD`;
const PRODUCT_2 = `${PIXEL.slice(0, -2)}EE`;

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detail-remix-job-'));
  const libraryDir = path.join(root, 'library');
  const workflowsDir = path.join(libraryDir, 'workflows');
  const projectsDir = path.join(libraryDir, 'projects');
  const codexJobsDir = path.join(libraryDir, 'codex-image-jobs');
  fs.mkdirSync(workflowsDir, { recursive: true });
  fs.mkdirSync(projectsDir, { recursive: true });
  fs.writeFileSync(path.join(workflowsDir, 'workflow-1.json'), JSON.stringify({
    id: 'workflow-1', title: '详情复刻测试', projectDirName: '详情复刻测试', nodes: [], groups: [],
  }));
  return {
    root,
    jobsDir: path.join(projectsDir, '详情复刻测试', '.jobs', 'detail-remix'),
    context: {
      dirs: { workflowsDir, projectsDir },
      libraryDir,
      codexJobsDir,
      recognitionModel: 'test-model',
      skipFinalValidation: true,
      applyTextOverlay: async () => {
        throw new Error('current detail-remix jobs must never use a local text/logo overlay');
      },
      matchDetailRemixDimensions: async ({ sourceBuffer }) => sourceBuffer,
    },
  };
}

function basePayload(overrides = {}) {
  return {
    workflowId: 'workflow-1',
    nodeId: 'detail-remix-node',
    jobId: 'detail-remix-fixed-job',
    ownDetails: [{ nodeId: 'own-node', imageUrl: OWN_DETAIL, order: 0 }],
    competitorDetails: [{
      nodeId: 'competitor-node', imageUrl: COMPETITOR, order: 0, sourceWidth: 600, sourceHeight: 800,
    }],
    productImages: [PRODUCT],
    productNodeIds: ['product-node'],
    characterReferenceImages: [CHARACTER],
    characterReferenceNodeIds: ['character-node'],
    useCharacterReference: true,
    recognitionProvider: 'gemini-web',
    imageModel: 'google-flow-nano-banana-pro',
    aspectRatio: '3:4',
    ...overrides,
  };
}

async function waitFor(jobId, context, predicate, message = 'job did not reach expected state') {
  let lastJob = null;
  for (let index = 0; index < 200; index += 1) {
    const job = getDetailRemixJob(jobId, 'workflow-1', context);
    lastJob = job;
    if (predicate(job)) return job;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`${message}: ${lastJob?.status || 'missing'} / ${lastJob?.stage || 'unknown'} / ${lastJob?.error || ''}`);
}

const completeRecognition = ({ hasPerson = true } = {}) => async (_request, meta) => {
  if (meta.kind === 'own-selling-points') {
    return JSON.stringify({
      productViews: [{
        sourceImageIndex: 0,
        cropRegion: { x: 0, y: 0, width: 1, height: 1 },
        viewAngle: 'front-left',
        visibleSides: ['front', 'left'],
        description: '产品完整清晰',
        quality: 0.95,
      }],
      sellingPoints: [{ id: 'sp-1', title: '深层舒缓', description: '贴合腰背曲线' }],
    });
  }
  return JSON.stringify({
    page: {
      hasPerson,
      reversePrompt: '柔和家居光线，人物位于画面左侧，右侧为产品展示位置',
      productRegion: { x: 0.6, y: 0.35, width: 0.3, height: 0.45 },
      selectedProductViewIds: ['pv-1'],
      mappedSellingPoints: [{ sellingPointId: 'sp-1' }],
    },
  });
};

test('无需单独产品图：自动裁出我方详情产品角度并与竞品版式、可选人物一次生成', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const generationCalls = [];
  const recognitionCalls = [];
  const context = {
    ...env.context,
    runRecognition: async (request, meta) => {
      recognitionCalls.push({ request, meta });
      return completeRecognition({ hasPerson: true })(request, meta);
    },
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return { buffer: Buffer.from('generated-final'), extension: 'png' };
    },
  };

  const created = createDetailRemixJob(basePayload({ productImages: [], productNodeIds: [] }), context);
  const resultNodeId = created.pages[0].resultNodeId;
  const completed = await waitFor(created.id, context, job => job?.stage === 'completed');

  assert.equal(completed.schemaVersion, 6);
  assert.equal(completed.phase, 'final');
  assert.equal(completed.pages[0].sourceNodeId, 'competitor-node');
  assert.equal(completed.pages[0].resultNodeId, resultNodeId);
  assert.match(completed.pages[0].rawResultUrl, /-raw\.png$/);
  assert.match(completed.pages[0].finalUrl, new RegExp(`${resultNodeId}\\.png$`));
  assert.deepEqual(completed.resultNodeIds, [resultNodeId]);
  assert.deepEqual(completed.productNodeIds, []);
  assert.equal(completed.productViews.length, 1);
  assert.equal(completed.productViews[0].viewAngle, 'front-left');
  assert.match(completed.productViews[0].imageUrl, /-pv-1\.png$/);
  assert.equal(generationCalls.length, 1);

  const recognitionImages = recognitionCalls.flatMap(call => call.request.imageDataUrls);
  assert.ok(recognitionImages.includes(OWN_DETAIL));
  assert.ok(recognitionImages.includes(COMPETITOR));
  const call = generationCalls[0];
  assert.equal(call.meta.phase, 'final-detail');
  assert.deepEqual(call.request.referenceImageInputs, [COMPETITOR, completed.productViews[0].imageUrl, CHARACTER]);
  assert.deepEqual(call.meta.referenceKinds, ['competitor-layout', 'own-product-auto-angle', 'character']);
  assert.ok(!call.request.referenceImageInputs.includes(OWN_DETAIL));
  assert.match(call.request.prompt, /自动挑选.*产品参考/);
  assert.match(call.request.prompt, /生成第.*最终图/);
  assert.match(call.request.prompt, /必须逐字生成的文案替换清单/);
  assert.match(call.request.prompt, /深层舒缓/);
  assert.match(call.request.prompt, /后续不会再叠加产品、文字或 Logo/);
  assert.doesNotMatch(call.request.prompt, /稍后由程序/);
  assert.match(call.request.prompt, /不要输出中间底图/);
  assert.throws(
    () => composeDetailRemixProducts(created.id, 'workflow-1', { productImages: [PRODUCT] }, context),
    error => error?.code === 'SINGLE_STAGE_JOB' && error?.status === 409,
  );
  assert.ok(fs.existsSync(path.join(env.jobsDir, `${created.id}.json`)));
});

test('竞品识图 JSON 格式失败会在生图前用同一严格 Schema 安全重试一次', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const competitorCalls = [];
  let generationCalls = 0;
  const context = {
    ...env.context,
    runRecognition: async (request, meta) => {
      if (meta.kind === 'own-selling-points') return completeRecognition({ hasPerson: false })(request, meta);
      competitorCalls.push({ request, meta });
      if (competitorCalls.length === 1) {
        return '{"page":{"hasPerson":false "reversePrompt":"缺少逗号"}}';
      }
      return completeRecognition({ hasPerson: false })(request, meta);
    },
    generateImage: async () => {
      generationCalls += 1;
      return { buffer: Buffer.from('format-retry-final'), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'recognition-format-retry-job',
    productImages: [],
    productNodeIds: [],
  }), context);
  const completed = await waitFor(created.id, context, job => job?.stage === 'completed');
  assert.equal(competitorCalls.length, 2);
  assert.deepEqual(competitorCalls.map(call => call.meta.formatAttempt), [1, 2]);
  assert.ok(competitorCalls.every(call => call.request.outputSchema?.properties?.page));
  assert.match(competitorCalls[1].request.userPrompt, /上一次回复未通过 JSON/);
  assert.equal(completed.pages[0].recognitionAttempts, 2);
  assert.equal(completed.pages[0].recognitionFormatRetries, 1);
  assert.equal(generationCalls, 1);
});

test('只重试尚未进入生图的失败页，保留成功页和稳定结果节点，并按页面顺序导出', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  let allowSecondPage = false;
  const generatedPages = [];
  const context = {
    ...env.context,
    runRecognition: async (request, meta) => {
      if (meta.kind === 'own-selling-points') return completeRecognition({ hasPerson: false })(request, meta);
      if (meta.pageIndex === 1 && !allowSecondPage) {
        return '{"page":{"hasPerson":false "reversePrompt":"仍然缺少逗号"}}';
      }
      return completeRecognition({ hasPerson: false })(request, meta);
    },
    generateImage: async (_request, meta) => {
      generatedPages.push(meta.pageIndex);
      return { buffer: Buffer.from(`retry-page-${meta.pageIndex}`), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'failed-only-retry-job',
    productImages: [],
    productNodeIds: [],
    competitorDetails: [
      { nodeId: 'competitor-1', imageUrl: COMPETITOR, order: 0 },
      { nodeId: 'competitor-2', imageUrl: PIXEL, order: 1 },
    ],
  }), context);
  const partial = await waitFor(created.id, context, job => job?.status === 'partial_failed');
  const firstResultUrl = partial.pages[0].finalUrl;
  const stableIds = partial.pages.map(page => page.resultNodeId);
  assert.deepEqual(generatedPages, [0]);
  assert.equal(partial.pages[1].codexImageJobId, undefined);

  await new Promise(resolve => setTimeout(resolve, 10));
  allowSecondPage = true;
  retryFailedDetailRemixPages(created.id, 'workflow-1', {}, context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');
  assert.deepEqual(generatedPages, [0, 1]);
  assert.equal(completed.pages[0].finalUrl, firstResultUrl);
  assert.deepEqual(completed.pages.map(page => page.resultNodeId), stableIds);
  assert.equal(completed.pages[1].retryCount, 1);

  const manifest = getDetailRemixExportManifest(created.id, 'workflow-1', context);
  assert.equal(manifest.count, 2);
  assert.deepEqual(manifest.files.map(file => file.pageIndex), [0, 1]);
  assert.deepEqual(manifest.files.map(file => path.basename(file.sourcePath)), stableIds.map(id => `${id}.png`));
});

test('竞品页会从我的详情多角度库中选择匹配视角，而不是固定使用第一张', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const ownBuffer = await sharp({
    create: { width: 200, height: 100, channels: 4, background: '#ff0000' },
  }).composite([{
    input: Buffer.from('<svg width="100" height="100"><rect width="100" height="100" fill="#0000ff"/></svg>'),
    left: 100,
    top: 0,
  }]).png().toBuffer();
  const ownImage = `data:image/png;base64,${ownBuffer.toString('base64')}`;
  const generationCalls = [];
  const context = {
    ...env.context,
    runRecognition: async (_request, meta) => meta.kind === 'own-selling-points'
      ? JSON.stringify({
        productViews: [
          { sourceImageIndex: 0, cropRegion: { x: 0, y: 0, width: 0.5, height: 1 }, viewAngle: 'front', quality: 0.9 },
          { sourceImageIndex: 0, cropRegion: { x: 0.5, y: 0, width: 0.5, height: 1 }, viewAngle: 'right-side', quality: 0.95 },
        ],
        sellingPoints: [{ id: 'sp-1', title: '真实卖点' }],
      })
      : JSON.stringify({ page: {
        hasPerson: false,
        targetProductView: { viewAngle: 'right-side' },
        selectedProductViewIds: ['pv-2'],
        mappedSellingPoints: [{ sellingPointId: 'sp-1' }],
      } }),
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return { buffer: Buffer.from('angle-selected'), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'auto-angle-match-job',
    ownDetails: [{ nodeId: 'own', imageUrl: ownImage, order: 0 }],
    productImages: [],
    productNodeIds: [],
    useCharacterReference: false,
  }), context);
  const completed = await waitFor(created.id, context, job => job?.stage === 'completed');
  assert.deepEqual(completed.pages[0].selectedProductViewIds, ['pv-2', 'pv-1']);
  assert.equal(completed.pages[0].selectedProductViews[0].viewAngle, 'right-side');
  assert.equal(generationCalls[0].request.referenceImageInputs[1], completed.productViews[1].imageUrl);
  assert.equal(generationCalls[0].request.referenceImageInputs[2], completed.productViews[0].imageUrl);
  assert.deepEqual(generationCalls[0].meta.referenceKinds, [
    'competitor-layout', 'own-product-auto-angle', 'own-product-auto-angle',
  ]);
  const cropPath = path.join(
    env.root, 'library', 'projects', '详情复刻测试', 'images', `${created.id}-pv-2.png`,
  );
  const pixel = await sharp(cropPath).removeAlpha().raw().toBuffer();
  assert.ok(pixel[2] > 200 && pixel[0] < 50, 'selected crop should come from the blue right-side view');
});

test('先读取全部我的详情建立卖点库，再按稳定顺序逐张分析并一次生成最终图', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const events = [];
  const ownRequests = [];
  const ownDetails = Array.from({ length: 5 }, (_, index) => ({ nodeId: `own-${index}`, imageUrl: PIXEL, order: index }));
  const competitorDetails = Array.from({ length: 3 }, (_, index) => ({ nodeId: `competitor-${index}`, imageUrl: PIXEL, order: index }));
  const context = {
    ...env.context,
    recognitionBatchSize: 2,
    runRecognition: async (_request, meta) => {
      if (meta.kind === 'own-selling-points') {
        events.push(`own-${meta.chunkIndex}`);
        ownRequests.push(_request.imageDataUrls.length);
        return JSON.stringify({ productViews: [{
          sourceImageIndex: 0,
          cropRegion: { x: 0, y: 0, width: 1, height: 1 },
          viewAngle: meta.chunkIndex === 0 ? 'front' : 'side',
          quality: 0.9,
        }], sellingPoints: [{
          id: 'sp-1', title: '共同真实卖点', description: '来自我的详情图片', sourceImageIndexes: [0],
        }] });
      }
      events.push(`competitor-${meta.pageIndex}`);
      return JSON.stringify({ page: {
        hasPerson: false,
        reversePrompt: `第 ${meta.pageIndex + 1} 张构图`,
        mappedSellingPoints: [{ sellingPointId: 'sp-1' }],
      } });
    },
    generateImage: async (_request, meta) => {
      events.push(`final-${meta.pageIndex}`);
      return { buffer: Buffer.from(`sequential-${meta.pageIndex}`), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'sequential-folder-queue-job', ownDetails, competitorDetails,
    useCharacterReference: false, characterReferenceImages: [],
  }), context);
  const completed = await waitFor(created.id, context, job => job?.stage === 'completed');
  assert.deepEqual(ownRequests, [2, 2, 1]);
  assert.deepEqual(events, [
    'own-0', 'own-1', 'own-2',
    'competitor-0', 'final-0',
    'competitor-1', 'final-1',
    'competitor-2', 'final-2',
  ]);
  assert.equal(completed.ownRecognition.processedImages, 5);
  assert.deepEqual(completed.ownSellingPoints[0].sourceImageIndexes, [0, 2, 4]);
  assert.deepEqual(completed.pages.map(page => page.queuePosition), [0, 1, 2]);
  assert.equal(completed.resultNodeIds.length, 3);
});

test('产品补充图非必填；若提供则属于不可变请求并占用参考图配额', t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const context = { ...env.context, autoStart: false };
  assert.doesNotThrow(() => createDetailRemixJob(basePayload({
    jobId: 'product-required', productImages: [], productNodeIds: [],
  }), context));

  createDetailRemixJob(basePayload({ jobId: 'immutable-product-job' }), context);
  assert.throws(() => createDetailRemixJob(basePayload({
    jobId: 'immutable-product-job', productImages: [PRODUCT_2], productNodeIds: ['product-2'],
  }), context), error => error?.code === 'IDEMPOTENCY_CONFLICT');

  const tooManyProducts = Array.from({ length: 10 }, (_, index) => `/product-${index}.png`);
  assert.throws(() => createDetailRemixJob(basePayload({
    jobId: 'too-many-products', nodeId: 'too-many-products-node', productImages: tooManyProducts,
  }), context), /产品补充图/);

  const tooManyCharacters = Array.from({ length: 9 }, (_, index) => `/character-${index}.png`);
  assert.doesNotThrow(() => createDetailRemixJob(basePayload({
    jobId: 'character-quota-off', nodeId: 'quota-off-node',
    useCharacterReference: false, characterReferenceImages: tooManyCharacters,
  }), context));
  assert.throws(() => createDetailRemixJob(basePayload({
    jobId: 'character-quota-on', nodeId: 'quota-on-node',
    useCharacterReference: true, characterReferenceImages: tooManyCharacters,
  }), context), /人物参考图最多支持 7 张/);
});

test('人物开关关闭或竞品无人时，不把人物参考发送给最终生图', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const calls = [];
  const context = {
    ...env.context,
    runRecognition: completeRecognition({ hasPerson: true }),
    generateImage: async (request, meta) => {
      calls.push({ request, meta });
      return { buffer: Buffer.from('final-without-character'), extension: 'png' };
    },
  };
  const off = createDetailRemixJob(basePayload({
    jobId: 'character-off-job', useCharacterReference: false, productImages: [], productNodeIds: [],
  }), context);
  const offDone = await waitFor(off.id, context, job => job?.stage === 'completed');
  assert.deepEqual(calls[0].request.referenceImageInputs, [COMPETITOR, offDone.productViews[0].imageUrl]);
  assert.deepEqual(calls[0].meta.referenceKinds, ['competitor-layout', 'own-product-auto-angle']);

  const noPersonContext = {
    ...context,
    runRecognition: completeRecognition({ hasPerson: false }),
  };
  const noPerson = createDetailRemixJob(basePayload({
    jobId: 'no-person-job', nodeId: 'no-person-node', productImages: [], productNodeIds: [],
  }), noPersonContext);
  const noPersonDone = await waitFor(noPerson.id, noPersonContext, job => job?.stage === 'completed');
  assert.deepEqual(calls[1].request.referenceImageInputs, [COMPETITOR, noPersonDone.productViews[0].imageUrl]);
});

test('创建请求幂等；提交边界中断不会自动重复付费提交', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  let recognitionCalls = 0;
  let generationCalls = 0;
  const context = {
    ...env.context,
    runRecognition: async (request, meta) => {
      recognitionCalls += 1;
      return completeRecognition({ hasPerson: false })(request, meta);
    },
    generateImage: async () => {
      generationCalls += 1;
      return { buffer: Buffer.from('idempotent'), extension: 'png' };
    },
  };
  const first = createDetailRemixJob(basePayload({ jobId: 'idempotent-detail-job' }), context);
  const completed = await waitFor(first.id, context, job => job?.stage === 'completed');
  const repeated = createDetailRemixJob(basePayload({ jobId: 'idempotent-detail-job' }), context);
  assert.equal(repeated.id, completed.id);
  assert.equal(getLatestDetailRemixJob('detail-remix-node', 'workflow-1', context).id, completed.id);
  assert.equal(recognitionCalls, 2);
  assert.equal(generationCalls, 1);
  assert.equal(repeated.pages[0].resultNodeId, completed.pages[0].resultNodeId);

  const interrupted = { ...completed, status: 'processing', stage: 'generating_final', phase: 'final' };
  interrupted.pages = completed.pages.map(page => ({
    ...page, status: 'submitting', rawResultUrl: undefined, finalUrl: undefined, resultUrl: undefined,
  }));
  interrupted.currentSubmission = { kind: 'final-detail', pageIndex: 0 };
  __detailRemixTest.writeJob(interrupted, context);
  const recovered = getDetailRemixJob(interrupted.id, 'workflow-1', context);
  assert.equal(recovered.status, 'recovery_required');
  assert.equal(recovered.pages[0].status, 'recovery_required');
  assert.equal(generationCalls, 1);
});

test('AI 修复在 Codex 提交边界重启时继续等待同一子任务，不误用初版图也不重复提交', t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const context = { ...env.context, autoStart: false };
  const created = createDetailRemixJob(basePayload({
    jobId: 'repair-resume-boundary-job',
    imageModel: 'codex-imagegen',
    useCharacterReference: false,
    characterReferenceImages: [],
    characterReferenceNodeIds: [],
  }), context);
  const child = createCodexImageJob({
    jobsDir: context.codexJobsDir,
    libraryDir: context.libraryDir,
    nodeId: `${created.pages[0].resultNodeId}-repair-1-raw`,
    prompt: '继续同一个 AI 修复任务',
    workflowId: 'workflow-1',
    projectDirName: '详情复刻测试',
  });
  const persisted = __detailRemixTest.readJob(created.id, 'workflow-1', context.dirs);
  persisted.status = 'processing';
  persisted.stage = 'repairing_final';
  persisted.pages[0] = {
    ...persisted.pages[0],
    status: 'submitting',
    rawResultUrl: '/library/projects/%E8%AF%A6%E6%83%85%E5%A4%8D%E5%88%BB%E6%B5%8B%E8%AF%95/images/initial.png',
    repairAttempts: 1,
    repairCodexImageJobId: child.id,
    repairCompletedAt: undefined,
  };
  persisted.currentSubmission = {
    kind: 'final-repair', pageIndex: 0, codexJobId: child.id,
  };
  __detailRemixTest.writeJob(persisted, context);

  const interrupted = __detailRemixTest.readJob(created.id, 'workflow-1', context.dirs);
  assert.equal(__detailRemixTest.markInterruptedSubmission(interrupted, context), false);
  const recovered = __detailRemixTest.readJob(created.id, 'workflow-1', context.dirs);
  assert.equal(recovered.status, 'pending');
  assert.equal(recovered.pages[0].status, 'submitting');
  assert.equal(recovered.currentSubmission.kind, 'final-repair');
  assert.equal(recovered.currentSubmission.codexJobId, child.id);
  assert.equal(recovered.pages[0].repairCodexImageJobId, child.id);
  assert.equal(listCodexImageJobs(context.codexJobsDir).length, 1);
});

test('Codex 识图中断会安全续跑，不再误报为已提交付费生图', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const seedContext = { ...env.context, autoStart: false };
  const created = createDetailRemixJob(basePayload({
    jobId: 'recognition-resume-job',
    recognitionProvider: 'codex-cli',
  }), seedContext);
  const persisted = __detailRemixTest.readJob(created.id, 'workflow-1', env.context.dirs);
  persisted.status = 'recovery_required';
  persisted.stage = 'recovery_required';
  persisted.stageLabel = '提交边界中断，请先检查平台历史记录';
  persisted.error = '无法确认平台是否已接单；系统不会自动重复提交';
  persisted.currentSubmission = { kind: 'own-recognition', chunkIndex: 0 };
  persisted.ownRecognition = {
    status: 'recovery_required',
    totalImages: 1,
    processedImages: 0,
    chunks: [{
      index: 0,
      startIndex: 0,
      imageCount: 1,
      sourceNodeIds: ['own-node'],
      status: 'recovery_required',
    }],
  };
  __detailRemixTest.writeJob(persisted, seedContext);

  let recognitionCalls = 0;
  let generationCalls = 0;
  const resumedContext = {
    ...env.context,
    runRecognition: async (request, meta) => {
      recognitionCalls += 1;
      return completeRecognition({ hasPerson: false })(request, meta);
    },
    generateImage: async () => {
      generationCalls += 1;
      return { buffer: Buffer.from('recognition-resumed'), extension: 'png' };
    },
  };
  const resumed = getDetailRemixJob(created.id, 'workflow-1', resumedContext);
  assert.notEqual(resumed.status, 'recovery_required');
  const completed = await waitFor(created.id, resumedContext, job => job?.stage === 'completed');
  assert.equal(completed.status, 'completed');
  assert.equal(recognitionCalls, 2);
  assert.equal(generationCalls, 1);
});

test('取消详情任务会同时取消尚未完成的 Codex 生图子任务', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const context = {
    ...env.context,
    codexPollIntervalMs: 5,
    runRecognition: completeRecognition({ hasPerson: false }),
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'cancel-codex-child-job',
    nodeId: 'cancel-codex-child-node',
    imageModel: 'codex-imagegen',
    useCharacterReference: false,
    characterReferenceImages: [],
    characterReferenceNodeIds: [],
  }), context);
  const submitted = await waitFor(created.id, context, job => Boolean(job?.pages?.[0]?.codexImageJobId));
  const childId = submitted.pages[0].codexImageJobId;
  assert.equal(listCodexImageJobs(env.context.codexJobsDir, 'pending').length, 1);

  const cancelled = cancelDetailRemixJob(created.id, 'workflow-1', context);
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(cancelled.cancelledChildJobIds, [childId]);
  assert.equal(cancelled.cancelSubmitted, false);
  assert.equal(getCodexImageJob(env.context.codexJobsDir, childId).status, 'cancelled');
  assert.deepEqual(listCodexImageJobs(env.context.codexJobsDir, 'pending'), []);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(getDetailRemixJob(created.id, 'workflow-1', context).status, 'cancelled');
});

test('preparing 状态可安全续跑，最终结果节点 id 保持不变', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const seedContext = { ...env.context, autoStart: false };
  const created = createDetailRemixJob(basePayload({ jobId: 'safe-resume-job' }), seedContext);
  const resultNodeId = created.pages[0].resultNodeId;
  const persisted = __detailRemixTest.readJob(created.id, 'workflow-1', env.context.dirs);
  persisted.status = 'processing';
  persisted.stage = 'generating_final';
  persisted.pages[0].status = 'preparing';
  __detailRemixTest.writeJob(persisted, seedContext);
  let generationCalls = 0;
  const resumedContext = {
    ...env.context,
    runRecognition: completeRecognition({ hasPerson: false }),
    generateImage: async () => {
      generationCalls += 1;
      return { buffer: Buffer.from('resumed'), extension: 'png' };
    },
  };
  getDetailRemixJob(created.id, 'workflow-1', resumedContext);
  const completed = await waitFor(created.id, resumedContext, job => job?.stage === 'completed');
  assert.equal(generationCalls, 1);
  assert.equal(completed.pages[0].resultNodeId, resultNodeId);
});

test('逐页失败保留成功最终图，并支持取消与 dismiss', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const context = {
    ...env.context,
    runRecognition: completeRecognition({ hasPerson: false }),
    generateImage: async (_request, meta) => {
      if (meta.pageIndex === 1) throw new Error('模拟第二页失败');
      return { buffer: Buffer.from('first-page-ok'), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'partial-detail-job',
    competitorDetails: [
      { nodeId: 'competitor-1', imageUrl: COMPETITOR, order: 0 },
      { nodeId: 'competitor-2', imageUrl: PIXEL, order: 1 },
    ],
  }), context);
  const partial = await waitFor(created.id, context, job => job?.status === 'partial_failed');
  assert.equal(partial.stage, 'final_partial_failed');
  assert.equal(partial.pages[0].status, 'completed');
  assert.equal(partial.pages[1].status, 'failed');
  assert.equal(partial.resultNodeIds.length, 1);
  const dismissed = dismissDetailRemixResultNodes([partial.pages[0].resultNodeId, 'not-owned'], 'workflow-1', context);
  assert.deepEqual(dismissed.dismissed, [partial.pages[0].resultNodeId]);

  const pending = createDetailRemixJob(basePayload({ jobId: 'cancel-detail-job', nodeId: 'cancel-node' }), {
    ...env.context, autoStart: false,
  });
  const cancelled = cancelDetailRemixJob(pending.id, 'workflow-1', env.context);
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(cancelled.pages.every(page => page.status === 'cancelled'));
});

test('每一页按竞品原始像素尺寸输出，模型请求选择最接近的支持比例', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const competitorBuffer = await sharp({
    create: { width: 320, height: 500, channels: 4, background: '#223344' },
  }).png().toBuffer();
  const generatedBuffer = await sharp({
    create: { width: 512, height: 512, channels: 4, background: '#8899aa' },
  }).png().toBuffer();
  const competitorImage = `data:image/png;base64,${competitorBuffer.toString('base64')}`;
  const generationCalls = [];
  const context = {
    ...env.context,
    matchDetailRemixDimensions: undefined,
    applyTextOverlay: async ({ sourceBuffer }) => sourceBuffer,
    runRecognition: completeRecognition({ hasPerson: false }),
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return { buffer: generatedBuffer, extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'exact-source-size-job',
    ownDetails: [{ nodeId: 'own', imageUrl: competitorImage, order: 0 }],
    competitorDetails: [{ nodeId: 'competitor', imageUrl: competitorImage, order: 0 }],
    useCharacterReference: false,
  }), context);
  const completed = await waitFor(created.id, context, job => job?.stage === 'completed');
  const finalPath = path.join(env.root, 'library', 'projects', '详情复刻测试', 'images', `${completed.pages[0].resultNodeId}.png`);
  const metadata = await sharp(finalPath).metadata();
  assert.deepEqual([metadata.width, metadata.height], [320, 500]);
  assert.equal(completed.pages[0].resultAspectRatio, '320/500');
  assert.equal(generationCalls.length, 1);
  assert.equal(generationCalls[0].request.aspectRatio, '9:16');
});

test('从我方详情提取品牌 Logo，作为参考交给 AI 直接替换且不执行本地覆盖', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const ownBuffer = await sharp({
    create: { width: 200, height: 100, channels: 4, background: '#ffffff' },
  }).composite([{
    input: Buffer.from('<svg width="50" height="50"><rect width="50" height="50" fill="#ff0000"/></svg>'),
    left: 0, top: 0,
  }]).png().toBuffer();
  const competitorBuffer = await sharp({
    create: { width: 320, height: 500, channels: 4, background: '#111111' },
  }).png().toBuffer();
  const ownImage = `data:image/png;base64,${ownBuffer.toString('base64')}`;
  const competitorImage = `data:image/png;base64,${competitorBuffer.toString('base64')}`;
  const generationCalls = [];
  const context = {
    ...env.context,
    matchDetailRemixDimensions: undefined,
    runRecognition: async (_request, meta) => meta.kind === 'own-selling-points'
      ? JSON.stringify({
        brandIdentity: {
          name: '我方品牌', logoSourceImageIndex: 0,
          logoRegion: { x: 0, y: 0, width: 0.25, height: 0.5 },
        },
        productViews: [{
          sourceImageIndex: 0,
          cropRegion: { x: 0, y: 0, width: 1, height: 1 },
          viewAngle: 'front',
          quality: 0.9,
        }],
        sellingPoints: [{ id: 'sp-1', title: '真实卖点' }],
      })
      : JSON.stringify({ page: {
        hasPerson: false,
        productRegion: { x: 0.5, y: 0.4, width: 0.3, height: 0.4 },
        brandSlots: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.1 }],
        copySlots: [{ role: 'headline', x: 0.2, y: 0.8, width: 0.6, height: 0.1 }],
        mappedSellingPoints: [{ sellingPointId: 'sp-1', slotRole: 'headline' }],
      } }),
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return { buffer: competitorBuffer, extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'brand-logo-overlay-job',
    ownDetails: [{ nodeId: 'own', imageUrl: ownImage, order: 0 }],
    competitorDetails: [{ nodeId: 'competitor', imageUrl: competitorImage, order: 0 }],
    productImages: [],
    productNodeIds: [],
    useCharacterReference: false,
  }), context);
  const completed = await waitFor(created.id, context, job => job?.stage === 'completed');
  assert.equal(completed.brandIdentity.name, '我方品牌');
  assert.ok(completed.brandLogoUrl);
  assert.deepEqual(generationCalls[0].request.referenceImageInputs, [
    competitorImage,
    completed.productViews[0].imageUrl,
    completed.brandLogoUrl,
  ]);
  assert.deepEqual(generationCalls[0].meta.referenceKinds, [
    'competitor-layout',
    'own-product-auto-angle',
    'own-brand-logo',
  ]);
  assert.match(generationCalls[0].request.prompt, /参考图3是我方真实 Logo 参考/);
  assert.match(generationCalls[0].request.prompt, /我方品牌/);
  assert.match(generationCalls[0].request.prompt, /真实卖点/);
  const finalPath = path.join(env.root, 'library', 'projects', '详情复刻测试', 'images', `${completed.pages[0].resultNodeId}.png`);
  const { data, info } = await sharp(finalPath).raw().toBuffer({ resolveWithObject: true });
  const sampleX = Math.round(info.width * 0.2);
  const sampleY = Math.round(info.height * 0.15);
  const offset = (sampleY * info.width + sampleX) * info.channels;
  assert.ok(data[offset] < 40 && data[offset + 1] < 40 && data[offset + 2] < 40,
    'the local pipeline must preserve the AI result instead of pasting the red logo crop itself');
});

test('项目文件夹改名后，单阶段输入与结果 URL 按当前项目目录恢复', t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const context = { ...env.context, autoStart: false };
  const oldEncoded = encodeURIComponent('详情复刻测试');
  const created = createDetailRemixJob(basePayload({
    jobId: 'rename-safe-job',
    ownDetails: [{ nodeId: 'own', imageUrl: `/library/projects/${oldEncoded}/images/own.png` }],
    competitorDetails: [{ nodeId: 'competitor', imageUrl: `/library/projects/${oldEncoded}/images/competitor.png` }],
    productImages: [`/library/projects/${oldEncoded}/images/product.png`],
  }), context);
  const persisted = __detailRemixTest.readJob(created.id, 'workflow-1', context.dirs);
  persisted.pages[0].rawResultUrl = `/library/projects/${oldEncoded}/images/raw-final.png`;
  persisted.pages[0].finalUrl = `/library/projects/${oldEncoded}/images/final.png`;
  persisted.pages[0].resultUrl = persisted.pages[0].finalUrl;
  persisted.productViews = [{ id: 'pv-1', imageUrl: `/library/projects/${oldEncoded}/images/auto-view.png` }];
  persisted.brandLogoUrl = `/library/projects/${oldEncoded}/images/brand-logo.png`;
  __detailRemixTest.writeJob(persisted, context);

  const oldRoot = path.join(env.context.dirs.projectsDir, '详情复刻测试');
  const newRoot = path.join(env.context.dirs.projectsDir, '详情复刻新名称');
  fs.renameSync(oldRoot, newRoot);
  const workflowPath = path.join(env.context.dirs.workflowsDir, 'workflow-1.json');
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  workflow.projectDirName = '详情复刻新名称';
  fs.writeFileSync(workflowPath, JSON.stringify(workflow));

  const recovered = getDetailRemixJob(created.id, 'workflow-1', context);
  const prefix = `/library/projects/${encodeURIComponent('详情复刻新名称')}/images`;
  assert.equal(recovered.ownDetails[0].imageUrl, `${prefix}/own.png`);
  assert.equal(recovered.competitorDetails[0].imageUrl, `${prefix}/competitor.png`);
  assert.equal(recovered.productImages[0], `${prefix}/product.png`);
  assert.equal(recovered.productViews[0].imageUrl, `${prefix}/auto-view.png`);
  assert.equal(recovered.pages[0].rawResultUrl, `${prefix}/raw-final.png`);
  assert.equal(recovered.pages[0].finalUrl, `${prefix}/final.png`);
  assert.equal(recovered.brandLogoUrl, `${prefix}/brand-logo.png`);
});

test('参数页把对应我方证据图与精确事实一起交给最终生图，未证实参数不进入提示词', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const generationCalls = [];
  const context = {
    ...env.context,
    runRecognition: async (request, meta) => {
      if (meta.kind === 'own-selling-points') {
        assert.ok(request.outputSchema?.properties?.verifiedFacts);
        return JSON.stringify({
          brandIdentity: {},
          productViews: [{
            sourceImageIndex: 0,
            cropRegion: { x: 0, y: 0, width: 1, height: 1 },
            viewAngle: 'front', visibleSides: ['front'], description: '正面', quality: 0.9,
          }],
          sellingPoints: [{ id: 'sp-1', title: '模拟虎口抓捏', description: '舒缓肩颈' }],
          verifiedFacts: [{
            id: 'fact-local-1', factType: 'rated_power', label: '额定功率', value: '16W',
            displayText: '额定功率\n16W', sourceImageIndexes: [0],
            sourceRegion: { x: 0.1, y: 0.5, width: 0.4, height: 0.1 }, confidence: 0.99,
          }],
        });
      }
      return JSON.stringify({ page: {
        pageType: 'specification', hasPerson: false,
        selectedProductViewIds: ['pv-1'],
        productInstances: [{ x: 0.1, y: 0.1, width: 0.8, height: 0.3 }],
        copySlots: [
          { slotId: 'power-label', role: 'parameterLabel', sourceText: '工作功率' },
          { slotId: 'power-value', role: 'parameterValue', sourceText: '20W' },
          { slotId: 'capacity', role: 'specification', sourceText: '电池容量 2500mAh' },
        ],
        mappedSellingPoints: [{ sellingPointId: 'sp-1', slotId: 'power-label', slotRole: 'parameterLabel' }],
        mappedFacts: [
          { factId: 'fact-1', slotId: 'power-label', slotRole: 'parameterLabel', displayPart: 'label' },
          { factId: 'fact-1', slotId: 'power-value', slotRole: 'parameterValue', displayPart: 'value' },
        ],
      } });
    },
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return { buffer: Buffer.from('strict-facts-final'), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'strict-facts-job',
    productImages: [], productNodeIds: [],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');
  assert.equal(completed.verifiedFacts.length, 1);
  assert.equal(completed.verifiedFacts[0].value, '16W');
  assert.equal(completed.pages[0].mappedFacts[0].value, '16W');
  assert.deepEqual(completed.pages[0].mappedFacts.map(item => item.replacementText), ['额定功率', '16W']);
  assert.equal(generationCalls.length, 1);
  assert.deepEqual(generationCalls[0].meta.referenceKinds, [
    'competitor-layout', 'own-product-auto-angle', 'own-fact-evidence',
  ]);
  assert.equal(generationCalls[0].request.referenceImageInputs.at(-1), OWN_DETAIL);
  assert.match(generationCalls[0].request.prompt, /"replacementText":"额定功率"/);
  assert.match(generationCalls[0].request.prompt, /"replacementText":"16W"/);
  assert.doesNotMatch(generationCalls[0].request.prompt, /"replacementText":"模拟虎口抓捏"/);
  assert.doesNotMatch(generationCalls[0].request.prompt, /2500mAh/);
});

test('成图质检失败时只追加一次 AI 修复，通过复检后才发布最终节点', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  let validationCalls = 0;
  const generationCalls = [];
  const context = {
    ...env.context,
    skipFinalValidation: false,
    runRecognition: async (_request, meta) => {
      if (meta.kind === 'own-selling-points') {
        return JSON.stringify({
          productViews: [{
            sourceImageIndex: 0,
            cropRegion: { x: 0, y: 0, width: 1, height: 1 },
            viewAngle: 'front', visibleSides: ['front'], description: '', quality: 0.9,
          }],
          sellingPoints: [],
          verifiedFacts: [{
            id: 'local', factType: 'rated_power', label: '额定功率', value: '16W',
            displayText: '额定功率\n16W', sourceImageIndexes: [0],
            sourceRegion: { x: 0, y: 0, width: 1, height: 1 }, confidence: 1,
          }],
        });
      }
      if (meta.kind === 'competitor-page') {
        return JSON.stringify({ page: {
          pageType: 'specification', hasPerson: false,
          selectedProductViewIds: ['pv-1'], productInstances: [],
          copySlots: [{ slotId: 'power', role: 'specification', sourceText: '20W' }],
          mappedSellingPoints: [],
          mappedFacts: [{ factId: 'fact-1', slotId: 'power', slotRole: 'specification', displayPart: 'displayText' }],
        } });
      }
      validationCalls += 1;
      return JSON.stringify(validationCalls === 1 ? {
        passed: false, copyExact: false, brandCorrect: true, productCorrect: true,
        competitorRemoved: true, gibberishDetected: true,
        missingTexts: [], wrongTexts: ['把16W写成16V'], unexpectedTexts: [], summary: '参数错字',
      } : {
        passed: true, copyExact: true, brandCorrect: true, productCorrect: true,
        competitorRemoved: true, gibberishDetected: false,
        missingTexts: [], wrongTexts: [], unexpectedTexts: [], summary: '通过',
      });
    },
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return { buffer: Buffer.from(`quality-${meta.phase}`), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'quality-repair-job',
    productImages: [], productNodeIds: [],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');
  assert.equal(validationCalls, 2);
  assert.deepEqual(generationCalls.map(call => call.meta.phase), ['final-detail', 'final-repair']);
  assert.equal(completed.pages[0].repairAttempts, 1);
  assert.equal(completed.pages[0].validation.passed, true);
  assert.match(generationCalls[1].request.prompt, /只修复文字与品牌问题/);
  assert.equal(generationCalls[1].meta.referenceKinds[0], 'quality-failed-final');
  assert.ok(completed.pages[0].finalUrl);
});
