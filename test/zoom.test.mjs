import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeWheelDelta,
    isTrackpadGesture,
    zoomFactorFromWheel,
    clampZoom,
    ZOOM_MIN,
    ZOOM_MAX,
} from '../shared/zoom.js';

/** 单次事件的缩放百分比（正数=放大幅度） */
const pct = (deltaY, deltaMode = 0) => (zoomFactorFromWheel(deltaY, deltaMode) - 1) * 100;

test('normalizeWheelDelta 按 deltaMode 归一化为像素', () => {
    assert.equal(normalizeWheelDelta(100, 0), 100);
    assert.equal(normalizeWheelDelta(3, 1), 48);      // 行 → 像素
    assert.equal(normalizeWheelDelta(1, 2), 800);     // 页 → 像素
});

test('isTrackpadGesture：仅像素单位且量小才算触控板', () => {
    assert.equal(isTrackpadGesture(2, 0), true);
    assert.equal(isTrackpadGesture(100, 0), false);   // 鼠标滚轮
    assert.equal(isTrackpadGesture(3, 1), false);     // Firefox 滚轮按行计，必须排除
});

test('回归：触控板捏合单次事件不得慢到“推不动”（旧实现仅 0.2%）', () => {
    // 旧实现 exp(-2 * 0.001) ≈ 0.2%
    const oldPct = (Math.exp(-2 * 0.001) - 1) * 100;
    assert.ok(Math.abs(oldPct) < 0.3, '前提：旧实现确实很慢');

    const now = Math.abs(pct(2));
    assert.ok(now > 1.5, `触控板单次缩放应 >1.5%，实际 ${now.toFixed(2)}%`);
    assert.ok(now < 5, `触控板单次缩放不应过冲，实际 ${now.toFixed(2)}%`);
});

test('触控板连续手势：一秒（约 30 次事件）应有明显缩放', () => {
    let zoom = 1;
    for (let i = 0; i < 30; i++) zoom *= zoomFactorFromWheel(-2); // 负值=放大
    // 旧实现 30 次仅约 +6%，几乎无感
    assert.ok(zoom > 1.5, `30 次事件后应显著放大，实际 ${zoom.toFixed(2)}x`);
});

test('鼠标滚轮一格幅度适中（不因提速而跳变）', () => {
    const step = Math.abs(pct(100));
    assert.ok(step > 8, `滚轮一格应 >8%，实际 ${step.toFixed(1)}%`);
    assert.ok(step < 30, `滚轮一格不应 >30%（跳变），实际 ${step.toFixed(1)}%`);
});

test('Firefox 滚轮（deltaMode=1）幅度与 Chrome 滚轮相当，不失控', () => {
    const firefox = Math.abs(pct(3, 1));   // 48px
    const chrome = Math.abs(pct(100, 0));  // 100px
    assert.ok(firefox > 5 && firefox < 30, `Firefox 一格 ${firefox.toFixed(1)}% 应在合理区间`);
    assert.ok(chrome > 5 && chrome < 30);
});

test('方向正确：deltaY 为负放大、为正缩小', () => {
    assert.ok(zoomFactorFromWheel(-2) > 1);
    assert.ok(zoomFactorFromWheel(2) < 1);
    assert.ok(zoomFactorFromWheel(-100) > 1);
    assert.ok(zoomFactorFromWheel(100) < 1);
});

test('delta 为 0 时倍率为 1（无变化）', () => {
    assert.equal(zoomFactorFromWheel(0), 1);
});

test('clampZoom 限制在 [ZOOM_MIN, ZOOM_MAX]', () => {
    assert.equal(clampZoom(5), ZOOM_MAX);
    assert.equal(clampZoom(0.01), ZOOM_MIN);
    assert.equal(clampZoom(1), 1);
});
