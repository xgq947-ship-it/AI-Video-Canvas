import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidNodeConnection, NODE } from '../shared/connectionRules.js';

test('AI 漫剧节点可连向成片(RENDER)', () => {
  assert.equal(isValidNodeConnection(NODE.AUDIO, NODE.RENDER), true);
  assert.equal(isValidNodeConnection(NODE.SFX, NODE.RENDER), true);
  assert.equal(isValidNodeConnection(NODE.BGM, NODE.RENDER), true);
  assert.equal(isValidNodeConnection(NODE.SUBTITLE, NODE.RENDER), true);
  assert.equal(isValidNodeConnection(NODE.VIDEO, NODE.RENDER), true);
  assert.equal(isValidNodeConnection(NODE.VIDEO_EDITOR, NODE.RENDER), true);
});

test('AUDIO 连接不再被禁止（修复点）', () => {
  // 修复前 useConnectionDragging 明确禁止一切 AUDIO 连接
  assert.equal(isValidNodeConnection(NODE.TEXT, NODE.AUDIO), true); // 台词文本 -> 配音
  assert.equal(isValidNodeConnection(NODE.AUDIO, NODE.RENDER), true);
});

test('成片(RENDER)是终点，不能作为父', () => {
  assert.equal(isValidNodeConnection(NODE.RENDER, NODE.VIDEO), false);
  assert.equal(isValidNodeConnection(NODE.RENDER, NODE.RENDER), false);
});

test('音轨/字幕只能连向成片', () => {
  assert.equal(isValidNodeConnection(NODE.AUDIO, NODE.VIDEO), false);
  assert.equal(isValidNodeConnection(NODE.BGM, NODE.IMAGE), false);
  assert.equal(isValidNodeConnection(NODE.SUBTITLE, NODE.VIDEO), false);
});

test('TEXT 可连向 IMAGE/VIDEO/AUDIO/SUBTITLE，但不能连向 TEXT', () => {
  assert.equal(isValidNodeConnection(NODE.TEXT, NODE.IMAGE), true);
  assert.equal(isValidNodeConnection(NODE.TEXT, NODE.VIDEO), true);
  assert.equal(isValidNodeConnection(NODE.TEXT, NODE.SUBTITLE), true);
  assert.equal(isValidNodeConnection(NODE.TEXT, NODE.TEXT), false);
});

test('保留原有图片/视频链式规则（无回归）', () => {
  assert.equal(isValidNodeConnection(NODE.IMAGE, NODE.IMAGE), true);
  assert.equal(isValidNodeConnection(NODE.IMAGE, NODE.VIDEO), true);
  assert.equal(isValidNodeConnection(NODE.IMAGE, NODE.IMAGE_EDITOR), true);
  assert.equal(isValidNodeConnection(NODE.VIDEO, NODE.VIDEO), true);
  assert.equal(isValidNodeConnection(NODE.VIDEO, NODE.IMAGE), false);
  assert.equal(isValidNodeConnection(NODE.VIDEO_EDITOR, NODE.VIDEO), true);
  assert.equal(isValidNodeConnection(NODE.IMAGE, NODE.TEXT), false);
});
