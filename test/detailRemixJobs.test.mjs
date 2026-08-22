import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';

import {
  __detailRemixTest,
  cancelDetailRemixJob,
  createDetailRemixJob,
  dismissDetailRemixResultNodes,
  getDetailRemixJob,
  getDetailRemixExportManifest,
  getLatestDetailRemixJob,
  regenerateDetailRemixPages,
  retryFailedDetailRemixPages,
} from '../server/services/detailRemixJobs.js';
import {
  claimCodexImageJob,
  completeCodexImageJob,
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
    // Existing tests exercise the explicitly retained one-pass fast mode.
    // Product identity lock has dedicated two-pass coverage below.
    lockProductIdentity: false,
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

  assert.equal(completed.schemaVersion, 9);
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
  assert.match(call.request.prompt, /精确逐位置替换清单/);
  assert.match(call.request.prompt, /深层舒缓/);
  assert.match(call.request.prompt, /后续不会再叠加产品、文字或 Logo/);
  assert.doesNotMatch(call.request.prompt, /稍后由程序/);
  assert.match(call.request.prompt, /不要输出中间底图/);
  assert.ok(fs.existsSync(path.join(env.jobsDir, `${created.id}.json`)));
});

test('产品身份锁定默认两阶段：竞品只进入场景隔离，最终产品请求只含底图与我方产品', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const generationCalls = [];
  let dimensionCalls = 0;
  const context = {
    ...env.context,
    runRecognition: completeRecognition({ hasPerson: true }),
    matchDetailRemixDimensions: async ({ sourceBuffer }) => {
      dimensionCalls += 1;
      if (dimensionCalls === 1) {
        const persisted = __detailRemixTest.readJob(
          'identity-lock-two-pass-job',
          'workflow-1',
          env.context.dirs,
        );
        assert.equal(persisted.pages[0].status, 'normalizing_scene_plate');
        assert.equal(persisted.pages[0].scenePlateStatus, 'normalizing');
        assert.equal(persisted.currentSubmission, undefined);
      }
      return sourceBuffer;
    },
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return {
        buffer: Buffer.from(meta.phase === 'blank-plate' ? 'identity-clean-scene' : 'identity-final'),
        extension: 'png',
      };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'identity-lock-two-pass-job',
    lockProductIdentity: undefined,
    preferSuppliedProductReferences: true,
    productSheet: { rows: 1, columns: 1, cells: [{ index: 1, label: '我方产品实拍' }] },
  }), context);
  assert.equal(created.lockProductIdentity, true);
  const completed = await waitFor(created.id, context, job => job?.stage === 'completed');

  assert.equal(generationCalls.length, 2);
  assert.equal(generationCalls[0].meta.phase, 'blank-plate');
  assert.deepEqual(generationCalls[0].request.referenceImageInputs, [COMPETITOR, CHARACTER]);
  assert.deepEqual(generationCalls[0].meta.referenceKinds, ['competitor-structure-only', 'character']);
  assert.match(generationCalls[0].request.prompt, /无产品场景底图/);
  assert.match(generationCalls[0].request.prompt, /皮革颗粒、缝线、按钮细节/);
  assert.ok(!generationCalls[0].request.referenceImageInputs.includes(PRODUCT));

  assert.equal(generationCalls[1].meta.phase, 'final-detail');
  assert.equal(generationCalls[1].request.referenceImageInputs[0], completed.pages[0].rawPlateUrl);
  assert.deepEqual(generationCalls[1].request.referenceImageInputs.slice(1), [PRODUCT]);
  assert.deepEqual(generationCalls[1].meta.referenceKinds, ['identity-locked-scene', 'own-product-supplement']);
  assert.ok(!generationCalls[1].request.referenceImageInputs.includes(COMPETITOR));
  assert.ok(!generationCalls[1].request.referenceImageInputs.includes(CHARACTER));
  assert.match(generationCalls[1].request.prompt, /不包含任何可供借鉴的竞品产品/);
  assert.match(generationCalls[1].request.prompt, /参考图相应位置没有就必须保持无标识/);
  assert.equal(completed.pages[0].scenePlateStatus, 'completed');
});

test('同模换色直出只生成一次：竞品锁定几何，我方产品只提供表面外观，人物与 Logo 按优先级排列', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const generationCalls = [];
  const context = {
    ...env.context,
    runRecognition: completeRecognition({ hasPerson: true }),
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return { buffer: Buffer.from('same-mold-final'), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'same-mold-one-pass-job',
    generationMode: 'same-mold-recolor',
    // Explicit mode must win over this legacy setting.
    lockProductIdentity: true,
    preferSuppliedProductReferences: false,
    brandLogoImages: [PRODUCT_2],
    brandLogoNodeIds: ['brand-logo-node'],
    productSheet: { rows: 1, columns: 1, cells: [{ index: 1, label: '我方颜色与纹理' }] },
    maxStructuralRegenerations: 3,
  }), context);

  assert.equal(created.schemaVersion, 9);
  assert.equal(created.generationMode, 'same-mold-recolor');
  assert.equal(created.lockProductIdentity, false);
  assert.equal(created.preferSuppliedProductReferences, true);
  assert.equal(created.maxStructuralRegenerations, 0);
  assert.equal(created.pages[0].plateNodeId, undefined);

  const completed = await waitFor(created.id, context, job => job?.stage === 'completed');
  assert.equal(generationCalls.length, 1);
  assert.equal(generationCalls[0].meta.phase, 'final-detail');
  assert.deepEqual(generationCalls[0].request.referenceImageInputs, [
    COMPETITOR, PRODUCT, CHARACTER, PRODUCT_2,
  ]);
  assert.deepEqual(generationCalls[0].meta.referenceKinds, [
    'same-mold-geometry-original',
    'own-product-appearance-primary',
    'character',
    'own-brand-logo',
  ]);
  assert.match(generationCalls[0].request.prompt, /同模换色/);
  assert.match(generationCalls[0].request.prompt, /产品几何冻结/);
  assert.match(generationCalls[0].request.prompt, /不得把产品抹掉后重画/);
  assert.match(generationCalls[0].request.prompt, /参考图3是人物完整外观的最高权威/);
  assert.match(generationCalls[0].request.prompt, /参考图4只允许用于 page_graphic 页面品牌槽/);
  assert.doesNotMatch(generationCalls[0].request.prompt, /无产品场景底图/);
  assert.equal(completed.pages[0].scenePlateStatus, undefined);
  assert.equal(completed.pages[0].repairAttempts || 0, 0);
  const metadata = JSON.parse(fs.readFileSync(path.join(
    env.root,
    'library',
    'projects',
    '详情复刻测试',
    'images',
    `${completed.pages[0].resultNodeId}.json`,
  ), 'utf8'));
  assert.equal(metadata.generationMode, 'same-mold-recolor');
  assert.equal(metadata.productGeometryLocked, true);
  assert.equal(metadata.productIdentityLocked, false);
  assert.equal(metadata.scenePlateUrl, undefined);
});

test('同模换色质检发现产品改形时直接标记失败，不自动提交修复或整页重生成', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const generationCalls = [];
  const context = {
    ...env.context,
    skipFinalValidation: false,
    maxStructuralRegenerations: 3,
    runRecognition: async (request, meta) => {
      if (meta.kind !== 'final-detail-validation') {
        return completeRecognition({ hasPerson: false })(request, meta);
      }
      return JSON.stringify({
        passed: false,
        copyExact: true,
        brandCorrect: true,
        productCorrect: false,
        productGeometryPreserved: false,
        productAppearanceMatched: true,
        competitorProductBrandRemoved: true,
        logoCorrect: true,
        logoPresentationCorrect: true,
        layoutHierarchyCorrect: true,
        visualPolishCorrect: true,
        layoutIssues: [],
        productPlacementCorrect: true,
        parameterAlignmentCorrect: true,
        unsupportedStrictFactsAbsent: true,
        characterIdentityCorrect: true,
        characterHairstyleCorrect: true,
        characterOutfitCorrect: true,
        characterAccessoriesCorrect: true,
        characterIssues: [],
        competitorRemoved: true,
        gibberishDetected: false,
        missingTexts: [],
        wrongTexts: [],
        unexpectedTexts: [],
        summary: '产品轮廓发生变化',
      });
    },
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return { buffer: Buffer.from('same-mold-wrong-geometry'), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'same-mold-geometry-failed-job',
    generationMode: 'same-mold-recolor',
    useCharacterReference: false,
    characterReferenceImages: [],
    characterReferenceNodeIds: [],
    productSheet: { rows: 1, columns: 1, cells: [{ index: 1, label: '我方产品外观' }] },
    maxStructuralRegenerations: 3,
  }), context);
  const failed = await waitFor(created.id, context, job => job?.stage === 'failed_validation');

  assert.deepEqual(generationCalls.map(call => call.meta.phase), ['final-detail']);
  assert.equal(failed.pages[0].status, 'failed_validation');
  assert.equal(failed.pages[0].validation.productGeometryPreserved, false);
  assert.ok(failed.pages[0].validation.blockingFailures.includes('productGeometryPreserved'));
  assert.equal(failed.pages[0].repairAttempts || 0, 0);
  assert.equal(failed.pages[0].structuralRegenerationAttempts || 0, 0);
  assert.match(failed.pages[0].qualityFailedCandidateUrl, /-raw\.png$/);

  regenerateDetailRemixPages(created.id, 'workflow-1', { pageIndexes: [0] }, context);
  const retried = await waitFor(
    created.id,
    context,
    job => job?.stage === 'failed_validation' && job.pages[0].regenerationCount === 1,
  );
  assert.deepEqual(generationCalls.map(call => call.meta.phase), ['final-detail', 'final-detail']);
  assert.equal(retried.generationMode, 'same-mold-recolor');
  assert.equal(retried.pages[0].repairAttempts || 0, 0);
});

test('锁定模式产品质检失败时，修复继续携带我方产品且绝不重新引入竞品原图', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const generationCalls = [];
  let validationCalls = 0;
  const context = {
    ...env.context,
    skipFinalValidation: false,
    runRecognition: async (request, meta) => {
      if (meta.kind !== 'final-detail-validation') {
        return completeRecognition({ hasPerson: true })(request, meta);
      }
      validationCalls += 1;
      return JSON.stringify(cleanValidation(validationCalls === 1 ? {
        passed: false,
        productCorrect: false,
        logoPresentationCorrect: false,
        summary: '产品上多出白色 Logo 与圆点',
      } : {}));
    },
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return { buffer: Buffer.from(`locked-${meta.phase}`), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'identity-lock-repair-job',
    lockProductIdentity: true,
    preferSuppliedProductReferences: true,
    productSheet: { rows: 1, columns: 1, cells: [{ index: 1, label: '我方产品实拍' }] },
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');

  assert.deepEqual(generationCalls.map(call => call.meta.phase), [
    'blank-plate', 'final-detail', 'final-repair',
  ]);
  const repair = generationCalls[2];
  assert.deepEqual(repair.meta.referenceKinds, [
    'quality-failed-final', 'own-product-supplement', 'character',
  ]);
  assert.ok(repair.request.referenceImageInputs.includes(PRODUCT));
  assert.ok(!repair.request.referenceImageInputs.includes(COMPETITOR));
  assert.match(repair.request.prompt, /本次修复不提供竞品原图/);
  assert.match(repair.request.prompt, /参考中没有的标识必须删除/);
  assert.equal(completed.pages[0].repairAttempts, 1);
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

test('营销页核心文案槽缺失会在付费生图前重试，完整保留胶囊标签、主标题和副标题', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const competitorCalls = [];
  const generationCalls = [];
  const copySlots = [
    { slotId: 'badge', role: 'featureBadge', sourceText: '竞品按摩披肩', x: 0.35, y: 0.1, width: 0.3, height: 0.04, maxChars: 8 },
    { slotId: 'headline', role: 'headline', sourceText: '竞品核心大标题', x: 0.1, y: 0.2, width: 0.8, height: 0.08, maxChars: 10 },
    { slotId: 'subheadline', role: 'featureSubheadline', sourceText: '竞品副标题', x: 0.15, y: 0.3, width: 0.7, height: 0.05, maxChars: 10 },
    { slotId: 'watermark', role: 'watermark', sourceText: '竞品水印', x: 0.8, y: 0.95, width: 0.15, height: 0.02, maxChars: 8 },
  ];
  const context = {
    ...env.context,
    runRecognition: async (_request, meta) => {
      if (meta.kind === 'own-selling-points') {
        return JSON.stringify({
          productViews: [{
            sourceImageIndex: 0, cropRegion: { x: 0, y: 0, width: 1, height: 1 },
            viewAngle: 'front', visibleSides: ['front'], description: '', quality: 0.95,
          }],
          sellingPoints: [
            { id: 'sp-1', title: '肩颈按摩器', description: '轻松覆盖肩颈' },
            { id: 'sp-2', title: '仿人手深层揉捏', description: '贴合肩颈斜方肌' },
            { id: 'sp-3', title: '按摩热敷双效', description: '舒缓肩颈疲劳' },
          ],
        });
      }
      competitorCalls.push(meta);
      const complete = competitorCalls.length > 1;
      return JSON.stringify({ page: {
        pageType: 'marketing', hasPerson: false,
        selectedProductViewIds: ['pv-1'], productInstances: [], copySlots,
        mappedSellingPoints: complete ? [
          { sellingPointId: 'sp-1', slotId: 'badge', slotRole: 'featureBadge', replacementText: '肩颈按摩器' },
          { sellingPointId: 'sp-2', slotId: 'headline', slotRole: 'headline', replacementText: '仿人手深层揉捏' },
          { sellingPointId: 'sp-3', slotId: 'subheadline', slotRole: 'featureSubheadline', replacementText: '按摩热敷双效' },
        ] : [
          { sellingPointId: 'sp-3', slotId: 'subheadline', slotRole: 'featureSubheadline', replacementText: '按摩热敷双效' },
        ],
        mappedFacts: [],
      } });
    },
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return { buffer: Buffer.from('marketing-layout-final'), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'marketing-layout-contract-job',
    productImages: [], productNodeIds: [],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');

  assert.equal(competitorCalls.length, 2);
  assert.equal(completed.pages[0].recognitionContractRetries, 1);
  assert.equal(completed.pages[0].competitorAnalysisVersion, 4);
  assert.equal(generationCalls.length, 1);
  assert.match(generationCalls[0].request.prompt, /肩颈按摩器/);
  assert.match(generationCalls[0].request.prompt, /仿人手深层揉捏/);
  assert.match(generationCalls[0].request.prompt, /按摩热敷双效/);
  assert.match(generationCalls[0].request.prompt, /胶囊标签—主标题—副标题/);
  assert.match(generationCalls[0].request.prompt, /高级感精修/);
  assert.doesNotMatch(generationCalls[0].request.prompt, /竞品水印/);
});

test('前序页面即使被识别成型号页也强制按营销页生成，只有最后两张保留参数候选资格', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const competitorInstructions = [];
  const generationCalls = [];
  const context = {
    ...env.context,
    runRecognition: async (request, meta) => {
      if (meta.kind === 'own-selling-points') {
        return JSON.stringify({
          productViews: [{
            sourceImageIndex: 0, cropRegion: { x: 0, y: 0, width: 1, height: 1 },
            viewAngle: 'front', visibleSides: ['front'], description: '', quality: 0.95,
          }],
          sellingPoints: [{ id: 'sp-1', title: '肩颈深度放松', description: '贴合肩颈斜方肌' }],
        });
      }
      competitorInstructions.push({ pageIndex: meta.pageIndex, instruction: request.systemInstruction });
      if (meta.pageIndex === 0) {
        return JSON.stringify({ page: {
          pageType: '型号页', pageMode: 'STRICT_PARAMETER_MODE', strictPageCategory: 'model',
          hasPerson: false, selectedProductViewIds: ['pv-1'], productInstances: [],
          copySlots: [{
            slotId: 'headline-1', role: 'headline', field: '', parameterPart: 'none',
            sourceText: '5203N按摩披肩', x: 0.1, y: 0.1, width: 0.8, height: 0.08,
            align: 'center', color: '#ffffff', fontWeight: 700, maxChars: 8,
          }],
          mappedSellingPoints: [{
            sellingPointId: 'sp-1', slotId: 'headline-1', slotRole: 'headline', replacementText: '肩颈深度放松',
          }],
          mappedFacts: [],
        } });
      }
      return JSON.stringify({ page: {
        pageType: 'marketing', pageMode: 'MARKETING_MODE', strictPageCategory: 'none',
        hasPerson: false, selectedProductViewIds: ['pv-1'], productInstances: [],
        copySlots: [], mappedSellingPoints: [], mappedFacts: [],
      } });
    },
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return { buffer: Buffer.from(`tail-mode-${meta.pageIndex}`), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'tail-only-strict-mode-job',
    competitorDetails: [
      { nodeId: 'competitor-1', imageUrl: COMPETITOR, order: 0 },
      { nodeId: 'competitor-2', imageUrl: PIXEL, order: 1 },
      { nodeId: 'competitor-3', imageUrl: PRODUCT_2, order: 2 },
    ],
    productImages: [], productNodeIds: [],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');

  assert.equal(completed.pages[0].analysis.pageMode, 'MARKETING_MODE');
  assert.equal(completed.pages[0].analysis.strictParameterModeEligible, false);
  assert.equal(completed.pages[1].analysis.strictParameterModeEligible, true);
  assert.equal(completed.pages[2].analysis.strictParameterModeEligible, true);
  assert.match(competitorInstructions[0].instruction, /只有最后两张/);
  assert.match(competitorInstructions[0].instruction, /本页已被程序锁定为 MARKETING_MODE/);
  assert.match(generationCalls[0].request.prompt, /肩颈深度放松/);
  assert.deepEqual(generationCalls.map(call => call.meta.pageIndex), [0, 1, 2]);
});

test('营销文案连续两次重复且超长时由程序确定性缩写和换词，不再把页面判失败', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  let competitorCalls = 0;
  const generationCalls = [];
  const copySlots = [
    { slotId: 'eyebrow-1', role: 'eyebrow', sourceText: '竞品眉题', x: 0.2, y: 0.1, width: 0.6, height: 0.04, maxChars: 6 },
    { slotId: 'headline-1', role: 'headline', sourceText: '竞品主标题', x: 0.1, y: 0.2, width: 0.8, height: 0.08, maxChars: 6 },
    { slotId: 'subtitle-1', role: 'body', sourceText: '竞品副标题', x: 0.1, y: 0.3, width: 0.8, height: 0.05, maxChars: 6 },
  ];
  const context = {
    ...env.context,
    runRecognition: async (_request, meta) => {
      if (meta.kind === 'own-selling-points') {
        return JSON.stringify({
          productViews: [{
            sourceImageIndex: 0, cropRegion: { x: 0, y: 0, width: 1, height: 1 },
            viewAngle: 'front', visibleSides: ['front'], description: '', quality: 0.95,
          }],
          sellingPoints: [
            { id: 'sp-1', title: '按摩热敷双效', description: '舒缓肩颈疲劳' },
            { id: 'sp-2', title: '仿人手抓捏', description: '覆盖肩颈斜方肌' },
            { id: 'sp-3', title: '轻巧便携', description: '办公居家皆适用' },
          ],
        });
      }
      competitorCalls += 1;
      return JSON.stringify({ page: {
        pageType: 'marketing', pageMode: 'MARKETING_MODE', strictPageCategory: 'none',
        hasPerson: false, selectedProductViewIds: ['pv-1'], productInstances: [], copySlots,
        mappedSellingPoints: copySlots.map(slot => ({
          sellingPointId: 'sp-1', slotId: slot.slotId, slotRole: slot.role,
          replacementText: '按摩热敷双效舒缓',
        })),
        mappedFacts: [],
      } });
    },
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return { buffer: Buffer.from('auto-repaired-copy'), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'auto-repair-marketing-copy-job',
    productImages: [], productNodeIds: [],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');

  const replacements = completed.pages[0].mappedSellingPoints.map(item => item.replacementText);
  assert.equal(competitorCalls, 2);
  assert.equal(generationCalls.length, 1);
  assert.equal(completed.pages[0].recognitionAutoRepairCount, 3);
  assert.equal(new Set(replacements).size, replacements.length);
  assert.ok(replacements.every(text => [...text].length <= 6));
  for (const replacement of replacements) assert.match(generationCalls[0].request.prompt, new RegExp(replacement));
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

test('旧规则已完成识别但未提交生图的失败页仍可安全重规划', t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const context = { ...env.context, autoStart: false };
  const created = createDetailRemixJob(basePayload({
    jobId: 'retry-completed-recognition-job',
    productImages: [], productNodeIds: [],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
  }), context);
  const persisted = __detailRemixTest.readJob(created.id, 'workflow-1', context.dirs);
  persisted.status = 'partial_failed';
  persisted.phase = 'final';
  persisted.pages[0].status = 'failed';
  persisted.pages[0].recognitionStatus = 'completed';
  persisted.pages[0].competitorAnalysisVersion = 2;
  persisted.pages[0].analysis = { pageMode: 'STRICT_PARAMETER_MODE', strictPageCategory: 'model' };
  persisted.pages[0].errorCode = 'DETAIL_REMIX_SPEC_FACTS_MISSING';
  persisted.pages[0].error = '旧版误判参数页';
  __detailRemixTest.writeJob(persisted, context);

  const retried = retryFailedDetailRemixPages(created.id, 'workflow-1', { pageIndexes: [0] }, context);
  assert.equal(retried.status, 'pending');
  assert.equal(retried.pages[0].status, 'waiting');
  assert.equal(retried.pages[0].recognitionStatus, 'waiting');
  assert.equal(retried.pages[0].analysis, undefined);
  assert.equal(retried.pages[0].competitorAnalysisVersion, undefined);
  assert.equal(retried.pages[0].retryCount, 1);
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
  assert.throws(() => createDetailRemixJob(basePayload({
    jobId: 'same-mold-product-required',
    generationMode: 'same-mold-recolor',
    productImages: [],
    productNodeIds: [],
  }), context), /同模换色.*产品参考图/);

  createDetailRemixJob(basePayload({ jobId: 'immutable-product-job' }), context);
  assert.throws(() => createDetailRemixJob(basePayload({
    jobId: 'immutable-product-job', productImages: [PRODUCT_2], productNodeIds: ['product-2'],
  }), context), error => error?.code === 'IDEMPOTENCY_CONFLICT');

  createDetailRemixJob(basePayload({
    jobId: 'immutable-generation-mode-job',
    generationMode: 'same-mold-recolor',
  }), context);
  assert.throws(() => createDetailRemixJob(basePayload({
    jobId: 'immutable-generation-mode-job',
    generationMode: 'direct-replacement',
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
  assert.throws(
    () => createDetailRemixJob(basePayload({
      jobId: 'idempotent-detail-job',
      lockProductIdentity: true,
    }), context),
    error => error?.code === 'IDEMPOTENCY_CONFLICT',
  );

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
  assert.match(generationCalls[0].request.prompt, /参考图3只允许用于 page_graphic 页面品牌槽/);
  assert.match(generationCalls[0].request.prompt, /严禁复制.*深色背景.*矩形边界/);
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

test('Codex 生图最多发送五张参考图，并由程序确定性保留版式、双产品角度、Logo 与人物', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const generationCalls = [];
  const context = {
    ...env.context,
    runRecognition: async (_request, meta) => meta.kind === 'own-selling-points'
      ? JSON.stringify({
        brandIdentity: {
          name: 'SUPOR', logoSourceImageIndex: 0,
          logoRegion: { x: 0, y: 0, width: 1, height: 1 },
        },
        productViews: [1, 2, 3].map(index => ({
          sourceImageIndex: 0,
          cropRegion: { x: (index - 1) * 0.1, y: 0, width: 0.8, height: 1 },
          viewAngle: `angle-${index}`,
          visibleSides: ['front'],
          description: `角度 ${index}`,
          quality: 1 - index * 0.01,
        })),
        sellingPoints: [{ id: 'sp-1', title: '肩颈放松' }],
      })
      : JSON.stringify({ page: {
        pageType: 'marketing', hasPerson: true,
        selectedProductViewIds: ['pv-1', 'pv-2', 'pv-3'],
        productInstances: [], copySlots: [], mappedSellingPoints: [], mappedFacts: [],
      } }),
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return { buffer: Buffer.from('codex-five-reference-final'), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'codex-five-reference-limit-job',
    imageModel: 'codex-imagegen',
    ownDetails: [{ nodeId: 'own-node', imageUrl: PIXEL, order: 0 }],
    productImages: [],
    productNodeIds: [],
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');

  assert.equal(generationCalls.length, 1);
  assert.equal(generationCalls[0].request.referenceImageInputs.length, 5);
  assert.deepEqual(generationCalls[0].meta.referenceKinds, [
    'competitor-layout',
    'own-product-auto-angle',
    'own-product-auto-angle',
    'own-brand-logo',
    'character',
  ]);
  assert.equal(completed.pages[0].selectedProductViews.length, 2);
  assert.equal(completed.pages[0].generationReferenceCount, 5);
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
            id: 'fact-local-1', field: 'power', label: '额定功率', value: '16W',
            normalizedValue: '16W', displayText: '额定功率\n16W', evidenceImageIndex: 0,
            evidenceRegion: { x: 0.1, y: 0.5, width: 0.4, height: 0.1 }, confidence: 0.99,
          }],
        });
      }
      return JSON.stringify({ page: {
        pageType: 'specification', hasPerson: false,
        selectedProductViewIds: ['pv-1'],
        productInstances: [{ x: 0.1, y: 0.1, width: 0.8, height: 0.3 }],
        copySlots: [
          { slotId: 'power-label', role: 'parameterLabel', field: 'power', parameterPart: 'label', sourceText: '工作功率', x: 0.1, y: 0.4, width: 0.3, height: 0.05 },
          { slotId: 'power-value', role: 'parameterValue', field: 'power', parameterPart: 'value', sourceText: '20W', x: 0.5, y: 0.4, width: 0.2, height: 0.05 },
          { slotId: 'capacity-label', role: 'parameterLabel', field: 'battery_capacity', parameterPart: 'label', sourceText: '电池容量', x: 0.1, y: 0.5, width: 0.3, height: 0.05 },
          { slotId: 'capacity-value', role: 'parameterValue', field: 'battery_capacity', parameterPart: 'value', sourceText: '2500mAh', x: 0.5, y: 0.5, width: 0.2, height: 0.05 },
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
            id: 'local', field: 'power', label: '额定功率', value: '16W',
            normalizedValue: '16W', displayText: '额定功率\n16W', evidenceImageIndex: 0,
            evidenceRegion: { x: 0, y: 0, width: 1, height: 1 }, confidence: 1,
          }],
        });
      }
      if (meta.kind === 'competitor-page') {
        return JSON.stringify({ page: {
          pageType: 'specification', hasPerson: false,
          selectedProductViewIds: ['pv-1'], productInstances: [],
          copySlots: [
            { slotId: 'power-label', role: 'parameterLabel', field: 'power', parameterPart: 'label', sourceText: '功率', x: 0.1, y: 0.1, width: 0.3, height: 0.05 },
            { slotId: 'power-value', role: 'parameterValue', field: 'power', parameterPart: 'value', sourceText: '20W', x: 0.5, y: 0.1, width: 0.2, height: 0.05 },
          ],
          mappedSellingPoints: [],
          mappedFacts: [
            { factId: 'fact-1', slotId: 'power-label', slotRole: 'parameterLabel', displayPart: 'label' },
            { factId: 'fact-1', slotId: 'power-value', slotRole: 'parameterValue', displayPart: 'value' },
          ],
        } });
      }
      validationCalls += 1;
      return JSON.stringify(validationCalls === 1 ? {
        passed: false, copyExact: false, brandCorrect: true, productCorrect: true,
        logoCorrect: true, logoPresentationCorrect: true,
        layoutHierarchyCorrect: true, visualPolishCorrect: true, layoutIssues: [],
        productPlacementCorrect: true,
        parameterAlignmentCorrect: false, unsupportedStrictFactsAbsent: true,
        characterIdentityCorrect: true, characterHairstyleCorrect: true,
        characterOutfitCorrect: true, characterAccessoriesCorrect: true, characterIssues: [],
        competitorRemoved: true, gibberishDetected: true,
        missingTexts: [], wrongTexts: ['把16W写成16V'], unexpectedTexts: [], summary: '参数错字',
      } : {
        passed: true, copyExact: true, brandCorrect: true, productCorrect: true,
        logoCorrect: true, logoPresentationCorrect: true,
        layoutHierarchyCorrect: true, visualPolishCorrect: true, layoutIssues: [],
        productPlacementCorrect: true,
        parameterAlignmentCorrect: true, unsupportedStrictFactsAbsent: true,
        characterIdentityCorrect: true, characterHairstyleCorrect: true,
        characterOutfitCorrect: true, characterAccessoriesCorrect: true, characterIssues: [],
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
  assert.match(generationCalls[1].request.prompt, /只修复质检报告中失败的区域/);
  assert.equal(generationCalls[1].meta.referenceKinds[0], 'quality-failed-final');
  assert.ok(completed.pages[0].finalUrl);
});

test('文案层级或 Logo 容器破坏时不得误判通过，定向修复携带竞品原图恢复高级感版式', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  let validationCalls = 0;
  const validationRequests = [];
  const generationCalls = [];
  const context = {
    ...env.context,
    skipFinalValidation: false,
    runRecognition: async (request, meta) => {
      if (meta.kind === 'own-selling-points') {
        return JSON.stringify({
          productViews: [{
            sourceImageIndex: 0, cropRegion: { x: 0, y: 0, width: 1, height: 1 },
            viewAngle: 'front', visibleSides: ['front'], description: '', quality: 0.95,
          }],
          sellingPoints: [
            { id: 'sp-1', title: '肩颈按摩器' },
            { id: 'sp-2', title: '仿人手深层揉捏' },
            { id: 'sp-3', title: '按摩热敷双效' },
          ],
        });
      }
      if (meta.kind === 'competitor-page') {
        return JSON.stringify({ page: {
          pageType: 'marketing', hasPerson: false,
          selectedProductViewIds: ['pv-1'], productInstances: [],
          copySlots: [
            { slotId: 'badge', role: 'featureBadge', sourceText: '竞品标签', x: 0.35, y: 0.1, width: 0.3, height: 0.04, maxChars: 8 },
            { slotId: 'headline', role: 'headline', sourceText: '竞品大标题', x: 0.1, y: 0.2, width: 0.8, height: 0.08, maxChars: 10 },
            { slotId: 'subheadline', role: 'featureSubheadline', sourceText: '竞品副标题', x: 0.15, y: 0.3, width: 0.7, height: 0.05, maxChars: 10 },
          ],
          mappedSellingPoints: [
            { sellingPointId: 'sp-1', slotId: 'badge', slotRole: 'featureBadge', replacementText: '肩颈按摩器' },
            { sellingPointId: 'sp-2', slotId: 'headline', slotRole: 'headline', replacementText: '仿人手深层揉捏' },
            { sellingPointId: 'sp-3', slotId: 'subheadline', slotRole: 'featureSubheadline', replacementText: '按摩热敷双效' },
          ],
          mappedFacts: [],
        } });
      }
      validationCalls += 1;
      validationRequests.push(request);
      const repaired = validationCalls > 1;
      return JSON.stringify({
        passed: true,
        copyExact: true,
        brandCorrect: true,
        productCorrect: true,
        logoCorrect: true,
        logoPresentationCorrect: repaired,
        layoutHierarchyCorrect: repaired,
        visualPolishCorrect: repaired,
        layoutIssues: repaired ? [] : ['主标题层级消失', 'Logo 被生成为深色矩形贴片'],
        productPlacementCorrect: true,
        parameterAlignmentCorrect: true,
        unsupportedStrictFactsAbsent: true,
        characterIdentityCorrect: true,
        characterHairstyleCorrect: true,
        characterOutfitCorrect: true,
        characterAccessoriesCorrect: true,
        characterIssues: [],
        competitorRemoved: true,
        gibberishDetected: false,
        missingTexts: [],
        wrongTexts: [],
        unexpectedTexts: [],
        summary: repaired ? '通过' : '版式与 Logo 呈现失败',
      });
    },
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return { buffer: Buffer.from(`layout-${meta.phase}`), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'layout-logo-validation-repair-job',
    productImages: [], productNodeIds: [],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');

  assert.equal(validationCalls, 2);
  assert.deepEqual(generationCalls.map(call => call.meta.phase), ['final-detail', 'final-repair']);
  assert.deepEqual(generationCalls[1].meta.referenceKinds, [
    'quality-failed-final', 'competitor-layout-original', 'own-product-auto-angle',
  ]);
  assert.equal(generationCalls[1].request.referenceImageInputs[1], COMPETITOR);
  assert.equal(validationRequests[0].imageDataUrls[1], COMPETITOR);
  assert.match(generationCalls[1].request.prompt, /恢复胶囊标签、主标题、副标题/);
  assert.match(generationCalls[1].request.prompt, /贴图方块和脏底/);
  assert.equal(completed.pages[0].validation.layoutHierarchyCorrect, true);
  assert.equal(completed.pages[0].validation.visualPolishCorrect, true);
});

test('人物只换脸但发型服装不符时质检失败，定向修复继续携带完整人物参考', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  let validationCalls = 0;
  const validationRequests = [];
  const generationCalls = [];
  const context = {
    ...env.context,
    skipFinalValidation: false,
    runRecognition: async (request, meta) => {
      if (meta.kind === 'own-selling-points') {
        return JSON.stringify({
          productViews: [{
            sourceImageIndex: 0,
            cropRegion: { x: 0, y: 0, width: 1, height: 1 },
            viewAngle: 'front', visibleSides: ['front'], description: '', quality: 0.95,
          }],
          sellingPoints: [{ id: 'sp-1', title: '颈部放松' }],
        });
      }
      if (meta.kind === 'competitor-page') {
        return JSON.stringify({ page: {
          pageType: 'marketing', hasPerson: true,
          selectedProductViewIds: ['pv-1'], productInstances: [], copySlots: [],
          mappedSellingPoints: [], mappedFacts: [],
        } });
      }
      validationCalls += 1;
      validationRequests.push(request);
      const characterPassed = validationCalls > 1;
      return JSON.stringify({
        passed: characterPassed,
        copyExact: true,
        brandCorrect: true,
        productCorrect: true,
        logoCorrect: true,
        logoPresentationCorrect: true,
        layoutHierarchyCorrect: true,
        visualPolishCorrect: true,
        layoutIssues: [],
        productPlacementCorrect: true,
        parameterAlignmentCorrect: true,
        unsupportedStrictFactsAbsent: true,
        characterIdentityCorrect: true,
        characterHairstyleCorrect: characterPassed,
        characterOutfitCorrect: characterPassed,
        characterAccessoriesCorrect: true,
        characterIssues: characterPassed ? [] : ['只换了脸，仍保留竞品发型和服装'],
        competitorRemoved: true,
        gibberishDetected: false,
        missingTexts: [],
        wrongTexts: [],
        unexpectedTexts: [],
        summary: characterPassed ? '通过' : '人物造型不完整',
      });
    },
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return { buffer: Buffer.from(`character-${meta.phase}`), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'character-style-repair-job',
    productImages: [], productNodeIds: [],
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');

  assert.equal(validationCalls, 2);
  assert.deepEqual(generationCalls.map(call => call.meta.phase), ['final-detail', 'final-repair']);
  assert.deepEqual(generationCalls[0].meta.referenceKinds, [
    'competitor-layout', 'own-product-auto-angle', 'character',
  ]);
  assert.deepEqual(generationCalls[1].meta.referenceKinds, [
    'quality-failed-final', 'competitor-layout-original', 'own-product-auto-angle', 'character',
  ]);
  assert.equal(generationCalls[1].request.referenceImageInputs.at(-1), CHARACTER);
  assert.match(generationCalls[0].request.prompt, /绝不允许只换脸/);
  assert.match(generationCalls[1].request.prompt, /发型、服装或配饰/);
  assert.match(validationRequests[0].systemInstruction, /参考图4是人物完整造型参考/);
  assert.equal(validationRequests[0].imageDataUrls[1], COMPETITOR);
  assert.equal(validationRequests[0].imageDataUrls.at(-1), CHARACTER);
  assert.equal(completed.pages[0].validation.characterOutfitCorrect, true);
  assert.deepEqual(completed.pages[0].validation.characterIssues, []);
});

test('单页重新生成只提交首个指定成功页，失败页和已取消页保持不动且旧文件可恢复', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const recognitionCalls = [];
  const generationCalls = [];
  const context = {
    ...env.context,
    runRecognition: async (request, meta) => {
      recognitionCalls.push(meta);
      return completeRecognition({ hasPerson: false })(request, meta);
    },
    generateImage: async (_request, meta) => {
      generationCalls.push(meta);
      return { buffer: Buffer.from(`page-${meta.pageIndex}`), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'single-completed-page-regeneration-job',
    competitorDetails: [0, 1, 2].map(index => ({
      nodeId: `competitor-${index}`,
      imageUrl: COMPETITOR,
      order: index,
      sourceWidth: 600,
      sourceHeight: 800,
    })),
    useCharacterReference: false,
    characterReferenceImages: [],
    characterReferenceNodeIds: [],
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');
  const targetBefore = completed.pages[1];
  const oldResultNodeId = targetBefore.resultNodeId;
  const oldResultUrl = targetBefore.finalUrl;
  const oldResultPath = path.join(
    env.root, 'library', 'projects', '详情复刻测试', 'images', `${oldResultNodeId}.png`,
  );
  assert.ok(fs.existsSync(oldResultPath));

  const interrupted = __detailRemixTest.readJob(created.id, 'workflow-1', context.dirs);
  interrupted.status = 'cancelled';
  interrupted.stage = 'cancelled';
  interrupted.cancelRequested = true;
  interrupted.pages[0].status = 'failed';
  interrupted.pages[0].finalUrl = undefined;
  interrupted.pages[0].resultUrl = undefined;
  interrupted.pages[2].status = 'cancelled';
  interrupted.pages[2].finalUrl = undefined;
  interrupted.pages[2].resultUrl = undefined;
  __detailRemixTest.writeJob(interrupted, context);
  recognitionCalls.length = 0;
  generationCalls.length = 0;

  const regenerationContext = {
    ...context,
    newId: () => 'fresh-regenerated-result-node',
    autoStart: false,
  };
  const queued = regenerateDetailRemixPages(
    created.id,
    'workflow-1',
    { pageIndex: 1 },
    regenerationContext,
  );
  assert.equal(queued.status, 'pending');
  assert.equal(queued.pages[0].status, 'failed');
  assert.equal(queued.pages[1].status, 'waiting');
  assert.equal(queued.pages[2].status, 'cancelled');
  assert.equal(queued.pages[1].resultNodeId, 'fresh-regenerated-result-node');
  assert.equal(queued.pages[1].previousResults.at(-1).resultNodeId, oldResultNodeId);
  assert.equal(queued.pages[1].previousResults.at(-1).finalUrl, oldResultUrl);
  assert.equal(queued.pages[1].recognitionStatus, 'completed');
  assert.ok(queued.pages[1].analysis);

  const executionContext = { ...regenerationContext, autoStart: true };
  void __detailRemixTest.executeFinalPhase(queued, executionContext);
  const regenerated = await waitFor(
    created.id,
    executionContext,
    job => job?.status === 'partial_failed',
  );
  assert.deepEqual(recognitionCalls, []);
  assert.deepEqual(generationCalls.map(meta => meta.pageIndex), [1]);
  assert.equal(regenerated.pages[0].status, 'failed');
  assert.equal(regenerated.pages[1].status, 'completed');
  assert.equal(regenerated.pages[2].status, 'cancelled');
  assert.equal(regenerated.pages[1].regenerationCount, 1);
  assert.equal(regenerated.pages[1].resultNodeId, 'fresh-regenerated-result-node');
  assert.ok(fs.existsSync(oldResultPath));
});

test('严格参数字段错配会被安全删除，页面继续生成且不泄漏错误数值', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const generationCalls = [];
  const context = {
    ...env.context,
    runRecognition: async (_request, meta) => {
      if (meta.kind === 'own-selling-points') {
        return JSON.stringify({
          brandIdentity: {},
          productViews: [{
            sourceImageIndex: 0,
            cropRegion: { x: 0, y: 0, width: 1, height: 1 },
            viewAngle: 'front', visibleSides: ['front'], description: '', quality: 0.95,
          }],
          sellingPoints: [],
          verifiedFacts: [{
            id: 'local', field: 'power', label: '额定功率', value: '16W',
            normalizedValue: '16W', displayText: '额定功率\n16W', evidenceImageIndex: 0,
            evidenceRegion: { x: 0.1, y: 0.5, width: 0.4, height: 0.1 }, confidence: 0.99,
          }],
        });
      }
      return JSON.stringify({ page: {
        pageType: '电气参数页', hasPerson: false,
        selectedProductViewIds: ['pv-1'], productInstances: [],
        copySlots: [
          { slotId: 'power-label', role: 'parameterLabel', field: 'voltage', parameterPart: 'label', sourceText: '额定功率', x: 0.1, y: 0.1, width: 0.3, height: 0.05 },
          { slotId: 'power-value', role: 'parameterValue', field: 'voltage', parameterPart: 'value', sourceText: '24W', x: 0.5, y: 0.1, width: 0.2, height: 0.05 },
        ],
        mappedSellingPoints: [],
        mappedFacts: [
          { factId: 'fact-1', slotId: 'power-label', slotRole: 'parameterLabel', displayPart: 'label' },
          { factId: 'fact-1', slotId: 'power-value', slotRole: 'parameterValue', displayPart: 'value' },
        ],
      } });
    },
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return { buffer: Buffer.from('strict-mismatch-removed'), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'strict-field-mismatch-job',
    productImages: [], productNodeIds: [],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');
  assert.equal(generationCalls.length, 1);
  assert.equal(completed.pages[0].recognitionAttempts, 2);
  assert.equal(completed.pages[0].recognitionContractRetries, 1);
  assert.deepEqual(completed.pages[0].mappedFacts, []);
  assert.ok(completed.pages[0].factMappingAudit.rejected.some(item => item.reason === 'field_mismatch'));
  assert.doesNotMatch(generationCalls[0].request.prompt, /24W|16W/);
  assert.match(generationCalls[0].request.prompt, /没有证据映射的竞品参数栏必须连标签和值一起删除/);
});

test('质检自称通过但仍报告无证据参数时不得放行，修复与整页重生成都用尽后标记 FAILED_VALIDATION', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  let validationCalls = 0;
  const generationPhases = [];
  const context = {
    ...env.context,
    skipFinalValidation: false,
    runRecognition: async (_request, meta) => {
      if (meta.kind === 'own-selling-points') {
        return JSON.stringify({
          brandIdentity: {},
          productViews: [{
            sourceImageIndex: 0,
            cropRegion: { x: 0, y: 0, width: 1, height: 1 },
            viewAngle: 'front', visibleSides: ['front'], description: '', quality: 0.95,
          }],
          sellingPoints: [],
          verifiedFacts: [{
            id: 'local', field: 'power', label: '额定功率', value: '16W',
            normalizedValue: '16W', displayText: '额定功率\n16W', evidenceImageIndex: 0,
            evidenceRegion: { x: 0.1, y: 0.5, width: 0.4, height: 0.1 }, confidence: 0.99,
          }],
        });
      }
      if (meta.kind === 'competitor-page') {
        return JSON.stringify({ page: {
          pageType: 'specification', hasPerson: false,
          selectedProductViewIds: ['pv-1'], productInstances: [],
          copySlots: [
            { slotId: 'power-label', role: 'parameterLabel', field: 'power', parameterPart: 'label', sourceText: '功率', x: 0.1, y: 0.1, width: 0.3, height: 0.05 },
            { slotId: 'power-value', role: 'parameterValue', field: 'power', parameterPart: 'value', sourceText: '24W', x: 0.5, y: 0.1, width: 0.2, height: 0.05 },
          ],
          mappedSellingPoints: [],
          mappedFacts: [
            { factId: 'fact-1', slotId: 'power-label', slotRole: 'parameterLabel', displayPart: 'label' },
            { factId: 'fact-1', slotId: 'power-value', slotRole: 'parameterValue', displayPart: 'value' },
          ],
        } });
      }
      validationCalls += 1;
      return JSON.stringify({
        passed: true, copyExact: true, brandCorrect: true, productCorrect: true,
        logoCorrect: true, productPlacementCorrect: true,
        parameterAlignmentCorrect: true, unsupportedStrictFactsAbsent: true,
        characterIdentityCorrect: true, characterHairstyleCorrect: true,
        characterOutfitCorrect: true, characterAccessoriesCorrect: true, characterIssues: [],
        competitorRemoved: true, gibberishDetected: false,
        missingTexts: [], wrongTexts: [], unexpectedTexts: ['2500mAh'],
        summary: '仍有无证据参数',
      });
    },
    generateImage: async (_request, meta) => {
      generationPhases.push(meta.phase);
      return { buffer: Buffer.from(`validation-${meta.phase}`), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'strict-validation-failure-job',
    productImages: [], productNodeIds: [],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
  }), context);
  const failed = await waitFor(created.id, context, job => job?.stage === 'failed_validation');
  // Hard facts survived the targeted edit, so the page escalates to one full
  // re-generation before the gate gives up on it.
  assert.equal(validationCalls, 3);
  assert.deepEqual(generationPhases, ['final-detail', 'final-repair', 'final-regenerate-1']);
  assert.equal(failed.pages[0].structuralRegenerationAttempts, 1);
  assert.equal(failed.pages[0].status, 'failed_validation');
  assert.equal(failed.pages[0].terminalStatus, 'FAILED_VALIDATION');
  assert.equal(failed.pages[0].validationStatus, 'FAILED_VALIDATION');
  assert.equal(failed.pages[0].finalUrl, undefined);
});

/** Marketing-page recognition with three copy slots; enough to exercise the quality gate. */
const marketingRecognition = async (_request, meta) => {
  if (meta.kind === 'own-selling-points') {
    return JSON.stringify({
      productViews: [{
        sourceImageIndex: 0, cropRegion: { x: 0, y: 0, width: 1, height: 1 },
        viewAngle: 'front', visibleSides: ['front'], description: '', quality: 0.95,
      }],
      sellingPoints: [
        { id: 'sp-1', title: '肩颈按摩器' },
        { id: 'sp-2', title: '仿人手深层揉捏' },
      ],
    });
  }
  return JSON.stringify({ page: {
    pageType: 'marketing', hasPerson: false,
    selectedProductViewIds: ['pv-1'], productInstances: [],
    copySlots: [
      { slotId: 'badge', role: 'featureBadge', sourceText: '竞品标签', x: 0.35, y: 0.1, width: 0.3, height: 0.04, maxChars: 8 },
      { slotId: 'headline', role: 'headline', sourceText: '竞品大标题', x: 0.1, y: 0.2, width: 0.8, height: 0.08, maxChars: 10 },
    ],
    mappedSellingPoints: [
      { sellingPointId: 'sp-1', slotId: 'badge', slotRole: 'featureBadge', replacementText: '肩颈按摩器' },
      { sellingPointId: 'sp-2', slotId: 'headline', slotRole: 'headline', replacementText: '仿人手深层揉捏' },
    ],
    mappedFacts: [],
  } });
};

const cleanValidation = (overrides = {}) => ({
  passed: true, copyExact: true, brandCorrect: true, productCorrect: true,
  logoCorrect: true, logoPresentationCorrect: true,
  layoutHierarchyCorrect: true, visualPolishCorrect: true, layoutIssues: [],
  productPlacementCorrect: true,
  parameterAlignmentCorrect: true, unsupportedStrictFactsAbsent: true,
  characterIdentityCorrect: true, characterHairstyleCorrect: true,
  characterOutfitCorrect: true, characterAccessoriesCorrect: true, characterIssues: [],
  competitorRemoved: true, gibberishDetected: false,
  missingTexts: [], wrongTexts: [], unexpectedTexts: [], summary: '通过',
  ...overrides,
});

test('只报告主观问题时先复核一次；复核通过则直接交付，不额外付费生图', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  let validationCalls = 0;
  const generationPhases = [];
  const context = {
    ...env.context,
    skipFinalValidation: false,
    runRecognition: async (request, meta) => {
      if (meta.kind !== 'final-detail-validation') return marketingRecognition(request, meta);
      validationCalls += 1;
      return JSON.stringify(validationCalls === 1
        ? cleanValidation({
          passed: false, visualPolishCorrect: false,
          layoutIssues: ['字距略松'], summary: '精修不足',
        })
        : cleanValidation());
    },
    generateImage: async (_request, meta) => {
      generationPhases.push(meta.phase);
      return { buffer: Buffer.from(`advisory-${meta.phase}`), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'advisory-rejudge-pass-job',
    productImages: [], productNodeIds: [],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');

  assert.equal(validationCalls, 2);
  assert.deepEqual(generationPhases, ['final-detail']);
  assert.equal(completed.pages[0].validationRejudgeCount, 1);
  assert.equal(completed.pages[0].repairAttempts || 0, 0);
  assert.equal(completed.pages[0].deliveredWithWarnings, undefined);
  assert.ok(completed.pages[0].finalUrl);
});

test('主观问题被复核确认后仍只修复一次，修复无效则带质检提示交付而非作废', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  let validationCalls = 0;
  const generationPhases = [];
  const context = {
    ...env.context,
    skipFinalValidation: false,
    runRecognition: async (request, meta) => {
      if (meta.kind !== 'final-detail-validation') return marketingRecognition(request, meta);
      validationCalls += 1;
      return JSON.stringify(cleanValidation({
        passed: false, visualPolishCorrect: false,
        layoutIssues: ['字距略松'], summary: '精修不足',
      }));
    },
    generateImage: async (_request, meta) => {
      generationPhases.push(meta.phase);
      return { buffer: Buffer.from(`advisory-${meta.phase}`), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'advisory-warning-delivery-job',
    productImages: [], productNodeIds: [],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');

  // First report, one re-judge, then one re-check after the single repair.
  assert.equal(validationCalls, 3);
  // No paid re-generation: nothing factual was ever wrong with the page.
  assert.deepEqual(generationPhases, ['final-detail', 'final-repair']);
  assert.equal(completed.pages[0].structuralRegenerationAttempts || 0, 0);
  assert.equal(completed.pages[0].status, 'completed');
  assert.equal(completed.pages[0].deliveredWithWarnings, true);
  assert.equal(completed.pages[0].validationStatus, 'passed_with_warnings');
  assert.deepEqual(completed.pages[0].validationWarnings, ['视觉精修不足', '版式问题']);
  assert.ok(completed.pages[0].finalUrl);
});

test('文案写错等硬性问题不触发复核，直接进入定向修复', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  let validationCalls = 0;
  const generationPhases = [];
  const context = {
    ...env.context,
    skipFinalValidation: false,
    runRecognition: async (request, meta) => {
      if (meta.kind !== 'final-detail-validation') return marketingRecognition(request, meta);
      validationCalls += 1;
      return JSON.stringify(validationCalls === 1
        ? cleanValidation({
          passed: false, copyExact: false,
          wrongTexts: ['把揉捏写成柔捏'], summary: '文案写错',
        })
        : cleanValidation());
    },
    generateImage: async (_request, meta) => {
      generationPhases.push(meta.phase);
      return { buffer: Buffer.from(`blocking-${meta.phase}`), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'blocking-no-rejudge-job',
    productImages: [], productNodeIds: [],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');

  assert.equal(validationCalls, 2);
  assert.equal(completed.pages[0].validationRejudgeCount, undefined);
  assert.deepEqual(generationPhases, ['final-detail', 'final-repair']);
  assert.ok(completed.pages[0].finalUrl);
});

test('整页重生成次数可调为 0，保持旧的一次修复即终止行为', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const generationPhases = [];
  const context = {
    ...env.context,
    skipFinalValidation: false,
    maxStructuralRegenerations: 0,
    runRecognition: async (request, meta) => {
      if (meta.kind !== 'final-detail-validation') return marketingRecognition(request, meta);
      return JSON.stringify(cleanValidation({
        passed: false, copyExact: false,
        wrongTexts: ['把揉捏写成柔捏'], summary: '文案写错',
      }));
    },
    generateImage: async (_request, meta) => {
      generationPhases.push(meta.phase);
      return { buffer: Buffer.from(`nobudget-${meta.phase}`), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'no-regeneration-budget-job',
    productImages: [], productNodeIds: [],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
  }), context);
  const failed = await waitFor(created.id, context, job => job?.stage === 'failed_validation');

  assert.deepEqual(generationPhases, ['final-detail', 'final-repair']);
  assert.equal(failed.pages[0].terminalStatus, 'FAILED_VALIDATION');
});

test('质检失败页可以单独重新生成，旧候选保留在历史结果中', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  let failEverything = true;
  const generationPhases = [];
  const context = {
    ...env.context,
    skipFinalValidation: false,
    maxStructuralRegenerations: 0,
    runRecognition: async (request, meta) => {
      if (meta.kind !== 'final-detail-validation') return marketingRecognition(request, meta);
      return JSON.stringify(failEverything
        ? cleanValidation({ passed: false, copyExact: false, wrongTexts: ['错字'], summary: '文案写错' })
        : cleanValidation());
    },
    generateImage: async (_request, meta) => {
      generationPhases.push(meta.phase);
      return { buffer: Buffer.from(`retry-${meta.phase}`), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'validation-failed-regenerate-job',
    productImages: [], productNodeIds: [],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
  }), context);
  const failed = await waitFor(created.id, context, job => job?.stage === 'failed_validation');
  const supersededNodeId = failed.pages[0].resultNodeId;
  assert.equal(failed.pages[0].status, 'failed_validation');

  failEverything = false;
  generationPhases.length = 0;
  regenerateDetailRemixPages(created.id, 'workflow-1', { pageIndexes: [0] }, context);
  const recovered = await waitFor(created.id, context, job => job?.status === 'completed');

  assert.deepEqual(generationPhases, ['final-detail']);
  assert.equal(recovered.pages[0].status, 'completed');
  assert.ok(recovered.pages[0].finalUrl);
  assert.notEqual(recovered.pages[0].resultNodeId, supersededNodeId);
  assert.equal(recovered.pages[0].previousResults.length, 1);
  assert.equal(recovered.pages[0].previousResults[0].status, 'failed_validation');
  assert.ok(recovered.pages[0].previousResults[0].qualityFailedCandidateUrl);
});

test('导出清单默认只含已验收结果，开启候选后按页码补齐未过检页', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const context = {
    ...env.context,
    skipFinalValidation: false,
    maxStructuralRegenerations: 0,
    runRecognition: async (request, meta) => {
      if (meta.kind !== 'final-detail-validation') return marketingRecognition(request, meta);
      return JSON.stringify(cleanValidation({
        passed: false, copyExact: false, wrongTexts: ['错字'], summary: '文案写错',
      }));
    },
    generateImage: async () => ({ buffer: Buffer.from('candidate-page'), extension: 'png' }),
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'candidate-export-job',
    productImages: [], productNodeIds: [],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
  }), context);
  const failed = await waitFor(created.id, context, job => job?.stage === 'failed_validation');
  assert.equal(failed.pages[0].status, 'failed_validation');
  assert.ok(failed.pages[0].qualityFailedCandidateUrl);

  assert.throws(
    () => getDetailRemixExportManifest(created.id, 'workflow-1', context),
    error => error.code === 'DETAIL_REMIX_EXPORT_EMPTY',
  );
  const withCandidates = getDetailRemixExportManifest(
    created.id,
    'workflow-1',
    context,
    { includeCandidates: true },
  );
  assert.equal(withCandidates.count, 1);
  assert.equal(withCandidates.candidateCount, 1);
  assert.equal(withCandidates.files[0].candidate, true);
  assert.equal(withCandidates.files[0].pageIndex, 0);
  assert.ok(fs.existsSync(withCandidates.files[0].sourcePath));
});

/** Two competitor pages sharing one own-detail source; enough to observe overlap. */
function twoPagePayload(overrides = {}) {
  return basePayload({
    competitorDetails: [
      { nodeId: 'competitor-node', imageUrl: COMPETITOR, order: 0, sourceWidth: 600, sourceHeight: 800 },
      { nodeId: 'competitor-node-2', imageUrl: COMPETITOR, order: 1, sourceWidth: 600, sourceHeight: 800 },
    ],
    productImages: [], productNodeIds: [],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
    ...overrides,
  });
}

test('Codex CLI 识图时竞品分析先并发预跑，生图仍逐张串行', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  let liveRecognitions = 0;
  let peakRecognitions = 0;
  let liveGenerations = 0;
  let peakGenerations = 0;
  const context = {
    ...env.context,
    runRecognition: async (request, meta) => {
      if (meta.kind !== 'competitor-page') return marketingRecognition(request, meta);
      liveRecognitions += 1;
      peakRecognitions = Math.max(peakRecognitions, liveRecognitions);
      await new Promise(resolve => setTimeout(resolve, 20));
      liveRecognitions -= 1;
      return marketingRecognition(request, meta);
    },
    generateImage: async () => {
      liveGenerations += 1;
      peakGenerations = Math.max(peakGenerations, liveGenerations);
      await new Promise(resolve => setTimeout(resolve, 10));
      liveGenerations -= 1;
      return { buffer: Buffer.from('concurrent-page'), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(twoPagePayload({
    jobId: 'recognition-prefetch-job',
    recognitionProvider: 'codex-cli',
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed', 'prefetch job stuck');

  assert.equal(peakRecognitions, 2);
  // Paid generations stay strictly one at a time; only the unpaid step overlaps.
  assert.equal(peakGenerations, 1);
  assert.equal(completed.pages.length, 2);
  assert.ok(completed.pages.every(page => page.status === 'completed'));
});

test('Gemini Web 识图共用同一个浏览器，必须保持串行不预跑', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  let liveRecognitions = 0;
  let peakRecognitions = 0;
  const context = {
    ...env.context,
    runRecognition: async (request, meta) => {
      if (meta.kind !== 'competitor-page') return marketingRecognition(request, meta);
      liveRecognitions += 1;
      peakRecognitions = Math.max(peakRecognitions, liveRecognitions);
      await new Promise(resolve => setTimeout(resolve, 20));
      liveRecognitions -= 1;
      return marketingRecognition(request, meta);
    },
    generateImage: async () => ({ buffer: Buffer.from('serial-page'), extension: 'png' }),
  };
  const created = createDetailRemixJob(twoPagePayload({
    jobId: 'recognition-serial-job',
    recognitionProvider: 'gemini-web',
  }), context);
  await waitFor(created.id, context, job => job?.status === 'completed', 'serial job stuck');

  assert.equal(peakRecognitions, 1);
});

test('提交阶段按页判定：预提交的下一页不会被别页的修复边界误判为待核对', t => {
  const presubmitted = {
    index: 1,
    status: 'submitting',
    codexImageJobId: 'child-next-page',
  };
  const repairing = {
    index: 0,
    status: 'submitting',
    repairAttempts: 1,
    repairCodexImageJobId: 'child-repair',
  };
  const regenerating = {
    index: 2,
    status: 'submitting',
    structuralRegenerationAttempts: 2,
    regenerateCodexImageJobId2: 'child-regen-2',
  };
  const isolating = {
    index: 3,
    status: 'submitting',
    plateCodexImageJobId: 'child-scene-plate',
  };
  assert.equal(__detailRemixTest.interruptedPhaseForPage(presubmitted), 'final-detail');
  assert.equal(__detailRemixTest.interruptedPhaseForPage(repairing), 'final-repair');
  assert.equal(__detailRemixTest.interruptedPhaseForPage(regenerating), 'final-regenerate-2');
  assert.equal(__detailRemixTest.interruptedPhaseForPage(isolating), 'blank-plate');
  // A finished repair falls back to the plain generation phase.
  assert.equal(
    __detailRemixTest.interruptedPhaseForPage({ ...repairing, repairCompletedAt: '2026-08-14T00:00:00.000Z' }),
    'final-detail',
  );
});

test('Codex 生图时在质检期间预提交下一页，且每页各自记录子任务便于取消与恢复', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const context = { ...env.context, autoStart: false };
  const created = createDetailRemixJob(twoPagePayload({
    jobId: 'presubmit-pipeline-job',
    imageModel: 'codex-imagegen',
    productImages: [PRODUCT],
    productNodeIds: ['product-node'],
  }), context);

  const job = __detailRemixTest.readJob(created.id, 'workflow-1', context.dirs);
  // Both analyses are already done; page 1 is mid-validation with its raw image saved.
  for (const page of job.pages) {
    page.recognitionStatus = 'completed';
    page.competitorAnalysisVersion = 4;
    page.analysis = {
      pageType: 'marketing', hasPerson: false, copySlots: [], productInstances: [],
      // analyzeCompetitorPage stamps the source size onto the analysis; the
      // prompt reads it from there, so a realistic stub must carry it too.
      sourceWidth: 600, sourceHeight: 800,
    };
  }
  job.pages[0].status = 'normalizing_output';
  job.pages[0].rawResultUrl = '/library/projects/x/images/page-1-raw.png';
  await __detailRemixTest.presubmitNextPageGeneration(job, job.pages[0], context);

  const queued = listCodexImageJobs(context.codexJobsDir);
  assert.equal(queued.length, 1);
  assert.equal(job.pages[1].codexImageJobId, queued[0].id);
  assert.equal(job.pages[1].status, 'submitting');
  assert.ok(job.pages[1].presubmittedAt);
  // The job-wide boundary still points at nothing; the pointer that matters lives on the page.
  assert.equal(job.currentSubmission, undefined);

  // A second call must not queue the same page twice.
  await __detailRemixTest.presubmitNextPageGeneration(job, job.pages[0], context);
  assert.equal(listCodexImageJobs(context.codexJobsDir).length, 1);

  // Cancelling reaps the pre-submitted child even though it was never the awaited submission.
  job.status = 'processing';
  __detailRemixTest.writeJob(job, context);
  const cancelled = cancelDetailRemixJob(created.id, 'workflow-1', context);
  assert.deepEqual(cancelled.cancelledChildJobIds, [queued[0].id]);
  assert.equal(getCodexImageJob(context.codexJobsDir, queued[0].id).status, 'cancelled');
});

test('质检调用崩溃可安全重试，不让判图故障作废已付费的成图', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  let validationCalls = 0;
  let generationCalls = 0;
  const context = {
    ...env.context,
    skipFinalValidation: false,
    validationRetryDelayMs: 0,
    runRecognition: async (request, meta) => {
      if (meta.kind !== 'final-detail-validation') return marketingRecognition(request, meta);
      validationCalls += 1;
      if (validationCalls === 1) throw new Error('Codex CLI 进程退出码 1');
      return JSON.stringify(cleanValidation());
    },
    generateImage: async () => {
      generationCalls += 1;
      return { buffer: Buffer.from('flaky-judge'), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'flaky-validation-job',
    productImages: [], productNodeIds: [],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed', 'flaky judge job stuck');

  assert.equal(validationCalls, 2);
  // The image was never regenerated: only the unpaid judgement was repeated.
  assert.equal(generationCalls, 1);
  assert.ok(completed.pages[0].finalUrl);
});

test('浏览器生图失败绝不自动重试，避免无法确认是否已扣费的重复提交', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  let generationCalls = 0;
  const context = {
    ...env.context,
    runRecognition: marketingRecognition,
    generateImage: async () => {
      generationCalls += 1;
      throw new Error('浏览器任务中断');
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'browser-no-retry-job',
    imageModel: 'google-flow-nano-banana-pro',
    productImages: [], productNodeIds: [],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
  }), context);
  const failed = await waitFor(created.id, context, job => job?.status === 'failed', 'browser failure job stuck');

  assert.equal(generationCalls, 1);
  assert.equal(failed.pages[0].status, 'failed');
});

test('预提交的下一页会被直接等待并采用，绝不重复提交第二次付费任务', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  // No generateImage override: this test must exercise the real Codex submission path.
  const context = { ...env.context, autoStart: false, runRecognition: marketingRecognition };
  const created = createDetailRemixJob(twoPagePayload({
    jobId: 'presubmit-await-job',
    imageModel: 'codex-imagegen',
    productImages: [PRODUCT],
    productNodeIds: ['product-node'],
  }), context);

  const job = __detailRemixTest.readJob(created.id, 'workflow-1', context.dirs);
  for (const page of job.pages) {
    page.recognitionStatus = 'completed';
    page.competitorAnalysisVersion = 4;
    page.analysis = {
      pageType: 'marketing', hasPerson: false, copySlots: [], productInstances: [],
      // analyzeCompetitorPage stamps the source size onto the analysis; the
      // prompt reads it from there, so a realistic stub must carry it too.
      sourceWidth: 600, sourceHeight: 800,
    };
  }
  // Page 1 is already delivered, so only the pre-submitted page 2 is left to run.
  job.pages[0].status = 'completed';
  job.pages[0].finalUrl = '/library/projects/%E8%AF%A6%E6%83%85%E5%A4%8D%E5%88%BB%E6%B5%8B%E8%AF%95/images/page-1.png';
  job.pages[0].resultUrl = job.pages[0].finalUrl;
  await __detailRemixTest.presubmitNextPageGeneration(job, job.pages[0], context);
  __detailRemixTest.writeJob(job, context);

  const presubmitted = listCodexImageJobs(context.codexJobsDir);
  assert.equal(presubmitted.length, 1);
  const childId = presubmitted[0].id;
  const presubmittedPrompt = presubmitted[0].prompt;
  // Pre-submission must resolve the page's pixel size first, or the paid render
  // is asked for at "自动" instead of following its competitor original.
  assert.match(presubmittedPrompt, /目标尺寸继承竞品原图：600 × 800 像素/);

  // The single worker finishes the pre-submitted render while page 1 was being judged.
  const generated = path.join(env.root, 'presubmitted-result.png');
  await sharp({ create: { width: 6, height: 8, channels: 3, background: '#204060' } })
    .png().toFile(generated);
  claimCodexImageJob(context.codexJobsDir, childId);
  await completeCodexImageJob({
    jobsDir: context.codexJobsDir,
    imagesDir: path.join(env.context.libraryDir, 'images'),
    projectsDir: env.context.dirs.projectsDir,
    jobId: childId,
    sourceImage: generated,
  });

  await __detailRemixTest.executeFinalPhase(
    __detailRemixTest.readJob(created.id, 'workflow-1', context.dirs),
    context,
  );
  const finished = __detailRemixTest.readJob(created.id, 'workflow-1', context.dirs);

  // The whole point: no second paid job was created for a page already queued.
  assert.equal(listCodexImageJobs(context.codexJobsDir).length, 1);
  assert.equal(finished.pages[1].codexImageJobId, childId);
  assert.equal(finished.pages[1].status, 'completed');
  assert.ok(finished.pages[1].finalUrl);
  assert.ok(finished.pages[1].presubmittedAt);
  // Metadata must describe the prompt the paid child actually carried.
  assert.equal(finished.pages[1].finalPrompt, presubmittedPrompt);
  assert.equal(finished.status, 'completed');
});

const PRODUCT_SHEET = {
  rows: 2,
  columns: 3,
  cells: [
    { index: 1, label: '正面整机' },
    { index: 2, label: '左前 3/4' },
    { index: 3, label: '侧面' },
    { index: 4, label: '背面' },
    { index: 5, label: '机芯抓捏机构' },
    { index: 6, label: '按键卡扣材质' },
  ],
};

test('开启产品参考板优先后，我提供的板子独占产品参考位，自动裁图不再顶掉它', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const generationCalls = [];
  const context = {
    ...env.context,
    runRecognition: completeRecognition({ hasPerson: false }),
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return { buffer: Buffer.from('sheet-final'), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'product-sheet-priority-job',
    productImages: [PRODUCT],
    productNodeIds: ['product-node'],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
    preferSuppliedProductReferences: true,
    productSheet: PRODUCT_SHEET,
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');

  const productKinds = generationCalls[0].meta.referenceKinds
    .filter(kind => kind.startsWith('own-product'));
  assert.deepEqual(productKinds, ['own-product-supplement']);
  assert.equal(generationCalls[0].request.referenceImageInputs[1], PRODUCT);
  assert.equal(completed.pages[0].productSheetActive, true);
  assert.equal(completed.pages[0].selectedProductViews[0].supplemental, true);
});

test('关闭开关时保持原有优先级，自动裁出的角度仍排在用户补充图之前', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const generationCalls = [];
  const context = {
    ...env.context,
    runRecognition: completeRecognition({ hasPerson: false }),
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return { buffer: Buffer.from('auto-final'), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'product-sheet-disabled-job',
    productImages: [PRODUCT],
    productNodeIds: ['product-node'],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');

  assert.equal(generationCalls[0].meta.referenceKinds[1], 'own-product-auto-angle');
  assert.equal(completed.pages[0].productSheetActive, false);
});

test('角度板会写进识图与生成提示词，并按实例绑定具体格位', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const recognitionRequests = [];
  const generationCalls = [];
  const context = {
    ...env.context,
    runRecognition: async (request, meta) => {
      recognitionRequests.push({ request, meta });
      if (meta.kind === 'own-selling-points') {
        return JSON.stringify({
          productViews: [{
            sourceImageIndex: 0, cropRegion: { x: 0, y: 0, width: 1, height: 1 },
            viewAngle: 'front', visibleSides: ['front'], description: '', quality: 0.9,
          }],
          sellingPoints: [{ id: 'sp-1', title: '仿人手深层揉捏' }],
        });
      }
      return JSON.stringify({ page: {
        pageType: 'marketing', hasPerson: false,
        selectedProductViewIds: ['pv-1'],
        productInstances: [
          { instanceId: 'product-1', x: 0.2, y: 0.2, width: 0.2, height: 0.2, viewAngle: 'detail', contactSurface: '', foregroundOcclusion: '', productSheetCell: 5 },
          { instanceId: 'product-2', x: 0.6, y: 0.2, width: 0.2, height: 0.2, viewAngle: 'back', contactSurface: '', foregroundOcclusion: '', productSheetCell: 4 },
        ],
        copySlots: [{ slotId: 'headline', role: 'headline', sourceText: '竞品大标题', x: 0.1, y: 0.5, width: 0.8, height: 0.08, maxChars: 10 }],
        mappedSellingPoints: [{ sellingPointId: 'sp-1', slotId: 'headline', slotRole: 'headline', replacementText: '仿人手深层揉捏' }],
        mappedFacts: [],
      } });
    },
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return { buffer: Buffer.from('bound-final'), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'product-sheet-binding-job',
    productImages: [PRODUCT],
    productNodeIds: ['product-node'],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
    preferSuppliedProductReferences: true,
    productSheet: PRODUCT_SHEET,
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');

  // The planner is told the grid exists so it can assign a cell per instance.
  const competitorInstruction = recognitionRequests
    .find(entry => entry.meta.kind === 'competitor-page').request.systemInstruction;
  assert.match(competitorInstruction, /5=机芯抓捏机构/);
  assert.match(competitorInstruction, /productSheetCell/);

  // The renderer gets the same grid plus the resolved per-instance binding.
  const prompt = generationCalls[0].request.prompt;
  assert.match(prompt, /2 行 × 3 列角度板/);
  assert.match(prompt, /"instanceId":"product-1","cell":5/);
  assert.match(prompt, /"instanceId":"product-2","cell":4/);
  assert.match(prompt, /禁止把它的网格、分格线、编号数字/);
  assert.equal(completed.pages[0].analysis.productInstances[0].productSheetCell, 5);
});

test('未手填分格时自动读取角度板，逐格标签来自图片而不是人工输入', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const sheetRequests = [];
  const generationCalls = [];
  const context = {
    ...env.context,
    runRecognition: async (request, meta) => {
      if (meta.kind === 'product-sheet') {
        sheetRequests.push(request);
        return JSON.stringify({
          isSheet: true, rows: 2, columns: 3,
          cells: [
            { index: 1, label: '正面整机', usable: true, issue: '' },
            { index: 2, label: '左前 3/4', usable: true, issue: '' },
            { index: 3, label: '侧面', usable: true, issue: '' },
            { index: 4, label: '背面', usable: true, issue: '' },
            { index: 5, label: '滚轮气囊结构', usable: true, issue: '' },
            { index: 6, label: '按键面板特写', usable: true, issue: '' },
          ],
          summary: '2x3 角度板',
        });
      }
      return completeRecognition({ hasPerson: false })(request, meta);
    },
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return { buffer: Buffer.from('auto-sheet'), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'product-sheet-auto-detect-job',
    productImages: [PRODUCT],
    productNodeIds: ['product-node'],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
    preferSuppliedProductReferences: true,
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');

  assert.equal(sheetRequests.length, 1);
  assert.equal(sheetRequests[0].imageDataUrls.length, 1);
  assert.equal(completed.productSheetManual, false);
  assert.equal(completed.productSheet.rows, 2);
  assert.equal(completed.productSheet.columns, 3);
  assert.equal(completed.productSheet.cells[4].label, '滚轮气囊结构');
  assert.deepEqual(completed.productSheetWarnings, []);
  assert.match(generationCalls[0].request.prompt, /5=滚轮气囊结构/);
});

test('所连产品图不是角度板时回落为普通参考图，提示词不得声称存在分格', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const generationCalls = [];
  const context = {
    ...env.context,
    runRecognition: async (request, meta) => {
      if (meta.kind === 'product-sheet') {
        return JSON.stringify({
          isSheet: false, rows: 0, columns: 0, cells: [], summary: '单张产品实拍',
        });
      }
      return completeRecognition({ hasPerson: false })(request, meta);
    },
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return { buffer: Buffer.from('not-a-sheet'), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'product-sheet-not-a-sheet-job',
    productImages: [PRODUCT],
    productNodeIds: ['product-node'],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
    preferSuppliedProductReferences: true,
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');

  assert.equal(completed.productSheet, null);
  assert.match(completed.productSheetWarnings[0], /不是角度板/);
  assert.doesNotMatch(generationCalls[0].request.prompt, /角度板/);
  // The supplied image still wins the product slot; only the grid claim is dropped.
  assert.equal(generationCalls[0].request.referenceImageInputs[1], PRODUCT);
});

test('角度板某格不可用时排除该格并留下提示，其余格位照常绑定', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const generationCalls = [];
  const context = {
    ...env.context,
    runRecognition: async (request, meta) => {
      if (meta.kind === 'product-sheet') {
        return JSON.stringify({
          isSheet: true, rows: 2, columns: 2,
          cells: [
            { index: 1, label: '正面整机', usable: true, issue: '' },
            { index: 2, label: '', usable: false, issue: '过暗看不出角度' },
            { index: 3, label: '背面', usable: true, issue: '' },
            { index: 4, label: '按键特写', usable: true, issue: '' },
          ],
          summary: '2x2 角度板，第 2 格过暗',
        });
      }
      return completeRecognition({ hasPerson: false })(request, meta);
    },
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return { buffer: Buffer.from('partial-sheet'), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'product-sheet-unusable-cell-job',
    productImages: [PRODUCT],
    productNodeIds: ['product-node'],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
    preferSuppliedProductReferences: true,
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');

  assert.deepEqual(completed.productSheet.cells.map(cell => cell.index), [1, 3, 4]);
  assert.match(completed.productSheetWarnings[0], /第 2 格不可用：过暗看不出角度/);
  const prompt = generationCalls[0].request.prompt;
  assert.match(prompt, /1=正面整机、3=背面、4=按键特写/);
});

test('识别调用失败不拖垮任务，按普通产品参考图继续生成', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const generationCalls = [];
  const context = {
    ...env.context,
    runRecognition: async (request, meta) => {
      if (meta.kind === 'product-sheet') throw new Error('识图服务暂时不可用');
      return completeRecognition({ hasPerson: false })(request, meta);
    },
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return { buffer: Buffer.from('detect-failed'), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'product-sheet-detect-failed-job',
    productImages: [PRODUCT],
    productNodeIds: ['product-node'],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
    preferSuppliedProductReferences: true,
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');

  assert.equal(completed.productSheet, null);
  assert.match(completed.productSheetWarnings[0], /识别失败/);
  assert.ok(completed.pages[0].finalUrl);
});

test('手填分格视为人工覆盖，不再触发自动识别', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  let sheetDetectCalls = 0;
  const generationCalls = [];
  const context = {
    ...env.context,
    runRecognition: async (request, meta) => {
      if (meta.kind === 'product-sheet') {
        sheetDetectCalls += 1;
        return JSON.stringify({ isSheet: false, rows: 0, columns: 0, cells: [], summary: '' });
      }
      return completeRecognition({ hasPerson: false })(request, meta);
    },
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return { buffer: Buffer.from('manual-sheet'), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'product-sheet-manual-override-job',
    productImages: [PRODUCT],
    productNodeIds: ['product-node'],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
    preferSuppliedProductReferences: true,
    productSheet: PRODUCT_SHEET,
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');

  assert.equal(sheetDetectCalls, 0);
  assert.equal(completed.productSheetManual, true);
  assert.equal(completed.productSheet.cells[4].label, '机芯抓捏机构');
});

test('开启了以我提供的产品图为准却没连产品图会被明确拒绝', t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  assert.throws(() => createDetailRemixJob(basePayload({
    jobId: 'product-sheet-no-image-job',
    productImages: [], productNodeIds: [],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
    preferSuppliedProductReferences: true,
  }), { ...env.context, autoStart: false }), /没有连接任何产品参考图/);
});

test('自称角度板却读不出可用分格时，也必须给出回落说明而不是静默', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const context = {
    ...env.context,
    runRecognition: async (request, meta) => {
      if (meta.kind === 'product-sheet') {
        return JSON.stringify({
          isSheet: true, rows: 2, columns: 3,
          cells: [{ index: 1, label: '', usable: true, issue: '' }],
          summary: '看起来是板子但读不出角度',
        });
      }
      return completeRecognition({ hasPerson: false })(request, meta);
    },
    generateImage: async () => ({ buffer: Buffer.from('empty-sheet'), extension: 'png' }),
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'product-sheet-empty-cells-job',
    productImages: [PRODUCT],
    productNodeIds: ['product-node'],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
    preferSuppliedProductReferences: true,
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');

  assert.equal(completed.productSheet, null);
  assert.equal(completed.productSheetWarnings.length, 1);
  assert.match(completed.productSheetWarnings[0], /读出可用的分格角度/);
});

test('识别结果按图片缓存，重新生成同一页不会再次调用角度板识别', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  let sheetDetectCalls = 0;
  const context = {
    ...env.context,
    runRecognition: async (request, meta) => {
      if (meta.kind === 'product-sheet') {
        sheetDetectCalls += 1;
        return JSON.stringify({
          isSheet: true, rows: 1, columns: 2,
          cells: [
            { index: 1, label: '正面整机', usable: true, issue: '' },
            { index: 2, label: '背面', usable: true, issue: '' },
          ],
          summary: '1x2 角度板',
        });
      }
      return completeRecognition({ hasPerson: false })(request, meta);
    },
    generateImage: async () => ({ buffer: Buffer.from('cached-sheet'), extension: 'png' }),
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'product-sheet-cache-job',
    productImages: [PRODUCT],
    productNodeIds: ['product-node'],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
    preferSuppliedProductReferences: true,
  }), context);
  await waitFor(created.id, context, job => job?.status === 'completed');
  assert.equal(sheetDetectCalls, 1);

  regenerateDetailRemixPages(created.id, 'workflow-1', { pageIndexes: [0] }, context);
  const regenerated = await waitFor(
    created.id,
    context,
    job => job?.status === 'completed' && job.pages[0].regenerationCount === 1,
  );
  // The board did not change, so re-detecting it would be a wasted call per retry.
  assert.equal(sheetDetectCalls, 1);
  assert.equal(regenerated.productSheet.cells.length, 2);
});

test('规划识图只被允许使用真实存在的格号，不得给出包含被排除格的区间', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const competitorInstructions = [];
  const context = {
    ...env.context,
    runRecognition: async (request, meta) => {
      if (meta.kind === 'product-sheet') {
        return JSON.stringify({
          isSheet: true, rows: 2, columns: 2,
          cells: [
            { index: 1, label: '正面整机', usable: true, issue: '' },
            { index: 2, label: '', usable: false, issue: '过暗' },
            { index: 3, label: '背面', usable: true, issue: '' },
            { index: 4, label: '按键特写', usable: true, issue: '' },
          ],
          summary: '2x2，第 2 格过暗',
        });
      }
      if (meta.kind === 'competitor-page') competitorInstructions.push(request.systemInstruction);
      return completeRecognition({ hasPerson: false })(request, meta);
    },
    generateImage: async () => ({ buffer: Buffer.from('enumerated'), extension: 'png' }),
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'product-sheet-enumerated-cells-job',
    productImages: [PRODUCT],
    productNodeIds: ['product-node'],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
    preferSuppliedProductReferences: true,
  }), context);
  await waitFor(created.id, context, job => job?.status === 'completed');

  assert.match(competitorInstructions[0], /只能使用这些编号：1、3、4/);
  assert.doesNotMatch(competitorInstructions[0], /1~4/);
});

test('取消发生在预提交途中时不得再排入付费子任务', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const context = { ...env.context, autoStart: false };
  const created = createDetailRemixJob(basePayload({
    jobId: 'presubmit-cancel-race-job',
    imageModel: 'codex-imagegen',
    productImages: [], productNodeIds: [],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
    competitorDetails: [
      { nodeId: 'competitor-a', imageUrl: COMPETITOR, order: 0, sourceWidth: 600, sourceHeight: 800 },
      { nodeId: 'competitor-b', imageUrl: COMPETITOR, order: 1, sourceWidth: 600, sourceHeight: 800 },
    ],
  }), context);

  const persisted = __detailRemixTest.readJob(created.id, 'workflow-1', context.dirs);
  persisted.productViews = [{
    id: 'pv-1', sourceImageIndex: 0, imageUrl: OWN_DETAIL,
    viewAngle: 'front', visibleSides: ['front'], description: '', quality: 0.9,
  }];
  // Page 2 is analysed and ready to be queued ahead of time.
  persisted.pages[1] = {
    ...persisted.pages[1],
    recognitionStatus: 'completed',
    competitorAnalysisVersion: 99,
    analysis: {
      pageType: 'marketing', hasPerson: false, copySlots: [],
      productInstances: [], selectedProductViewIds: ['pv-1'],
      sourceWidth: 600, sourceHeight: 800,
    },
    mappedSellingPoints: [],
    mappedFacts: [],
  };
  // The user cancelled while page 1 was being judged.
  persisted.status = 'cancelled';
  persisted.cancelRequested = true;
  __detailRemixTest.writeJob(persisted, context);

  const inMemory = __detailRemixTest.readJob(created.id, 'workflow-1', context.dirs);
  // The in-flight loop still believes it is running, exactly as it would in the race.
  inMemory.status = 'processing';
  await assert.rejects(
    () => __detailRemixTest.presubmitNextPageGeneration(inMemory, inMemory.pages[0], context),
    error => error?.code === 'OPERATION_CANCELLED' || /取消/.test(String(error?.message || '')),
  );

  assert.equal(listCodexImageJobs(context.codexJobsDir).length, 0);
  assert.equal(inMemory.pages[1].codexImageJobId, undefined);
});

test('我方详情识图返回坏 JSON 时会重试，不再一次失败就打挂整个任务', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  let ownCalls = 0;
  const context = {
    ...env.context,
    runRecognition: async (request, meta) => {
      if (meta.kind === 'own-selling-points') {
        ownCalls += 1;
        if (ownCalls === 1) return '这不是 JSON，只是模型的一段废话';
      }
      return completeRecognition({ hasPerson: false })(request, meta);
    },
    generateImage: async () => ({ buffer: Buffer.from('own-retry'), extension: 'png' }),
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'own-knowledge-retry-job',
    productImages: [], productNodeIds: [],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');

  assert.equal(ownCalls, 2);
  assert.equal(completed.ownRecognition.status, 'completed');
  assert.equal(completed.ownRecognition.chunks[0].lastError, undefined);
  assert.ok(completed.pages[0].finalUrl);
});

test('我方详情识图重试用尽后仍然失败，并保留最后一次错误', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  let ownCalls = 0;
  const context = {
    ...env.context,
    runRecognition: async (request, meta) => {
      if (meta.kind === 'own-selling-points') {
        ownCalls += 1;
        return '始终不是 JSON';
      }
      return completeRecognition({ hasPerson: false })(request, meta);
    },
    generateImage: async () => ({ buffer: Buffer.from('never'), extension: 'png' }),
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'own-knowledge-exhausted-job',
    productImages: [], productNodeIds: [],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
  }), context);
  const failed = await waitFor(created.id, context, job => job?.status === 'failed');

  assert.equal(ownCalls, 3);
  assert.ok(failed.ownRecognition.chunks[0].lastError);
});

test('竞品原图比例远离模型可用比例时记录裁剪损失并在收尾时点名该页', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const context = {
    ...env.context,
    runRecognition: completeRecognition({ hasPerson: false }),
    generateImage: async () => ({ buffer: Buffer.from('tall-page'), extension: 'png' }),
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'dimension-crop-loss-job',
    productImages: [], productNodeIds: [],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
    competitorDetails: [
      // 750x1000 lands exactly on 3:4; 750x2000 has no close provider ratio.
      { nodeId: 'c-square', imageUrl: COMPETITOR, order: 0, sourceWidth: 750, sourceHeight: 1000 },
      { nodeId: 'c-tall', imageUrl: COMPETITOR, order: 1, sourceWidth: 750, sourceHeight: 2000 },
    ],
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');

  assert.equal(completed.pages[0].dimensionCropLoss, 0);
  assert.ok(completed.pages[1].dimensionCropLoss > 0.3);
  assert.deepEqual(completed.croppedPageIndexes, [1]);
});

const BRIEF = [
  '肩颈按摩器，品牌 SUPOR，主打仿人手深层揉捏。',
  '覆盖肩颈斜方肌，按摩热敷双效同步。',
  '额定功率 16W；电池容量 2500mAh；单次工作时间 15 分钟。',
].join('\n');

const briefRecognition = async (request, meta) => {
  if (meta.kind === 'product-brief') {
    return JSON.stringify({
      brandIdentity: { name: 'SUPOR', slogan: '抓揉肩颈斜方肌' },
      sellingPoints: [
        { id: 'sp-1', title: '仿人手深层揉捏', description: '覆盖肩颈斜方肌' },
        { id: 'sp-2', title: '按摩热敷双效', description: '同步进行' },
      ],
      verifiedFacts: [
        { id: 'fact-1', field: 'power', label: '额定功率', value: '16W' },
        { id: 'fact-2', field: 'battery_capacity', label: '电池容量', value: '2500mAh' },
      ],
    });
  }
  return JSON.stringify({ page: {
    pageType: 'specification', hasPerson: false,
    selectedProductViewIds: [], productInstances: [],
    copySlots: [
      { slotId: 'power-label', role: 'parameterLabel', field: 'power', parameterPart: 'label', sourceText: '功率', x: 0.1, y: 0.1, width: 0.3, height: 0.05 },
      { slotId: 'power-value', role: 'parameterValue', field: 'power', parameterPart: 'value', sourceText: '20W', x: 0.5, y: 0.1, width: 0.2, height: 0.05 },
    ],
    mappedSellingPoints: [],
    mappedFacts: [
      { factId: 'fact-1', slotId: 'power-label', slotRole: 'parameterLabel', displayPart: 'label' },
      { factId: 'fact-1', slotId: 'power-value', slotRole: 'parameterValue', displayPart: 'value' },
    ],
  } });
};

test('只给产品说明与产品参考图即可生成，不再需要导入我方详情', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const recognitionKinds = [];
  const generationCalls = [];
  const context = {
    ...env.context,
    runRecognition: async (request, meta) => {
      recognitionKinds.push(meta.kind);
      return briefRecognition(request, meta);
    },
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return { buffer: Buffer.from('brief-final'), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'product-brief-job',
    ownDetails: [],
    productBrief: BRIEF,
    productImages: [PRODUCT],
    productNodeIds: ['product-node'],
    preferSuppliedProductReferences: true,
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');

  // 说明文本直接结构化，完全不走我方详情识图。
  assert.ok(recognitionKinds.includes('product-brief'));
  assert.equal(recognitionKinds.includes('own-selling-points'), false);
  assert.equal(completed.ownRecognition.source, 'product-brief');
  assert.equal(completed.ownSellingPoints.length, 2);
  assert.equal(completed.verifiedFacts.length, 2);
  assert.equal(completed.brandIdentity.name, 'SUPOR');
  assert.ok(completed.pages[0].finalUrl);
});

test('声明式参数没有图片证据也必须写进成图，不能被证据链判为无来源而删空', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const generationCalls = [];
  const context = {
    ...env.context,
    runRecognition: briefRecognition,
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return { buffer: Buffer.from('declared-facts'), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'declared-facts-job',
    ownDetails: [],
    productBrief: BRIEF,
    productImages: [PRODUCT],
    productNodeIds: ['product-node'],
    preferSuppliedProductReferences: true,
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');

  // 没有我方详情就没有证据图；旧的证据链会把所有参数丢弃，参数页整片留白。
  assert.deepEqual(completed.pages[0].omittedMappedFacts, []);
  assert.ok(completed.pages[0].effectiveMappedFacts.length > 0);
  assert.match(generationCalls[0].request.prompt, /16W/);
  // 证据图占位被腾空，参考图里只剩版式图与产品板。
  assert.equal(generationCalls[0].meta.referenceKinds.includes('own-fact-evidence'), false);
});

test('商家直接提供的干净 Logo 优先于从详情图抠出来的那张', async t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const generationCalls = [];
  const context = {
    ...env.context,
    runRecognition: briefRecognition,
    generateImage: async (request, meta) => {
      generationCalls.push({ request, meta });
      return { buffer: Buffer.from('logo-input'), extension: 'png' };
    },
  };
  const created = createDetailRemixJob(basePayload({
    jobId: 'brand-logo-input-job',
    ownDetails: [],
    productBrief: BRIEF,
    productImages: [PRODUCT],
    productNodeIds: ['product-node'],
    brandLogoImages: [PRODUCT_2],
    brandLogoNodeIds: ['logo-node'],
    preferSuppliedProductReferences: true,
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
  }), context);
  const completed = await waitFor(created.id, context, job => job?.status === 'completed');

  assert.equal(completed.brandLogoUrl, PRODUCT_2);
  assert.equal(completed.brandLogoSource, 'supplied');
  assert.ok(generationCalls[0].meta.referenceKinds.includes('own-brand-logo'));
});

test('既没有产品说明也没有我方详情时明确拒绝', t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  assert.throws(() => createDetailRemixJob(basePayload({
    jobId: 'no-brief-no-own-job',
    ownDetails: [],
    productImages: [PRODUCT],
    productNodeIds: ['product-node'],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
  }), { ...env.context, autoStart: false }), /请填写产品说明/);
});

test('有说明但没有任何产品外观参考时明确拒绝', t => {
  const env = setup();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  assert.throws(() => createDetailRemixJob(basePayload({
    jobId: 'no-product-image-job',
    ownDetails: [],
    productBrief: BRIEF,
    productImages: [], productNodeIds: [],
    useCharacterReference: false, characterReferenceImages: [], characterReferenceNodeIds: [],
  }), { ...env.context, autoStart: false }), /请至少连接一张产品参考图/);
});
