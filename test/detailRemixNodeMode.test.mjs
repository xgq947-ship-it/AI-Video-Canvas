import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(
  new URL('../src/features/detail-remix/DetailRemixNode.tsx', import.meta.url),
  'utf8',
);

test('详情节点保留常规执行入口，并提供独立的同模换色一次直出按钮', () => {
  assert.match(source, /生成最终详情/);
  assert.match(source, /同模换色直出（1次\/页）/);
  assert.match(source, /handleExecute\('same-mold-recolor'\)/);
  assert.match(source, /generationMode === 'same-mold-recolor'/);
  assert.match(source, /maxStructuralRegenerations: sameMoldRecolor \? 0/);
  assert.match(source, /质检失败不会自动付费修复/);
});

test('同模换色入口固定在滚动区外，任务繁忙时只禁用而不隐藏', () => {
  const buttonIndex = source.indexOf('aria-label="同模换色直出"');
  const scrollIndex = source.indexOf('className="space-y-2 overflow-y-auto p-3"');
  assert.ok(buttonIndex >= 0 && buttonIndex < scrollIndex, '入口必须位于标题栏，不能藏在滚动区底部');
  const buttonBlock = source.slice(buttonIndex, scrollIndex);
  assert.match(buttonBlock, /disabled=\{busy\}/);
  assert.doesNotMatch(buttonBlock, /!generationBusy/);
});
