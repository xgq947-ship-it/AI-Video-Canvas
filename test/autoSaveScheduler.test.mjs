import assert from 'node:assert/strict';
import test from 'node:test';

import { createAutoSaveScheduler } from '../src/utils/autoSaveScheduler.js';

/** 可控的假定时器，记录被创建/清除的次数。 */
function createFakeTimers() {
    let created = 0;
    let cleared = 0;
    const handlers = new Map();
    let nextId = 1;
    return {
        get created() { return created; },
        get cleared() { return cleared; },
        setTimer(handler) {
            created += 1;
            const id = nextId++;
            handlers.set(id, handler);
            return id;
        },
        clearTimer(id) {
            cleared += 1;
            handlers.delete(id);
        },
        async fireAll() {
            for (const handler of [...handlers.values()]) await handler();
        }
    };
}

test('状态变化不会重建定时器（自动保存不会被 render 无限推迟）', async () => {
    // 回归：useAutoSave 曾把 nodes / 未记忆化的 onSave 放进 effect 依赖，
    // 每次 render 都 clearInterval + setInterval，60 秒计时器永远从 0 重来。
    const timers = createFakeTimers();
    let state = { isDirty: false, nodeCount: 0, save: null };
    let saves = 0;

    const scheduler = createAutoSaveScheduler({
        intervalMs: 60_000,
        getState: () => state,
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer
    });

    // 模拟用户连续拖拽：状态换了 100 次（每次都是全新的 save 函数引用）。
    for (let i = 0; i < 100; i += 1) {
        state = { isDirty: true, nodeCount: 3, save: async () => { saves += 1; } };
    }

    assert.equal(timers.created, 1, '定时器只应创建一次');
    assert.equal(timers.cleared, 0);

    await timers.fireAll();
    assert.equal(saves, 1, '定时器到点后必须用最新状态保存一次');

    scheduler.stop();
    assert.equal(timers.cleared, 1);
});

test('未修改、空画布或缺少保存函数时不写盘', async () => {
    const timers = createFakeTimers();
    let state = { isDirty: false, nodeCount: 3, save: async () => { throw new Error('不应被调用'); } };

    createAutoSaveScheduler({
        intervalMs: 1_000,
        getState: () => state,
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer
    });

    await timers.fireAll();

    state = { ...state, isDirty: true, nodeCount: 0 };
    await timers.fireAll();

    state = { isDirty: true, nodeCount: 3, save: null };
    await timers.fireAll();
});

test('上一次保存还没结束时不会并发再保存', async () => {
    const timers = createFakeTimers();
    let release;
    let started = 0;
    const state = {
        isDirty: true,
        nodeCount: 1,
        save: () => {
            started += 1;
            return new Promise(resolve => { release = resolve; });
        }
    };

    const scheduler = createAutoSaveScheduler({
        intervalMs: 1_000,
        getState: () => state,
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer
    });

    const first = scheduler.tick();
    await scheduler.tick();
    assert.equal(started, 1, '保存进行中时第二次 tick 必须跳过');

    release();
    await first;

    // 第三次 tick 会再挂起一个 pending 的保存，先断言再放行，否则永远等不到。
    const third = scheduler.tick();
    assert.equal(started, 2, '上一次保存结束后应该能再次保存');
    release();
    await third;
    scheduler.stop();
});

test('保存抛错不会卡死后续保存', async () => {
    const timers = createFakeTimers();
    const errors = [];
    let attempts = 0;
    const state = {
        isDirty: true,
        nodeCount: 1,
        save: async () => {
            attempts += 1;
            if (attempts === 1) throw new Error('磁盘写入失败');
        }
    };

    const scheduler = createAutoSaveScheduler({
        intervalMs: 1_000,
        getState: () => state,
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
        logger: { error: (...args) => errors.push(args) }
    });

    await scheduler.tick();
    assert.equal(errors.length, 1);

    await scheduler.tick();
    assert.equal(attempts, 2, '一次失败后必须继续尝试自动保存');
    scheduler.stop();
});

test('stop 之后不再保存', async () => {
    const timers = createFakeTimers();
    let saves = 0;
    const scheduler = createAutoSaveScheduler({
        intervalMs: 1_000,
        getState: () => ({ isDirty: true, nodeCount: 1, save: async () => { saves += 1; } }),
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer
    });

    scheduler.stop();
    await scheduler.tick();
    assert.equal(saves, 0);
});
