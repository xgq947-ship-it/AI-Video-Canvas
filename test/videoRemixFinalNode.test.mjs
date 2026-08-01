import assert from 'node:assert/strict';
import test from 'node:test';

import { upsertVideoRemixFinalNode } from '../src/utils/videoRemixFinalNode.js';

const remix = {
  id: 'remix-1',
  type: 'Video Remix',
  title: '复刻项目',
  x: 100,
  y: 200,
};

const firstOutput = {
  nodeId: 'video-remix-final-remix-1',
  url: '/library/projects/Test/videos/final-1.mp4',
  duration: 5,
  width: 1920,
  height: 1080,
  fps: 24,
  aspectRatio: '16:9',
};

test('成片只创建一个 Final Video Node，并直接连接 Video Remix', () => {
  const nodes = upsertVideoRemixFinalNode([remix], remix.id, firstOutput);
  assert.equal(nodes.length, 2);
  const result = nodes[1];
  assert.equal(result.type, 'Video');
  assert.equal(result.resultUrl, firstOutput.url);
  assert.deepEqual(result.parentIds, [remix.id]);
  assert.equal(result.videoDuration, 5);
  assert.equal(result.resultAspectRatio, '1920/1080');
});

test('重复渲染更新同一个节点，并保留用户移动和重命名', () => {
  let nodes = upsertVideoRemixFinalNode([remix], remix.id, firstOutput);
  nodes = nodes.map(node => node.id === firstOutput.nodeId
    ? { ...node, x: 900, y: 700, displayName: '我的最终版' }
    : node);
  nodes = upsertVideoRemixFinalNode(nodes, remix.id, {
    ...firstOutput,
    url: '/library/projects/Test/videos/final-2.mp4',
    duration: 4.5,
  });
  assert.equal(nodes.length, 2);
  const result = nodes.find(node => node.id === firstOutput.nodeId);
  assert.equal(result.resultUrl, '/library/projects/Test/videos/final-2.mp4');
  assert.equal(result.videoDuration, 4.5);
  assert.equal(result.x, 900);
  assert.equal(result.y, 700);
  assert.equal(result.displayName, '我的最终版');
});
