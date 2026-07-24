import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
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
