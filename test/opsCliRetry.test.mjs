import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { runOpsCli, shouldRetryOpsFailure } from '../server/services/opsCliRunner.js';

/**
 * 浏览器自动化的自动重试。
 *
 * 最重要的一条不是「能重试」，而是「提交之后绝不重试」：生成请求一旦发出去，
 * 平台就开始扣配额了，这时重试等于二次提交，用户被扣两次费还拿到两份结果 ——
 * 比直接报错更糟。
 */

function fakeChild() {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => { child.killed = true; };
    return child;
}

/** 造一个按顺序回放脚本化响应的 spawnProcess。 */
function scriptedSpawn(responses) {
    const attempts = [];
    const spawnProcess = (_command, _args, options) => {
        const child = fakeChild();
        const index = attempts.length;
        attempts.push({ env: options?.env || {} });
        const response = responses[Math.min(index, responses.length - 1)];
        queueMicrotask(() => {
            child.stdout.write(JSON.stringify(response.payload));
            child.emit('close', response.exitCode ?? (response.payload.success ? 0 : 1));
        });
        return child;
    };
    return { spawnProcess, attempts };
}

const failure = (errorCode, { submitted, retryable = true }) => ({
    payload: {
        success: false,
        data: { error: `模拟失败 ${errorCode}`, error_code: errorCode, retryable, submitted }
    }
});

const success = () => ({
    payload: { success: true, data: { context_path: '/tmp/run_20260726.json', images: [] } }
});

// 退避在测试里置零：这里验证的是重试决策，不是真的要等 4 秒。
const NO_BACKOFF = [0, 0];

const run = (spawnProcess) => runOpsCli({
    args: ['text-to-image', 'jimeng', 'generate'],
    timeoutMs: 30_000,
    label: '即梦图片生成',
    sessionStateStore: { transition() {} },
    retryBackoffMs: NO_BACKOFF,
    spawnProcess
});

test('EDITOR_NOT_READY 会自动重试并最终成功', async () => {
    // 冷启动时即梦前端要拉一大堆 chunk，编辑器迟迟不挂载。这是最典型的
    // 「等一会儿就好」的失败，此前却被直接抛给用户。
    const { spawnProcess, attempts } = scriptedSpawn([
        failure('EDITOR_NOT_READY', { submitted: false }),
        success()
    ]);

    const { runId } = await run(spawnProcess);

    assert.equal(attempts.length, 2, '第一次失败后应该再试一次');
    assert.equal(runId, 'run_20260726');
});

test('提交之后的失败绝不重试，避免二次扣配额', async () => {
    // provider 兜底 except 会把提交之后的崩溃也标成 retryable 的
    // PAGE_NAVIGATION_FAILED。只看 retryable 就重试 = 重复生成 + 重复扣费。
    const { spawnProcess, attempts } = scriptedSpawn([
        failure('PAGE_NAVIGATION_FAILED', { submitted: true, retryable: true }),
        success()
    ]);

    await assert.rejects(run(spawnProcess), /模拟失败 PAGE_NAVIGATION_FAILED/);
    assert.equal(attempts.length, 1, '已提交的失败一次都不能重试');
});

test('提交之前的 PAGE_NAVIGATION_FAILED 可以重试', async () => {
    const { spawnProcess, attempts } = scriptedSpawn([
        failure('PAGE_NAVIGATION_FAILED', { submitted: false }),
        success()
    ]);

    await run(spawnProcess);
    assert.equal(attempts.length, 2);
});

test('缺少 submitted 字段时按已提交处理', async () => {
    // 老版本 CLI 或未知失败路径不会带这个字段。宁可让用户手点一次重新生成，
    // 也不能替他自动二次提交。
    const { spawnProcess, attempts } = scriptedSpawn([
        { payload: { success: false, data: { error: '未知', error_code: 'PAGE_NAVIGATION_FAILED', retryable: true } } },
        success()
    ]);

    await assert.rejects(run(spawnProcess));
    assert.equal(attempts.length, 1);
});

test('AUTH_REQUIRED 不重试，立刻把「请登录」告诉用户', async () => {
    // AUTH_REQUIRED 在 Python 侧也是 retryable=true，但用户不去登录，
    // 重试一百次也一样 —— 只会让提示晚几分钟才到。
    const { spawnProcess, attempts } = scriptedSpawn([
        failure('AUTH_REQUIRED', { submitted: false }),
        success()
    ]);

    await assert.rejects(run(spawnProcess), /AUTH_REQUIRED/);
    assert.equal(attempts.length, 1);
});

test('重试次数有上限，真实故障不会被无限拖着', async () => {
    const { spawnProcess, attempts } = scriptedSpawn([
        failure('EDITOR_NOT_READY', { submitted: false })
    ]);

    await assert.rejects(run(spawnProcess), /EDITOR_NOT_READY/);
    assert.equal(attempts.length, 3, '默认最多三次尝试');
});

test('只有重试的那几次才放宽编辑器等待窗口', async () => {
    // 第一次用默认窗口让真正的故障尽快暴露；重试时才给冷启动更多时间。
    const { spawnProcess, attempts } = scriptedSpawn([
        failure('EDITOR_NOT_READY', { submitted: false }),
        success()
    ]);

    await run(spawnProcess);

    assert.equal(attempts[0].env.EVAN_EDITOR_READY_TIMEOUT_S, '');
    assert.equal(attempts[1].env.EVAN_EDITOR_READY_TIMEOUT_S, '180');
});

test('shouldRetryOpsFailure 的判定边界', () => {
    const opts = { attempt: 1, maxAttempts: 3 };
    assert.equal(shouldRetryOpsFailure({ code: 'EDITOR_NOT_READY' }, opts), true);
    assert.equal(shouldRetryOpsFailure({ code: 'EDITOR_NOT_READY', submitted: true }, opts), false);
    assert.equal(shouldRetryOpsFailure({ code: 'AUTH_REQUIRED' }, opts), false);
    assert.equal(shouldRetryOpsFailure({ code: 'OPS_TIMEOUT' }, opts), false);
    assert.equal(shouldRetryOpsFailure({ code: 'BROWSER_MODELS_NOT_READY' }, opts), false);
    // 最后一次尝试不再排队重试
    assert.equal(
        shouldRetryOpsFailure({ code: 'EDITOR_NOT_READY' }, { attempt: 3, maxAttempts: 3 }),
        false
    );
});

test('重试过程中不写失败态，避免画布闪「登录失效」', async () => {
    const states = [];
    const { spawnProcess } = scriptedSpawn([
        failure('EDITOR_NOT_READY', { submitted: false }),
        success()
    ]);

    await runOpsCli({
        args: ['text-to-image', 'jimeng', 'generate'],
        timeoutMs: 30_000,
        label: '即梦图片生成',
        sessionStateStore: { transition: (_provider, state) => states.push(state) },
        retryBackoffMs: NO_BACKOFF,
        spawnProcess
    });

    // 只应有开头的 checking 和结尾的 authenticated，中间不能出现失败态。
    assert.deepEqual(states, ['checking', 'authenticated']);
});

test('重试退避期间取消也会释放任务并恢复原登录状态', async () => {
    const controller = new AbortController();
    const states = [];
    const { spawnProcess, attempts } = scriptedSpawn([
        failure('EDITOR_NOT_READY', { submitted: false })
    ]);

    const promise = runOpsCli({
        args: ['text-to-image', 'jimeng', 'generate'],
        timeoutMs: 30_000,
        label: '即梦图片生成',
        signal: controller.signal,
        sessionStateStore: {
            get: () => ({ state: 'authenticated' }),
            transition: (_provider, state) => states.push(state)
        },
        retryBackoffMs: [60_000],
        spawnProcess
    });
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();

    await assert.rejects(promise, error => error.code === 'OPERATION_CANCELLED');
    assert.equal(attempts.length, 1);
    assert.deepEqual(states, ['checking', 'authenticated']);
});
