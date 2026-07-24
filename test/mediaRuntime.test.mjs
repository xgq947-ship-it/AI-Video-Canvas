import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveBundledBrowserExecutable } from '../server/runtime/browserExecutable.js';
import { resolveMediaToolPaths } from '../server/runtime/mediaTools.js';

test('媒体工具优先使用桌面进程注入的内置路径', () => {
    const paths = resolveMediaToolPaths({
        EVAN_FFMPEG_PATH: '/Applications/Evan.app/Contents/Resources/media-tools/ffmpeg',
        EVAN_FFPROBE_PATH: '/Applications/Evan.app/Contents/Resources/media-tools/ffprobe'
    }, { projectRoot: '/checkout', tools: null, platform: 'darwin' });

    assert.equal(paths.ffmpeg, '/Applications/Evan.app/Contents/Resources/media-tools/ffmpeg');
    assert.equal(paths.ffprobe, '/Applications/Evan.app/Contents/Resources/media-tools/ffprobe');
});

test('媒体工具缺失时仍指向项目依赖，不静默依赖系统 PATH', () => {
    const paths = resolveMediaToolPaths({}, {
        projectRoot: '/checkout',
        tools: null,
        platform: 'win32'
    });

    assert.equal(paths.ffmpeg, '/checkout/node_modules/ffmpeg-ffprobe-static/ffmpeg.exe');
    assert.equal(paths.ffprobe, '/checkout/node_modules/ffmpeg-ffprobe-static/ffprobe.exe');
});

test('Remotion 从 Playwright 资源目录发现 Evan 内置 Chromium', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-browser-'));
    const executable = path.join(
        root,
        'chromium-1228',
        'chrome-mac-arm64',
        'Google Chrome for Testing.app',
        'Contents',
        'MacOS',
        'Google Chrome for Testing'
    );
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, '');
    try {
        assert.equal(resolveBundledBrowserExecutable(
            { PLAYWRIGHT_BROWSERS_PATH: root },
            { platform: 'darwin', projectRoot: '/checkout' }
        ), executable);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
