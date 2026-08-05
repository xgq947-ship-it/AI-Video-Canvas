/**
 * 画布视口剔除的回归测试。
 *
 * 性能收益是次要的，这里主要守的是**不能因为剔除而制造功能 bug**：
 * 拖拽中的节点、连线起点节点一旦被卸载，setPointerCapture 立刻失效，
 * 交互会断在半路——那比多渲染几个节点严重得多。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { visibleNodeIds } from '../src/utils/viewportCulling.js';

const rect = { width: 1000, height: 800 };
const atOrigin = { x: 0, y: 0, zoom: 1 };

const node = (id, x, y) => ({ id, x, y });

test('可视区内的节点会被保留', () => {
    const nodes = [node('a', 0, 0), node('b', 500, 400)];
    const visible = visibleNodeIds({ nodes, viewport: atOrigin, rect });
    assert.equal(visible.has('a'), true);
    assert.equal(visible.has('b'), true);
});

test('远在视口之外的节点会被剔除', () => {
    // margin 默认 1 屏：x 方向可见世界范围约 [-1000, 2000]
    const nodes = [node('near', 100, 100), node('far', 50000, 50000)];
    const visible = visibleNodeIds({ nodes, viewport: atOrigin, rect });
    assert.equal(visible.has('near'), true);
    assert.equal(visible.has('far'), false, '五万像素之外的节点不该渲染');
});

test('外扩一屏的缓冲区内仍然保留（滚动时不闪进闪出）', () => {
    // 可视区右边界 1000，外扩一屏到 2000；节点宽度按 400 估算
    const nodes = [node('buffer', 1500, 0)];
    const visible = visibleNodeIds({ nodes, viewport: atOrigin, rect });
    assert.equal(visible.has('buffer'), true, '缓冲区内的节点应提前渲染好');
});

test('选中的节点永不剔除——拖拽依赖 setPointerCapture', () => {
    const nodes = [node('dragging', 90000, 90000)];
    const visible = visibleNodeIds({ nodes, viewport: atOrigin, rect, keepIds: ['dragging'] });
    assert.equal(visible.has('dragging'), true, '卸载正在拖的节点会让拖拽直接断掉');
});

test('连线起点节点永不剔除（它不一定处于选中状态）', () => {
    const nodes = [node('source', -90000, 0)];
    const visible = visibleNodeIds({ nodes, viewport: atOrigin, rect, keepIds: ['source'] });
    assert.equal(visible.has('source'), true);
});

test('平移视口后，剔除范围跟着移动', () => {
    const nodes = [node('a', 0, 0), node('b', 6000, 0)];
    // 把世界坐标 6000 附近拉进视口：screen = viewport.x + world*zoom
    const panned = { x: -6000, y: 0, zoom: 1 };
    const visible = visibleNodeIds({ nodes, viewport: panned, rect });
    assert.equal(visible.has('b'), true, '平移过去的节点应被渲染');
    assert.equal(visible.has('a'), false, '原点节点此时已远在视口外');
});

test('缩小后可视世界范围变大，更多节点进入渲染', () => {
    const nodes = [node('far', 4000, 0)];
    assert.equal(visibleNodeIds({ nodes, viewport: atOrigin, rect }).has('far'), false);
    // zoom 0.2：可视世界宽度 5000，外扩后可达 15000
    const zoomedOut = { x: 0, y: 0, zoom: 0.2 };
    assert.equal(visibleNodeIds({ nodes, viewport: zoomedOut, rect }).has('far'), true);
});

test('画布尺寸拿不到时不做剔除，宁可多渲染也不能空白', () => {
    const nodes = [node('a', 99999, 99999)];
    for (const badRect of [{ width: 0, height: 0 }, {}, { width: undefined, height: undefined }]) {
        const visible = visibleNodeIds({ nodes, viewport: atOrigin, rect: badRect });
        assert.equal(visible.has('a'), true, `rect=${JSON.stringify(badRect)} 时不应剔除`);
    }
});

test('zoom 非法时同样退化为全部渲染', () => {
    const nodes = [node('a', 99999, 0)];
    for (const zoom of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const visible = visibleNodeIds({ nodes, viewport: { x: 0, y: 0, zoom }, rect });
        assert.equal(visible.has('a'), true, `zoom=${zoom} 时不应剔除`);
    }
});

test('marginScreens 可调，0 表示只保留严格可视区', () => {
    const nodes = [node('buffer', 1500, 0)];
    const visible = visibleNodeIds({ nodes, viewport: atOrigin, rect, marginScreens: 0 });
    assert.equal(visible.has('buffer'), false);
});

// ---------------------------------------------------------------------------
// App 接线
// ---------------------------------------------------------------------------

const APP = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('渲染循环用的是剔除后的列表', () => {
    assert.match(APP, /\{renderedNodes\.map\(node => \(/);
});

test('选中节点与连线起点被放进 keepIds', () => {
    const block = APP.slice(APP.indexOf('const renderedNodes'), APP.indexOf('const latestNodeCallbacks'));
    assert.match(block, /keepIds = \[\.\.\.selectedNodeIds\]/);
    assert.match(block, /connectionStart\?\.nodeId/);
});

test('全部可见时复用原数组，不产生新引用', () => {
    const block = APP.slice(APP.indexOf('const renderedNodes'), APP.indexOf('const latestNodeCallbacks'));
    assert.match(block, /visible\.size === nodes\.length \? nodes :/, '每帧新数组会让下游 memo 失效');
});

test('小地图与包围盒仍基于完整 nodes，不受剔除影响', () => {
    // 它们从 state 读坐标，不依赖 DOM；如果误用 renderedNodes，
    // 屏幕外的节点会从小地图和分组框里消失。
    assert.doesNotMatch(APP, /selectedNodes=\{renderedNodes/);
    assert.doesNotMatch(APP, /nodes=\{renderedNodes\}/);
});
