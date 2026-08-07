/**
 * 端到端验证「执行层守卫真的接在真实路由上」，而不只是单测 licenseGuard 本身的逻辑
 * （那部分见 test/licenseGuard.test.mjs）。这里真起一个 Express server，挂载真实的
 * cinematic-director 路由文件，走真实 HTTP 请求。
 *
 * 用空 body 触发 runCinematicDirector 内部的输入校验错误（validateRunInput）来确认
 * 「放行时请求确实进了业务逻辑」，同时不产生任何网络调用——不需要真的生成模型可用。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import cinematicDirectorRoutes from '../server/routes/cinematic-director.js';
import { resetLicenseState, setLicenseState } from '../server/services/licenseGuard.js';

function startTestServer() {
    const app = express();
    app.use(express.json());
    app.use('/api', cinematicDirectorRoutes);
    const server = http.createServer(app);
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
        });
    });
}

test.beforeEach(() => resetLicenseState());

test('默认放行：未加锁时空 body 请求会真的进入业务逻辑（拿到输入校验错误，不是 403）', async () => {
    const { server, baseUrl } = await startTestServer();
    try {
        const res = await fetch(`${baseUrl}/api/skills/cinematic-director/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const body = await res.json();
        assert.notEqual(res.status, 403, '不该被守卫拦下');
        assert.notEqual(body.error, 'FEATURE_LOCKED');
        assert.match(body.error, /电影导演输入无效/, '应该是业务层的输入校验错误，证明请求真的到了 handler');
    } finally {
        server.close();
    }
});

test('试用到期时：请求在到达业务逻辑之前就被 403 拦下', async () => {
    setLicenseState({ status: 'expired', features: [] });
    const { server, baseUrl } = await startTestServer();
    try {
        const res = await fetch(`${baseUrl}/api/skills/cinematic-director/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const body = await res.json();
        assert.equal(res.status, 403);
        assert.equal(body.error, 'FEATURE_LOCKED');
        assert.equal(body.feature, 'director_workflow');
    } finally {
        server.close();
    }
});

test('永久授权且已授予该功能：请求正常进入业务逻辑', async () => {
    setLicenseState({ status: 'licensed', features: ['director_workflow'] });
    const { server, baseUrl } = await startTestServer();
    try {
        const res = await fetch(`${baseUrl}/api/skills/cinematic-director/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const body = await res.json();
        assert.notEqual(res.status, 403);
        assert.match(body.error, /电影导演输入无效/);
    } finally {
        server.close();
    }
});
