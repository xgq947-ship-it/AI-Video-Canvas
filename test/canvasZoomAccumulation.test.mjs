import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { clampZoom, zoomFactorFromWheel } from '../shared/zoom.js';

const source = fs.readFileSync(
  new URL('../src/hooks/useCanvasNavigation.ts', import.meta.url), 'utf8');

test('缩放必须用函数式更新，不能读闭包里的 viewport', () => {
  // 触控板捏合一次会连发几十个 wheel 事件，它们在同一个任务里批处理、期间不
  // 重渲染。从闭包取 viewport 会让这一串事件全部基于同一个陈旧值：倍率被吞掉
  // （手感发滞），锚点按错误基准换算（反复缩放后定位越来越飘）。
  assert.doesNotMatch(source, /\(anchorX - viewport\.x\)/);
  assert.doesNotMatch(source, /\(cx - viewport\.x\)/);
  assert.match(source, /setViewport\(prev => \{/);
  assert.match(source, /\(anchorX - prev\.x\) \* \(newZoom \/ prev\.zoom\)/);
  assert.match(source, /let targetZoom = prev\.zoom \* step;/);
});

test('滑块缩放同样基于 prev 换算', () => {
  assert.match(source, /cx - \(cx - prev\.x\) \* \(newZoom \/ prev\.zoom\)/);
  assert.match(source, /cy - \(cy - prev\.y\) \* \(newZoom \/ prev\.zoom\)/);
});

test('事件字段在进入更新函数前取出——更新函数异步执行时合成事件可能已回收', () => {
  assert.match(source, /const mouseX = e\.clientX - rect\.left;/);
  assert.match(source, /const \{ deltaX, deltaY \} = e;/);
});

test('倍率被夹紧到上下限后不再移动画布，避免在边界持续漂移', () => {
  assert.match(source, /if \(newZoom === prev\.zoom\) return prev;/);
});

test('连续事件的正确结果是逐次相乘，而不是只生效一次', () => {
  const step = zoomFactorFromWheel(-2, 0);
  let compounded = 0.1;
  for (let i = 0; i < 8; i += 1) compounded = clampZoom(compounded * step);
  const staleClosureResult = clampZoom(0.1 * step);
  // 实测：8 个小步事件后画布显示 12%，与 compounded 一致，而非 staleClosureResult。
  assert.ok(compounded > staleClosureResult);
  assert.equal(Math.round(compounded * 100), 12);
  assert.equal(Math.round(staleClosureResult * 100), 10);
});
