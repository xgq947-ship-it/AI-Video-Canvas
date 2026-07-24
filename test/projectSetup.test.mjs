import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    buildAiCliInstallArgs,
    buildDependencyInstallArgs,
    buildSetupCommandInvocation,
    ensureLocalEnv,
    initializeOptimizerPreference,
    installBundledCodexSkill,
    runSetup
} from '../scripts/setup-project.mjs';
import { getManagedCliPath, getProjectCliPath, resolveClaudeBin, resolveCodexBin } from '../server/services/cliPaths.js';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

test('基础依赖正常安装，AI CLI 使用隔离目录且只在明确启用时安装', () => {
    assert.deepEqual(buildDependencyInstallArgs(), ['install']);
    const args = buildAiCliInstallArgs('/repo');
    assert.deepEqual(args.slice(0, 5), ['install', '--prefix', path.join('/repo', '.local-ai-cli'), '--no-save', '--package-lock=false']);
    assert.equal(args.includes('@openai/codex@latest'), true);
    assert.equal(args.includes('@anthropic-ai/claude-code@^2.1.218'), true);
});

test('Windows 项目安装与 CLI 探测通过 cmd.exe 执行包装脚本', () => {
    const invocation = buildSetupCommandInvocation(
        'C:\\Users\\测试 用户\\AppData\\Roaming\\npm\\npm.cmd',
        ['install', '--prefix', 'C:\\Evan Project\\.local-ai-cli'],
        {
            platform: 'win32',
            environment: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }
        }
    );

    assert.equal(invocation.command, 'C:\\Windows\\System32\\cmd.exe');
    assert.deepEqual(invocation.args.slice(0, 3), ['/d', '/s', '/c']);
    assert.match(invocation.args[3], /^"C:\\Users\\测试 用户\\.*npm\.cmd"/);
    assert.match(invocation.args[3], /"C:\\Evan Project\\\.local-ai-cli"/);
});

test('初始化复制 .env 但不覆盖已有本机配置', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-setup-env-'));
    try {
        fs.writeFileSync(path.join(root, '.env.example'), 'EXAMPLE=1\n');
        assert.equal(ensureLocalEnv(root).created, true);
        fs.writeFileSync(path.join(root, '.env'), 'PRIVATE=1\n');
        assert.equal(ensureLocalEnv(root).created, false);
        assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'PRIVATE=1\n');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('项目内置 Skill 可以安装到隔离的 CODEX_HOME', () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-codex-home-'));
    try {
        const target = installBundledCodexSkill(repositoryRoot, codexHome);
        const skill = fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8');
        assert.match(skill, /name: twitcanva-codex-images/);
        assert.doesNotMatch(skill, /\/Users\/dasheng/);
        assert.equal(fs.existsSync(path.join(target, 'agents', 'openai.yaml')), true);
    } finally {
        fs.rmSync(codexHome, { recursive: true, force: true });
    }
});

test('初始化创建默认后端配置但保留用户已有选择', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-setup-config-'));
    try {
        assert.equal(initializeOptimizerPreference(root, 'codex-cli').created, true);
        const configPath = path.join(root, 'library', 'config', 'optimizer.json');
        assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).provider, 'codex-cli');
        fs.writeFileSync(configPath, '{"provider":"claude-cli","models":{}}\n');
        assert.equal(initializeOptimizerPreference(root, 'codex-cli').created, false);
        assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).provider, 'claude-cli');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('CLI 路径优先使用用户覆盖，其次 ChatGPT App 或项目本地依赖', () => {
    const root = '/repo';
    const managedCodex = getManagedCliPath(root, 'codex', 'linux');
    const managedClaude = getManagedCliPath(root, 'claude', 'linux');
    const localCodex = getProjectCliPath(root, 'codex', 'linux');
    const localClaude = getProjectCliPath(root, 'claude', 'linux');
    const existing = new Set(['/custom/codex', managedCodex, managedClaude, localCodex, localClaude]);
    const exists = value => existing.has(value);

    assert.equal(resolveCodexBin({ projectRoot: root, environment: { CODEX_CLI_PATH: '/custom/codex' }, platform: 'linux', exists }), '/custom/codex');
    assert.equal(resolveCodexBin({ projectRoot: root, environment: {}, platform: 'linux', exists }), managedCodex);
    assert.equal(resolveClaudeBin({ projectRoot: root, environment: {}, platform: 'linux', exists }), managedClaude);
    assert.match(getProjectCliPath('C:\\repo', 'codex', 'win32'), /codex\.cmd$/);
});

test('Codex 自动发现优先使用 PATH 中持续更新的独立安装', () => {
    const root = '/tmp/evan-cli-path';
    const pathCodex = path.join(root, 'bin', 'codex');
    const managedCodex = getManagedCliPath(root, 'codex', 'linux');
    const existing = new Set([pathCodex, managedCodex]);

    assert.equal(resolveCodexBin({
        projectRoot: root,
        environment: { PATH: path.join(root, 'bin') },
        platform: 'linux',
        exists: value => existing.has(value)
    }), pathCodex);
});

test('未安装 Codex 和 Claude 时初始化跳过 CLI 与 Skill 且正常完成', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-setup-no-cli-'));
    const codexHome = path.join(root, 'codex-home');
    try {
        fs.writeFileSync(path.join(root, '.env.example'), 'EXAMPLE=1\n');
        fs.mkdirSync(path.join(root, 'integrations', 'skills', 'twitcanva-codex-images'), { recursive: true });
        fs.writeFileSync(path.join(root, 'integrations', 'skills', 'twitcanva-codex-images', 'SKILL.md'), '---\nname: twitcanva-codex-images\n---\n');

        const result = runSetup({
            projectRoot: root,
            codexHome,
            installDependencies: false,
            resolveCodex: () => 'missing-codex',
            resolveClaude: () => 'missing-claude',
            probe: () => ({ available: false, status: null, stdout: '', stderr: '', error: 'not found' })
        });

        assert.equal(result.codexAvailable, false);
        assert.equal(result.claudeAvailable, false);
        assert.equal(result.skillTarget, '');
        assert.equal(fs.existsSync(path.join(codexHome, 'skills', 'twitcanva-codex-images')), false);
        assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'library', 'config', 'optimizer.json'), 'utf8')).provider, 'deepseek');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
