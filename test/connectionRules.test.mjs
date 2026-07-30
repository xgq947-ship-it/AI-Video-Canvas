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

test('配音可连向视频作为 Seedance 音色参考，其他音轨仍只能连向成片', () => {
  assert.equal(isValidNodeConnection(NODE.AUDIO, NODE.VIDEO), true);
  assert.equal(isValidNodeConnection(NODE.SFX, NODE.VIDEO), false);
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

test('产品短视频节点接收两张图片与短视频文本，输出可继续生成图片或视频', () => {
  assert.equal(isValidNodeConnection(NODE.IMAGE, NODE.PRODUCT_SCENE_REPLACE), true);
  assert.equal(isValidNodeConnection(NODE.IMAGE_EDITOR, NODE.PRODUCT_SCENE_REPLACE), true);
  assert.equal(isValidNodeConnection(NODE.TEXT, NODE.PRODUCT_SCENE_REPLACE), true);
  assert.equal(isValidNodeConnection(NODE.VIDEO, NODE.PRODUCT_SCENE_REPLACE), false);
  assert.equal(isValidNodeConnection(NODE.PRODUCT_SCENE_REPLACE, NODE.IMAGE), true);
  assert.equal(isValidNodeConnection(NODE.PRODUCT_SCENE_REPLACE, NODE.VIDEO), true);
});

test('Video Remix 只接收参考视频，并以普通视频节点承接最终结果', () => {
  assert.equal(isValidNodeConnection(NODE.VIDEO, NODE.VIDEO_REMIX), true);
  assert.equal(isValidNodeConnection(NODE.IMAGE, NODE.VIDEO_REMIX), false);
  assert.equal(isValidNodeConnection(NODE.TEXT, NODE.VIDEO_REMIX), false);
  assert.equal(isValidNodeConnection(NODE.VIDEO_REMIX, NODE.VIDEO), true);
  assert.equal(isValidNodeConnection(NODE.VIDEO_REMIX, NODE.IMAGE), false);
});
