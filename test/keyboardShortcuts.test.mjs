import assert from 'node:assert/strict';
import test from 'node:test';

import { canvasHistoryShortcut, isTextEditingTarget } from '../src/utils/keyboardShortcuts.js';

test('Windows/Linux Ctrl 与 macOS Command 进入同一套 Undo/Redo', () => {
  assert.equal(canvasHistoryShortcut({ ctrlKey: true, metaKey: false, shiftKey: false, key: 'z' }), 'undo');
  assert.equal(canvasHistoryShortcut({ ctrlKey: false, metaKey: true, shiftKey: false, key: 'Z' }), 'undo');
  assert.equal(canvasHistoryShortcut({ ctrlKey: true, metaKey: false, shiftKey: true, key: 'z' }), 'redo');
  assert.equal(canvasHistoryShortcut({ ctrlKey: true, metaKey: false, shiftKey: false, key: 'y' }), 'redo');
  assert.equal(canvasHistoryShortcut({ ctrlKey: false, metaKey: false, shiftKey: false, key: 'z' }), null);
});

test('输入框与 contenteditable 聚焦时保留原生文本 Ctrl/Command+Z', () => {
  assert.equal(isTextEditingTarget({ tagName: 'INPUT' }), true);
  assert.equal(isTextEditingTarget({ tagName: 'textarea' }), true);
  assert.equal(isTextEditingTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isTextEditingTarget({ tagName: 'DIV', closest: selector => selector.includes('textbox') ? {} : null }), true);
  assert.equal(isTextEditingTarget({ tagName: 'BUTTON', closest: () => null }), false);
});
