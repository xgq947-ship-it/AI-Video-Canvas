import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';
import sharp from 'sharp';

import {
  buildDetailStitchSlices,
  detailStitchTargetHeights,
  expectedDetailStitchCropLoss,
  normalizeDetailStitchCuts,
} from '../shared/detailStitch.js';
import { getImageGenerationProvider } from '../shared/generationProviders.js';
import detailStitchRoutes from '../server/routes/detail-stitch.js';
import { detectAdjacentDuplicateRows } from '../server/services/detailStitch/stitcher.js';
import {
  applyDetailStitchSlices,
  canRestoreDetailStitchOriginals,
  restoreDetailStitchOriginals,
} from '../src/utils/detailStitchNodes.js';
import {
  buildDetailRemixInputMapping,
  createDetailRemixNodeData,
} from '../shared/detailRemix.js';

const PROJECT_NAME = '详情拼接测试';

async function overlapPattern(width = 100, height = 40) {
  const stripes = Array.from({ length: Math.ceil(width / 10) }, (_, index) => ({
    input: {
      create: {
        width: Math.min(10, width - index * 10),
        height,
        channels: 4,
        background: index % 2 ? '#f5b942' : '#2647a8',
      },
    },
    left: index * 10,
    top: 0,
  }));
  return sharp({
    create: { width, height, channels: 4, background: '#ffffff' },
  }).composite(stripes).png().toBuffer();
}

async function createRouteFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detail-stitch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const libraryDir = path.join(root, 'library');
  const workflowsDir = path.join(libraryDir, 'workflows');
  const projectsDir = path.join(libraryDir, 'projects');
  const imagesDir = path.join(projectsDir, PROJECT_NAME, 'images');
  fs.mkdirSync(workflowsDir, { recursive: true });
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.writeFileSync(path.join(workflowsDir, 'workflow-1.json'), JSON.stringify({
    id: 'workflow-1', title: PROJECT_NAME, projectDirName: PROJECT_NAME, nodes: [], groups: [],
  }));

  const overlap = await overlapPattern();
  await sharp({ create: { width: 100, height: 200, channels: 4, background: '#9b2f2f' } })
    .composite([{ input: overlap, left: 0, top: 160 }]).png().toFile(path.join(imagesDir, 'a.png'));
  await sharp({ create: { width: 100, height: 200, channels: 4, background: '#285f43' } })
    .composite([{ input: overlap, left: 0, top: 0 }]).png().toFile(path.join(imagesDir, 'b.png'));
  await sharp({ create: { width: 140, height: 140, channels: 4, background: '#375ea8' } })
    .composite([{
      input: { create: { width: 40, height: 140, channels: 4, background: '#f2d358' } },
      left: 50,
      top: 0,
    }]).png().toFile(path.join(imagesDir, 'c.png'));

  const app = express();
  app.use(express.json());
  app.locals.WORKFLOWS_DIR = workflowsDir;
  app.locals.PROJECTS_DIR = projectsDir;
  app.locals.LIBRARY_DIR = libraryDir;
  app.use('/api', detailStitchRoutes);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  return {
    root,
    imagesDir,
    baseUrl: `http://127.0.0.1:${address.port}`,
    sourceUrl: filename => `/library/projects/${encodeURIComponent(PROJECT_NAME)}/images/${filename}`,
  };
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  assert.ok(response.ok, `${response.status}: ${data.error || 'request failed'}`);
  return data;
}

test('目标高度表来自当前 provider，预期 cover-crop 损失与切片比例共用一套算法', () => {
  const flow = getImageGenerationProvider('google-flow-nano-banana-pro');
  const jimeng = getImageGenerationProvider('jimeng-image-5-0-pro');
  const flowTargets = detailStitchTargetHeights(750, flow.supportedAspectRatios);
  const jimengTargets = detailStitchTargetHeights(750, jimeng.supportedAspectRatios);
  assert.deepEqual(flowTargets.map(item => [item.aspectRatio, item.height]), [
    ['1:1', 750], ['16:9', 422], ['4:3', 563], ['3:4', 1000], ['9:16', 1333],
  ]);
  assert.ok(jimengTargets.some(item => item.aspectRatio === '3:2' && item.height === 500));
  assert.ok(jimengTargets.some(item => item.aspectRatio === '2:3' && item.height === 1125));
  assert.equal(expectedDetailStitchCropLoss(750, 1000, '3:4'), 0);
  assert.ok(expectedDetailStitchCropLoss(750, 1000, '1:1') > 0.24);

  assert.throws(() => normalizeDetailStitchCuts([{ y: 50 }], 1000), /不能小于/);
  const slices = buildDetailStitchSlices({
    cuts: [{ y: 1000, source: 'manual' }],
    canvasWidth: 750,
    canvasHeight: 2000,
    supportedAspectRatios: flow.supportedAspectRatios,
  });
  assert.deepEqual(slices.map(slice => [slice.startY, slice.endY, slice.targetAspectRatio]), [
    [0, 1000, '3:4'], [1000, 2000, '3:4'],
  ]);
  assert.equal(slices[0].source, 'manual');
});

test('空白平坦带不会被误判为抓取重复区', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detail-stitch-flat-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = path.join(root, 'first.png');
  const second = path.join(root, 'second.png');
  await sharp({ create: { width: 100, height: 180, channels: 4, background: '#ffffff' } }).png().toFile(first);
  await sharp({ create: { width: 100, height: 180, channels: 4, background: '#ffffff' } }).png().toFile(second);
  assert.equal(await detectAdjacentDuplicateRows(first, second), 0);
});

test('拼接、去重、智能规划、PNG 切片和 sidecar 通过真实 HTTP 路由端到端跑通', async t => {
  const fixture = await createRouteFixture(t);
  const imageModel = 'google-flow-nano-banana-pro';
  const missingWorkflow = await fetch(`${fixture.baseUrl}/api/detail-stitch/stitch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ controllerNodeId: 'controller', imageModel, sources: [] }),
  });
  assert.equal(missingWorkflow.status, 400);
  const stitched = await postJson(`${fixture.baseUrl}/api/detail-stitch/stitch`, {
    workflowId: 'workflow-1',
    controllerNodeId: 'controller',
    imageModel,
    sources: ['a.png', 'b.png', 'c.png'].map((filename, index) => ({
      nodeId: `source-${index + 1}`,
      url: fixture.sourceUrl(filename),
    })),
  });
  assert.equal(stitched.widthPolicy, 'scale-to-mode');
  assert.equal(stitched.canvasWidth, 100);
  assert.equal(stitched.canvasHeight, 460);
  assert.equal(stitched.sources[1].dedupTrimmedTop, 40);
  assert.equal(stitched.sources[1].scaledHeight, 200);
  assert.equal(stitched.sources[1].offsetY, 200);
  assert.equal(stitched.sources[2].offsetY, 360);
  assert.equal(stitched.widthAdjustedCount, 1);
  assert.match(stitched.fullImageUrl, /_full\.png$/);
  const fullPath = path.join(fixture.imagesDir, decodeURIComponent(stitched.fullImageUrl.split('/').at(-1)));
  const fullMetadata = await sharp(fullPath, { limitInputPixels: false }).metadata();
  assert.deepEqual([fullMetadata.width, fullMetadata.height, fullMetadata.format], [100, 460, 'png']);

  const planned = await postJson(`${fixture.baseUrl}/api/detail-stitch/plan`, {
    workflowId: 'workflow-1', stitchId: stitched.stitchId, imageModel,
  });
  assert.ok(planned.candidates.length > 0);
  assert.ok(planned.slices.length >= 2);
  assert.equal(planned.slices[0].startY, 0);
  assert.equal(planned.slices.at(-1).endY, 460);
  const nodeIds = planned.slices.map((_, index) => `new-slice-${index + 1}`);
  const confirmedCuts = planned.cuts.map((cut, index) => ({
    ...cut,
    source: index === 0 ? 'manual' : cut.source,
  }));
  const invalidNodeCount = await fetch(`${fixture.baseUrl}/api/detail-stitch/slice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflowId: 'workflow-1', stitchId: stitched.stitchId, imageModel,
      cuts: confirmedCuts, nodeIds: [],
    }),
  });
  assert.equal(invalidNodeCount.status, 400);
  const exported = await postJson(`${fixture.baseUrl}/api/detail-stitch/slice`, {
    workflowId: 'workflow-1', stitchId: stitched.stitchId, imageModel,
    cuts: confirmedCuts,
    nodeIds,
  });
  assert.deepEqual(exported.slices.map(slice => slice.nodeId), nodeIds);
  assert.equal(exported.slices[0].source, 'manual');
  for (const slice of exported.slices) {
    assert.match(slice.url, /\.png$/);
    const slicePath = path.join(fixture.imagesDir, decodeURIComponent(slice.url.split('/').at(-1)));
    const metadata = await sharp(slicePath, { limitInputPixels: false }).metadata();
    assert.deepEqual([metadata.width, metadata.height, metadata.format], [slice.width, slice.height, 'png']);
  }
  const sidecar = path.join(
    fixture.root, 'library', 'projects', PROJECT_NAME, '.jobs', 'detail-stitch', `${stitched.stitchId}.json`,
  );
  assert.equal(fs.existsSync(sidecar), true);
  const persisted = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  assert.deepEqual(persisted.slices.map(slice => slice.index), exported.slices.map(slice => slice.index));
});

function canvasFixture() {
  const detail = createDetailRemixNodeData({
    inputRefs: {
      competitorDetailNodeIds: ['source-1', 'source-2'],
      productNodeIds: ['product'],
    },
    folderImports: {
      competitor: {
        folderName: '原始竞品', status: 'completed', total: 2, uploaded: 2, failed: 0,
        nodeIds: ['source-1', 'source-2'],
      },
    },
    status: 'completed',
    jobId: 'paid-job',
  });
  const mapping = buildDetailRemixInputMapping(detail.inputRefs);
  const controller = {
    id: 'controller', type: 'Detail Page Remix', x: 1000, y: 1600,
    prompt: '', status: 'success', model: '', imageModel: 'google-flow-nano-banana-pro',
    aspectRatio: '3:4', resolution: '2K', parentIds: Object.keys(mapping),
    inputPortByParentId: mapping, detailRemix: detail,
  };
  const imported = (id, order) => ({
    id, type: 'Image', x: order * 400, y: 0, prompt: id, status: 'success',
    model: 'Upload', aspectRatio: '3:4', resolution: 'Auto', resultUrl: `/${id}.png`,
    resultAspectRatio: '750/1000',
    detailRemixImport: {
      controllerNodeId: 'controller', role: 'competitor', folderName: '原始竞品',
      relativePath: `${order + 1}.png`, order,
    },
  });
  return [controller, imported('source-1', 0), imported('source-2', 1), {
    id: 'product', type: 'Image', x: 0, y: 0, prompt: '', status: 'success', model: 'Upload',
    aspectRatio: '1:1', resolution: 'Auto', resultUrl: '/product.png',
  }];
}

function stitchRecord() {
  return {
    schemaVersion: 1,
    stitchId: 'stitch-1', workflowId: 'workflow-1', controllerNodeId: 'controller',
    imageModel: 'google-flow-nano-banana-pro', createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z', widthPolicy: 'scale-to-mode',
    canvasWidth: 750, canvasHeight: 900, fullImageUrl: '/full.png', widthAdjustedCount: 0,
    sources: [{ nodeId: 'source-1' }, { nodeId: 'source-2' }], candidates: [], cuts: [],
    slices: [
      { index: 0, id: 'slice_001', startY: 0, endY: 300, width: 750, height: 300, targetAspectRatio: '21:9', expectedCropLoss: 0, source: 'auto', url: '/slice-1.png', nodeId: 'slice-node-1' },
      { index: 1, id: 'slice_002', startY: 300, endY: 600, width: 750, height: 300, targetAspectRatio: '21:9', expectedCropLoss: 0, source: 'manual', url: '/slice-2.png', nodeId: 'slice-node-2' },
      { index: 2, id: 'slice_003', startY: 600, endY: 900, width: 750, height: 300, targetAspectRatio: '21:9', expectedCropLoss: 0, source: 'auto', url: '/slice-3.png', nodeId: 'slice-node-3' },
    ],
  };
}

test('竞品节点替换一次同步 refs、端口、parentIds 和导入元数据，原图归档且可恢复', () => {
  const original = canvasFixture();
  const applied = applyDetailStitchSlices(original, 'controller', stitchRecord(), {
    now: () => '2026-08-20T01:00:00.000Z',
  });
  const byId = new Map(applied.map(node => [node.id, node]));
  const controller = byId.get('controller');
  const expectedSliceIds = ['slice-node-1', 'slice-node-2', 'slice-node-3'];
  assert.deepEqual(controller.detailRemix.inputRefs.competitorDetailNodeIds, expectedSliceIds);
  assert.deepEqual(controller.parentIds, [...expectedSliceIds, 'product']);
  assert.deepEqual(expectedSliceIds.map(id => controller.inputPortByParentId[id]), [
    'competitor-detail', 'competitor-detail', 'competitor-detail',
  ]);
  assert.equal(controller.detailRemix.status, 'outdated');
  assert.equal(controller.detailRemix.needsRegeneration, true);
  assert.deepEqual(controller.detailRemix.detailStitch.originalCompetitorNodeIds, ['source-1', 'source-2']);
  assert.equal(byId.get('source-1').detailStitchArchive.stitchId, 'stitch-1');
  assert.equal(byId.get('source-2').detailStitchArchive.stitchId, 'stitch-1');
  for (const [index, id] of expectedSliceIds.entries()) {
    const node = byId.get(id);
    assert.equal(node.detailRemixImport.controllerNodeId, 'controller');
    assert.equal(node.detailRemixImport.role, 'competitor');
    assert.equal(node.detailRemixImport.order, index);
    assert.equal(node.detailStitchSource.sliceId, `slice_${String(index + 1).padStart(3, '0')}`);
  }
  assert.equal(canRestoreDetailStitchOriginals(controller), true);

  const restored = restoreDetailStitchOriginals(applied, 'controller', {
    now: () => '2026-08-20T02:00:00.000Z',
  });
  const restoredById = new Map(restored.map(node => [node.id, node]));
  assert.deepEqual(
    restoredById.get('controller').detailRemix.inputRefs.competitorDetailNodeIds,
    ['source-1', 'source-2'],
  );
  assert.equal(restoredById.get('controller').detailRemix.detailStitch.status, 'restored');
  assert.equal(restoredById.get('source-1').detailStitchArchive, undefined);
  assert.equal(restoredById.get('slice-node-1').detailStitchArchive.stitchId, 'stitch-1');
});

test('节点替换在页序变化或切片不连续时原子失败，不修改输入数组', () => {
  const original = canvasFixture();
  const snapshot = JSON.stringify(original);
  const stale = stitchRecord();
  stale.sources = [{ nodeId: 'source-2' }, { nodeId: 'source-1' }];
  assert.throws(
    () => applyDetailStitchSlices(original, 'controller', stale),
    /竞品输入已变化/,
  );
  const broken = stitchRecord();
  broken.slices[1] = { ...broken.slices[1], startY: 350 };
  assert.throws(
    () => applyDetailStitchSlices(original, 'controller', broken),
    /不连续/,
  );
  assert.equal(JSON.stringify(original), snapshot);
});
