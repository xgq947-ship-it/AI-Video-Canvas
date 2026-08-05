/**
 * 画布落盘调度器的回归测试。
 *
 * 这套机制的存在意义是「崩溃/断电时能恢复」，所以两个方向都要守住：
 *   - 不能太吵：批量生成时密集到达的变化必须合并成一次写盘（原来是约 2N 次）；
 *   - 不能太懒：最坏延迟必须有上界，且卸载/关窗前必须把待写的那次落下去。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvasSaveScheduler } from '../src/utils/canvasSaveScheduler.js';

/**
 * 把微任务队列跑干净。
 * 调度器内部是 `Promise.resolve().then(save).catch(onError)`，save 返回的 promise
 * 还要经过一次 adoption，链路有好几跳，等一两个 tick 不够。
 */
const flushMicrotasks = async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

/** 可手动推进的假定时器，避免测试依赖真实时间。 */
const createFakeClock = () => {
    let now = 0;
    let nextId = 1;
    const scheduled = new Map();
    return {
        setTimer(fn, delay) {
            const id = nextId++;
            scheduled.set(id, { fn, at: now + delay });
            return id;
        },
        clearTimer(id) {
            scheduled.delete(id);
        },
        async advance(ms) {
            now += ms;
            const due = [...scheduled.entries()]
                .filter(([, entry]) => entry.at <= now)
                .sort((a, b) => a[1].at - b[1].at);
            for (const [id, entry] of due) {
                scheduled.delete(id);
                entry.fn();
            }
            await flushMicrotasks();
        },
        get pendingCount() {
            return scheduled.size;
        }
    };
};

const createScheduler = (clock, overrides = {}) => {
    const calls = [];
    const scheduler = createCanvasSaveScheduler({
        delayMs: 1200,
        save: () => { calls.push(Date.now()); },
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
        ...overrides
    });
    return { scheduler, calls };
};

test('窗口内的密集请求合并成一次写盘', async () => {
    const clock = createFakeClock();
    const { scheduler, calls } = createScheduler(clock);

    // 模拟批量生成：10 个分镜进 LOADING + 10 个产出媒体 = 20 次请求
    for (let i = 0; i < 20; i += 1) scheduler.request();
    assert.equal(calls.length, 0, '排期期间不应该已经写过盘');

    await clock.advance(1200);
    assert.equal(calls.length, 1, `20 次请求应合并为 1 次写盘，实际 ${calls.length} 次`);
});

test('前沿排期：最坏延迟有上界，不会被持续到达的请求无限推后', async () => {
    const clock = createFakeClock();
    const { scheduler, calls } = createScheduler(clock);

    scheduler.request();
    // 每 300ms 来一次请求，尾沿去抖会被推到永远，前沿排期必须照常在 1200ms 落盘
    for (let elapsed = 300; elapsed <= 1200; elapsed += 300) {
        await clock.advance(300);
        scheduler.request();
    }
    assert.equal(calls.length, 1, '持续到达的请求不得把保存无限推后');
});

test('窗口结束后的新请求会重新排期', async () => {
    const clock = createFakeClock();
    const { scheduler, calls } = createScheduler(clock);

    scheduler.request();
    await clock.advance(1200);
    assert.equal(calls.length, 1);

    scheduler.request();
    await clock.advance(1200);
    assert.equal(calls.length, 2, '合并窗口结束后应能再次排期');
});

test('flush 立刻执行待写的保存，并清掉排期', async () => {
    const clock = createFakeClock();
    const { scheduler, calls } = createScheduler(clock);

    scheduler.request();
    assert.equal(scheduler.pending, true);

    assert.equal(scheduler.flush(), true, 'flush 应报告确实有排期被提前执行');
    await flushMicrotasks();
    assert.equal(calls.length, 1, 'flush 必须真的把保存执行掉');
    assert.equal(scheduler.pending, false);
    assert.equal(clock.pendingCount, 0, '排期必须被清掉，不能之后再触发一次');

    // 已经没有排期时 flush 是空操作，不该凭空多写一次
    assert.equal(scheduler.flush(), false);
    assert.equal(calls.length, 1);
});

test('cancel 丢弃排期且不写盘（手动保存后避免重复写）', async () => {
    const clock = createFakeClock();
    const { scheduler, calls } = createScheduler(clock);

    scheduler.request();
    assert.equal(scheduler.cancel(), true);
    await clock.advance(1200);
    assert.equal(calls.length, 0, 'cancel 之后不应再写盘');
    assert.equal(scheduler.cancel(), false, '没有排期时 cancel 是空操作');
});

test('stop 之后不再接受请求，也不会残留定时器', async () => {
    const clock = createFakeClock();
    const { scheduler, calls } = createScheduler(clock);

    scheduler.request();
    scheduler.stop();
    assert.equal(clock.pendingCount, 0, 'stop 必须清掉已排期的定时器');

    assert.equal(scheduler.request(), false, 'stop 之后不应再排期');
    await clock.advance(5000);
    assert.equal(calls.length, 0);
});

test('保存抛错不会打断调度器，后续请求仍能排期', async () => {
    const clock = createFakeClock();
    const errors = [];
    let shouldFail = true;
    const calls = [];
    const scheduler = createCanvasSaveScheduler({
        delayMs: 1200,
        save: () => {
            calls.push(1);
            if (shouldFail) return Promise.reject(new Error('磁盘满了'));
            return Promise.resolve();
        },
        onError: error => errors.push(error),
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer
    });

    scheduler.request();
    await clock.advance(1200);
    assert.equal(errors.length, 1, '失败必须报给 onError，而不是变成未捕获的 rejection');
    assert.match(errors[0].message, /磁盘满了/);

    shouldFail = false;
    scheduler.request();
    await clock.advance(1200);
    assert.equal(calls.length, 2, '一次失败不应让调度器停摆');
});

// ---------------------------------------------------------------------------
// App 接线：调度器只有在两条路径都真的走它时才有意义
// ---------------------------------------------------------------------------

import fs from 'node:fs';

const APP = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('LOADING 增加不再同步直接保存，而是走调度器', () => {
    const block = APP.slice(APP.indexOf('const currentLoadingCount'), APP.indexOf('lastLoadingCountRef.current = currentLoadingCount'));
    assert.match(block, /saveSchedulerRef\.current\?\.request\(\)/);
    assert.doesNotMatch(
        block,
        /handleSaveWithTracking\(\)/,
        'LOADING 路径不得再同步全量保存：批量生成时会变成 N 次写盘'
    );
});

test('媒体产物路径不再用 setTimeout(..., 0) 自己去抖', () => {
    assert.doesNotMatch(APP, /mediaSaveTimerRef/, '旧的 0ms 去抖定时器应已被调度器取代');
    assert.match(APP, /createCanvasSaveScheduler\(\{/);
});

// 注意：这条只验证「两个入口都接了 flush」这一结构事实。
// 它无法验证保存在卸载期间真的完成 —— flush 只是把 fetch 发出去（没有用
// keepalive），能不能写完是尽力而为。
test('关窗与卸载都接了 flush', () => {
    assert.match(APP, /addEventListener\('beforeunload', flushBeforeUnload\)/);
    const cleanup = APP.slice(APP.indexOf("removeEventListener('beforeunload'"), APP.indexOf('saveSchedulerRef.current = null'));
    assert.match(cleanup, /scheduler\.flush\(\)/, '卸载时必须先 flush 再 stop，不能直接丢掉排期');
});

test('手动保存会取消已排期的那次，避免重复写盘', () => {
    const block = APP.slice(APP.indexOf('const handleSaveWithTracking'), APP.indexOf('await handleSaveWorkflow()'));
    assert.match(block, /saveSchedulerRef\.current\?\.cancel\(\)/);
});
