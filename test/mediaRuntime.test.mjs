import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    parseChromeVersion,
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
