import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { closeBrowserForShutdown } from '../server/services/opsCliRunner.js';

/**
 * 常驻的无头 Chromium 是 detached 启动的，后端进程退出不会带走它。
 * 退出路径必须主动关一次，否则用户关掉 Evan 之后它会一直占着内存，
 * 要等到下次启动 Evan 再过一个 idle 周期才被回收。
 */

function fakeChild() {
    const child = new EventEmitter();
    child.kill = () => { child.killed = true; };
    return child;
}

test('退出时向 ops-cli 下发 browser close', async () => {
    const child = fakeChild();
    const calls = [];

    const promise = closeBrowserForShutdown({
        spawnProcess: (command, args, options) => {
            calls.push({ command, args, options });
            queueMicrotask(() => child.emit('close', 0));
            return child;
        }
    });

    assert.equal(await promise.then(result => result.closed), true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args.slice(-3), ['--json', 'browser', 'close']);
    // 必须等它退出，所以不能 detached。
    assert.notEqual(calls[0].options.detached, true);
});

test('关闭超时不会挂住退出流程', async () => {
    const child = fakeChild();

    const result = await closeBrowserForShutdown({
        timeoutMs: 20,
        spawnProcess: () => child // 永远不 emit close
    });

    assert.deepEqual(result, { closed: false, reason: 'timeout' });
    assert.equal(child.killed, true, '超时后必须杀掉挂死的关闭进程');
});

test('spawn 失败不会抛错', async () => {
    const result = await closeBrowserForShutdown({
        spawnProcess: () => { throw new Error('spawn ENOENT'); }
    });

    assert.equal(result.closed, false);
    assert.match(result.reason, /ENOENT/);
});

test('子进程 error 事件不会抛错', async () => {
    const child = fakeChild();
    const result = await closeBrowserForShutdown({
        spawnProcess: () => {
            queueMicrotask(() => child.emit('error', new Error('spawn EACCES')));
            return child;
        }
    });

    assert.equal(result.closed, false);
    assert.match(result.reason, /EACCES/);
});

test('非 0 退出码如实上报，不假装关闭成功', async () => {
    const child = fakeChild();
    const result = await closeBrowserForShutdown({
        spawnProcess: () => {
            queueMicrotask(() => child.emit('close', 3));
            return child;
        }
    });

    assert.deepEqual(result, { closed: false, reason: 'exit-3' });
});

test('浏览器运行时没安装时直接跳过，不去 spawn', async () => {
    // 走真实 spawn 默认值时才做就绪检查；本机没跑过 setup:browser-models 就应该直接返回。
    const previous = process.env.EVAN_OPS_EXECUTABLE;
    process.env.EVAN_OPS_EXECUTABLE = `/nonexistent/evan-ops-cli-${Date.now()}`;
    try {
        const result = await closeBrowserForShutdown();
        assert.deepEqual(result, { closed: false, reason: 'not-ready' });
    } finally {
        if (previous === undefined) delete process.env.EVAN_OPS_EXECUTABLE;
        else process.env.EVAN_OPS_EXECUTABLE = previous;
    }
});

test('浏览器运行时缺失时，空闲关闭定时器不会把后端进程带崩', async () => {
    // 回归：closeIdleBrowser 之前既不检查就绪状态，也不给 detached 子进程挂
    // 'error' 监听器。ChildProcess 的 'error' 没有监听器时会直接终结进程 ——
    // 而模块加载时就 armed 了一个兜底定时器，于是任何没跑过 setup:browser-models
    // 的机器上，后端都会在启动 120 秒后猝死（本地 npm run dev 实测复现）。
    const probe = `
        process.env.EVAN_BROWSER_IDLE_CLOSE_MS = '80';
        process.env.EVAN_OPS_EXECUTABLE = '';
        await import(${JSON.stringify(new URL('../server/services/opsCliRunner.js', import.meta.url).href)});
        await new Promise(resolve => setTimeout(resolve, 600));
        console.log('SURVIVED');
    `;

    const child = spawn(process.execPath, ['--input-type=module', '--eval', probe], {
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.resume();

    const code = await new Promise(resolve => child.on('close', resolve));

    assert.equal(code, 0, '空闲关闭失败绝不能让后端进程退出');
    assert.match(stdout, /SURVIVED/);
});
