#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { resolveClaudeBin, resolveCodexBin } from '../server/services/cliPaths.js';

const scriptFile = fileURLToPath(import.meta.url);
const defaultProjectRoot = path.resolve(path.dirname(scriptFile), '..');
export const BUNDLED_SKILL_NAME = 'twitcanva-codex-images';

function log(status, message) {
    process.stdout.write(`${status} ${message}\n`);
}

export function ensureLocalEnv(projectRoot) {
    const target = path.join(projectRoot, '.env');
    if (fs.existsSync(target)) return { created: false, path: target };
    const source = path.join(projectRoot, '.env.example');
    if (!fs.existsSync(source)) throw new Error(`缺少环境变量模板：${source}`);
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    return { created: true, path: target };
}

export function installBundledCodexSkill(projectRoot, codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) {
    const source = path.join(projectRoot, 'integrations', 'skills', BUNDLED_SKILL_NAME);
    const target = path.join(codexHome, 'skills', BUNDLED_SKILL_NAME);
    if (!fs.existsSync(path.join(source, 'SKILL.md'))) throw new Error(`缺少项目内置 Skill：${source}`);
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(source, target, { recursive: true, force: true });
    return target;
}

export function initializeOptimizerPreference(projectRoot, provider = 'codex-cli') {
    const configPath = path.join(projectRoot, 'library', 'config', 'optimizer.json');
    if (fs.existsSync(configPath)) return { created: false, path: configPath };
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify({ provider, models: {} }, null, 2)}\n`, { mode: 0o600 });
    return { created: true, path: configPath };
}

export function probeCli(command, args, { timeout = 15000 } = {}) {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout, windowsHide: true });
    return {
        available: !result.error && result.status === 0,
        status: result.status,
        stdout: String(result.stdout || '').trim(),
        stderr: String(result.stderr || '').trim(),
        error: result.error?.message || ''
    };
}

function codexAuthenticated(command) {
    return probeCli(command, ['login', 'status']).available;
}

function claudeAuthenticated(command) {
    const result = probeCli(command, ['auth', 'status']);
    if (!result.available) return false;
    try {
        return JSON.parse(result.stdout).loggedIn === true;
    } catch {
        return /logged.?in|authenticated/i.test(`${result.stdout}\n${result.stderr}`);
    }
}

function runRequired(command, args, cwd) {
    const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: false });
    if (result.error || result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} 执行失败${result.error ? `：${result.error.message}` : ''}`);
    }
}

export function runSetup({
    projectRoot = defaultProjectRoot,
    codexHome,
    installDependencies = true,
    checkOnly = false,
    withBrowserModels = false
} = {}) {
    const nodeMajor = Number(process.versions.node.split('.')[0]);
    if (nodeMajor < 22) throw new Error(`需要 Node.js 22 或更高版本，当前为 ${process.version}`);

    log('→', `项目目录：${projectRoot}`);
    if (installDependencies && !checkOnly) {
        log('→', '安装项目依赖及内置 Codex / Claude CLI…');
        runRequired(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install'], projectRoot);
    }

    if (!checkOnly) {
        const env = ensureLocalEnv(projectRoot);
        log(env.created ? '✓' : '·', env.created ? '已从 .env.example 创建本机 .env' : '保留已有 .env');

        const skillTarget = installBundledCodexSkill(projectRoot, codexHome);
        log('✓', `已安装项目 Skill：${skillTarget}`);
    }

    const codexBin = resolveCodexBin({ projectRoot });
    const claudeBin = resolveClaudeBin({ projectRoot });
    const codex = probeCli(codexBin, ['--version']);
    const claude = probeCli(claudeBin, ['--version']);
    log(codex.available ? '✓' : '!', codex.available ? `Codex CLI 可用：${codexBin}` : 'Codex CLI 不可用');
    log(claude.available ? '✓' : '!', claude.available ? `Claude CLI 可用：${claudeBin}` : 'Claude CLI 不可用');

    const codexLoggedIn = codex.available && codexAuthenticated(codexBin);
    const claudeLoggedIn = claude.available && claudeAuthenticated(claudeBin);
    log(codexLoggedIn ? '✓' : '!', codexLoggedIn ? 'Codex 已登录' : 'Codex 尚未登录');
    log(claudeLoggedIn ? '✓' : '!', claudeLoggedIn ? 'Claude 已登录' : 'Claude 尚未登录');

    if (!checkOnly) {
        const provider = codex.available ? 'codex-cli' : (claude.available ? 'claude-cli' : 'deepseek');
        const optimizer = initializeOptimizerPreference(projectRoot, provider);
        log(optimizer.created ? '✓' : '·', optimizer.created ? `默认提示词后端：${provider}` : '保留已有提示词后端配置');
    }

    if (withBrowserModels && !checkOnly) {
        log('→', '安装 Google Flow / 即梦浏览器自动化环境…');
        runRequired(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'setup:browser-models'], projectRoot);
    }

    process.stdout.write('\n');
    if (!codexLoggedIn && codex.available) log('下一步', '运行 `npm exec -- codex login`，用对方自己的 ChatGPT 账号登录');
    if (!claudeLoggedIn && claude.available) log('可选', '运行 `npm exec -- claude`，用对方自己的 Claude 账号登录');
    log('完成', codexLoggedIn ? '初始化完成，可以运行 `npm run dev`' : '本地文件初始化完成；完成 Codex 登录后运行 `npm run dev`');

    return { codexBin, claudeBin, codexAvailable: codex.available, claudeAvailable: claude.available, codexLoggedIn, claudeLoggedIn };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
    const args = new Set(process.argv.slice(2));
    try {
        runSetup({
            installDependencies: !args.has('--skip-dependencies'),
            checkOnly: args.has('--check'),
            withBrowserModels: args.has('--with-browser-models')
        });
    } catch (error) {
        log('失败', error.message);
        process.exitCode = 1;
    }
}
