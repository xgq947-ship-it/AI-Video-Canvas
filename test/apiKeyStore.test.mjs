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
    assert.equal(fs.statSync(path.join(libraryDir, 'config', 'api-keys.json')).mode & 0o777, 0o600);
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
});

test('提示词优化可单独配置 DeepSeek API 密钥', () => {
    const fields = describeApiKeySettings({}, {});
    const deepseek = fields.find(field => field.name === 'DEEPSEEK_API_KEY');

    assert.equal(deepseek.provider, 'DeepSeek');
    assert.match(deepseek.label, /提示词优化/);
});
