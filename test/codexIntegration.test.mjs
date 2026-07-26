import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    buildWindowsScriptInvocation,
    createCodexIntegration,
    loadCodexConfig,
    resolveUnpackedResourcePath,
    saveCodexConfig
} from '../server/services/codexIntegration.js';
import { setRuntimeCodexPath } from '../server/services/cliPaths.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const waitFor = async predicate => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Timed out waiting for Codex login');
};

test('桌面版使用本机 Codex 路径、独立登录目录和内置队列桥接', async t => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-codex-integration-'));
    const libraryDir = path.join(dataDir, 'library');
    const fakeCodex = path.join(dataDir, process.platform === 'win32' ? 'codex.cmd' : 'codex');
    fs.mkdirSync(libraryDir, { recursive: true });
    fs.writeFileSync(fakeCodex, process.platform === 'win32'
        ? `@echo off
if "%~1"=="--version" (
  echo codex-cli 9.9.9
  exit /b 0
)
if "%~1"=="login" if "%~2"=="status" (
  if exist "%CODEX_HOME%\\auth-ok" exit /b 0
  exit /b 1
)
if "%~1"=="login" (
  type nul > "%CODEX_HOME%\\auth-ok"
  exit /b 0
)
exit /b 1
`
        : `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "codex-cli 9.9.9"
  exit 0
fi
if [ "$1" = "login" ] && [ "$2" = "status" ]; then
  test -f "$CODEX_HOME/auth-ok"
  exit $?
fi
if [ "$1" = "login" ]; then
  touch "$CODEX_HOME/auth-ok"
  exit 0
fi
exit 1
`);
    if (process.platform !== 'win32') fs.chmodSync(fakeCodex, 0o700);
    t.after(() => {
        setRuntimeCodexPath('');
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    const integration = createCodexIntegration({
        resourcesDir: projectRoot,
        dataDir,
        libraryDir,
        environment: {
            ...process.env,
            EVAN_DESKTOP: '1',
            CODEX_CLI_PATH: '',
            EVAN_ELECTRON_EXECUTABLE: process.execPath,
            EVAN_ELECTRON_RUN_AS_NODE: '0'
        },
        platform: process.platform
    });

    const configured = integration.setCliPath(fakeCodex);
    assert.equal(configured.available, true);
    assert.equal(configured.authenticated, false);
    assert.equal(configured.version, 'codex-cli 9.9.9');
    assert.equal(configured.skillInstalled, true);
    assert.equal(configured.queueBridgeReady, true);
    assert.equal(configured.codexHome, path.join(dataDir, 'codex-home'));
    assert.equal(loadCodexConfig(libraryDir).cliPath, fakeCodex);

    integration.startLogin();
    await waitFor(() => integration.getStatus({ force: true }).authenticated);
    assert.equal(integration.getStatus({ force: true }).authenticated, true);

    const queue = process.platform === 'win32'
        ? (() => {
            const environment = integration.commandEnvironment();
            const invocation = buildWindowsScriptInvocation(
                integration.runtime.runnerPath,
                ['list'],
                environment
            );
            return spawnSync(invocation.command, invocation.args, {
                encoding: 'utf8',
                env: environment,
                windowsVerbatimArguments: invocation.windowsVerbatimArguments
            });
        })()
        : spawnSync(integration.runtime.runnerPath, ['list'], {
            encoding: 'utf8',
            env: integration.commandEnvironment()
        });
    assert.equal(queue.status, 0, queue.stderr);
    assert.deepEqual(JSON.parse(queue.stdout), []);
});

test('Codex CLI 路径配置拒绝相对路径和不存在文件', t => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-codex-config-'));
    const libraryDir = path.join(dataDir, 'library');
    t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

    assert.throws(
        () => saveCodexConfig(libraryDir, { cliPath: 'relative/codex' }),
        /绝对路径/
    );
    assert.throws(
        () => saveCodexConfig(libraryDir, { cliPath: path.join(dataDir, 'missing-codex') }),
        /不存在/
    );
});

test('安装包中的 Codex 资源从 app.asar.unpacked 读取', () => {
    const packed = path.join(
        '/Applications',
        'Evan.app',
        'Contents',
        'Resources',
        'app.asar',
        'scripts',
        'codex-image-queue.mjs'
    );
    const unpacked = packed.replace(
        `${path.sep}app.asar${path.sep}`,
        `${path.sep}app.asar.unpacked${path.sep}`
    );

    assert.equal(
        resolveUnpackedResourcePath(packed, candidate => candidate === unpacked),
        unpacked
    );
    assert.equal(
        resolveUnpackedResourcePath('/workspace/scripts/codex-image-queue.mjs'),
        '/workspace/scripts/codex-image-queue.mjs'
    );
});
