/**
 * 提示词优化后端的模型目录。
 *
 * 目录和实际调用分开：模型目录可以失败或过期，但不会阻断现有的手动模型 ID。
 * DeepSeek 提供官方 /models 接口，按当前 API Key 同步；Claude/Codex CLI 的登录态
 * 没有稳定的模型枚举接口，因此只提供 CLI 官方别名/常用 ID，并保留自定义入口。
 */

import { PROMPT_OPTIMIZER_PROVIDERS } from './promptOptimizerProviders.js';

const DEEPSEEK_MODELS_URL = 'https://api.deepseek.com/models';
const MODEL_CATALOG_CACHE_TTL_MS = 10 * 60_000;
const MODEL_CATALOG_TIMEOUT_MS = 6_000;

const DEEPSEEK_FALLBACK_MODELS = Object.freeze([
    { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' }
]);

const BUILTIN_MODEL_CATALOGS = Object.freeze({
    'claude-cli': {
        source: 'cli-alias',
        syncSupported: false,
        models: Object.freeze([
            { id: 'sonnet', label: 'Sonnet（CLI 最新别名）' },
            { id: 'opus', label: 'Opus（CLI 最新别名）' }
        ]),
        message: 'Claude CLI 不提供稳定的模型目录接口；使用别名会随 CLI 更新到对应最新版本。'
    },
    'codex-cli': {
        source: 'cli-known',
        syncSupported: false,
        models: Object.freeze([
            { id: 'gpt-5.6', label: 'GPT-5.6（别名）' },
            { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
            { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
            { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
            { id: 'codex-mini-latest', label: 'Codex Mini Latest' }
        ]),
        message: 'Codex CLI 不提供稳定的登录态模型目录；最终可用性由本机 CLI 和账号决定。'
    },
    'gemini-web': {
        source: 'web-current',
        syncSupported: false,
        models: Object.freeze([
            { id: 'Gemini Web', label: 'Gemini Web 当前网页模型' }
        ]),
        message: 'Gemini Web 通过网页当前模型运行，请在 Gemini 页面选择模型；此请求不接收模型 ID。'
    }
});

let cache = null;
let cachedAt = 0;
let inflight = null;

function cloneModels(models) {
    return models.map(model => ({ ...model }));
}

function normalizeModelId(value) {
    const id = String(value || '').trim();
    return id.length > 0 && id.length <= 200 ? id : '';
}

function labelForModel(id) {
    const labels = {
        'deepseek-v4-pro': 'DeepSeek V4 Pro',
        'deepseek-v4-flash': 'DeepSeek V4 Flash'
    };
    return labels[id] || id;
}

function normalizeDeepSeekModels(payload) {
    const models = Array.isArray(payload?.data)
        ? payload.data
            .map(item => normalizeModelId(item?.id))
            .filter(Boolean)
            .map(id => ({ id, label: labelForModel(id) }))
        : [];
    const seen = new Set();
    return models.filter(model => {
        if (seen.has(model.id)) return false;
        seen.add(model.id);
        return true;
    });
}

function fallbackCatalog(providerId, overrides = {}) {
    const provider = PROMPT_OPTIMIZER_PROVIDERS[providerId];
    const builtin = BUILTIN_MODEL_CATALOGS[providerId];
    const models = providerId === 'deepseek'
        ? cloneModels(DEEPSEEK_FALLBACK_MODELS)
        : cloneModels(builtin?.models || []);
    return {
        models,
        discovered: false,
        syncSupported: providerId === 'deepseek',
        source: providerId === 'deepseek' ? 'builtin' : (builtin?.source || 'builtin'),
        message: overrides.message
            || builtin?.message
            || (providerId === 'deepseek'
                ? '配置 DeepSeek API Key 后可自动同步当前账号可用模型。'
                : ''),
        updatedAt: null,
        defaultModel: provider?.defaultModel || ''
    };
}

async function discoverDeepSeekModels(apiKey, signal) {
    if (!apiKey) {
        return fallbackCatalog('deepseek');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MODEL_CATALOG_TIMEOUT_MS);
    const abortFromCaller = () => controller.abort();
    signal?.addEventListener('abort', abortFromCaller, { once: true });

    try {
        const response = await fetch(DEEPSEEK_MODELS_URL, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: 'application/json'
            },
            signal: controller.signal
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const models = normalizeDeepSeekModels(payload);
        if (models.length === 0) {
            throw new Error('响应中没有可用模型');
        }

        return {
            ...fallbackCatalog('deepseek'),
            models,
            discovered: true,
            source: 'deepseek-api',
            message: '已从 DeepSeek 官方 API 同步当前可用模型。',
            updatedAt: new Date().toISOString()
        };
    } catch (error) {
        console.warn(`[优化模型] DeepSeek 模型同步失败：${error.message}`);
        return fallbackCatalog('deepseek', {
            message: 'DeepSeek 模型同步失败，当前使用内置列表；仍可手动填写模型 ID。'
        });
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abortFromCaller);
    }
}

function getBuiltinCatalog(providerId) {
    const catalog = fallbackCatalog(providerId);
    return {
        ...catalog,
        updatedAt: new Date().toISOString()
    };
}

export function invalidatePromptOptimizerModelCatalogCache() {
    cache = null;
    cachedAt = 0;
}

/**
 * 返回设置页使用的模型目录，不返回任何密钥或 CLI 登录资料。
 * apiKeys 只接受服务端已经解析好的密钥值，调用方不得把它透传给前端。
 */
export async function getPromptOptimizerModelCatalog({
    refresh = false,
    apiKeys = {},
    signal
} = {}) {
    if (!refresh && cache && Date.now() - cachedAt < MODEL_CATALOG_CACHE_TTL_MS) {
        return cache;
    }
    if (inflight) return inflight;

    inflight = (async () => {
        const providers = {};
        providers.deepseek = await discoverDeepSeekModels(apiKeys.deepseek || '', signal);
        for (const providerId of Object.keys(PROMPT_OPTIMIZER_PROVIDERS)) {
            if (providerId === 'deepseek') continue;
            providers[providerId] = getBuiltinCatalog(providerId);
        }

        const result = {
            updatedAt: new Date().toISOString(),
            providers
        };
        cache = result;
        cachedAt = Date.now();
        return result;
    })().finally(() => {
        inflight = null;
    });

    return inflight;
}

export { DEEPSEEK_MODELS_URL, DEEPSEEK_FALLBACK_MODELS, BUILTIN_MODEL_CATALOGS };
