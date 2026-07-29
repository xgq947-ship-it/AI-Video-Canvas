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
const BROWSER_HUB_ROOT = path.join(RUNTIME_ROOT, 'browser-hub');

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

requireFile(OPS_EXECUTABLE);
requireFile(path.join(MEDIA_ROOT, `ffmpeg${MEDIA_SUFFIX}`));
requireFile(path.join(MEDIA_ROOT, `ffprobe${MEDIA_SUFFIX}`));
requireFile(path.join(BROWSER_HUB_ROOT, 'manifest.json'));
requireFile(path.join(BROWSER_HUB_ROOT, 'server', 'daemon.mjs'));
requireFile(path.join(BROWSER_HUB_ROOT, 'runtime', IS_WINDOWS ? 'node.exe' : 'node'));
requireFile(path.join(BROWSER_HUB_ROOT, 'runtime', 'NODE-LICENSE'));
requireFile(path.join(ROOT, 'build', 'icon.ico'));
if (process.platform === 'darwin') requireFile(path.join(ROOT, 'build', 'icon.icns'));

requireCommand(OPS_EXECUTABLE, ['--help'], '独立 Ops CLI');
requireCommand(path.join(MEDIA_ROOT, `ffmpeg${MEDIA_SUFFIX}`), ['-version'], 'FFmpeg');
requireCommand(path.join(MEDIA_ROOT, `ffprobe${MEDIA_SUFFIX}`), ['-version'], 'FFprobe');

console.log('✅ 桌面运行时验收通过');
console.log(`   平台：${process.platform}/${process.arch}`);
console.log(`   Ops CLI：${OPS_EXECUTABLE}`);
console.log('   浏览器：运行时检测用户电脑上的 Google Chrome');
console.log(`   媒体工具：${MEDIA_ROOT}`);
console.log(`   共享浏览器：${BROWSER_HUB_ROOT}`);
