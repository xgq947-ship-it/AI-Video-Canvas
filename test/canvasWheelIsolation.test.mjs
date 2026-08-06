import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('节点内部滚轮不再触发画布平移或缩放', () => {
  const wheelHandler = app.slice(
    app.indexOf('// Wrap handleWheel to pass hovered node for zoom-to-center'),
    app.indexOf('const {', app.indexOf('// Wrap handleWheel to pass hovered node for zoom-to-center')),
  );

  assert.match(wheelHandler, /e\.target instanceof Element/);
  assert.match(wheelHandler, /closest\('\[data-node-id\]'\)/);
  assert.match(wheelHandler, /if \(e\.target instanceof Element && e\.target\.closest\('\[data-node-id\]'\)\) return;/);
  assert.ok(wheelHandler.indexOf('closest') < wheelHandler.indexOf('baseHandleWheel'), '节点内部事件必须在画布处理前被忽略');
});
