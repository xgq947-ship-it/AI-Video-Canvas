/**
 * 本机 API 密钥存储。
 * 文件位于已被 Git 忽略的 library/config 下，只向前端返回掩码和配置状态。
 */

import fs from 'fs';
import path from 'path';

export const API_KEY_FIELDS = [
    { name: 'DEEPSEEK_API_KEY', provider: 'DeepSeek', label: 'DeepSeek API Key（提示词优化）', secret: true },
    { name: 'GEMINI_API_KEY', provider: 'Google', label: 'Gemini / Veo API Key', secret: true },
    { name: 'OPENAI_API_KEY', provider: 'OpenAI', label: 'OpenAI API Key', secret: true },
    { name: 'ARK_API_KEY', provider: 'Seedance 2.0', label: '火山方舟 ARK API Key（中国区）', secret: true }
];

const ALLOWED_FIELDS = new Set(API_KEY_FIELDS.map(field => field.name));

export function getApiKeyConfigPath(libraryDir) {
    return path.join(libraryDir, 'config', 'api-keys.json');
}

export function loadApiKeyOverrides(libraryDir) {
    const filePath = getApiKeyConfigPath(libraryDir);
    if (!fs.existsSync(filePath)) return {};

    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return Object.fromEntries(
            Object.entries(parsed).filter(([name, value]) => ALLOWED_FIELDS.has(name) && typeof value === 'string' && value.trim())
        );
    } catch (error) {
        console.error('[API 设置] 读取本机密钥配置失败：', error.message);
        return {};
    }
}

export function saveApiKeyOverrides(libraryDir, current, values = {}, clear = []) {
    const next = { ...current };

    for (const [name, value] of Object.entries(values)) {
        if (!ALLOWED_FIELDS.has(name) || typeof value !== 'string') continue;
        const trimmed = value.trim();
        if (trimmed) next[name] = trimmed;
    }

    for (const name of clear) {
        if (ALLOWED_FIELDS.has(name)) delete next[name];
    }

    const filePath = getApiKeyConfigPath(libraryDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    // 仅属主可读写：这个文件里是明文密钥。
    // 注意 Windows：NTFS 没有 POSIX 权限位，chmod 基本是空操作，
    // 实际权限由该文件所在目录（用户目录下的 library/config）的 ACL 继承决定。
    // 因此在 Windows 上不要依赖这里的 0o600 做安全保证。
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2), { mode: 0o600 });
    if (process.platform !== 'win32') {
        fs.chmodSync(filePath, 0o600);
    }
    return next;
}

export function applyApiKeysToApp(app, environment, overrides) {
    for (const field of API_KEY_FIELDS) {
        app.locals[field.name] = overrides[field.name] || environment[field.name] || '';
    }
}

function maskSecret(value) {
    if (!value) return '';
    const tail = value.slice(-4);
    return `••••••••${tail}`;
}

export function describeApiKeySettings(environment, overrides) {
    return API_KEY_FIELDS.map(field => {
        const manualValue = overrides[field.name];
        const environmentValue = environment[field.name];
        const value = manualValue || environmentValue || '';
        return {
            ...field,
            configured: Boolean(value),
            source: manualValue ? 'manual' : environmentValue ? 'environment' : 'none',
            maskedValue: value ? maskSecret(value) : ''
        };
    });
}
