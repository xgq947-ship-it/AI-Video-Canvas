import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    applyApiKeysToApp,
    describeApiKeySettings,
    loadApiKeyOverrides,
    saveApiKeyOverrides
} from '../server/services/apiKeyStore.js';

test('手动 API 密钥以本机文件保存并覆盖环境变量', () => {
    const libraryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twitcanva-api-'));
    const saved = saveApiKeyOverrides(libraryDir, {}, { ARK_API_KEY: 'manual-seedance-key' });
    const app = { locals: {} };

    applyApiKeysToApp(app, { ARK_API_KEY: 'env-key' }, saved);

    assert.equal(loadApiKeyOverrides(libraryDir).ARK_API_KEY, 'manual-seedance-key');
    assert.equal(app.locals.ARK_API_KEY, 'manual-seedance-key');

    // 权限位只在 POSIX 上有意义。Windows 的 NTFS 没有 POSIX 权限位，
    // chmod 是空操作，这里恒为 0o666(438) 而非 0o600(384)——
    // 原来无条件断言 0o600 会导致 Windows 上必然有 1 个 fail，
    // 且报错信息（438 ≠ 384）完全看不出是权限问题。
    if (process.platform !== 'win32') {
        assert.equal(fs.statSync(path.join(libraryDir, 'config', 'api-keys.json')).mode & 0o777, 0o600);
    }
    fs.rmSync(libraryDir, { recursive: true, force: true });
});

test('清除手动密钥后回退环境变量，接口不返回明文', () => {
    const libraryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twitcanva-api-'));
    const saved = saveApiKeyOverrides(libraryDir, { ARK_API_KEY: 'manual-12345678' }, {}, ['ARK_API_KEY']);
    const fields = describeApiKeySettings({ ARK_API_KEY: 'env-87654321' }, saved);
    const ark = fields.find(field => field.name === 'ARK_API_KEY');

    assert.equal(ark.source, 'environment');
    assert.equal(ark.configured, true);
    assert.equal(ark.maskedValue, '••••••••4321');
    assert.equal(JSON.stringify(fields).includes('env-87654321'), false);
    fs.rmSync(libraryDir, { recursive: true, force: true });
});

test('已下线模型与配音供应商的密钥字段不再暴露', () => {
    const fields = describeApiKeySettings({}, {});
    const ark = fields.find(field => field.name === 'ARK_API_KEY');

    assert.equal(ark.provider, 'Seedance 2.0');
    assert.match(ark.label, /火山方舟.*中国区/);
    assert.equal(fields.some(field => field.name === 'KLING_API_KEY'), false);
    assert.equal(fields.some(field => field.name === 'HAILUO_API_KEY'), false);
    assert.equal(fields.some(field => field.name === 'KLING_ACCESS_KEY'), false);
    assert.equal(fields.some(field => field.name === 'KLING_SECRET_KEY'), false);
    assert.equal(fields.some(field => field.name === 'MINIMAX_API_KEY'), false);
    assert.equal(fields.some(field => field.name === 'MINIMAX_GROUP_ID'), false);
    assert.equal(fields.some(field => field.name === 'GEMINI_API_KEY'), false);
    assert.equal(fields.some(field => field.name === 'OPENAI_API_KEY'), false);
});

test('提示词优化可单独配置 DeepSeek API 密钥', () => {
    const fields = describeApiKeySettings({}, {});
    const deepseek = fields.find(field => field.name === 'DEEPSEEK_API_KEY');

    assert.equal(deepseek.provider, 'DeepSeek');
    assert.match(deepseek.label, /提示词优化/);
});

test('设置接口不再接受 Gemini 与 OpenAI API Key 写入或清除', () => {
    const libraryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twitcanva-api-hidden-'));
    const current = { GEMINI_API_KEY: 'legacy-gemini', OPENAI_API_KEY: 'legacy-openai' };
    const saved = saveApiKeyOverrides(libraryDir, current, {
        GEMINI_API_KEY: 'new-gemini',
        OPENAI_API_KEY: 'new-openai'
    }, ['GEMINI_API_KEY', 'OPENAI_API_KEY']);

    assert.equal(saved.GEMINI_API_KEY, 'legacy-gemini');
    assert.equal(saved.OPENAI_API_KEY, 'legacy-openai');
    fs.rmSync(libraryDir, { recursive: true, force: true });
});
