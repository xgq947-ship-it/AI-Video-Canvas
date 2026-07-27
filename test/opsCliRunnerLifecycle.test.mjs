import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { runOpsCli } from '../server/services/opsCliRunner.js';

test('Ops CLI error 后的 close 事件不能覆盖首次失败状态', async () => {
    const transitions = [];
    const stateStore = {
        transition(provider, state, detail = {}) {
            transitions.push({ provider, state, ...detail });
        }
    };
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};

    const promise = runOpsCli({
        args: ['text-to-image', 'jimeng', 'generate'],
        timeoutMs: 5_000,
        label: '即梦生图',
        sessionStateStore: stateStore,
        spawnProcess: () => {
            queueMicrotask(() => {
                child.emit('error', new Error('spawn EACCES'));
                child.emit('close', -1);
            });
            return child;
        }
    });

    await assert.rejects(promise, /无法启动 Python 进程：spawn EACCES/);
    assert.deepEqual(
        transitions.map(item => item.state),
        ['checking', 'browser_unavailable']
    );
    assert.equal(
        transitions.some(item => item.errorCode === 'INVALID_CLI_RESPONSE'),
        false
    );
});

test('Ops CLI 的 Windows GB18030 中文错误会完整显示给用户', async () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    const stateStore = { transition() {} };

    const promise = runOpsCli({
        args: ['text-to-image', 'jimeng', 'generate'],
        timeoutMs: 5_000,
        label: '即梦生图',
        sessionStateStore: stateStore,
        spawnProcess: () => {
            queueMicrotask(() => {
                const prefix = Buffer.from('{"success":false,"data":{"error":"', 'ascii');
                const chinese = Buffer.from('bcb4c3cec9facdbccaa7b0dc', 'hex');
                const suffix = Buffer.from('","error_code":"PAGE_NAVIGATION_FAILED"}}', 'ascii');
                // 刻意拆成多个 data 事件，覆盖 Windows 管道分块场景。
                child.stdout.write(prefix);
                child.stdout.write(chinese.subarray(0, 5));
                child.stdout.write(chinese.subarray(5));
                child.stdout.write(suffix);
                child.emit('close', 1);
            });
            return child;
        }
    });

    await assert.rejects(promise, /即梦生图失败：即梦生图失败/);
});

test('注入 spawnProcess 的调用不受本机 venv 是否就绪影响', async () => {
    // 回归：ensureReady() 曾经在注入替身时也执行，导致干净 checkout（以及 CI，
    // 它只跑 npm ci 不跑 setup:browser-models）上这个文件的用例必挂。
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};

    const promise = runOpsCli({
        args: ['browser', 'status'],
        timeoutMs: 5_000,
        label: '浏览器状态',
        sessionStateStore: { transition() {} },
        spawnProcess: () => {
            queueMicrotask(() => {
                child.stdout.write('{"success":true,"data":{"ok":true}}');
                child.emit('close', 0);
            });
            return child;
        }
    });

    const { data } = await promise;
    assert.deepEqual(data, { ok: true });
});

test('AbortSignal 会立即终止正在等待的 Ops CLI 子进程', async () => {
    const controller = new AbortController();
    const states = [];
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => { child.killed = true; };

    const promise = runOpsCli({
        args: ['text-to-image', 'jimeng', 'generate'],
        timeoutMs: 60_000,
        label: '即梦生图',
        signal: controller.signal,
        sessionStateStore: {
            get: () => ({ state: 'authenticated' }),
            transition: (_provider, state) => states.push(state)
        },
        spawnProcess: () => child
    });

    controller.abort();
    await assert.rejects(promise, error =>
        error.code === 'OPERATION_CANCELLED' && error.cancelled === true
    );
    assert.equal(child.killed, true);
    assert.deepEqual(states, ['checking', 'authenticated']);
});

test('真实 spawn 路径在可执行文件缺失时仍然拒绝执行', async () => {
    const previous = process.env.EVAN_OPS_EXECUTABLE;
    process.env.EVAN_OPS_EXECUTABLE = path.join(
        os.tmpdir(),
        `evan-missing-ops-cli-${Date.now()}`
    );
    try {
        // runOpsCli 的就绪检查是同步抛出的，用 thunk 包住才能被 rejects 捕获。
        await assert.rejects(
            async () => runOpsCli({
                args: ['browser', 'status'],
                timeoutMs: 5_000,
                label: '浏览器状态',
                sessionStateStore: { transition() {} }
            }),
            error => error.code === 'BROWSER_MODELS_NOT_READY'
        );
    } finally {
        if (previous === undefined) delete process.env.EVAN_OPS_EXECUTABLE;
        else process.env.EVAN_OPS_EXECUTABLE = previous;
    }
});
