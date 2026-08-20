import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const toolbarSource = fs.readFileSync(
  new URL('../src/components/canvas/NodeHoverToolbar.tsx', import.meta.url),
  'utf8',
);
const canvasNodeSource = fs.readFileSync(
  new URL('../src/components/canvas/CanvasNode.tsx', import.meta.url),
  'utf8',
);

test('图片和视频操作工具栏由单击选中控制，不再由鼠标悬停触发', () => {
  assert.doesNotMatch(toolbarSource, /group-hover\/nodecard/);
  assert.match(toolbarSource, /if \(!visible\) return null;/);
  assert.equal(
    (canvasNodeSource.match(/visible=\{selected && showControls\}/g) || []).length,
    3,
  );
});
