import express from 'express';
import {
    applyApiKeysToApp,
    describeApiKeySettings,
    loadApiKeyOverrides,
    saveApiKeyOverrides
} from '../services/apiKeyStore.js';
import { listPromptOptimizerProviders } from '../services/promptOptimizerProviders.js';
import {
    applyOptimizerPreferenceToApp,
    describeOptimizerSettings,
    loadOptimizerPreference,
    saveOptimizerPreference
} from '../services/optimizerPreference.js';
import { browserSessionState } from '../services/browserSessionState.js';
import {
    applyWebExecutionPreferenceToApp,
    describeWebExecutionSettings,
    loadWebExecutionPreference,
    saveWebExecutionPreference,
    WEB_HTTP_PROVIDER_IDS,
    WEB_HTTP_PROVIDER_LABELS
} from '../services/webhttp/index.js';
import { getModelRegistry, invalidateModelRegistryCache } from '../services/webhttp/registry.js';
import {
    checkAllWebAuthStatus,
    describeAuthStatus,
    persistAuthStatus,
    toBrowserSessionState
} from '../services/webhttp/auth.js';

const router = express.Router();

router.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!origin) return next();

    try {
        const hostname = new URL(origin).hostname;
        if (['localhost', '127.0.0.1', '::1'].includes(hostname)) return next();
    } catch {
        // 非法来源统一拒绝。
    }

    return res.status(403).json({ error: 'API 配置只允许从本机工作台访问' });
});

router.get('/api-keys', (req, res) => {
    const libraryDir = req.app.locals.LIBRARY_DIR;
    const overrides = loadApiKeyOverrides(libraryDir);
    res.json({ fields: describeApiKeySettings(process.env, overrides) });
});

router.post('/api-keys', (req, res) => {
    try {
        const libraryDir = req.app.locals.LIBRARY_DIR;
        const current = loadApiKeyOverrides(libraryDir);
        const next = saveApiKeyOverrides(
            libraryDir,
            current,
            req.body?.values || {},
            Array.isArray(req.body?.clear) ? req.body.clear : []
        );
        applyApiKeysToApp(req.app, process.env, next);
        res.json({
            success: true,
            fields: describeApiKeySettings(process.env, next)
        });
    } catch (error) {
        console.error('[API 设置] 保存失败：', error);
        res.status(500).json({ error: error.message || 'API 密钥保存失败' });
    }
});

// —— 提示词优化后端（下拉选择）——
router.get('/optimizer', (req, res) => {
    const codexStatus = req.app.locals.CODEX_INTEGRATION?.getStatus();
    const providers = listPromptOptimizerProviders().map(provider => ({
        ...provider,
        // CLI 后端无需密钥；API 后端标注其密钥是否已配置，供 UI 提示。
        keyConfigured: provider.apiKeyField ? Boolean(req.app.locals[provider.apiKeyField]) : true,
        available: provider.id === 'codex-cli'
            ? Boolean(codexStatus?.available && codexStatus?.authenticated)
            : provider.id === 'gemini-web'
                ? browserSessionState.get('gemini-web').state === 'authenticated'
                : true,
        unavailableHint: provider.id === 'codex-cli' && !codexStatus?.authenticated
            ? (codexStatus?.error || '请先配置并登录 Codex CLI')
            : provider.id === 'gemini-web'
                ? '请先在 Browser Automation 中登录并验证 Gemini Web'
                : ''
    }));
    res.json({ providers, current: describeOptimizerSettings(req.app) });
});

router.post('/optimizer', (req, res) => {
    try {
        const libraryDir = req.app.locals.LIBRARY_DIR;
        const saved = saveOptimizerPreference(libraryDir, {
            provider: req.body?.provider,
            model: typeof req.body?.model === 'string' ? req.body.model : undefined
        });
        applyOptimizerPreferenceToApp(req.app, process.env, loadOptimizerPreference(libraryDir));
        res.json({ success: true, current: describeOptimizerSettings(req.app), saved });
    } catch (error) {
        console.error('[优化后端] 保存失败：', error);
        res.status(400).json({ error: error.message || '优化后端保存失败' });
    }
});

// —— Web Provider 执行模式（auto / http / browser）——
router.get('/web-execution', (req, res) => {
    res.json(describeWebExecutionSettings(req.app));
});

router.post('/web-execution', (req, res) => {
    try {
        const libraryDir = req.app.locals.LIBRARY_DIR;
        saveWebExecutionPreference(libraryDir, {
            provider: req.body?.provider,
            mode: req.body?.mode
        });
        applyWebExecutionPreferenceToApp(req.app, process.env, loadWebExecutionPreference(libraryDir));
        res.json({ success: true, current: describeWebExecutionSettings(req.app) });
    } catch (error) {
        res.status(400).json({ error: error.message || '执行模式保存失败' });
    }
});

/**
 * 三个 Web 平台的登录状态（HTTP-first）。
 *
 * 判断只来自平台自己返回的数据：
 *   Gemini  GET /app                 → WIZ_global_data.S06Grb + SNlM0e
 *   即梦    GET /ai-tool/generate    → window.__isLogined
 *   Flow    GET /fx/api/auth/session → user.email + access_token
 * 不看头像、不看登录按钮、不看任何 selector，也不生成内容、不消耗额度。
 */
router.get('/web-sessions', async (req, res) => {
    const stored = browserSessionState.list();
    const describe = provider => ({
        id: provider,
        label: WEB_HTTP_PROVIDER_LABELS[provider],
        state: stored[provider]?.state || 'unknown',
        updatedAt: stored[provider]?.updatedAt || null,
        message: stored[provider]?.message || ''
    });

    // 默认只回读已持久化的状态：打开设置页不该顺手唤醒 Chrome。
    // `?probe=1` 才真的发起 HTTP 检测（对应界面上的「重新检测」）。
    if (req.query.probe !== '1') {
        return res.json({ providers: WEB_HTTP_PROVIDER_IDS.map(describe), probed: false });
    }

    try {
        const statuses = await checkAllWebAuthStatus({ force: true, providers: WEB_HTTP_PROVIDER_IDS });
        const providers = statuses.map(status => {
            persistAuthStatus(browserSessionState, status);
            return {
                id: status.provider,
                label: WEB_HTTP_PROVIDER_LABELS[status.provider],
                // 六态原样透出给界面；持久化时才收敛到会话状态词表。
                status: status.status,
                state: toBrowserSessionState(status.status),
                source: status.source,
                checkedAt: status.checkedAt,
                updatedAt: new Date(status.checkedAt).toISOString(),
                expiresAt: status.expiresAt || null,
                // 账号信息只在响应里出现，不落盘。
                account: status.email || status.name || status.userId || '',
                message: status.message || describeAuthStatus(status)
            };
        });
        res.json({ providers, probed: true });
    } catch (error) {
        res.status(500).json({ error: error.message || '登录状态检测失败' });
    }
});

/** 统一模型注册表：图片/视频节点、产品短视频节点与设置页共用这一个数据源。 */
router.get('/models', async (req, res) => {
    try {
        if (req.query.refresh === '1') invalidateModelRegistryCache();
        res.json(await getModelRegistry({ refresh: req.query.refresh === '1' }));
    } catch (error) {
        res.status(500).json({ error: error.message || '读取模型注册表失败' });
    }
});

router.get('/codex', (req, res) => {
    try {
        const integration = req.app.locals.CODEX_INTEGRATION;
        if (!integration) return res.status(503).json({ error: 'Codex 服务不可用' });
        res.json(integration.getStatus({
            force: req.query.refresh === '1'
        }));
    } catch (error) {
        res.status(500).json({ error: error.message || '读取 Codex 状态失败' });
    }
});

router.post('/codex', (req, res) => {
    try {
        const integration = req.app.locals.CODEX_INTEGRATION;
        if (!integration) return res.status(503).json({ error: 'Codex 服务不可用' });
        res.json(integration.setCliPath(req.body?.cliPath || ''));
    } catch (error) {
        res.status(400).json({ error: error.message || '保存 Codex 配置失败' });
    }
});

router.post('/codex/login', (req, res) => {
    try {
        const integration = req.app.locals.CODEX_INTEGRATION;
        if (!integration) return res.status(503).json({ error: 'Codex 服务不可用' });
        res.status(202).json(integration.startLogin());
    } catch (error) {
        res.status(400).json({ error: error.message || '启动 Codex 登录失败' });
    }
});

export default router;
