#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { resolveClaudeBin, resolveCodexBin } from '../server/services/cliPaths.js';
import { decodeProcessOutput } from '../server/utils/processOutput.js';

const scriptFile = fileURLToPath(import.meta.url);
const defaultProjectRoot = path.resolve(path.dirname(scriptFile), '..');
export const BUNDLED_SKILL_NAME = 'twitcanva-codex-images';
export const AI_CLI_PACKAGES = ['@openai/codex@latest', '@anthropic-ai/claude-code@^2.1.218'];

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

function quoteWindowsCommandArg(value) {
    return `"${String(value).replaceAll('"', '""')}"`;
}

export function buildSetupCommandInvocation(
    command,
    args,
    { platform = process.platform, environment = process.env } = {}
) {
    if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(command)) {
        return { command, args };
    }
    return {
        command: environment.ComSpec || environment.COMSPEC || 'cmd.exe',
        args: [
            '/d',
            '/s',
            '/c',
            [quoteWindowsCommandArg(command), ...args.map(quoteWindowsCommandArg)].join(' ')
        ]
    };
}

export function probeCli(
    command,
    args,
    { timeout = 15000, platform = process.platform, environment = process.env } = {}
) {
    const invocation = buildSetupCommandInvocation(command, args, { platform, environment });
    const result = spawnSync(invocation.command, invocation.args, {
        timeout,
        windowsHide: true,
        env: environment
    });
    return {
        available: !result.error && result.status === 0,
        status: result.status,
        stdout: decodeProcessOutput(result.stdout).trim(),
        stderr: decodeProcessOutput(result.stderr).trim(),
        error: result.error?.message || ''
    };
}

function codexAuthenticated(command, probe = probeCli) {
    return probe(command, ['login', 'status']).available;
}

function claudeAuthenticated(command, probe = probeCli) {
    const result = probe(command, ['auth', 'status']);
    if (!result.available) return false;
    try {
        return JSON.parse(result.stdout).loggedIn === true;
    } catch {
        return /logged.?in|authenticated/i.test(`${result.stdout}\n${result.stderr}`);
    }
}

function runRequired(command, args, cwd) {
    const invocation = buildSetupCommandInvocation(command, args);
    const result = spawnSync(invocation.command, invocation.args, {
        cwd,
        stdio: 'inherit',
        windowsHide: false
    });
    if (result.error || result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} 执行失败${result.error ? `：${result.error.message}` : ''}`);
    }
}

export function buildDependencyInstallArgs() {
    return ['install'];
}

export function buildAiCliInstallArgs(projectRoot) {
    return [
        'install',
        '--prefix', path.join(projectRoot, '.local-ai-cli'),
        '--no-save',
        '--package-lock=false',
        ...AI_CLI_PACKAGES
    ];
}

export function runSetup({
    projectRoot = defaultProjectRoot,
    codexHome,
    installDependencies = true,
    installAiCli = false,
    checkOnly = false,
    withBrowserModels = false,
    resolveCodex = resolveCodexBin,
    resolveClaude = resolveClaudeBin,
    probe = probeCli
} = {}) {
    const nodeMajor = Number(process.versions.node.split('.')[0]);
    if (nodeMajor < 22) throw new Error(`需要 Node.js 22 或更高版本，当前为 ${process.version}`);

    log('→', `项目目录：${projectRoot}`);
    if (installDependencies && !checkOnly) {
        log('→', '安装项目基础依赖…');
        runRequired(
            process.platform === 'win32' ? 'npm.cmd' : 'npm',
            buildDependencyInstallArgs(),
            projectRoot
        );
    }

    if (installAiCli && !checkOnly) {
        log('→', '安装可选 Codex / Claude CLI 到项目本机工具目录…');
        runRequired(
            process.platform === 'win32' ? 'npm.cmd' : 'npm',
            buildAiCliInstallArgs(projectRoot),
            projectRoot
        );
    }

    if (!checkOnly) {
        const env = ensureLocalEnv(projectRoot);
        log(env.created ? '✓' : '·', env.created ? '已从 .env.example 创建本机 .env' : '保留已有 .env');

    }

    const codexBin = resolveCodex({ projectRoot });
    const claudeBin = resolveClaude({ projectRoot });
    const codex = probe(codexBin, ['--version']);
    const claude = probe(claudeBin, ['--version']);
    log(codex.available ? '✓' : '·', codex.available ? `Codex CLI 可用：${codexBin}` : '未检测到 Codex CLI，已跳过');
    log(claude.available ? '✓' : '·', claude.available ? `Claude CLI 可用：${claudeBin}` : '未检测到 Claude CLI，已跳过');

    const codexLoggedIn = codex.available && codexAuthenticated(codexBin, probe);
    const claudeLoggedIn = claude.available && claudeAuthenticated(claudeBin, probe);
    if (codex.available) log(codexLoggedIn ? '✓' : '!', codexLoggedIn ? 'Codex 已登录' : 'Codex 尚未登录');
    if (claude.available) log(claudeLoggedIn ? '✓' : '!', claudeLoggedIn ? 'Claude 已登录' : 'Claude 尚未登录');

    let skillTarget = '';
    if (!checkOnly && codex.available) {
        skillTarget = installBundledCodexSkill(projectRoot, codexHome);
        log('✓', `已安装项目 Skill：${skillTarget}`);
    }

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
    if (!codex.available && !claude.available) log('提示', 'AI CLI 为可选能力；需要时运行 `npm run setup:ai-cli`');
    log('完成', '初始化完成，可以运行 `npm run dev`');

    return { codexBin, claudeBin, codexAvailable: codex.available, claudeAvailable: claude.available, codexLoggedIn, claudeLoggedIn, skillTarget };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
    const args = new Set(process.argv.slice(2));
    try {
        runSetup({
            installDependencies: !args.has('--skip-dependencies'),
            installAiCli: args.has('--with-ai-cli'),
            checkOnly: args.has('--check'),
            withBrowserModels: args.has('--with-browser-models')
        });
    } catch (error) {
        log('失败', error.message);
        process.exitCode = 1;
    }
}
