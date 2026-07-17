import express from 'express';
import {
    applyApiKeysToApp,
    describeApiKeySettings,
    loadApiKeyOverrides,
    saveApiKeyOverrides
} from '../services/apiKeyStore.js';

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

export default router;
