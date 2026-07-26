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
const EVAN_PROFILE = path.join(
    process.env.HOME || '',
    'Library',
    'Application Support',
    'Evan AI Video Canvas',
    'data',
    'browser-profile'
);

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

function dedicatedChromePids() {
    if (!EVAN_PROFILE) return [];
    const profileArgument = `--user-data-dir=${EVAN_PROFILE}`;
    const systemChromeRoots = [
        '/Applications/Google Chrome.app/',
        path.join(process.env.HOME || '', 'Applications', 'Google Chrome.app') + path.sep
    ];
    return processList()
        .filter((entry) => (
            systemChromeRoots.some((root) => entry.command.startsWith(root))
            && entry.command.includes(profileArgument)
        ))
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
        [VITE_ENTRY, 'Vite']
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

async function start() {
    const recordedPid = readPid();
    const activePids = [...new Set([
        ...(isAlive(recordedPid) ? [recordedPid] : []),
        ...managedElectronPids()
    ])];
    if (activePids.length > 0) {
        emit({ status: 'already_running', pid: activePids[0] });
        return;
    }

    requireRuntimeFiles();
    buildFrontend();
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
    if (!isAlive(child.pid)) {
        fs.rmSync(PID_FILE, { force: true });
        let detail = '';
        try {
            detail = fs.readFileSync(LOG_FILE, 'utf8').slice(-1600).trim();
        } catch {
            // The process may have exited before writing a log.
        }
        throw new Error(`Electron 启动后立即退出${detail ? `：\n${detail}` : ''}`);
    }
    emit({ status: 'started', pid: child.pid });
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

async function stop() {
    const recordedPid = readPid();
    const electronPids = [...new Set([
        ...(isAlive(recordedPid) ? [recordedPid] : []),
        ...managedElectronPids()
    ])];
    const chromePidsBeforeStop = dedicatedChromePids();
    if (electronPids.length === 0 && chromePidsBeforeStop.length === 0) {
        fs.rmSync(PID_FILE, { force: true });
        emit({ status: 'not_running' });
        return;
    }

    signalAll(electronPids, 'SIGTERM');
    if (!(await waitForExit(electronPids, 10_000))) {
        signalAll(electronPids, 'SIGKILL');
        await waitForExit(electronPids, 2_000);
    }

    const remainingChromePids = dedicatedChromePids();
    signalAll(remainingChromePids, 'SIGTERM');
    if (!(await waitForExit(remainingChromePids, 5_000))) {
        signalAll(remainingChromePids, 'SIGKILL');
    }
    fs.rmSync(PID_FILE, { force: true });
    emit({
        status: 'stopped',
        electronProcesses: electronPids.length,
        chromeProcesses: new Set([...chromePidsBeforeStop, ...remainingChromePids]).size
    });
}

const command = process.argv[2];
try {
    if (command === 'start') {
        await start();
    } else if (command === 'stop') {
        await stop();
    } else {
        throw new Error('用法：desktop-launcher.mjs <start|stop>');
    }
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
}
