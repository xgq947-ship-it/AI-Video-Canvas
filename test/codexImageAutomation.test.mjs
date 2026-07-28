import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    buildCodexAutomationCommand,
    createCodexImageAutomation,
    resolveExtraWritableRoots,
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

// 按“参数是否存在 + 相邻取值”断言，不钉死整段前缀顺序：以前每加一个参数都要
// 顺手改一次 slice(0, N)。
function argValue(args, flag) {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
}

test('Codex 自动生图固定使用 Plus 会话和工作区沙箱', () => {
    const spec = buildCodexAutomationCommand('/tmp/twitcanva', '/tmp/codex', '/tmp/evan-codex-queue');
    assert.equal(spec.command, '/tmp/codex');
    assert.equal(spec.args[0], 'exec');
    assert.ok(spec.args.includes('--ephemeral'));
    assert.equal(argValue(spec.args, '-C'), '/tmp/twitcanva');
    assert.equal(argValue(spec.args, '-s'), 'workspace-write');
    assert.equal(argValue(spec.args, '--color'), 'never');
    // 工作目录（userData/data）不是 git 仓库，少了这个参数 codex exec 直接退出码 1：
    // “Not inside a trusted directory and --skip-git-repo-check was not specified.”
    assert.ok(spec.args.includes('--skip-git-repo-check'));
    assert.match(spec.args.at(-1), /ChatGPT 登录包含的内置 image_gen/);
    assert.match(spec.args.at(-1), /不调用 OpenAI API/);
    assert.match(spec.args.at(-1), /evan-codex-queue/);
});

test('项目素材目录链接到沙箱外时，按真实路径放开写权限', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'twitcanva-codex-roots-'));
    const workspaceDir = path.join(root, 'data');
    const libraryDir = path.join(workspaceDir, 'library');
    const projectsDir = path.join(libraryDir, 'projects');
    const outside = path.join(root, 'outside-project');
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.mkdirSync(path.join(projectsDir, 'inside-project'));
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(projectsDir, 'linked-project'));
    // 目录里混着 .DS_Store 这类文件，不能当成可写根。
    fs.writeFileSync(path.join(projectsDir, '.DS_Store'), 'junk');

    const roots = resolveExtraWritableRoots({ libraryDir, workspaceDir });
    assert.deepEqual(roots, [fs.realpathSync(outside)]);

    const spec = buildCodexAutomationCommand(workspaceDir, '/tmp/codex', '', { libraryDir });
    const addDirIndex = spec.args.indexOf('--add-dir');
    assert.notEqual(addDirIndex, -1);
    assert.equal(spec.args[addDirIndex + 1], fs.realpathSync(outside));
    // 沙箱本来就可写的目录不重复声明。
    assert.equal(spec.args.filter(arg => arg === '--add-dir').length, 1);

    fs.rmSync(root, { recursive: true, force: true });
});

test('连续通知只启动一个 Codex worker', async t => {
    const dirs = fixture();
    t.after(() => fs.rmSync(dirs.root, { recursive: true, force: true }));
    const children = [];
    let spawnedCommand = '';
    let spawnedOptions = null;
    const spawnProcess = (command, _args, options) => {
        spawnedCommand = command;
        spawnedOptions = options;
        const child = new EventEmitter();
        child.pid = 12345;
        child.kill = () => {};
        children.push(child);
        return child;
    };
    const automation = createCodexImageAutomation({
        projectRoot: dirs.root,
        workspaceDir: dirs.libraryDir,
        jobsDir: dirs.jobsDir,
        codexPath: () => '/tmp/codex-current',
        commandEnvironment: () => ({
            ...process.env,
            EVAN_CODEX_QUEUE: '/tmp/evan-codex-queue'
        }),
        spawnProcess,
        maxAttempts: 1,
        timeoutMs: 1000
    });

    automation.notify();
    automation.notify();
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(children.length, 1);
    assert.equal(spawnedCommand, '/tmp/codex-current');
    assert.equal(spawnedOptions.cwd, dirs.libraryDir);
    assert.equal(spawnedOptions.env.EVAN_CODEX_QUEUE, '/tmp/evan-codex-queue');
    assert.equal(automation.getStatus().status, 'running');
    assert.equal(automation.getStatus().queuedJobs, 1);

    children[0].emit('close', 1);
    assert.equal(automation.getStatus().status, 'error');
    assert.match(automation.getStatus().lastError, /退出码 1/);
});

test('Windows 的 codex.cmd 通过 ComSpec 启动', async t => {
    const dirs = fixture();
    t.after(() => fs.rmSync(dirs.root, { recursive: true, force: true }));
    let invocation = null;
    const child = new EventEmitter();
    child.pid = 23456;
    child.kill = () => {};
    const automation = createCodexImageAutomation({
        projectRoot: dirs.root,
        workspaceDir: dirs.libraryDir,
        jobsDir: dirs.jobsDir,
        codexPath: 'C:\\Users\\tester\\AppData\\Roaming\\npm\\codex.cmd',
        commandEnvironment: {
            ComSpec: 'C:\\Windows\\System32\\cmd.exe',
            EVAN_CODEX_QUEUE: 'C:\\Evan\\evan-codex-queue.cmd'
        },
        platform: 'win32',
        spawnProcess: (command, args, options) => {
            invocation = { command, args, options };
            return child;
        },
        maxAttempts: 1,
        timeoutMs: 1000
    });

    automation.notify();
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(invocation.command, 'C:\\Windows\\System32\\cmd.exe');
    assert.deepEqual(invocation.args.slice(0, 3), ['/d', '/s', '/c']);
    assert.match(invocation.args[3], /codex\.cmd/);
    assert.match(invocation.args[3], /workspace-write/);
    child.emit('close', 1);
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
