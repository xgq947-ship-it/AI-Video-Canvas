#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WINDOWS = process.platform === 'win32';
const RUNTIME_ROOT = path.join(ROOT, 'desktop-runtime', 'current');
const OPS_EXECUTABLE = path.join(
    RUNTIME_ROOT,
    'evan-ops-cli',
    IS_WINDOWS ? 'evan-ops-cli.exe' : 'evan-ops-cli'
);
const MEDIA_ROOT = path.join(RUNTIME_ROOT, 'media-tools');
const MEDIA_SUFFIX = IS_WINDOWS ? '.exe' : '';
const BROWSERS_ROOT = path.join(ROOT, 'server', 'python', '.browsers');

function fail(message) {
    console.error(`\n❌ 桌面运行时验收失败：${message}\n`);
    process.exit(1);
}

function requireFile(file) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        fail(`缺少文件：${file}`);
    }
}

function requireCommand(command, args, label) {
    const result = spawnSync(command, args, {
        cwd: ROOT,
        encoding: 'utf8',
        windowsHide: true
    });
    if (result.error || result.status !== 0) {
        fail(`${label}不可执行：${result.error?.message || result.stderr || result.stdout}`);
    }
}

function findChromium() {
    if (!fs.existsSync(BROWSERS_ROOT)) return '';
    const suffixes = IS_WINDOWS
        ? [path.join('chrome-win64', 'chrome.exe'), path.join('chrome-win', 'chrome.exe')]
        : process.platform === 'darwin'
            ? [
                path.join('chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
                path.join('chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing')
            ]
            : [path.join('chrome-linux64', 'chrome'), path.join('chrome-linux', 'chrome')];
    const directories = fs.readdirSync(BROWSERS_ROOT)
        .filter(name => name.startsWith('chromium-'))
        .sort()
        .reverse();
    for (const directory of directories) {
        for (const suffix of suffixes) {
            const candidate = path.join(BROWSERS_ROOT, directory, suffix);
            if (fs.existsSync(candidate)) return candidate;
        }
    }
    return '';
}

requireFile(OPS_EXECUTABLE);
requireFile(path.join(MEDIA_ROOT, `ffmpeg${MEDIA_SUFFIX}`));
requireFile(path.join(MEDIA_ROOT, `ffprobe${MEDIA_SUFFIX}`));
requireFile(path.join(ROOT, 'build', 'icon.ico'));
if (process.platform === 'darwin') requireFile(path.join(ROOT, 'build', 'icon.icns'));

const chromium = findChromium();
if (!chromium) fail(`没有找到 ${process.platform}/${process.arch} 可用的内置 Chromium`);

requireCommand(OPS_EXECUTABLE, ['--help'], '独立 Ops CLI');
requireCommand(path.join(MEDIA_ROOT, `ffmpeg${MEDIA_SUFFIX}`), ['-version'], 'FFmpeg');
requireCommand(path.join(MEDIA_ROOT, `ffprobe${MEDIA_SUFFIX}`), ['-version'], 'FFprobe');

console.log('✅ 桌面运行时验收通过');
console.log(`   平台：${process.platform}/${process.arch}`);
console.log(`   Ops CLI：${OPS_EXECUTABLE}`);
console.log(`   Chromium：${chromium}`);
console.log(`   媒体工具：${MEDIA_ROOT}`);
