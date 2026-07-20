/**
 * 提示词优化后端偏好存储。
 * 存到已被 Git 忽略的 library/config/optimizer.json，供“配置”弹窗下拉持久化选择。
 *
 * 文件结构：{ provider: 当前后端, models: { 后端id: 模型覆盖值 } }
 * 模型覆盖按后端各自记忆（每个后端留空则用其内置默认），互不干扰。
 *
 * 生效优先级（applyOptimizerPreferenceToApp）：
 *   1. 已保存的偏好（UI 下拉 / 模型框）—— 一经设置即为准
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
    if (!fs.existsSync(filePath)) return { models: {} };
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const pref = { models: {} };
        if (typeof parsed.provider === 'string' && PROMPT_OPTIMIZER_PROVIDERS[parsed.provider]) {
            pref.provider = parsed.provider;
        }
        // 新结构：按后端记忆模型
        if (parsed.models && typeof parsed.models === 'object') {
            for (const [id, model] of Object.entries(parsed.models)) {
                if (PROMPT_OPTIMIZER_PROVIDERS[id] && typeof model === 'string' && model.trim()) {
                    pref.models[id] = model.trim();
                }
            }
        }
        // 兼容旧结构：单一 model 字段挂到当时的 provider 名下
        if (typeof parsed.model === 'string' && parsed.model.trim() && pref.provider) {
            pref.models[pref.provider] = pref.models[pref.provider] || parsed.model.trim();
        }
        return pref;
    } catch (error) {
        console.error('[优化后端] 读取偏好失败：', error.message);
        return { models: {} };
    }
}

// 每次保存只更新“当前后端”的模型覆盖，其它后端的记忆保持不变。
export function saveOptimizerPreference(libraryDir, { provider, model } = {}) {
    if (provider !== undefined && !PROMPT_OPTIMIZER_PROVIDERS[provider]) {
        throw new Error(`未知的提示词优化后端：${provider}`);
    }
    const current = loadOptimizerPreference(libraryDir);
    const models = { ...current.models };
    if (provider) {
        if (typeof model === 'string' && model.trim()) models[provider] = model.trim();
        else delete models[provider];
    }
    const next = {
        provider: provider || current.provider || DEFAULT_PROVIDER,
        models
    };

    const filePath = getOptimizerConfigPath(libraryDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2), { mode: 0o600 });
    return next;
}

export function applyOptimizerPreferenceToApp(app, environment, preference) {
    const provider = preference.provider
        || (environment.PROMPT_OPTIMIZER_PROVIDER || '').toLowerCase()
        || DEFAULT_PROVIDER;
    const activeProvider = PROMPT_OPTIMIZER_PROVIDERS[provider] ? provider : DEFAULT_PROVIDER;
    const model = preference.models?.[activeProvider] || environment.PROMPT_OPTIMIZER_MODEL || '';
    app.locals.PROMPT_OPTIMIZER_PROVIDER = activeProvider;
    app.locals.PROMPT_OPTIMIZER_MODEL = model;
    app.locals.PROMPT_OPTIMIZER_MODELS = preference.models || {};
}

// 供设置界面读取当前生效值 + 每个后端已记忆的模型覆盖。
export function describeOptimizerSettings(app) {
    return {
        provider: app.locals.PROMPT_OPTIMIZER_PROVIDER || DEFAULT_PROVIDER,
        model: app.locals.PROMPT_OPTIMIZER_MODEL || '',
        models: app.locals.PROMPT_OPTIMIZER_MODELS || {}
    };
}
