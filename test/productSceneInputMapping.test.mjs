import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assignProductSceneInputOnConnect,
  productSceneInputMappingPatch,
  resolveProductSceneInputMapping,
} from '../src/utils/productSceneInputMapping.js';
import { removeCanvasConnection } from '../src/utils/canvasEdges.js';

const scene = { id: 'image-z', type: 'Image', title: '客厅场景参考', resultUrl: '/scene.png' };
const product = { id: 'image-a', type: 'Image', title: '我方产品', resultUrl: '/product.png' };
const prompt = { id: 'text-1', type: 'Text', prompt: '视频提示词' };

test('旧项目的产品输入按语义/稳定 id 迁移，不依赖 parentIds 创建顺序', () => {
  const firstOrder = {
    id: 'control',
    type: 'Product Scene Replace',
    parentIds: [product.id, scene.id, prompt.id],
  };
  const reversedOrder = { ...firstOrder, parentIds: [prompt.id, scene.id, product.id] };
  const nodes = [firstOrder, scene, product, prompt];
  assert.deepEqual(
    resolveProductSceneInputMapping(firstOrder, nodes),
    resolveProductSceneInputMapping(reversedOrder, [reversedOrder, scene, product, prompt])
  );
  assert.equal(resolveProductSceneInputMapping(firstOrder, nodes).sceneReferenceNodeId, scene.id);
  assert.equal(resolveProductSceneInputMapping(firstOrder, nodes).productImageNodeId, product.id);
});

test('手动语义映射在父节点顺序变化后保持不变并可序列化', () => {
  const mapping = {
    version: 1,
    sceneReferenceNodeId: product.id,
    productImageNodeId: scene.id,
    promptSourceNodeId: prompt.id,
  };
  const control = {
    id: 'control',
    type: 'Product Scene Replace',
    parentIds: [scene.id, product.id, prompt.id],
    ...productSceneInputMappingPatch(mapping),
  };
  const resolved = resolveProductSceneInputMapping(
    { ...control, parentIds: [prompt.id, product.id, scene.id] },
    [control, scene, product, prompt]
  );
  assert.deepEqual(resolved, mapping);
  assert.deepEqual(JSON.parse(JSON.stringify(control)).productSceneInputMapping, mapping);
});

test('断开场景 Edge 只清空场景角色，保留产品、节点和媒体；重连恢复原角色', () => {
  const mapping = {
    version: 1,
    sceneReferenceNodeId: scene.id,
    productImageNodeId: product.id,
  };
  const control = {
    id: 'control',
    type: 'Product Scene Replace',
    parentIds: [scene.id, product.id],
    resultUrl: '/existing-result.png',
    ...productSceneInputMappingPatch(mapping),
  };
  const disconnected = removeCanvasConnection(
    [scene, product, control],
    { parentId: scene.id, childId: control.id }
  );
  const nextControl = disconnected.find(node => node.id === control.id);
  assert.equal(disconnected.length, 3);
  assert.equal(nextControl.resultUrl, '/existing-result.png');
  assert.deepEqual(nextControl.parentIds, [product.id]);
  assert.equal(nextControl.productSceneInputMapping.sceneReferenceNodeId, undefined);
  assert.equal(nextControl.productSceneInputMapping.productImageNodeId, product.id);

  const reconnectPatch = assignProductSceneInputOnConnect(nextControl, scene, disconnected);
  assert.equal(reconnectPatch.sceneReferenceId, scene.id);
  assert.equal(reconnectPatch.productReferenceId, product.id);
});

test('两个无语义图片也按稳定 id 映射，连接创建顺序不会交换角色', () => {
  const a = { id: 'a', type: 'Image', resultUrl: '/a.png' };
  const b = { id: 'b', type: 'Image', resultUrl: '/b.png' };
  const control = { id: 'control', type: 'Product Scene Replace', parentIds: [b.id, a.id] };
  const mapping = resolveProductSceneInputMapping(control, [control, a, b]);
  assert.equal(mapping.sceneReferenceNodeId, 'a');
  assert.equal(mapping.productImageNodeId, 'b');
});

test('连接更多文本节点不会覆盖已经保存的短视频提示词来源', () => {
  const first = { id: 'text-a', type: 'Text', prompt: '第一版提示词' };
  const second = { id: 'text-b', type: 'Text', prompt: '第二版提示词' };
  const control = {
    id: 'control',
    type: 'Product Scene Replace',
    parentIds: [first.id],
    ...productSceneInputMappingPatch({ version: 1, promptSourceNodeId: first.id }),
  };
  const patch = assignProductSceneInputOnConnect(control, second, [control, first, second]);
  assert.equal(patch.productSceneInputMapping.promptSourceNodeId, first.id);
});
