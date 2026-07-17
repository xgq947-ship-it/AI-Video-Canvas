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
    const saved = saveApiKeyOverrides(libraryDir, { KLING_API_KEY: 'manual-12345678' }, {}, ['KLING_API_KEY']);
    const fields = describeApiKeySettings({ KLING_API_KEY: 'env-87654321' }, saved);
    const kling = fields.find(field => field.name === 'KLING_API_KEY');

    assert.equal(kling.source, 'environment');
    assert.equal(kling.configured, true);
    assert.equal(kling.maskedValue, '••••••••4321');
    assert.equal(JSON.stringify(fields).includes('env-87654321'), false);
    fs.rmSync(libraryDir, { recursive: true, force: true });
});
