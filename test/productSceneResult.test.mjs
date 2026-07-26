import assert from 'node:assert/strict';
import test from 'node:test';
import { upsertProductSceneResultNode } from '../src/utils/productSceneResult.js';

test('产品场景任务成功后在控制节点右侧创建并连接普通图片节点', () => {
  const source = { id: 'control', type: 'Product Scene Replace', x: 100, y: 200, productCategory: '揉腹仪', resolution: 'Auto' };
  const job = {
    id: 'job-1', resultNodeId: 'image-result', resultUrl: '/library/result.png', prompt: '最终提示词',
    imageModel: 'google-flow-nano-banana-pro', aspectRatio: '3:4'
  };
  const nodes = upsertProductSceneResultNode([source], source, job, 1234);
  const result = nodes[1];
  assert.equal(result.type, 'Image');
  assert.equal(result.status, 'success');
  assert.equal(result.title, '揉腹仪场景图');
  assert.deepEqual(result.parentIds, ['control']);
  assert.equal(result.x, 660);
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
  assert.equal(secondImage.y - firstImage.y, 300);
  assert.deepEqual(firstVideo.parentIds, ['image-1']);
  assert.equal(firstVideo.prompt, '短视频原始提示词');
  assert.equal(nodes.some(node => node.id === 'video-2'), false);
});
