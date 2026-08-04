import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildCliInvocation,
    getPromptOptimizerProvider,
    listPromptOptimizerProviders
} from '../server/services/promptOptimizerProviders.js';

test('只有 Codex CLI 提示词后端声明支持当前节点图片识别', () => {
    assert.equal(getPromptOptimizerProvider('codex-cli')?.supportsImage, true);
    assert.equal(getPromptOptimizerProvider('deepseek')?.supportsImage, false);
    assert.equal(getPromptOptimizerProvider('claude-cli')?.supportsImage, false);

    const codex = listPromptOptimizerProviders().find(provider => provider.id === 'codex-cli');
    assert.equal(codex?.supportsImage, true);
    assert.equal(codex?.defaultModel, 'gpt-5.6-luna');
    assert.equal(codex?.defaultEffort, 'xhigh');
});

test('Windows 的 npm CLI 包装脚本必须通过 ComSpec 启动', () => {
    const invocation = buildCliInvocation(
        'C:\\Users\\测试 用户\\AppData\\Roaming\\npm\\codex.cmd',
        ['exec', '--model', 'gpt-5.6-luna', '包含空格 & 符号的提示词'],
        {
            platform: 'win32',
            environment: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }
        }
    );

    assert.equal(invocation.command, 'C:\\Windows\\System32\\cmd.exe');
    assert.deepEqual(invocation.args.slice(0, 3), ['/d', '/s', '/c']);
    assert.match(invocation.args[3], /^"C:\\Users\\测试 用户\\.*codex\.cmd"/);
    assert.match(invocation.args[3], /"包含空格 & 符号的提示词"/);
});

test('原生 CLI 继续使用参数数组直接启动', () => {
    const args = ['exec', '提示词'];
    assert.deepEqual(
        buildCliInvocation('/usr/local/bin/codex', args, { platform: 'darwin' }),
        { command: '/usr/local/bin/codex', args }
    );
});
