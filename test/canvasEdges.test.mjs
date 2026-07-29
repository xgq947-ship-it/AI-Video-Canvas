import assert from 'node:assert/strict';
import test from 'node:test';

import { removeCanvasConnection, removeCanvasConnections } from '../src/utils/canvasEdges.js';

test('删除 Edge 只改 child.parentIds，不删除节点、生成资源或其它连接', () => {
  const nodes = [
    { id: 'scene', type: 'Image', resultUrl: '/scene.png' },
    { id: 'product', type: 'Image', resultUrl: '/product.png' },
    {
      id: 'control',
      type: 'Product Scene Replace',
      parentIds: ['scene', 'product'],
      productSceneInputMapping: {
        version: 1,
        sceneReferenceNodeId: 'scene',
        productImageNodeId: 'product',
      },
      sceneReferenceId: 'scene',
      productReferenceId: 'product',
      resultUrl: '/completed.png',
      productSceneVideoTasks: [{ index: 0, resultUrl: '/video.mp4' }],
    },
  ];
  const next = removeCanvasConnection(nodes, { parentId: 'scene', childId: 'control' });
  assert.equal(next.length, nodes.length);
  assert.equal(next.find(node => node.id === 'scene').resultUrl, '/scene.png');
  const control = next.find(node => node.id === 'control');
  assert.deepEqual(control.parentIds, ['product']);
  assert.equal(control.resultUrl, '/completed.png');
  assert.deepEqual(control.productSceneVideoTasks, nodes[2].productSceneVideoTasks);
  assert.equal(control.productReferenceId, 'product');
});

test('批量 Edge 删除仍不进入节点/资源删除路径', () => {
  const nodes = [
    { id: 'a', type: 'Image', resultUrl: '/a.png' },
    { id: 'b', type: 'Image', resultUrl: '/b.png' },
    { id: 'child', type: 'Video', parentIds: ['a', 'b'], resultUrl: '/existing.mp4' },
  ];
  const next = removeCanvasConnections(nodes, [
    { parentId: 'a', childId: 'child' },
    { parentId: 'b', childId: 'child' },
  ]);
  assert.equal(next.length, 3);
  assert.deepEqual(next.find(node => node.id === 'child').parentIds, []);
  assert.equal(next.find(node => node.id === 'child').resultUrl, '/existing.mp4');
});

test('Edge 删除状态进入历史后，恢复旧快照可完整还原连接与语义映射', () => {
  const before = [{
    id: 'child',
    type: 'Product Scene Replace',
    parentIds: ['source'],
    productSceneInputMapping: { version: 1, sceneReferenceNodeId: 'source' },
    sceneReferenceId: 'source',
  }];
  const after = removeCanvasConnection(before, { parentId: 'source', childId: 'child' });
  assert.deepEqual(after[0].parentIds, []);
  const restored = structuredClone(before);
  assert.deepEqual(restored[0].parentIds, ['source']);
  assert.equal(restored[0].productSceneInputMapping.sceneReferenceNodeId, 'source');
});

test('显式 input mapping 为空时不会因旧标量字段而复活已经断开的角色', () => {
  const nodes = [{
    id: 'child',
    type: 'Product Scene Replace',
    parentIds: ['prompt'],
    productSceneInputMapping: { version: 1 },
    sceneReferenceId: 'stale-scene',
    productReferenceId: 'stale-product',
    productSceneVideoPromptSourceId: 'prompt',
  }];
  const next = removeCanvasConnection(nodes, { parentId: 'prompt', childId: 'child' });
  assert.deepEqual(next[0].parentIds, []);
  assert.equal(next[0].productSceneInputMapping.sceneReferenceNodeId, undefined);
  assert.equal(next[0].productSceneInputMapping.productImageNodeId, undefined);
  assert.equal(next[0].productSceneInputMapping.promptSourceNodeId, undefined);
});
