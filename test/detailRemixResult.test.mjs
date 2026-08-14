import assert from 'node:assert/strict';
import test from 'node:test';
import { upsertDetailRemixResultNodes } from '../src/utils/detailRemixResult.js';

const sourceNode = { id: 'detail-remix-1', x: 100, y: 200, aspectRatio: '3:4', resolution: '2K' };

function job(overrides = {}) {
  return {
    id: 'job-1',
    imageModel: 'google-flow-nano-banana-pro',
    imageResolution: '2K',
    aspectRatio: '3:4',
    version: 1,
    pages: [
      {
        index: 0,
        pageId: 'page-1',
        resultNodeId: 'final-1',
        finalUrl: '/library/projects/demo/images/final-1.png',
        finalPrompt: 'final prompt one',
        outputWidth: 600,
        outputHeight: 800,
        resultAspectRatio: '600/800',
      },
      {
        index: 1,
        pageId: 'page-2',
        resultNodeId: 'final-2',
        resultUrl: '/library/projects/demo/images/final-2.png',
      },
    ],
    ...overrides,
  };
}

test('每页只创建一个最终图节点，并在控制节点下方水平排列', () => {
  const next = upsertDetailRemixResultNodes([], sourceNode, job(), 1000);
  assert.deepEqual(next.map(node => node.id), ['final-1', 'final-2']);
  assert.equal(next[0].x, -75);
  assert.equal(next[1].x - next[0].x, 445);
  assert.equal(next[0].y, 980);
  assert.equal(next[1].y, next[0].y);
  assert.deepEqual(next[0].parentIds, ['detail-remix-1']);
  assert.equal(next[0].prompt, 'final prompt one');
  assert.equal(next[0].detailRemixResultKind, 'final');
  assert.equal(next[0].detailRemixLayoutVersion, 3);
  assert.equal(next[0].resultAspectRatio, '600/800');
});

test('没有最终 URL 时不创建空结果节点', () => {
  const pending = job({ pages: job().pages.map(page => ({ ...page, finalUrl: undefined, resultUrl: undefined })) });
  assert.deepEqual(upsertDetailRemixResultNodes([], sourceNode, pending), []);
});

test('轮询 upsert 保留用户位置、名称和连线', () => {
  const initial = upsertDetailRemixResultNodes([], sourceNode, job(), 1000);
  const edited = initial.map(node => node.id === 'final-1'
    ? { ...node, x: 44, y: 55, title: '用户标题', displayName: '保留命名', parentIds: ['custom-parent'] }
    : node);
  const refreshed = upsertDetailRemixResultNodes(edited, sourceNode, job({
    pages: job().pages.map(page => page.index === 0
      ? { ...page, finalUrl: '/library/projects/demo/images/refreshed.png' }
      : page),
  }), 2000);
  const result = refreshed.find(node => node.id === 'final-1');
  assert.equal(result.x, 44);
  assert.equal(result.y, 55);
  assert.equal(result.title, '用户标题');
  assert.equal(result.displayName, '保留命名');
  assert.deepEqual(result.parentIds, ['custom-parent']);
  assert.match(result.resultUrl, /refreshed\.png/);
});

test('旧版结果优先显示最终合成图，不再同时恢复中间留空图', () => {
  const legacy = job({ pages: [{
    index: 0,
    pageId: 'legacy-page',
    plateNodeId: 'legacy-plate',
    compositeNodeId: 'legacy-final',
    plateUrl: '/plate.png',
    compositeUrl: '/final.png',
    composePrompt: 'legacy final prompt',
  }] });
  const next = upsertDetailRemixResultNodes([], sourceNode, legacy);
  assert.deepEqual(next.map(node => node.id), ['legacy-final']);
  assert.match(next[0].resultUrl, /final\.png/);
  assert.equal(next[0].prompt, 'legacy final prompt');
  assert.equal(next[0].detailRemixResultKind, 'final');
});

test('被 dismiss 的最终节点不会被恢复', () => {
  const next = upsertDetailRemixResultNodes([], sourceNode, job({ dismissedResultNodeIds: ['final-1'] }));
  assert.deepEqual(next.map(node => node.id), ['final-2']);
});

test('同一任务按语义身份 upsert，不会因服务端节点 id 漂移而重复', () => {
  const first = upsertDetailRemixResultNodes([], sourceNode, job(), 1000);
  const changedIds = job({
    pages: job().pages.map(page => page.index === 0 ? { ...page, resultNodeId: 'final-new' } : page),
  });
  const next = upsertDetailRemixResultNodes(first, sourceNode, changedIds, 2000);
  assert.equal(next.length, 2);
  assert.equal(next.some(node => node.id === 'final-new'), true);
  assert.equal(next.some(node => node.id === 'final-1'), false);
});

test('新版本保留旧结果，并排在上一批下面', () => {
  const first = upsertDetailRemixResultNodes([], sourceNode, job(), 1000);
  const secondJob = job({
    id: 'job-2',
    version: 2,
    pages: job().pages.map(page => ({
      ...page,
      pageId: `${page.pageId}-v2`,
      resultNodeId: `${page.resultNodeId}-v2`,
    })),
  });
  const next = upsertDetailRemixResultNodes(first, sourceNode, secondJob, 2000);
  const oldBottom = Math.max(...first.map(node => node.y + 365 / (3 / 4)));
  const newTop = Math.min(...next.filter(node => node.detailRemixSourceJobId === 'job-2').map(node => node.y));
  assert.equal(next.length, 4);
  assert.ok(newTop > oldBottom, `${newTop} should be below ${oldBottom}`);
  assert.match(next.find(node => node.id === 'final-1-v2').title, /v2$/);
});
