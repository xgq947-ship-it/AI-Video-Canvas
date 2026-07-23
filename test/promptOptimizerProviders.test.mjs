import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getPromptOptimizerProvider,
    listPromptOptimizerProviders
} from '../server/services/promptOptimizerProviders.js';

test('只有 Codex CLI 提示词后端声明支持当前节点图片识别', () => {
    assert.equal(getPromptOptimizerProvider('codex-cli')?.supportsImage, true);
    assert.equal(getPromptOptimizerProvider('deepseek')?.supportsImage, false);
    assert.equal(getPromptOptimizerProvider('claude-cli')?.supportsImage, false);

    const codex = listPromptOptimizerProviders().find(provider => provider.id === 'codex-cli');
    assert.equal(codex?.supportsImage, true);
});
