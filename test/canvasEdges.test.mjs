import assert from 'node:assert/strict';
import test from 'node:test';

import {
  removeCanvasConnection,
  removeCanvasConnections,
  removeCanvasNodes,
  wouldCreateCycle,
} from '../src/utils/canvasEdges.js';

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

test('删除商品详情复刻 Edge 会同步移除对应语义角色并保留人物开关', () => {
  const nodes = [{
    id: 'detail',
    type: 'Detail Page Remix',
    parentIds: ['competitor', 'person'],
    inputPortByParentId: {
      competitor: 'competitor-detail',
      person: 'character-reference',
    },
    detailRemix: {
      schemaVersion: 1,
      status: 'ready',
      inputRefs: {
        competitorDetailNodeIds: ['competitor'],
        ownDetailNodeIds: [],
        characterReference: { enabled: false, nodeIds: ['person'] },
        productNodeIds: [],
      },
    },
  }];
  const next = removeCanvasConnection(nodes, { parentId: 'person', childId: 'detail' });
  assert.deepEqual(next[0].parentIds, ['competitor']);
  assert.deepEqual(next[0].detailRemix.inputRefs.characterReference, { enabled: false, nodeIds: [] });
  assert.deepEqual(next[0].detailRemix.inputRefs.competitorDetailNodeIds, ['competitor']);
});

test('删除已导入的竞品图会同步页序引用，详情重切片不再读取已不存在节点', () => {
  const nodes = [
    { id: 'competitor-1', type: 'Image', resultUrl: '/1.png' },
    { id: 'competitor-2', type: 'Image', resultUrl: '/2.png' },
    { id: 'competitor-3', type: 'Image', resultUrl: '/3.png' },
    { id: 'product', type: 'Image', resultUrl: '/product.png' },
    {
      id: 'detail',
      type: 'Detail Page Remix',
      parentIds: ['competitor-1', 'competitor-2', 'competitor-3', 'product'],
      inputPortByParentId: {
        'competitor-1': 'competitor-detail',
        'competitor-2': 'competitor-detail',
        'competitor-3': 'competitor-detail',
        product: 'product-reference',
      },
      detailRemix: {
        schemaVersion: 1,
        status: 'ready',
        inputRefs: {
          competitorDetailNodeIds: ['competitor-1', 'competitor-2', 'competitor-3'],
          ownDetailNodeIds: [],
          characterReference: { enabled: false, nodeIds: [] },
          productNodeIds: ['product'],
        },
      },
    },
  ];
  const next = removeCanvasNodes(nodes, ['competitor-2']);
  assert.equal(next.some(node => node.id === 'competitor-2'), false);
  const detail = next.find(node => node.id === 'detail');
  assert.deepEqual(detail.parentIds, ['competitor-1', 'competitor-3', 'product']);
  assert.deepEqual(detail.detailRemix.inputRefs.competitorDetailNodeIds, [
    'competitor-1',
    'competitor-3',
  ]);
  assert.deepEqual(detail.detailRemix.inputRefs.productNodeIds, ['product']);
  assert.equal(detail.inputPortByParentId['competitor-2'], undefined);
});

test('打开旧项目时可清理已经缺失但仍残留在详情输入中的竞品图引用', () => {
  const staleNodes = [{
    id: 'detail',
    type: 'Detail Page Remix',
    parentIds: ['competitor-1', 'deleted-competitor'],
    inputPortByParentId: {
      'competitor-1': 'competitor-detail',
      'deleted-competitor': 'competitor-detail',
    },
    detailRemix: {
      schemaVersion: 1,
      status: 'ready',
      inputRefs: {
        competitorDetailNodeIds: ['competitor-1', 'deleted-competitor'],
        ownDetailNodeIds: [],
        characterReference: { enabled: false, nodeIds: [] },
        productNodeIds: [],
      },
    },
  }, {
    id: 'competitor-1', type: 'Image', resultUrl: '/1.png',
  }];
  const repaired = removeCanvasNodes(staleNodes, ['deleted-competitor']);
  const detail = repaired.find(node => node.id === 'detail');
  assert.deepEqual(detail.parentIds, ['competitor-1']);
  assert.deepEqual(detail.detailRemix.inputRefs.competitorDetailNodeIds, ['competitor-1']);
});

test('wouldCreateCycle：直接回连 A→B→A 会成环', () => {
  const nodes = [
    { id: 'a', type: 'Image' },
    { id: 'b', type: 'Image', parentIds: ['a'] }, // a → b 已存在
  ];
  // 再连 b → a 会闭环
  assert.equal(wouldCreateCycle(nodes, 'b', 'a'), true);
});

test('wouldCreateCycle：间接回连 A→B→C→A 会成环', () => {
  const nodes = [
    { id: 'a', type: 'Video' },
    { id: 'b', type: 'Video', parentIds: ['a'] },
    { id: 'c', type: 'Video', parentIds: ['b'] },
  ];
  assert.equal(wouldCreateCycle(nodes, 'c', 'a'), true);
});

test('wouldCreateCycle：自连算成环', () => {
  assert.equal(wouldCreateCycle([{ id: 'a' }], 'a', 'a'), true);
});

test('wouldCreateCycle：正常向前连接与重连既有边不算成环', () => {
  const nodes = [
    { id: 'a', type: 'Image' },
    { id: 'b', type: 'Image', parentIds: ['a'] },
    { id: 'c', type: 'Image' },
  ];
  // a → b 已存在，重新拖同一条边不应被判成环
  assert.equal(wouldCreateCycle(nodes, 'a', 'b'), false);
  // 新增前向边 b → c 合法
  assert.equal(wouldCreateCycle(nodes, 'b', 'c'), false);
  // 汇聚：a 再连到 c（c 无下游）合法
  assert.equal(wouldCreateCycle(nodes, 'a', 'c'), false);
});

test('wouldCreateCycle：菱形（多父）不会误判为环', () => {
  // a → b, a → c, b → d, c → d（钻石），再把 d 连到一个全新的 e 合法
  const nodes = [
    { id: 'a' },
    { id: 'b', parentIds: ['a'] },
    { id: 'c', parentIds: ['a'] },
    { id: 'd', parentIds: ['b', 'c'] },
    { id: 'e' },
  ];
  assert.equal(wouldCreateCycle(nodes, 'd', 'e'), false);
  // 但把 d 连回 a 会成环
  assert.equal(wouldCreateCycle(nodes, 'd', 'a'), true);
});
