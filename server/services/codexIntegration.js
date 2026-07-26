import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveCodexBin, setRuntimeCodexPath } from './cliPaths.js';
import { decodeProcessOutput } from '../utils/processOutput.js';

const STATUS_CACHE_MS = 5_000;
const PROBE_TIMEOUT_MS = 15_000;

const quoteShell = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const WINDOWS_CMD_META_CHARS = /([()\][%!^"`<>&|;, *?])/g;

const escapeWindowsCommand = value =>
    String(value).replace(WINDOWS_CMD_META_CHARS, '^$1');

const escapeWindowsArgument = value => {
    let escaped = String(value);
    escaped = escaped.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
    escaped = escaped.replace(/(?=(\\+?)?)\1$/, '$1$1');
    escaped = `"${escaped}"`;
    return escaped.replace(WINDOWS_CMD_META_CHARS, '^$1');
};

export function buildWindowsScriptInvocation(command, args, environment = process.env) {
    const shellCommand = [
        escapeWindowsCommand(command),
        ...args.map(escapeWindowsArgument)
    ].join(' ');
    return {
        command: environment.ComSpec || environment.COMSPEC || 'cmd.exe',
        args: ['/d', '/s', '/c', `"${shellCommand}"`],
        windowsVerbatimArguments: true
    };
}

export function resolveUnpackedResourcePath(resourcePath, exists = fs.existsSync) {
    const asarSegment = `${path.sep}app.asar${path.sep}`;
    if (!resourcePath.includes(asarSegment)) return resourcePath;
    const unpackedPath = resourcePath.replace(
        asarSegment,
        `${path.sep}app.asar.unpacked${path.sep}`
    );
    return exists(unpackedPath) ? unpackedPath : resourcePath;
}

export function getCodexConfigPath(libraryDir) {
    return path.join(libraryDir, 'config', 'codex.json');
}

export function loadCodexConfig(libraryDir) {
    const filePath = getCodexConfigPath(libraryDir);
    if (!fs.existsSync(filePath)) return { cliPath: '' };
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return {
            cliPath: typeof parsed.cliPath === 'string' ? parsed.cliPath.trim() : ''
        };
    } catch (error) {
        console.error('[Codex 配置] 读取失败：', error.message);
        return { cliPath: '' };
    }
}

export function saveCodexConfig(libraryDir, { cliPath = '' } = {}) {
    const normalizedPath = String(cliPath || '').trim();
    if (normalizedPath && !path.isAbsolute(normalizedPath)) {
        throw new Error('Codex CLI 路径必须是绝对路径');
    }
    if (normalizedPath && !fs.existsSync(normalizedPath)) {
        throw new Error('所选 Codex CLI 文件不存在');
    }
    const next = { cliPath: normalizedPath };
    const filePath = getCodexConfigPath(libraryDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    return next;
}

function runProbe(command, args, environment, platform = process.platform) {
    const isWindowsScript = platform === 'win32' && /\.(?:cmd|bat)$/i.test(command);
    const invocation = isWindowsScript
        ? buildWindowsScriptInvocation(command, args, environment)
        : { command, args, windowsVerbatimArguments: false };
    const result = spawnSync(invocation.command, invocation.args, {
        timeout: PROBE_TIMEOUT_MS,
        windowsHide: true,
        windowsVerbatimArguments: invocation.windowsVerbatimArguments,
        env: environment
    });
    return {
        ok: !result.error && result.status === 0,
        status: result.status,
        stdout: decodeProcessOutput(result.stdout).trim(),
        stderr: decodeProcessOutput(result.stderr).trim(),
        error: result.error?.message || ''
    };
}

export function prepareCodexRuntime({
    resourcesDir,
    dataDir,
    libraryDir,
    electronExecutable = '',
    electronRunAsNode = false,
    codexHome: configuredCodexHome = '',
    installSkill = true,
    platform = process.platform
}) {
    const codexHome = configuredCodexHome || path.join(dataDir, 'codex-home');
    const workspaceDir = dataDir;
    const runtimeDir = path.join(dataDir, 'runtime', 'codex');
    const skillSource = resolveUnpackedResourcePath(
        path.join(resourcesDir, 'integrations', 'skills', 'twitcanva-codex-images')
    );
    const skillTarget = path.join(codexHome, 'skills', 'twitcanva-codex-images');
    const queueScript = path.join(resourcesDir, 'scripts', 'codex-image-queue.mjs');
    const runnerPath = path.join(
        runtimeDir,
        platform === 'win32' ? 'evan-codex-queue.cmd' : 'evan-codex-queue'
    );

    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.mkdirSync(codexHome, { recursive: true });
    if (installSkill && fs.existsSync(path.join(skillSource, 'SKILL.md'))) {
        fs.cpSync(skillSource, skillTarget, { recursive: true, force: true });
    }

    const executable = electronExecutable || process.execPath;
    if (platform === 'win32') {
        const lines = [
            '@echo off',
            electronRunAsNode ? 'set "ELECTRON_RUN_AS_NODE=1"' : '',
            `set "EVAN_LIBRARY_DIR=${libraryDir}"`,
            `"${executable}" "${queueScript}" %*`
        ].filter(Boolean);
        fs.writeFileSync(runnerPath, `${lines.join('\r\n')}\r\n`, { mode: 0o700 });
    } else {
        const lines = [
            '#!/bin/sh',
            electronRunAsNode ? 'export ELECTRON_RUN_AS_NODE=1' : '',
            `export EVAN_LIBRARY_DIR=${quoteShell(libraryDir)}`,
            `exec ${quoteShell(executable)} ${quoteShell(queueScript)} "$@"`
        ].filter(Boolean);
        fs.writeFileSync(runnerPath, `${lines.join('\n')}\n`, { mode: 0o700 });
        fs.chmodSync(runnerPath, 0o700);
    }

    return { codexHome, workspaceDir, runnerPath, skillTarget, queueScript };
}

export function createCodexIntegration({
    resourcesDir,
    dataDir,
    libraryDir,
    environment = process.env,
    platform = process.platform,
    electronExecutable = environment.EVAN_ELECTRON_EXECUTABLE || '',
    electronRunAsNode = environment.EVAN_ELECTRON_RUN_AS_NODE === '1'
}) {
    const codexHome = environment.EVAN_DESKTOP === '1'
        ? path.join(dataDir, 'codex-home')
        : (environment.CODEX_HOME || path.join(os.homedir(), '.codex'));
    const runtime = prepareCodexRuntime({
        resourcesDir,
        dataDir,
        libraryDir,
        electronExecutable,
        electronRunAsNode,
        codexHome,
        installSkill: environment.EVAN_DESKTOP === '1',
        platform
    });
    let config = loadCodexConfig(libraryDir);
    let loginProcess = null;
    let loginState = { running: false, startedAt: null, lastError: null };
    let cachedStatus = null;
    let cachedAt = 0;
    setRuntimeCodexPath(config.cliPath);
    environment.CODEX_HOME = runtime.codexHome;
    environment.EVAN_CODEX_QUEUE = runtime.runnerPath;

    const commandEnvironment = () => ({
        ...environment,
        CODEX_HOME: runtime.codexHome,
        EVAN_CODEX_QUEUE: runtime.runnerPath,
        EVAN_LIBRARY_DIR: libraryDir
    });
    const command = () => resolveCodexBin({
        projectRoot: resourcesDir,
        configuredPath: config.cliPath,
        environment
    });
    const invalidate = () => {
        cachedStatus = null;
        cachedAt = 0;
    };

    const getStatus = ({ force = false } = {}) => {
        if (!force && cachedStatus && Date.now() - cachedAt < STATUS_CACHE_MS) {
            return { ...cachedStatus, login: { ...loginState } };
        }
        const resolvedPath = command();
        const versionProbe = runProbe(resolvedPath, ['--version'], commandEnvironment(), platform);
        const loginProbe = versionProbe.ok
            ? runProbe(resolvedPath, ['login', 'status'], commandEnvironment(), platform)
            : { ok: false, stdout: '', stderr: '', error: versionProbe.error };
        cachedStatus = {
            available: versionProbe.ok,
            authenticated: versionProbe.ok && loginProbe.ok,
            configuredPath: config.cliPath,
            resolvedPath,
            version: versionProbe.stdout || versionProbe.stderr,
            codexHome: runtime.codexHome,
            skillInstalled: fs.existsSync(path.join(runtime.skillTarget, 'SKILL.md')),
            queueBridgeReady: fs.existsSync(runtime.runnerPath) && fs.existsSync(runtime.queueScript),
            error: versionProbe.ok
                ? (loginProbe.ok ? '' : (loginProbe.stderr || loginProbe.stdout || 'Codex 尚未登录'))
                : (versionProbe.error || versionProbe.stderr || '未检测到 Codex CLI')
        };
        cachedAt = Date.now();
        return { ...cachedStatus, login: { ...loginState } };
    };

    const setCliPath = cliPath => {
        config = saveCodexConfig(libraryDir, { cliPath });
        setRuntimeCodexPath(config.cliPath);
        invalidate();
        return getStatus({ force: true });
    };

    const startLogin = () => {
        const status = getStatus({ force: true });
        if (!status.available) throw new Error(status.error || '未检测到 Codex CLI');
        if (loginProcess) return { ...status, login: { ...loginState } };

        const resolvedPath = command();
        const env = commandEnvironment();
        const isWindowsScript = platform === 'win32' && /\.(?:cmd|bat)$/i.test(resolvedPath);
        loginState = {
            running: true,
            startedAt: new Date().toISOString(),
            lastError: null
        };
        loginProcess = isWindowsScript
            ? (() => {
                const invocation = buildWindowsScriptInvocation(resolvedPath, ['login'], env);
                return spawn(invocation.command, invocation.args, {
                    env,
                    windowsHide: false,
                    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
                    stdio: 'ignore'
                });
            })()
            : spawn(resolvedPath, ['login'], {
                env,
                windowsHide: false,
                stdio: 'ignore'
            });
        loginProcess.once('error', error => {
            loginState = { ...loginState, running: false, lastError: error.message };
            loginProcess = null;
            invalidate();
        });
        loginProcess.once('close', code => {
            loginState = {
                ...loginState,
                running: false,
                lastError: code === 0 ? null : `Codex 登录进程退出码 ${code}`
            };
            loginProcess = null;
            invalidate();
        });
        loginProcess.unref?.();
        return { ...status, login: { ...loginState } };
    };

    return {
        runtime,
        command,
        commandEnvironment,
        getStatus,
        setCliPath,
        startLogin
    };
}
