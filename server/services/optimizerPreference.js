/**
 * 提示词优化后端偏好存储。
 * 存到已被 Git 忽略的 library/config/optimizer.json，供“配置”弹窗下拉持久化选择。
 *
 * 生效优先级（applyOptimizerPreferenceToApp）：
 *   1. 已保存的偏好（UI 下拉）—— 一经设置即为准
 *   2. 环境变量 PROMPT_OPTIMIZER_PROVIDER / PROMPT_OPTIMIZER_MODEL —— 作为初始默认
 *   3. 内置默认 deepseek
 */

import fs from 'fs';
import path from 'path';
import { PROMPT_OPTIMIZER_PROVIDERS } from './promptOptimizerProviders.js';

const DEFAULT_PROVIDER = 'deepseek';

export function getOptimizerConfigPath(libraryDir) {
    return path.join(libraryDir, 'config', 'optimizer.json');
}

export function loadOptimizerPreference(libraryDir) {
    const filePath = getOptimizerConfigPath(libraryDir);
    if (!fs.existsSync(filePath)) return {};
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const pref = {};
        if (typeof parsed.provider === 'string' && PROMPT_OPTIMIZER_PROVIDERS[parsed.provider]) {
            pref.provider = parsed.provider;
        }
        if (typeof parsed.model === 'string' && parsed.model.trim()) {
            pref.model = parsed.model.trim();
        }
        return pref;
    } catch (error) {
        console.error('[优化后端] 读取偏好失败：', error.message);
        return {};
    }
}

export function saveOptimizerPreference(libraryDir, { provider, model } = {}) {
    if (provider !== undefined && !PROMPT_OPTIMIZER_PROVIDERS[provider]) {
        throw new Error(`未知的提示词优化后端：${provider}`);
    }
    const next = {};
    if (provider) next.provider = provider;
    if (typeof model === 'string' && model.trim()) next.model = model.trim();

    const filePath = getOptimizerConfigPath(libraryDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2), { mode: 0o600 });
    return next;
}

export function applyOptimizerPreferenceToApp(app, environment, preference) {
    const provider = preference.provider
        || (environment.PROMPT_OPTIMIZER_PROVIDER || '').toLowerCase()
        || DEFAULT_PROVIDER;
    const model = preference.model || environment.PROMPT_OPTIMIZER_MODEL || '';
    app.locals.PROMPT_OPTIMIZER_PROVIDER = PROMPT_OPTIMIZER_PROVIDERS[provider] ? provider : DEFAULT_PROVIDER;
    app.locals.PROMPT_OPTIMIZER_MODEL = model;
}

// 供设置界面读取当前生效值。
export function describeOptimizerSettings(app) {
    return {
        provider: app.locals.PROMPT_OPTIMIZER_PROVIDER || DEFAULT_PROVIDER,
        model: app.locals.PROMPT_OPTIMIZER_MODEL || ''
    };
}
