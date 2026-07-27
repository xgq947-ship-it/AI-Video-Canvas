import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONNECTION_DROP_SLOP_PX,
  resolveConnectionDropTarget,
} from '../src/utils/connectionDropTarget.js';

const rect = (left, top, width, height) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
});

test('使用真实节点宽度判定产品场景节点右侧，不再受 340px 固定宽度限制', () => {
  const target = resolveConnectionDropTarget({
    point: { x: 445, y: 200 },
    sourceNodeId: 'image-1',
    candidates: [{ nodeId: 'product-scene', rect: rect(0, 0, 460, 600) }],
  });
  assert.deepEqual(target, { nodeId: 'product-scene', side: 'right' });
});

test('松手落在显式连接点时优先采用连接点方向', () => {
  const target = resolveConnectionDropTarget({
    point: { x: 440, y: 200 },
    sourceNodeId: 'image-1',
    connectorTarget: { nodeId: 'product-scene', side: 'left' },
    candidates: [{ nodeId: 'product-scene', rect: rect(0, 0, 460, 600) }],
  });
  assert.deepEqual(target, { nodeId: 'product-scene', side: 'left' });
});

test('连接点附近允许小范围松手误差，提升 Windows 触控板稳定性', () => {
  const target = resolveConnectionDropTarget({
    point: { x: 460 + CONNECTION_DROP_SLOP_PX - 1, y: 200 },
    sourceNodeId: 'image-1',
    candidates: [{ nodeId: 'product-scene', rect: rect(0, 0, 460, 600) }],
  });
  assert.deepEqual(target, { nodeId: 'product-scene', side: 'right' });
});

test('不会连接回起始节点，超出容错范围也不会误连', () => {
  assert.equal(resolveConnectionDropTarget({
    point: { x: 100, y: 100 },
    sourceNodeId: 'source',
    candidates: [{ nodeId: 'source', rect: rect(0, 0, 340, 400) }],
  }), null);
  assert.equal(resolveConnectionDropTarget({
    point: { x: 500, y: 100 },
    sourceNodeId: 'source',
    candidates: [{ nodeId: 'target', rect: rect(0, 0, 340, 400) }],
  }), null);
});
