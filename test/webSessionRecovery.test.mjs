/**
 * Session 生命周期与「登录失效 → 任务挂起 → 登录后恢复」的回归测试。
 *
 * 核心约束只有一条，但很硬：**只有还没提交出去的任务才可以重放**。
 * 已提交的任务重放 = 平台再生成一次 = 用户被扣两次费。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { cookieHeaderForUrl, getSessionManager } from '../server/services/webhttp/sessionManager.js';
import {
    WAITING_AUTH,
    clearPendingAuthTasks,
    listPendingAuthTasks,
    runWithAuthRecovery
} from '../server/services/webhttp/authRecovery.js';
import { WebProviderError } from '../server/services/webhttp/errors.js';

// ---------------------------------------------------------------------------
// Cookie 选择（移植自 Ops-Cli 的 _cookie_header_for_url）
// ---------------------------------------------------------------------------

test('Cookie 按 domain / path / secure 过滤，不把别的站点的值带出去', () => {
    const cookies = [
        { name: 'a', value: '1', domain: '.labs.google', path: '/' },
        { name: 'b', value: '2', domain: 'jimeng.jianying.com', path: '/' },
        { name: 'c', value: '3', domain: '.labs.google', path: '/fx', secure: true }
    ];
    const header = cookieHeaderForUrl(cookies, 'https://labs.google/fx/api/auth/session');
    assert.match(header, /\ba=1\b/);
    assert.match(header, /\bc=3\b/);
    assert.equal(/b=2/.test(header), false, '别的站点的 Cookie 不能被带上');
});

test('labs.google 不会拿到 google.com 的 Cookie（不是它的子域）', () => {
    // 看着像同一家，其实是两个注册域。按后缀粗筛会把 Google 账号 Cookie
    // 错送到 labs.google 的请求上。
    const cookies = [{ name: 'SAPISID', value: 'x', domain: '.google.com', path: '/' }];
    assert.equal(cookieHeaderForUrl(cookies, 'https://labs.google/fx/api/auth/session'), '');
    assert.equal(cookieHeaderForUrl(cookies, 'https://myaccount.google.com/'), 'SAPISID=x');
});

test('同名 Cookie 按路径更长者优先', () => {
    // 粗筛实现会把范围更宽、值更旧的那个送出去。
    const cookies = [
        { name: 'SID', value: 'wide', domain: '.labs.google', path: '/' },
        { name: 'SID', value: 'narrow', domain: '.labs.google', path: '/fx' }
    ];
    const header = cookieHeaderForUrl(cookies, 'https://labs.google/fx/api/auth/session');
    assert.ok(header.indexOf('SID=narrow') < header.indexOf('SID=wide'),
        '更精确的路径必须排在前面');
});

test('secure Cookie 不会出现在 http 请求上', () => {
    const cookies = [{ name: 's', value: '1', domain: 'example.com', path: '/', secure: true }];
    assert.equal(cookieHeaderForUrl(cookies, 'http://example.com/x'), '');
    assert.equal(cookieHeaderForUrl(cookies, 'https://example.com/x'), 's=1');
});

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

test('三个平台共用同一套 Session 接口', () => {
    for (const provider of ['gemini-web', 'jimeng', 'google-flow']) {
        const manager = getSessionManager(provider);
        for (const method of ['checkStatus', 'ensureSession', 'refreshSession', 'getCookies', 'invalidate']) {
            assert.equal(typeof manager[method], 'function', `${provider} 缺少 ${method}`);
        }
    }
    assert.throws(() => getSessionManager('不存在的平台'), /未知的 Web 平台/);
});

// ---------------------------------------------------------------------------
// 任务挂起与恢复
// ---------------------------------------------------------------------------

test('未提交的任务因登录失效被挂起，而不是直接丢掉', async () => {
    clearPendingAuthTasks('jimeng');
    await assert.rejects(
        runWithAuthRecovery({
            provider: 'jimeng',
            label: '即梦图片生成',
            metadata: { prompt: '一只猫' },
            run: () => {
                throw new WebProviderError('登录失效', {
                    provider: 'jimeng', code: 'AUTH_EXPIRED', submitted: false
                });
            }
        }),
        error => /已暂停/.test(error.message) && error.code === 'AUTH_EXPIRED'
    );

    const tasks = listPendingAuthTasks('jimeng');
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].state, WAITING_AUTH);
    assert.equal(tasks[0].label, '即梦图片生成');
    // 列表要能安全返回给前端：不得带上任务体本身。
    assert.equal('run' in tasks[0], false);
    clearPendingAuthTasks('jimeng');
});

test('已提交的任务即使是认证错误也绝不挂起重放', async () => {
    clearPendingAuthTasks('jimeng');
    await assert.rejects(
        runWithAuthRecovery({
            provider: 'jimeng',
            label: '即梦视频生成',
            run: () => {
                throw new WebProviderError('登录中途失效', {
                    provider: 'jimeng', code: 'AUTH_EXPIRED', submitted: true
                });
            }
        }),
        error => error.submitted === true
    );
    // 平台可能已经在生成了，重放等于二次扣费。
    assert.equal(listPendingAuthTasks('jimeng').length, 0);
});

test('非认证类失败原样抛出，不进挂起队列', async () => {
    clearPendingAuthTasks('google-flow');
    await assert.rejects(
        runWithAuthRecovery({
            provider: 'google-flow',
            label: 'Flow 图片生成',
            run: () => { throw new WebProviderError('内容策略', { provider: 'google-flow', code: 'CONTENT_POLICY' }); }
        }),
        error => error.code === 'CONTENT_POLICY'
    );
    assert.equal(listPendingAuthTasks('google-flow').length, 0);
});

test('成功的任务不受影响', async () => {
    const result = await runWithAuthRecovery({
        provider: 'gemini-web',
        label: 'Gemini 图片生成',
        run: () => ({ images: [{ buffer: Buffer.from('x') }] })
    });
    assert.equal(result.images.length, 1);
});

test('挂起队列有上限，不会无限堆积', async () => {
    clearPendingAuthTasks('jimeng');
    for (let index = 0; index < 12; index += 1) {
        await runWithAuthRecovery({
            provider: 'jimeng',
            label: `任务 ${index}`,
            run: () => { throw new WebProviderError('过期', { provider: 'jimeng', code: 'AUTH_EXPIRED', submitted: false }); }
        }).catch(() => {});
    }
    const tasks = listPendingAuthTasks('jimeng');
    assert.ok(tasks.length <= 8, `挂起任务应有上限，当前 ${tasks.length}`);
    // 丢的是最旧的，留下的是最近的。
    assert.equal(tasks.at(-1).label, '任务 11');
    clearPendingAuthTasks('jimeng');
});

// ---------------------------------------------------------------------------
// 结构约束
// ---------------------------------------------------------------------------

test('恢复流程不会退回网页点击生成', () => {
    const source = fs.readFileSync(new URL('../server/services/webhttp/authRecovery.js', import.meta.url), 'utf8');
    assert.equal(/browser:|enqueueBrowserWorkflow|text-to-image/.test(source), false);
});

test('生成入口都接了认证恢复', () => {
    const files = [
        'geminiWebWorkflow', 'googleFlowWorkflow', 'googleFlowImageWorkflow',
        'jimengImageWorkflow', 'jimengVideoWorkflow'
    ];
    for (const name of files) {
        const source = fs.readFileSync(new URL(`../server/services/${name}.js`, import.meta.url), 'utf8');
        assert.match(source, /runWithAuthRecovery/, `${name} 未接入认证恢复`);
    }
});
