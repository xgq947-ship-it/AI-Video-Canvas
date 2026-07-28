/**
 * Per-provider execution mode for the Web HTTP channels.
 *
 *   auto  HTTP，提交前失败会重试一次（认证类失败先走 Session 恢复）。
 *   http  HTTP，不额外重试。
 *
 * 曾经的 `browser`（DOM 点击生成）已整体删除：浏览器只负责登录与会话上下文。
 * 旧配置里残留的 "browser" 会被规范化成 auto，不影响已有用户数据。
 *
 * Stored next to the optimizer preference (library/config/), which is already
 * git-ignored user data. Only the mode is persisted — never a token or cookie.
 */

import fs from 'node:fs';
import path from 'node:path';

export const WEB_EXECUTION_MODES = Object.freeze(['auto', 'http']);
export const WEB_HTTP_PROVIDER_IDS = Object.freeze(['gemini-web', 'jimeng', 'google-flow']);
export const DEFAULT_WEB_EXECUTION_MODE = 'auto';

export const WEB_HTTP_PROVIDER_LABELS = Object.freeze({
    'gemini-web': 'Gemini Web',
    jimeng: '即梦 Web',
    'google-flow': 'Google Flow'
});

export function getWebExecutionConfigPath(libraryDir) {
    return path.join(libraryDir, 'config', 'web-execution.json');
}

function normalizeMode(value) {
    const mode = String(value || '').trim().toLowerCase();
    // 兼容旧配置：browser 模式已下线，读到时按默认 auto 处理，而不是报错让设置页打不开。
    if (mode === 'browser') return DEFAULT_WEB_EXECUTION_MODE;
    return WEB_EXECUTION_MODES.includes(mode) ? mode : null;
}

export function loadWebExecutionPreference(libraryDir) {
    const filePath = getWebExecutionConfigPath(libraryDir);
    if (!fs.existsSync(filePath)) return { modes: {} };
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const modes = {};
        for (const provider of WEB_HTTP_PROVIDER_IDS) {
            const mode = normalizeMode(parsed?.modes?.[provider]);
            if (mode) modes[provider] = mode;
        }
        return { modes };
    } catch (error) {
        console.error('[Web 执行模式] 读取偏好失败：', error.message);
        return { modes: {} };
    }
}

export function saveWebExecutionPreference(libraryDir, { provider, mode } = {}) {
    if (!WEB_HTTP_PROVIDER_IDS.includes(provider)) {
        throw new Error(`未知的 Web 平台：${provider}`);
    }
    const normalized = normalizeMode(mode);
    if (!normalized) {
        throw new Error(`执行模式只支持 ${WEB_EXECUTION_MODES.join(' / ')}`);
    }
    const current = loadWebExecutionPreference(libraryDir);
    const next = { modes: { ...current.modes, [provider]: normalized } };

    const filePath = getWebExecutionConfigPath(libraryDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2), { mode: 0o600 });
    return next;
}

/**
 * Environment override exists so a support session can pin a mode without
 * touching the user's saved preference: EVAN_WEB_MODE_JIMENG=browser etc.
 */
function environmentMode(environment, provider) {
    const key = `EVAN_WEB_MODE_${provider.toUpperCase().replace(/-/g, '_')}`;
    return normalizeMode(environment?.[key]);
}

export function applyWebExecutionPreferenceToApp(app, environment, preference) {
    const modes = {};
    for (const provider of WEB_HTTP_PROVIDER_IDS) {
        modes[provider] = preference?.modes?.[provider]
            || environmentMode(environment, provider)
            || DEFAULT_WEB_EXECUTION_MODE;
    }
    app.locals.WEB_EXECUTION_MODES = modes;
    return modes;
}

export function resolveWebExecutionMode(app, provider) {
    return app?.locals?.WEB_EXECUTION_MODES?.[provider] || DEFAULT_WEB_EXECUTION_MODE;
}

export function describeWebExecutionSettings(app) {
    const modes = app?.locals?.WEB_EXECUTION_MODES || {};
    return {
        options: [...WEB_EXECUTION_MODES],
        providers: WEB_HTTP_PROVIDER_IDS.map(provider => ({
            id: provider,
            label: WEB_HTTP_PROVIDER_LABELS[provider],
            mode: modes[provider] || DEFAULT_WEB_EXECUTION_MODE
        }))
    };
}
