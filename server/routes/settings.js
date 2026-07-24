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
            : true,
        unavailableHint: provider.id === 'codex-cli' && !codexStatus?.authenticated
            ? (codexStatus?.error || '请先配置并登录 Codex CLI')
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
