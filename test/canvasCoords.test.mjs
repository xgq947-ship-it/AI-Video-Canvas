import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    screenToPane,
    paneToCanvas,
    canvasToPane,
    screenToCanvas,
    canvasToScreen,
    canvasViewCenter,
    centerNodeAt,
    DEFAULT_NODE_WIDTH,
    VIDEO_NODE_WIDTH,
} from '../shared/canvasCoords.js';

// 展开侧边栏 300px 的画布容器（这正是历史 bug 里被漏掉的偏移）
const rect = { left: 300, top: 0, width: 980, height: 720 };

test('screenToPane 扣除画布容器偏移（侧边栏宽度）', () => {
    assert.deepEqual(screenToPane(700, 300, rect), { x: 400, y: 300 });
});

test('paneToCanvas 扣除视口平移并按缩放还原', () => {
    assert.deepEqual(paneToCanvas(400, 300, { x: 0, y: 0, zoom: 1 }), { x: 400, y: 300 });
    assert.deepEqual(paneToCanvas(400, 300, { x: 100, y: 50, zoom: 1 }), { x: 300, y: 250 });
    assert.deepEqual(paneToCanvas(400, 300, { x: 0, y: 0, zoom: 2 }), { x: 200, y: 150 });
});

test('screenToCanvas：鼠标位置 → 节点世界坐标（含侧边栏与缩放）', () => {
    const viewport = { x: 100, y: 50, zoom: 2 };
    // pane = (700-300, 300-0) = (400, 300)；canvas = ((400-100)/2, (300-50)/2)
    assert.deepEqual(screenToCanvas(700, 300, rect, viewport), { x: 150, y: 125 });
});

test('canvasToScreen 与 screenToCanvas 互为逆运算', () => {
    const viewport = { x: -120, y: 65, zoom: 1.4 };
    const screen = { x: 842, y: 391 };
    const canvas = screenToCanvas(screen.x, screen.y, rect, viewport);
    const back = canvasToScreen(canvas.x, canvas.y, rect, viewport);
    assert.ok(Math.abs(back.x - screen.x) < 1e-9);
    assert.ok(Math.abs(back.y - screen.y) < 1e-9);
});

test('canvasToPane 与 paneToCanvas 互为逆运算', () => {
    const viewport = { x: 37, y: -18, zoom: 0.75 };
    const pane = canvasToPane(210, 460, viewport);
    const back = paneToCanvas(pane.x, pane.y, viewport);
    assert.ok(Math.abs(back.x - 210) < 1e-9);
    assert.ok(Math.abs(back.y - 460) < 1e-9);
});

test('回归：节点放在光标处时，回算的屏幕位置必须精确等于光标（不得偏移侧边栏宽度）', () => {
    const viewport = { x: 0, y: 0, zoom: 1 };
    const cursor = { x: 700, y: 300 };
    const canvas = screenToCanvas(cursor.x, cursor.y, rect, viewport);
    const screen = canvasToScreen(canvas.x, canvas.y, rect, viewport);
    assert.equal(screen.x, cursor.x); // 曾经这里会差 300（侧边栏宽度）
    assert.equal(screen.y, cursor.y);
});

test('canvasViewCenter 是画布可视区中心，而非 window 中心', () => {
    const viewport = { x: 0, y: 0, zoom: 1 };
    const center = canvasViewCenter(rect, viewport);
    // 画布宽 980 → 中心 pane=490；换回屏幕应为 300+490=790
    assert.deepEqual(center, { x: 490, y: 360 });
    const screen = canvasToScreen(center.x, center.y, rect, viewport);
    assert.equal(screen.x, 790);
    // 若错用 window 中心 (1280/2=640) 会偏 150px
    assert.notEqual(screen.x, 640);
});

test('canvasViewCenter 在缩放/平移下仍映射到可视区中心', () => {
    const viewport = { x: -400, y: 120, zoom: 1.6 };
    const center = canvasViewCenter(rect, viewport);
    const screen = canvasToScreen(center.x, center.y, rect, viewport);
    assert.ok(Math.abs(screen.x - (rect.left + rect.width / 2)) < 1e-9);
    assert.ok(Math.abs(screen.y - (rect.top + rect.height / 2)) < 1e-9);
});

test('centerNodeAt 减去节点一半尺寸', () => {
    // 默认按节点卡片真实宽度 365 居中
    assert.deepEqual(centerNodeAt({ x: 500, y: 400 }), { x: 500 - 365 / 2, y: 250 });
    assert.deepEqual(centerNodeAt({ x: 500, y: 400 }, 100, 60), { x: 450, y: 370 });
});

test('centerNodeAt 默认宽度与节点卡片实际渲染宽度一致（365 / 视频 385）', () => {
    assert.equal(DEFAULT_NODE_WIDTH, 365);
    assert.equal(VIDEO_NODE_WIDTH, 385);
    // 居中后回算：节点中心必须落在目标点上
    const point = { x: 500, y: 400 };
    const placed = centerNodeAt(point, DEFAULT_NODE_WIDTH);
    assert.equal(placed.x + DEFAULT_NODE_WIDTH / 2, point.x);
    const placedVideo = centerNodeAt(point, VIDEO_NODE_WIDTH);
    assert.equal(placedVideo.x + VIDEO_NODE_WIDTH / 2, point.x);
});
