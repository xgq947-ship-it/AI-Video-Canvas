import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/hooks/useNodeDragging.ts', import.meta.url), 'utf8');

test('指针捕获必须挂在 currentTarget，不能挂在 target', () => {
  // target 是光标下最深的子元素。节点拖拽时每帧重渲染，状态文字、进度条、
  // 加载图标随时被 React 换掉；捕获所在元素一旦卸载，浏览器静默释放捕获，
  // 指针事件不再转发到画布容器，光标移出画布节点就当场卡住。
  assert.doesNotMatch(source, /e\.target\.setPointerCapture/);
  assert.doesNotMatch(source, /e\.target\.releasePointerCapture/);
  assert.match(source, /element\.setPointerCapture\(e\.pointerId\)/);
  assert.match(source, /const element = e\.currentTarget;/);
});

test('捕获元素被记住，释放时不依赖当次事件的 target', () => {
  // 松手时的 target 往往已经不是按下时那个元素了，按 target 释放会漏放。
  assert.match(source, /capturedElementRef/);
  assert.match(source, /capturedElementRef\.current = null;/);
});

test('捕获判定用 Element 而不是 HTMLElement——lucide 图标渲染的是 svg', () => {
  // 只看代码形态，注释里提到旧写法是允许的。
  assert.doesNotMatch(source, /e\.target instanceof HTMLElement/);
  assert.match(source, /element instanceof Element/);
  assert.match(source, /target instanceof Element/);
});

test('落在表单控件上的按下不启动节点拖拽', () => {
  // 不拦住的话，点进文本框会同时开始拖节点，而且指针被捕获后连选中文字都做不了。
  assert.match(source, /isInteractiveTarget/);
  assert.match(source, /input, textarea, select, button, a, \[contenteditable="true"\]/);
  assert.match(source, /if \(isInteractiveTarget\(e\.target\)\) return;/);
});

test('画布平移与节点拖拽共用同一套捕获逻辑', () => {
  assert.match(source, /const startPanning = \(e: React\.PointerEvent\) => \{\s*isPanning\.current = true;\s*capturePointer\(e\);/);
});

test('框选也捕获指针，快速点击或移出画布不会把旧框选留给下一次拖拽', () => {
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const selection = fs.readFileSync(new URL('../src/hooks/useSelectionBox.ts', import.meta.url), 'utf8');
  assert.match(app, /if \(e\.button === 0\) \{\s*\/\/[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*capturePointer\(e\);\s*startSelection\(e\);/);
  assert.match(app, /const selectedIds = endSelection\(nodes, viewport\);\s*if \(selectedIds !== null\)/);
  assert.doesNotMatch(app, /if \(isSelecting\)/);
  assert.match(selection, /selectionBoxRef\.current = next;\s*setSelectionBox\(next\);/);
  assert.match(selection, /isNodeInSelectionBox\(node, selectionBoxRef\.current, viewport\)/);
});

test('节点首次按下、pointercancel 和窗口失焦都会清掉残留框选', () => {
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /onNodePointerDown:[\s\S]*?current\.abortPointerInteractions\(\);\s*current\.clearSelectionBox\(\);\s*current\.resetConnectionDrag\(\);[\s\S]*?current\.handleNodePointerDown/);
  assert.match(app, /handleGlobalPointerCancel[\s\S]*?abortPointerInteractions\(\);\s*clearSelectionBox\(\);\s*resetConnectionDrag\(\);/);
  assert.match(app, /window\.addEventListener\('blur', handleWindowBlur\)/);
});

test('右键和次级触点不能覆盖正在开始的主指针拖拽', () => {
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /if \(e\.button !== 0 \|\| e\.isPrimary === false\) return;/);
  assert.match(app, /onNodePointerDown: \(e: React\.PointerEvent, id: string\) => \{\s*if \(e\.button !== 0 \|\| e\.isPrimary === false\) return;/);
});

test('指针被系统收走时必须有兜底，否则捕获会永久残留把画布卡死', () => {
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  // 捕获挂在稳定容器上之后不会再因为子元素卸载被浏览器顺手释放；
  // 少了这条路径，一次被打断的触控板手势就让某个节点永久持有捕获，
  // 之后所有指针事件都转发给它，整块画布看起来彻底失灵。
  assert.match(app, /onPointerCancel=\{handleGlobalPointerCancel\}/);
  assert.match(source, /abortPointerInteractions/);
  // lostpointercapture 在正常松手时也会冒泡，绑上去会误杀已完成的连线拖拽。
  assert.doesNotMatch(app, /onLostPointerCapture/);
});

test('每次新的按下都先清掉可能残留的旧捕获', () => {
  assert.match(source, /forceReleaseCapture\(\);\s*try \{\s*element\.setPointerCapture/);
});

test('详情节点的重状态归一化必须缓存，否则拖拽时每帧重算 1.6MB', () => {
  const node = fs.readFileSync(
    new URL('../src/features/detail-remix/DetailRemixNode.tsx', import.meta.url), 'utf8');
  // 拖动画布上任意节点都会让 setNodes 产生新数组，allNodes 引用随之改变，
  // CanvasNode 的 React.memo 失效。真实项目里这个节点状态有 22 页分析数据，
  // 不缓存就是每秒六十次深拷贝。
  assert.match(node, /const state = React\.useMemo\(\s*\(\) => createDetailRemixNodeData/);
  assert.match(node, /\[data\.detailRemix\],/);
  assert.match(node, /const imageNodes = React\.useMemo/);
  assert.match(node, /const byId = React\.useMemo/);
});
