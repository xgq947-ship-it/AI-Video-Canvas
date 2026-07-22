import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    buildCodexAutomationCommand,
    createCodexImageAutomation,
    pruneCodexAutomationLogs
} from '../server/services/codexImageAutomation.js';
import { createCodexImageJob } from '../server/services/codexImageJobs.js';

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'twitcanva-codex-auto-'));
    const libraryDir = path.join(root, 'library');
    const jobsDir = path.join(libraryDir, 'codex-image-jobs');
    fs.mkdirSync(libraryDir, { recursive: true });
    createCodexImageJob({ jobsDir, libraryDir, nodeId: 'node-1', prompt: '测试自动生图' });
    return { root, libraryDir, jobsDir };
}

test('Codex 自动生图固定使用 Plus 会话和工作区沙箱', () => {
    const spec = buildCodexAutomationCommand('/tmp/twitcanva', '/tmp/codex');
    assert.equal(spec.command, '/tmp/codex');
    assert.deepEqual(spec.args.slice(0, 7), [
        'exec', '--ephemeral', '-C', '/tmp/twitcanva', '-s', 'workspace-write', '--color'
    ]);
    assert.match(spec.args.at(-1), /ChatGPT 登录包含的内置 image_gen/);
    assert.match(spec.args.at(-1), /不调用 OpenAI API/);
});

test('连续通知只启动一个 Codex worker', async t => {
    const dirs = fixture();
    t.after(() => fs.rmSync(dirs.root, { recursive: true, force: true }));
    const children = [];
    const spawnProcess = () => {
        const child = new EventEmitter();
        child.pid = 12345;
        child.kill = () => {};
        children.push(child);
        return child;
    };
    const automation = createCodexImageAutomation({
        projectRoot: dirs.root,
        jobsDir: dirs.jobsDir,
        codexPath: '/tmp/codex',
        spawnProcess,
        maxAttempts: 1,
        timeoutMs: 1000
    });

    automation.notify();
    automation.notify();
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(children.length, 1);
    assert.equal(automation.getStatus().status, 'running');
    assert.equal(automation.getStatus().queuedJobs, 1);

    children[0].emit('close', 1);
    assert.equal(automation.getStatus().status, 'error');
    assert.match(automation.getStatus().lastError, /退出码 1/);
});

test('worker 日志只保留七天内最新十份', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'twitcanva-codex-logs-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const now = Date.parse('2026-07-22T00:00:00.000Z');

    for (let index = 0; index < 12; index += 1) {
        const filePath = path.join(root, `worker-recent-${String(index).padStart(2, '0')}.log`);
        fs.writeFileSync(filePath, 'log');
        const modifiedAt = new Date(now - index * 60_000);
        fs.utimesSync(filePath, modifiedAt, modifiedAt);
    }
    const expired = path.join(root, 'worker-expired.log');
    fs.writeFileSync(expired, 'old log');
    const expiredAt = new Date(now - 8 * 24 * 60 * 60 * 1000);
    fs.utimesSync(expired, expiredAt, expiredAt);

    const removed = pruneCodexAutomationLogs(root, { now });
    const remaining = fs.readdirSync(root).filter(filename => filename.endsWith('.log'));

    assert.equal(removed.length, 3);
    assert.equal(remaining.length, 10);
    assert.equal(fs.existsSync(expired), false);
});
