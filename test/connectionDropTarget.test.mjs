import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

test('重复候选不影响结果：指针正下方的节点排前面即可决定重叠时谁赢', () => {
  // 钩子把「指针正下方的节点」拼在完整候选表前面来表达 z 序，因此候选表里必然
  // 出现重复项。去重必须保留先出现的那个，否则重叠节点会连错。
  const top = { nodeId: 'top', rect: rect(0, 0, 340, 400) };
  const bottom = { nodeId: 'bottom', rect: rect(0, 0, 340, 400) };
  assert.deepEqual(resolveConnectionDropTarget({
    point: { x: 100, y: 100 },
    sourceNodeId: 'source',
    candidates: [top, bottom, top, bottom],
  }), { nodeId: 'top', side: 'left' });
});

test('连线拖拽的命中判定按帧缓存节点矩形，不每次事件都强制重排', () => {
  // getBoundingClientRect() 会强制同步布局，而命中判定要对画布上每个节点各取一次。
  // 高回报率鼠标一帧能发好几条 pointermove，逐条重算就是拖线卡顿的来源。
  // 按帧（rAF）而不是按整次拖拽缓存：拖到一半缩放/平移画布时结果仍要立刻跟上。
  const hook = fs.readFileSync(new URL('../src/hooks/useConnectionDragging.ts', import.meta.url), 'utf8');
  assert.match(hook, /nodeRectCache/);
  assert.match(hook, /requestAnimationFrame\(invalidateNodeRects\)/, '缓存必须在下一帧作废');
  const reader = hook.slice(hook.indexOf('const readNodeRects'), hook.indexOf('const resolveDropTargetAtPoint'));
  assert.equal(
    (reader.match(/getBoundingClientRect/g) || []).length,
    1,
    '取矩形只应集中在 readNodeRects 一处'
  );
  const resolver = hook.slice(hook.indexOf('const resolveDropTargetAtPoint'), hook.indexOf('const checkHoveredNode'));
  assert.doesNotMatch(resolver, /getBoundingClientRect|querySelectorAll/, '命中判定不得绕过缓存直接查 DOM');
});
