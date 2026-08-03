import assert from 'node:assert/strict';
import test from 'node:test';

import {
  upsertVideoRemixFinalNode,
  upsertVideoRemixProjectFinalNode,
} from '../src/utils/videoRemixFinalNode.js';

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

test('独立复刻任务只有用户发送时才创建无容器依赖的普通视频节点', () => {
  const project = {
    id: 'remix-project-1',
    title: '产品广告',
  };
  let nodes = upsertVideoRemixProjectFinalNode([], project, firstOutput, {
    x: 320,
    y: 180,
  });
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].type, 'Video');
  assert.deepEqual(nodes[0].parentIds, []);
  assert.equal(nodes[0].x, 320);
  assert.equal(nodes[0].y, 180);

  nodes = upsertVideoRemixProjectFinalNode(nodes, {
    ...project,
    finalCanvasNodeId: firstOutput.nodeId,
  }, {
    ...firstOutput,
    url: '/library/projects/Test/videos/final-standalone-v2.mp4',
  }, { x: 0, y: 0 });
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].resultUrl, '/library/projects/Test/videos/final-standalone-v2.mp4');
  assert.equal(nodes[0].x, 320);
});

test('用户删除已发送成片后再次发送仍复用任务记录的稳定节点 ID', () => {
  const project = {
    id: 'remix-project-1',
    title: '稳定输出',
    finalCanvasNodeId: 'remembered-final-node',
  };
  const output = {
    nodeId: 'new-render-output-id',
    url: '/library/projects/demo/video-remix/final.mp4',
    duration: 8,
    width: 1080,
    height: 1920,
    fps: 30,
    aspectRatio: '9:16',
  };

  const recreated = upsertVideoRemixProjectFinalNode([], project, output, { x: 15, y: 25 });
  const repeated = upsertVideoRemixProjectFinalNode(recreated, project, output, { x: 500, y: 500 });

  assert.equal(recreated.length, 1);
  assert.equal(recreated[0].id, 'remembered-final-node');
  assert.equal(repeated.length, 1);
  assert.equal(repeated[0].id, 'remembered-final-node');
  assert.deepEqual({ x: repeated[0].x, y: repeated[0].y }, { x: 15, y: 25 });
});
