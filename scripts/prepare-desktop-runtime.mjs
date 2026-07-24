#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PYTHON_ROOT = path.join(ROOT, 'server', 'python');
const IS_WINDOWS = process.platform === 'win32';
const VENV_PYTHON = IS_WINDOWS
    ? path.join(PYTHON_ROOT, '.venv', 'Scripts', 'python.exe')
    : path.join(PYTHON_ROOT, '.venv', 'bin', 'python');
const OUTPUT_ROOT = path.join(ROOT, 'desktop-runtime', 'current');
const WORK_ROOT = path.join(ROOT, 'desktop-runtime', '.build');
const APP_NAME = 'evan-ops-cli';
const EXECUTABLE = path.join(
    OUTPUT_ROOT,
    APP_NAME,
    IS_WINDOWS ? `${APP_NAME}.exe` : APP_NAME
);
const PYINSTALLER_VERSION = '6.21.0';
const MEDIA_PACKAGE_ROOT = path.join(ROOT, 'node_modules', 'ffmpeg-ffprobe-static');
const MEDIA_OUTPUT_ROOT = path.join(OUTPUT_ROOT, 'media-tools');

function fail(message) {
    console.error(`\n❌ ${message}\n`);
    process.exit(1);
}

function run(command, args, label) {
    console.log(`\n▶ ${label}`);
    const result = spawnSync(command, args, {
        cwd: ROOT,
        stdio: 'inherit',
        env: process.env
    });
    if (result.error) fail(`${label}失败：${result.error.message}`);
    if (result.status !== 0) fail(`${label}失败（退出码 ${result.status}）`);
}

function prepareMediaTools() {
    const extension = IS_WINDOWS ? '.exe' : '';
    const entries = [
        [[`ffmpeg${extension}`], `ffmpeg${extension}`],
        [[`ffprobe${extension}`], `ffprobe${extension}`],
        [['LICENSE'], 'PACKAGE-LICENSE'],
        // The package installer downloads ffmpeg.README on macOS/Linux, while
        // some Windows binary archives only retain the package-level README.
        [['ffmpeg.README', 'README.md'], 'FFMPEG-BUILD-README']
    ];
    fs.mkdirSync(MEDIA_OUTPUT_ROOT, { recursive: true });
    for (const [sourceNames, destinationName] of entries) {
        const source = sourceNames
            .map((sourceName) => path.join(MEDIA_PACKAGE_ROOT, sourceName))
            .find((candidate) => fs.existsSync(candidate));
        if (!source) {
            fail(`内置媒体工具缺少文件：${sourceNames.join(' 或 ')}`);
        }
        fs.copyFileSync(source, path.join(MEDIA_OUTPUT_ROOT, destinationName));
    }
    if (!IS_WINDOWS) {
        fs.chmodSync(path.join(MEDIA_OUTPUT_ROOT, 'ffmpeg'), 0o755);
        fs.chmodSync(path.join(MEDIA_OUTPUT_ROOT, 'ffprobe'), 0o755);
    }
    console.log(`\n✅ FFmpeg / FFprobe 已准备：${MEDIA_OUTPUT_ROOT}`);
}

if (!fs.existsSync(VENV_PYTHON)) {
    fail('浏览器模型 Python 环境不存在，请先运行 npm run setup:browser-models');
}

// Runtime artifacts are platform-specific. Always rebuild from a clean output
// directory so a previous macOS build can never leak Mach-O files into a
// Windows installer (or vice versa).
fs.rmSync(OUTPUT_ROOT, { recursive: true, force: true });
fs.mkdirSync(OUTPUT_ROOT, { recursive: true });

prepareMediaTools();

let installedVersion = '';
try {
    installedVersion = execFileSync(
        VENV_PYTHON,
        ['-c', 'from importlib.metadata import version; print(version("pyinstaller"))'],
        { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
} catch {
    // Installed below.
}
if (installedVersion !== PYINSTALLER_VERSION) {
    run(
        VENV_PYTHON,
        ['-m', 'pip', 'install', '--quiet', `pyinstaller==${PYINSTALLER_VERSION}`],
        `安装 PyInstaller ${PYINSTALLER_VERSION}`
    );
}

run(VENV_PYTHON, [
    '-m', 'PyInstaller',
    '--noconfirm',
    '--clean',
    '--onedir',
    '--name', APP_NAME,
    '--distpath', OUTPUT_ROOT,
    '--workpath', path.join(WORK_ROOT, 'work'),
    '--specpath', path.join(WORK_ROOT, 'spec'),
    '--paths', PYTHON_ROOT,
    '--paths', path.join(PYTHON_ROOT, 'sessionhub'),
    '--collect-submodules', 'ops_cli',
    '--collect-submodules', 'scene',
    '--collect-all', 'playwright',
    '--add-data', `${path.join(PYTHON_ROOT, 'ops_cli', 'platforms')}${path.delimiter}ops_cli/platforms`,
    path.join(PYTHON_ROOT, 'ops_cli_launcher.py')
], '构建独立 Ops CLI 运行时');

if (!fs.existsSync(EXECUTABLE)) {
    fail(`构建完成但未找到可执行文件：${EXECUTABLE}`);
}
console.log(`\n✅ 独立运行时已生成：${EXECUTABLE}`);
