import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const nodeWheelSources = [
  '../src/components/canvas/NodeContent.tsx',
  '../src/components/canvas/NodeControls.tsx',
  '../src/components/canvas/MangaNode.tsx',
].map(file => fs.readFileSync(new URL(file, import.meta.url), 'utf8'));

test('节点内部普通滚轮留给控件，Ctrl/Cmd 滚轮仍触发画布缩放', () => {
  const wheelHandler = app.slice(
    app.indexOf('// Wrap handleWheel to pass hovered node for zoom-to-center'),
    app.indexOf('const {', app.indexOf('// Wrap handleWheel to pass hovered node for zoom-to-center')),
  );

  assert.match(wheelHandler, /const isZoomGesture = e\.ctrlKey \|\| e\.metaKey;/);
  assert.match(wheelHandler, /e\.target instanceof Element/);
  assert.match(wheelHandler, /closest\('\[data-node-id\]'\)/);
  assert.match(wheelHandler, /if \(!isZoomGesture && e\.target instanceof Element && e\.target\.closest\('\[data-node-id\]'\)\) return;/);
  assert.ok(wheelHandler.indexOf('!isZoomGesture') < wheelHandler.indexOf('baseHandleWheel'), '只有节点内普通滚轮应在画布处理前被忽略');
  for (const source of nodeWheelSources) {
    assert.doesNotMatch(source, /onWheel=\{(?:stop|\(e\) => e\.stopPropagation\(\))\}/, '节点控件不能再次拦截 Ctrl/Cmd 缩放手势');
  }
});
