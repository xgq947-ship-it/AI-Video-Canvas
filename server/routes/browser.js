/**
 * routes/browser.js
 *
 * 运行时能力探测、共享浏览器登录态检查与登录窗口。
 * 从 server/index.js 原样搬出，行为未做改动。
 */

import express from 'express';

import { browserSessionState } from '../services/browserSessionState.js';
import { assertBrowserWorkflowIdle, enqueueBrowserWorkflow } from '../services/googleFlowWorkflowQueue.js';
import {
    BROWSER_MODELS_SETUP_HINT,
    browserRuntimeStatus,
    runOpsCli
} from '../services/opsCliRunner.js';
import {
    WEB_AUTH_PROVIDERS,
    checkAllWebAuthStatus,
    describeAuthStatus,
    peekWebAuthStatus,
    persistAuthStatus
} from '../services/webhttp/auth.js';

const router = express.Router();

// 运行时能力探测：前端据此把「需本地配置」的模型置灰，而不是让用户点了才报错。
router.get('/capabilities', (req, res) => {
    const chrome = browserRuntimeStatus();
    res.json({
        // 网页 HTTP 模型仍依赖 server/python 通过 Hub 连接系统共享 Chrome；
        // 未安装时这些模型不可用，但其余官方 API 模型照常工作。
        browserModels: {
            ready: chrome.ready,
            chrome,
            sessions: browserSessionState.list(),
            models: [
                'google-flow-omni-flash',
                'google-flow-veo-3-1-lite',
                'google-flow-veo-3-1-fast',
                'google-flow-veo-3-1-quality',
                'google-flow-nano-banana-pro',
                'google-flow-nano-banana-2',
                'google-flow-nano-banana-2-lite',
                'jimeng-image-5-0-pro',
                'jimeng-image-5-0-lite',
                'jimeng-seedance-2-0-mini',
                'jimeng-seedance-2-0-fast-standard',
                'jimeng-seedance-2-0-standard',
                'jimeng-seedance-2-0',
                'jimeng-seedance-2-0-fast',
                'gemini-web-image',
                'gemini-web-video'
            ],
            setupCommand: null,
            hint: BROWSER_MODELS_SETUP_HINT
        },
        platform: process.platform
    });
});

router.post('/browser-sessions/:provider/reauthenticate', async (req, res) => {
    const provider = String(req.params.provider || '');
    if (!['google-flow', 'jimeng', 'gemini-web'].includes(provider)) {
        return res.status(400).json({ error: '不支持的浏览器登录平台' });
    }
    try {
        assertBrowserWorkflowIdle('打开登录窗口');
        const { data } = await enqueueBrowserWorkflow(() => runOpsCli({
            args: ['browser', 'login', '--provider', provider],
            timeoutMs: 90_000,
            label: `${provider} 登录`,
            initialSessionState: 'reauthenticating',
            successSessionState: 'reauthenticating'
        }), { label: `${provider} 登录` });
        res.json({
            success: true,
            provider,
            session: browserSessionState.get(provider),
            ...data
        });
    } catch (error) {
        res.status(error.status || 500).json({
            error: error.message,
            code: error.code || 'BROWSER_LOGIN_FAILED',
            session: browserSessionState.get(provider)
        });
    }
});

router.post('/browser-sessions/check', async (req, res) => {
    const requested = Array.isArray(req.body?.providers) ? req.body.providers.map(String) : [];
    const providers = requested.length ? requested : ['jimeng', 'google-flow', 'gemini-web'];
    const force = req.body?.force === true;
    if (providers.some(provider => !WEB_AUTH_PROVIDERS.includes(provider))) {
        return res.status(400).json({ error: '包含不支持的浏览器登录平台' });
    }

    // 登录检测现在是纯 HTTP：三个平台各拉一次自己的会话接口，读平台返回的数据判断。
    // 不看头像、不看登录按钮、不看任何 selector，也不生成内容、不消耗积分。
    //
    // 刻意不再套那层浏览器串行队列：bridge 内部已按 provider 串行，外面再排一层
    // 只会让「重新检测」在生成任务占用队列时直接 409 —— 而检测本身根本不冲突。
    // 原来那条「忙碌判定必须早于写 checking」的约束依然成立，做法是只在真正要发请求
    // 的平台上写 checking，且失败时立刻落到确定状态，不会卡在「检查中」。
    const toProbe = providers.filter(provider => force || !peekWebAuthStatus(provider));
    for (const provider of toProbe) browserSessionState.transition(provider, 'checking');

    try {
        const statuses = await checkAllWebAuthStatus({ force, providers });
        const results = {};
        for (const status of statuses) {
            persistAuthStatus(browserSessionState, status);
            results[status.provider] = {
                // 兼容旧调用方（启动引导、设置页）读的 authenticated / reason / message。
                authenticated: status.status === 'logged-in',
                reason: status.status === 'logged-in' ? 'authenticated'
                    : status.status === 'logged-out' || status.status === 'expired' ? 'not-authenticated'
                        : 'unconfirmed',
                evidence: status.reason || 'http',
                message: status.message || describeAuthStatus(status),
                status: status.status,
                source: status.source,
                checkedAt: status.checkedAt,
                fromCache: Boolean(status.fromCache)
            };
        }
        res.json({ success: true, results, sessions: browserSessionState.list() });
    } catch (error) {
        for (const provider of toProbe) {
            browserSessionState.transition(provider, 'unknown', {
                errorCode: error.code || 'LOGIN_PROBE_FAILED',
                message: error.message
            });
        }
        res.status(500).json({
            error: error.message,
            code: error.code || 'LOGIN_PROBE_FAILED',
            sessions: browserSessionState.list()
        });
    }
});

router.post('/browser/open', async (_req, res) => {
    try {
        // 生成期间直接拒绝，不排队：排队会让按钮一直转到生成结束（队列没有等待超时），
        // 真排到了又会把 Chrome 切成有头模式，打断正在跑的生成。
        assertBrowserWorkflowIdle('打开浏览器窗口');
        const { data } = await enqueueBrowserWorkflow(() => runOpsCli({
            args: ['browser', 'open'],
            timeoutMs: 30_000,
            label: '打开系统共享 Chrome'
        }), { label: '打开系统共享 Chrome' });
        res.json({ success: true, ...data });
    } catch (error) {
        res.status(error.status || 500).json({
            error: error.message,
            code: error.code || 'BROWSER_OPEN_FAILED'
        });
    }
});

export default router;
