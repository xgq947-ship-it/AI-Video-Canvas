import assert from 'node:assert/strict';
import test from 'node:test';
import { getProductSceneResultRowStep, upsertProductSceneResultNode } from '../src/utils/productSceneResult.js';

test('产品场景任务成功后在控制节点右侧创建并连接普通图片节点', () => {
  const source = { id: 'control', type: 'Product Scene Replace', x: 100, y: 200, productCategory: '揉腹仪', resolution: 'Auto' };
  const job = {
    id: 'job-1', resultNodeId: 'image-result', resultUrl: '/library/result.png', prompt: '最终提示词',
    imageModel: 'google-flow-nano-banana-pro', imageResolution: '2K', aspectRatio: '3:4'
  };
  const nodes = upsertProductSceneResultNode([source], source, job, 1234);
  const result = nodes[1];
  assert.equal(result.type, 'Image');
  assert.equal(result.status, 'success');
  assert.equal(result.title, '揉腹仪场景图');
  assert.deepEqual(result.parentIds, ['control']);
  assert.equal(result.x, 660);
  assert.equal(result.resolution, '2K');
  assert.equal(result.resultUrl, '/library/result.png?t=1234');
});

test('恢复轮询重复收到完成状态时不会重复创建结果节点', () => {
  const source = { id: 'control', type: 'Product Scene Replace', x: 0, y: 0 };
  const job = { id: 'job-1', resultNodeId: 'image-result', resultUrl: '/result.png', imageModel: 'flow', aspectRatio: '1:1' };
  const once = upsertProductSceneResultNode([source], source, job, 1);
  const twice = upsertProductSceneResultNode(once, source, job, 2);
  assert.equal(twice.filter(node => node.id === 'image-result').length, 1);
  assert.equal(twice.find(node => node.id === 'image-result').resultUrl, '/result.png?t=2');
});

test('多图与成功视频分别创建子节点并保持产品源到图片到视频的连线', () => {
  const source = { id: 'control', type: 'Product Scene Replace', x: 100, y: 200, productCategory: '揉腹仪' };
  const job = {
    id: 'job-batch',
    resultNodeIds: ['image-1', 'image-2'],
    resultUrls: ['/image-1.png', '/image-2.png'],
    prompt: '替换图提示词', imageModel: 'gemini-web-image', aspectRatio: '9:16',
    videoPrompt: '短视频原始提示词', videoModel: 'gemini-web-video',
    videoAspectRatio: '9:16', videoDuration: 8,
    videoTasks: [
      { index: 0, imageNodeId: 'image-1', videoNodeId: 'video-1', status: 'success', resultUrl: '/video-1.mp4' },
      { index: 1, imageNodeId: 'image-2', videoNodeId: 'video-2', status: 'failed', error: '失败' },
    ],
  };
  const nodes = upsertProductSceneResultNode([source], source, job, 10);
  const firstImage = nodes.find(node => node.id === 'image-1');
  const secondImage = nodes.find(node => node.id === 'image-2');
  const firstVideo = nodes.find(node => node.id === 'video-1');

  assert.deepEqual(firstImage.parentIds, ['control']);
  assert.deepEqual(secondImage.parentIds, ['control']);
  assert.equal(secondImage.y - firstImage.y, getProductSceneResultRowStep(job));
  assert.equal(firstImage.x, secondImage.x);
  assert.equal(firstImage.batchIndex, 0);
  assert.equal(secondImage.batchIndex, 1);
  assert.equal(firstVideo.y, firstImage.y);
  assert.deepEqual(firstVideo.parentIds, ['image-1']);
  assert.equal(firstVideo.prompt, '短视频原始提示词');
  assert.equal(nodes.some(node => node.id === 'video-2'), false);
});

test('批量结果按原始 batchIndex 排列，不受完成数组顺序影响', () => {
  const source = { id: 'control', type: 'Product Scene Replace', x: 0, y: 0 };
  const job = {
    id: 'job-out-of-order',
    resultNodeIds: ['image-3', 'image-1', 'image-2'],
    resultUrls: ['/image-3.png', '/image-1.png', '/image-2.png'],
    imageResults: [
      { index: 2, nodeId: 'image-3', resultUrl: '/image-3.png' },
      { index: 0, nodeId: 'image-1', resultUrl: '/image-1.png' },
      { index: 1, nodeId: 'image-2', resultUrl: '/image-2.png' },
    ],
    resultNodeId: 'image-1',
    resultUrl: '/image-1.png',
    aspectRatio: '9:16',
    imageModel: 'flow',
  };
  const images = upsertProductSceneResultNode([source], source, job)
    .filter(node => node.type === 'Image');
  assert.deepEqual(images.map(node => node.id), ['image-1', 'image-2', 'image-3']);
  assert.deepEqual(images.map(node => node.batchIndex), [0, 1, 2]);
  assert.ok(images[0].y < images[1].y && images[1].y < images[2].y);
  assert.equal(new Set(images.map(node => node.x)).size, 1);
});

for (const count of [1, 2, 3, 4, 7]) {
  test(`批量布局对 ${count} 张图片使用同一套无重叠竖直算法`, () => {
    const source = { id: 'control', type: 'Product Scene Replace', x: 30, y: 50 };
    const resultNodeIds = Array.from({ length: count }, (_, index) => `image-${index}`);
    const resultUrls = Array.from({ length: count }, (_, index) => `/image-${index}.png`);
    const job = {
      id: `job-${count}`,
      resultNodeIds,
      resultUrls,
      imageResults: resultNodeIds.map((nodeId, index) => ({
        index,
        nodeId,
        resultUrl: resultUrls[index],
      })),
      resultNodeId: resultNodeIds[0],
      resultUrl: resultUrls[0],
      aspectRatio: '3:4',
      imageModel: 'flow',
    };
    const images = upsertProductSceneResultNode([source], source, job)
      .filter(node => node.type === 'Image');
    const rowStep = getProductSceneResultRowStep(job);
    assert.equal(images.length, count);
    assert.equal(new Set(images.map(node => node.x)).size, 1);
    assert.deepEqual(images.map(node => node.batchIndex), Array.from({ length: count }, (_, index) => index));
    for (let index = 1; index < images.length; index += 1) {
      assert.ok(Math.abs((images[index].y - images[index - 1].y) - rowStep) < 1e-9);
    }
  });
}

test('上一版数量更多时，新版依据已占用高度继续向下布局', () => {
  const source = { id: 'control', type: 'Product Scene Replace', x: 0, y: 0 };
  const firstJob = {
    id: 'job-v1',
    version: 1,
    resultNodeIds: ['v1-0', 'v1-1', 'v1-2', 'v1-3'],
    resultUrls: ['/v1-0.png', '/v1-1.png', '/v1-2.png', '/v1-3.png'],
    resultNodeId: 'v1-0',
    resultUrl: '/v1-0.png',
    aspectRatio: '9:16',
    imageModel: 'flow',
  };
  const secondJob = {
    id: 'job-v2',
    version: 2,
    resultNodeIds: ['v2-0'],
    resultUrls: ['/v2-0.png'],
    resultNodeId: 'v2-0',
    resultUrl: '/v2-0.png',
    aspectRatio: '9:16',
    imageModel: 'flow',
  };
  const first = upsertProductSceneResultNode([source], source, firstJob);
  const combined = upsertProductSceneResultNode(first, source, secondJob);
  const previousLast = combined.find(node => node.id === 'v1-3');
  const nextFirst = combined.find(node => node.id === 'v2-0');
  const imageHeight = 365 / (9 / 16);
  assert.ok(nextFirst.y >= previousLast.y + imageHeight);
});

test('图片先到、视频后到时从首次布局起就保持同一 batchIndex 行位置', () => {
  const source = { id: 'control', type: 'Product Scene Replace', x: 0, y: 0 };
  const imageStageJob = {
    id: 'job-staged',
    resultNodeIds: ['image-0', 'image-1'],
    resultUrls: ['/image-0.png', '/image-1.png'],
    resultNodeId: 'image-0',
    resultUrl: '/image-0.png',
    aspectRatio: '9:16',
    videoAspectRatio: '9:16',
    autoGenerateVideo: true,
    imageModel: 'flow',
  };
  const imageStage = upsertProductSceneResultNode([source], source, imageStageJob);
  const completed = upsertProductSceneResultNode(imageStage, source, {
    ...imageStageJob,
    videoTasks: [
      { index: 1, imageNodeId: 'image-1', videoNodeId: 'video-1', status: 'success', resultUrl: '/video-1.mp4' },
      { index: 0, imageNodeId: 'image-0', videoNodeId: 'video-0', status: 'success', resultUrl: '/video-0.mp4' },
    ],
  });
  for (const index of [0, 1]) {
    assert.equal(
      completed.find(node => node.id === `image-${index}`).y,
      completed.find(node => node.id === `video-${index}`).y
    );
  }
});

test('恢复轮询更新结果时保留用户移动位置和手动断开的 Edge', () => {
  const source = { id: 'control', type: 'Product Scene Replace', x: 0, y: 0 };
  const job = {
    id: 'job-1',
    resultNodeId: 'image-1',
    resultUrl: '/image.png',
    aspectRatio: '1:1',
    imageModel: 'flow',
  };
  const first = upsertProductSceneResultNode([source], source, job, 1);
  const moved = first.map(node => node.id === 'image-1'
    ? { ...node, x: 999, y: 777, parentIds: [], displayName: '手动名称' }
    : node);
  const refreshed = upsertProductSceneResultNode(moved, source, job, 2);
  const image = refreshed.find(node => node.id === 'image-1');
  assert.equal(image.x, 999);
  assert.equal(image.y, 777);
  assert.deepEqual(image.parentIds, []);
  assert.equal(image.displayName, '手动名称');
});

test('旧结果节点缺少 parentIds 时补上默认来源连接，显式空数组仍视为用户断线', () => {
  const source = { id: 'control', type: 'Product Scene Replace', x: 0, y: 0 };
  const job = {
    id: 'job-legacy-parent',
    resultNodeId: 'image-legacy',
    resultUrl: '/image.png',
    aspectRatio: '1:1',
    imageModel: 'flow',
  };
  const legacy = [{
    id: 'image-legacy',
    type: 'Image',
    productSceneSourceJobId: 'job-legacy-parent',
    x: 10,
    y: 20,
  }];
  const restored = upsertProductSceneResultNode([source, ...legacy], source, job);
  assert.deepEqual(restored.find(node => node.id === 'image-legacy').parentIds, ['control']);

  const disconnected = restored.map(node => node.id === 'image-legacy'
    ? { ...node, parentIds: [] }
    : node);
  const refreshed = upsertProductSceneResultNode(disconnected, source, job);
  assert.deepEqual(refreshed.find(node => node.id === 'image-legacy').parentIds, []);
});
