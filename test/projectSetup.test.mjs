import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    ensureLocalEnv,
    initializeOptimizerPreference,
    installBundledCodexSkill
} from '../scripts/setup-project.mjs';
import { getProjectCliPath, resolveClaudeBin, resolveCodexBin } from '../server/services/cliPaths.js';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

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
    const localCodex = getProjectCliPath(root, 'codex', 'linux');
    const localClaude = getProjectCliPath(root, 'claude', 'linux');
    const existing = new Set(['/custom/codex', localCodex, localClaude]);
    const exists = value => existing.has(value);

    assert.equal(resolveCodexBin({ projectRoot: root, environment: { CODEX_CLI_PATH: '/custom/codex' }, platform: 'linux', exists }), '/custom/codex');
    assert.equal(resolveCodexBin({ projectRoot: root, environment: {}, platform: 'linux', exists }), localCodex);
    assert.equal(resolveClaudeBin({ projectRoot: root, environment: {}, platform: 'linux', exists }), localClaude);
    assert.match(getProjectCliPath('C:\\repo', 'codex', 'win32'), /codex\.cmd$/);
});
