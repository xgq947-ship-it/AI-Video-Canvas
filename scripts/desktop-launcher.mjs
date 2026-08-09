#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_DIR = path.join(ROOT, 'runtime', 'desktop-launcher');
const PID_FILE = path.join(RUNTIME_DIR, 'electron.pid');
const LOG_FILE = path.join(RUNTIME_DIR, 'launcher.log');
const ELECTRON_BINARY = path.join(
    ROOT,
    'node_modules',
    'electron',
    'dist',
    'Electron.app',
    'Contents',
    'MacOS',
    'Electron'
);
const VITE_ENTRY = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const BROWSER_HUB_PREPARE = path.join(ROOT, 'scripts', 'prepare-browser-hub.mjs');
// Electron 的 before-quit 自身会在 10.5 秒后兜底退出；外部关闭器必须给它更长的
// 清理窗口，避免后端正在释放项目文件或 Hub 租约时被提前 SIGKILL。
const GRACEFUL_STOP_TIMEOUT_MS = 15_000;
const FORCE_STOP_TIMEOUT_MS = 3_000;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function isAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function processList() {
    try {
        const output = execFileSync('/bin/ps', ['ax', '-o', 'pid=,command='], { encoding: 'utf8' });
        return output.split('\n').flatMap((line) => {
            const match = line.match(/^\s*(\d+)\s+(.+)$/);
            return match ? [{ pid: Number(match[1]), command: match[2] }] : [];
        });
    } catch {
        return [];
    }
}

function managedElectronPids() {
    const exactCommand = `${ELECTRON_BINARY} .`;
    return processList()
        .filter((entry) => entry.command === exactCommand)
        .map((entry) => entry.pid);
}

function readPid() {
    try {
        const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
        return Number.isInteger(pid) ? pid : null;
    } catch {
        return null;
    }
}

function emit(payload) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function requireRuntimeFiles() {
    for (const [target, label] of [
        [ELECTRON_BINARY, 'Electron'],
        [VITE_ENTRY, 'Vite'],
        [BROWSER_HUB_PREPARE, 'AI Browser Hub 准备脚本']
    ]) {
        if (!fs.existsSync(target)) {
            throw new Error(`${label} 不存在，请先在项目目录运行 npm install`);
        }
    }
}

function buildFrontend() {
    const result = spawnSync(process.execPath, [VITE_ENTRY, 'build'], {
        cwd: ROOT,
        encoding: 'utf8',
        env: process.env
    });
    if (result.status !== 0) {
        const detail = `${result.stderr || result.stdout || ''}`.trim().slice(-1200);
        throw new Error(`前端构建失败${detail ? `：\n${detail}` : ''}`);
    }
}

function prepareBrowserHub() {
    const result = spawnSync(process.execPath, [BROWSER_HUB_PREPARE], {
        cwd: ROOT,
        encoding: 'utf8',
        env: process.env
    });
    if (result.status !== 0) {
        const detail = `${result.stderr || result.stdout || ''}`.trim().slice(-1200);
        throw new Error(`共享浏览器准备失败${detail ? `：\n${detail}` : ''}`);
    }
}

function syncPidFile(activePids) {
    if (activePids.length === 0) {
        fs.rmSync(PID_FILE, { force: true });
        return;
    }
    const recordedPid = readPid();
    if (recordedPid !== activePids[0]) {
        fs.mkdirSync(RUNTIME_DIR, { recursive: true });
        fs.writeFileSync(PID_FILE, `${activePids[0]}\n`);
    }
}

function status() {
    const activePids = managedElectronPids();
    syncPidFile(activePids);
    const payload = activePids.length > 0
        ? { status: 'running', pid: activePids[0], electronProcesses: activePids.length }
        : { status: 'stopped', electronProcesses: 0 };
    emit(payload);
    return payload;
}

async function start({ emitResult = true, resultStatus = 'started' } = {}) {
    const activePids = managedElectronPids();
    if (activePids.length > 0) {
        syncPidFile(activePids);
        const payload = { status: 'already_running', pid: activePids[0] };
        if (emitResult) emit(payload);
        return payload;
    }

    requireRuntimeFiles();
    buildFrontend();
    prepareBrowserHub();
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    const logFd = fs.openSync(LOG_FILE, 'a');
    const child = spawn(ELECTRON_BINARY, ['.'], {
        cwd: ROOT,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: process.env
    });
    fs.closeSync(logFd);
    child.unref();
    fs.writeFileSync(PID_FILE, `${child.pid}\n`);

    await delay(1500);
    const launchedPids = managedElectronPids();
    if (launchedPids.length === 0) {
        fs.rmSync(PID_FILE, { force: true });
        let detail = '';
        try {
            detail = fs.readFileSync(LOG_FILE, 'utf8').slice(-1600).trim();
        } catch {
            // The process may have exited before writing a log.
        }
        throw new Error(`Electron 启动后立即退出${detail ? `：\n${detail}` : ''}`);
    }
    syncPidFile(launchedPids);
    const payload = { status: resultStatus, pid: launchedPids[0] };
    if (emitResult) emit(payload);
    return payload;
}

function signalAll(pids, signal) {
    for (const pid of new Set(pids)) {
        if (!isAlive(pid)) continue;
        try {
            process.kill(pid, signal);
        } catch {
            // A process may exit between the liveness check and the signal.
        }
    }
}

async function waitForExit(pids, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (pids.every((pid) => !isAlive(pid))) return true;
        await delay(200);
    }
    return pids.every((pid) => !isAlive(pid));
}

async function stop({ emitResult = true } = {}) {
    const electronPids = managedElectronPids();
    if (electronPids.length === 0) {
        fs.rmSync(PID_FILE, { force: true });
        const payload = { status: 'not_running', electronProcesses: 0 };
        if (emitResult) emit(payload);
        return payload;
    }

    signalAll(electronPids, 'SIGTERM');
    let exited = await waitForExit(electronPids, GRACEFUL_STOP_TIMEOUT_MS);
    if (!exited) {
        signalAll(electronPids, 'SIGKILL');
        exited = await waitForExit(electronPids, FORCE_STOP_TIMEOUT_MS);
    }
    if (!exited) {
        throw new Error(`无法停止 Evan Electron 进程：${electronPids.join(', ')}`);
    }

    fs.rmSync(PID_FILE, { force: true });
    const payload = {
        status: 'stopped',
        electronProcesses: electronPids.length,
        browserRuntime: 'shared-hub-managed'
    };
    if (emitResult) emit(payload);
    return payload;
}

async function restart() {
    const stopped = await stop({ emitResult: false });
    const started = await start({ emitResult: false, resultStatus: 'restarted' });
    const payload = {
        ...started,
        status: 'restarted',
        stoppedProcesses: stopped.electronProcesses || 0
    };
    emit(payload);
    return payload;
}

const command = process.argv[2];
try {
    if (command === 'start') {
        await start();
    } else if (command === 'stop') {
        await stop();
    } else if (command === 'restart') {
        await restart();
    } else if (command === 'status') {
        status();
    } else {
        throw new Error('用法：desktop-launcher.mjs <start|stop|restart|status>');
    }
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
}
