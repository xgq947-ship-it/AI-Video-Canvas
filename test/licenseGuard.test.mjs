import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    getLicenseState,
    isFeatureAllowed,
    requireFeature,
    resetLicenseState,
    setLicenseState,
} from '../server/services/licenseGuard.js';

const D = 'director_workflow';

test.beforeEach(() => resetLicenseState());

test('默认（从未收到主进程消息）恒放行——保证现有用户升级不被锁死', () => {
    assert.equal(getLicenseState(), null);
    assert.equal(isFeatureAllowed(D), true);
    assert.equal(isFeatureAllowed(undefined), true);
});

test('无功能要求的节点恒放行，不看当前状态', () => {
    setLicenseState({ status: 'blocked', features: [] });
    assert.equal(isFeatureAllowed(undefined), true);
    assert.equal(isFeatureAllowed(null), true);
});

test('试用中且未到期且已授予该功能 → 放行', () => {
    setLicenseState({ status: 'trial', trialExpiresAt: Date.now() + 86_400_000, features: [D] });
    assert.equal(isFeatureAllowed(D), true);
});

test('试用已到期 → 拒绝', () => {
    setLicenseState({ status: 'trial', trialExpiresAt: Date.now() - 1000, features: [D] });
    assert.equal(isFeatureAllowed(D), false);
});

test('已永久授权且授予该功能 → 放行', () => {
    setLicenseState({ status: 'licensed', features: [D] });
    assert.equal(isFeatureAllowed(D), true);
});

test('已永久授权但未授予该功能 → 拒绝', () => {
    setLicenseState({ status: 'licensed', features: [] });
    assert.equal(isFeatureAllowed(D), false);
});

test('blocked 状态一律拒绝高级功能', () => {
    setLicenseState({ status: 'trial', trialExpiresAt: Date.now() + 86_400_000, features: [D] });
    setLicenseState({ status: 'blocked', features: [D] });
    assert.equal(isFeatureAllowed(D), false);
});

test('非对象消息被忽略，不破坏已有状态', () => {
    setLicenseState({ status: 'licensed', features: [D] });
    setLicenseState(null);
    setLicenseState('garbage');
    setLicenseState(42);
    assert.equal(isFeatureAllowed(D), true, '坏消息不应清空已生效的授权状态');
});

test('requireFeature 中间件：放行时调用 next，不touch res', () => {
    setLicenseState({ status: 'licensed', features: [D] });
    const mw = requireFeature(D);
    let nextCalled = false;
    const res = {
        status() { throw new Error('不该调用 res.status'); },
    };
    mw({}, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
});

test('requireFeature 中间件：拒绝时返回 403 + FEATURE_LOCKED，不调用 next', () => {
    setLicenseState({ status: 'expired', features: [] });
    const mw = requireFeature(D);
    let nextCalled = false;
    let statusCode = null;
    let body = null;
    const res = {
        status(code) { statusCode = code; return this; },
        json(payload) { body = payload; return this; },
    };
    mw({}, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 403);
    assert.equal(body.error, 'FEATURE_LOCKED');
    assert.equal(body.feature, D);
    assert.equal(typeof body.message, 'string');
});

test('日志/响应不泄露数据库细节——message 是固定的用户可读文案', () => {
    setLicenseState({ status: 'expired', features: [] });
    const mw = requireFeature(D);
    let body = null;
    const res = { status() { return this; }, json(p) { body = p; return this; } };
    mw({}, res, () => {});
    assert.equal(body.message, '试用已结束，请先激活授权码后再使用该高级节点');
});
