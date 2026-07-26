import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    parseChromeVersion,
    getChromeCompatibility,
    invalidateChromeCompatibility,
    probeSystemChromeCompatibility,
    resolveSystemChromeExecutable
} from '../server/runtime/browserExecutable.js';
import { resolveMediaToolPaths } from '../server/runtime/mediaTools.js';

test('媒体工具优先使用桌面进程注入的内置路径', () => {
    const resourcesDir = path.resolve('/Applications/Evan.app/Contents/Resources');
    const paths = resolveMediaToolPaths({
        EVAN_FFMPEG_PATH: path.join(resourcesDir, 'media-tools', 'ffmpeg'),
        EVAN_FFPROBE_PATH: path.join(resourcesDir, 'media-tools', 'ffprobe')
    }, { projectRoot: path.resolve('/checkout'), tools: null, platform: 'darwin' });

    assert.equal(paths.ffmpeg, path.join(resourcesDir, 'media-tools', 'ffmpeg'));
    assert.equal(paths.ffprobe, path.join(resourcesDir, 'media-tools', 'ffprobe'));
});

test('媒体工具缺失时仍指向项目依赖，不静默依赖系统 PATH', () => {
    const projectRoot = path.resolve('/checkout');
    const paths = resolveMediaToolPaths({}, {
        projectRoot,
        tools: null,
        platform: 'win32'
    });

    assert.equal(paths.ffmpeg, path.join(projectRoot, 'node_modules', 'ffmpeg-ffprobe-static', 'ffmpeg.exe'));
    assert.equal(paths.ffprobe, path.join(projectRoot, 'node_modules', 'ffmpeg-ffprobe-static', 'ffprobe.exe'));
});

test('运行时优先使用显式配置的系统 Google Chrome', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-browser-'));
    const executable = path.join(root, 'Google Chrome');
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, '');
    try {
        assert.equal(resolveSystemChromeExecutable(
            { EVAN_CHROME_EXECUTABLE: executable },
            { platform: 'darwin', projectRoot: '/checkout' }
        ), executable);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Chrome 兼容性探针验证版本并给出安装阻断原因', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-chrome-probe-'));
    const executable = path.join(root, 'chrome');
    fs.writeFileSync(executable, '');
    try {
        const ready = probeSystemChromeCompatibility(
            { EVAN_CHROME_EXECUTABLE: executable },
            {
                platform: 'darwin',
                minMajor: 136,
                spawnSyncImpl: () => ({ status: 0, stdout: 'Google Chrome 150.0.7871.182', stderr: '' })
            }
        );
        assert.equal(ready.ready, true);
        assert.equal(ready.major, 150);
        assert.equal(ready.executable, executable);

        const outdated = probeSystemChromeCompatibility(
            { EVAN_CHROME_EXECUTABLE: executable },
            {
                platform: 'darwin',
                minMajor: 151,
                spawnSyncImpl: () => ({ status: 0, stdout: 'Google Chrome 150.0.7871.182', stderr: '' })
            }
        );
        assert.equal(outdated.ready, false);
        assert.equal(outdated.reason, 'unsupported-version');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Chrome 版本解析兼容标准输出', () => {
    assert.deepEqual(parseChromeVersion('Google Chrome 150.0.7871.182'), {
        version: '150.0.7871.182',
        major: 150
    });
    assert.equal(parseChromeVersion('Chromium 150.0.1'), null);
});

// ---------------------------------------------------------------------------
// Chrome 探针缓存
// ---------------------------------------------------------------------------

test('Chrome 探针结果会被缓存，不在热路径上反复同步启动 Chrome', () => {
    // probeSystemChromeCompatibility 内部是 spawnSync(chrome, ['--version'])，
    // 会同步阻塞整个事件循环（超时上限 5 秒）。它被挂在 opsEnvironment() 和
    // ensureReady() 上，一次生成要付 2~4 次；退出路径上还会挤占关闭浏览器的预算。
    invalidateChromeCompatibility();
    let probes = 0;
    const options = {
        platform: 'darwin',
        homeDir: '/Users/tester',
        spawnSyncImpl: () => {
            probes += 1;
            return { status: 0, stdout: 'Google Chrome 150.0.7871.182', stderr: '' };
        },
        existsSyncImpl: () => true
    };
    const environment = { EVAN_CHROME_EXECUTABLE: process.execPath };

    let clock = 1_000;
    const read = (extra = {}) => getChromeCompatibility(environment, { now: () => clock, ...options, ...extra });

    assert.equal(read().ready, true);
    assert.equal(probes, 1);

    for (let i = 0; i < 20; i += 1) read();
    assert.equal(probes, 1, '缓存期内不应重复探测');

    // 可用结论缓存 5 分钟。
    clock += 4 * 60_000;
    read();
    assert.equal(probes, 1);
    clock += 2 * 60_000;
    read();
    assert.equal(probes, 2, '超过 TTL 后应重新探测');

    invalidateChromeCompatibility();
});

test('用户点「重新检测」时必须绕开缓存', () => {
    // chrome:retry 存在的意义就是「刚装完 Chrome，再看一次」。
    // 缓存不给 force 出口的话，这个按钮会永远读到旧结论。
    invalidateChromeCompatibility();
    let probes = 0;
    const options = {
        platform: 'darwin',
        homeDir: '/Users/tester',
        spawnSyncImpl: () => {
            probes += 1;
            return { status: 0, stdout: 'Google Chrome 150.0.7871.182', stderr: '' };
        }
    };
    const environment = { EVAN_CHROME_EXECUTABLE: process.execPath };

    getChromeCompatibility(environment, options);
    getChromeCompatibility(environment, options);
    assert.equal(probes, 1);

    getChromeCompatibility(environment, { ...options, force: true });
    assert.equal(probes, 2);

    invalidateChromeCompatibility();
});

test('探测失败只短暂缓存，不会把模型平白置灰几分钟', () => {
    // Windows 杀软拖慢一次 --version 就可能撞 5 秒超时。把这种瞬时失败
    // 按「可用」的 TTL 缓存，会让 Flow/即梦所有模型灰掉一整段时间。
    invalidateChromeCompatibility();
    let probes = 0;
    let clock = 1_000;
    const options = {
        platform: 'darwin',
        homeDir: '/Users/tester',
        spawnSyncImpl: () => {
            probes += 1;
            return { status: 1, stdout: '', stderr: '' }; // 探测失败
        }
    };
    const environment = { EVAN_CHROME_EXECUTABLE: process.execPath };

    const first = getChromeCompatibility(environment, { now: () => clock, ...options });
    assert.equal(first.ready, false);
    assert.equal(probes, 1);

    clock += 1_000; // 仍在短 TTL 内
    getChromeCompatibility(environment, { now: () => clock, ...options });
    assert.equal(probes, 1);

    clock += 5_000; // 超过 3 秒短 TTL
    getChromeCompatibility(environment, { now: () => clock, ...options });
    assert.equal(probes, 2, '失败结论不应被长时间缓存');

    invalidateChromeCompatibility();
});
