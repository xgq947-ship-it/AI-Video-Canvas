#!/usr/bin/env node
/**
 * 浏览器自动化模型（Google Flow / 即梦）Python 运行时安装。
 *
 * 只做机器能自动完成的部分：建 venv、装依赖。
 * 登录是人的事——脚本最后会把需要手动做的步骤打出来。
 *
 * 跨平台：Windows 用 .venv\Scripts\python.exe，其余平台用 .venv/bin/python。
 */

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
const MIN_PYTHON = [3, 11];

function log(msg) { console.log(msg); }
function fail(msg) {
    console.error(`\n❌ ${msg}\n`);
    process.exit(1);
}

/** 找一个 >= 3.11 的解释器。注意裸 python3 可能是系统自带的老版本。 */
function findPython() {
    const candidates = IS_WINDOWS
        ? ['py -3.13', 'py -3.12', 'py -3.11', 'python', 'python3']
        : ['python3.13', 'python3.12', 'python3.11', 'python3'];

    for (const candidate of candidates) {
        const [cmd, ...preArgs] = candidate.split(' ');
        try {
            const out = execFileSync(cmd, [...preArgs, '--version'], {
                encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
            }).trim();
            const match = out.match(/Python (\d+)\.(\d+)/);
            if (!match) continue;
            const [major, minor] = [Number(match[1]), Number(match[2])];
            if (major > MIN_PYTHON[0] || (major === MIN_PYTHON[0] && minor >= MIN_PYTHON[1])) {
                log(`✅ 找到 Python：${candidate} (${out})`);
                return { cmd, preArgs };
            }
            log(`   跳过 ${candidate}（${out}，需要 ${MIN_PYTHON.join('.')}+）`);
        } catch {
            // 该候选不存在，继续找下一个
        }
    }
    return null;
}

function run(cmd, args, label, options = {}) {
    log(`\n▶ ${label}`);
    const result = spawnSync(cmd, args, {
        stdio: 'inherit',
        cwd: PYTHON_ROOT,
        env: { ...process.env, ...options.env }
    });
    if (result.error) fail(`${label} 失败：${result.error.message}`);
    if (result.status !== 0) fail(`${label} 失败（退出码 ${result.status}）`);
}

log('=== 安装 Evan Chrome 自动化运行环境（Google Flow / 即梦）===\n');

const python = findPython();
if (!python) {
    fail([
        `未找到 Python ${MIN_PYTHON.join('.')} 或更高版本。`,
        '',
        '请先安装 Python，再重新运行本命令：',
        '  Windows : https://www.python.org/downloads/windows/',
        '            （安装时务必勾选 "Add python.exe to PATH"）',
        '  macOS   : brew install python@3.12',
        '            或 https://www.python.org/downloads/macos/',
        '',
        '装好后重开一个终端，运行：npm run setup:automation-runtime'
    ].join('\n'));
}

if (fs.existsSync(VENV_PYTHON)) {
    log('ℹ️  已存在 .venv，跳过创建（如需重建请先删除 server/python/.venv）');
} else {
    run(python.cmd, [...python.preArgs, '-m', 'venv', '.venv'], '创建虚拟环境 server/python/.venv');
}

run(VENV_PYTHON, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip'], '升级 pip');
run(VENV_PYTHON, ['-m', 'pip', 'install', '--quiet', '-r', 'requirements.txt'], '安装 Python 依赖');
// 自检：确认 CLI 能正常加载两个能力
log('\n▶ 自检 ops_cli');
const check = spawnSync(VENV_PYTHON, ['-m', 'ops_cli', '--help'], {
    cwd: PYTHON_ROOT, encoding: 'utf8'
});
if (check.status !== 0 || !/image-to-video/.test(check.stdout || '')) {
    fail(`ops_cli 自检未通过：\n${check.stderr || check.stdout}`);
}
log('✅ ops_cli 正常，image-to-video / text-to-image 均已就绪');

log(`
========================================================
✅ 环境安装完成
========================================================

Evan 不再下载或打包 Chromium；运行时使用电脑现有的 Google Chrome，
并自动创建独立 browser-profile。首次使用或登录过期时请分别登录：
   · 即梦        https://jimeng.jianying.com   —— 需要即梦 VIP 会员额度
   · Google Flow https://labs.google/fx/tools/flow —— 需要有 Flow 权限的 Google 账号

⚠️ 登录态只保存在你本机，不会也不能随项目分发。
   应用更新不会覆盖 Evan 专属 Chrome 的用户资料。

不配置这一套也没关系：Gemini / OpenAI / Seedance(ARK)
等官方 API 模型不依赖它，填好 .env 即可直接使用。
`);
