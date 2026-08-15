import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    getLicenseState,
    blockWhenCanvasLocked,
    isCanvasLockedNow,
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

// ---------------------------------------------------------------------------
// 试用到期后的全局闸门。渲染进程的遮罩一开 devtools 就能撤掉，这层才是真锁。
// ---------------------------------------------------------------------------

function runGate(method, url = '/detail-remix-jobs') {
    const req = { method, url, path: url };
    let nexted = false;
    let statusCode = 0;
    let payload = null;
    const res = {
        status(code) { statusCode = code; return this; },
        json(body) { payload = body; return this; },
    };
    blockWhenCanvasLocked(req, res, () => { nexted = true; });
    return { nexted, statusCode, payload };
}

test('从未收到主进程消息时闸门恒放行——授权子系统未启用不得上锁', () => {
    assert.equal(isCanvasLockedNow(), false);
    assert.equal(runGate('POST').nexted, true);
});

test('试用期内一切照常', () => {
    setLicenseState({ status: 'trial', trialExpiresAt: Date.now() + 86_400_000, features: [D] });
    assert.equal(isCanvasLockedNow(), false);
    assert.equal(runGate('POST').nexted, true);
});

test('试用到期后拒绝一切写请求', () => {
    setLicenseState({ status: 'expired', features: [] });
    assert.equal(isCanvasLockedNow(), true);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const result = runGate(method);
        assert.equal(result.nexted, false, `${method} 应被拦截`);
        assert.equal(result.statusCode, 403);
        assert.equal(result.payload.error, 'CANVAS_LOCKED');
    }
});

test('到期后只读请求仍放行——已生成的成果不被扣作人质，导出照常', () => {
    setLicenseState({ status: 'expired', features: [] });
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
        assert.equal(runGate(method).nexted, true, `${method} 应放行`);
    }
    // 桌面端一键导出正是先 GET 清单再由主进程复制文件。
    assert.equal(runGate('GET', '/detail-remix-jobs/j1/export-manifest').nexted, true);
});

test('设备被停用同样锁死写请求', () => {
    setLicenseState({ status: 'blocked', features: [] });
    assert.equal(isCanvasLockedNow(), true);
    assert.equal(runGate('POST').nexted, false);
});

test('状态未知时不得上锁——离线或启动瞬间不能把应用砖掉', () => {
    setLicenseState({ status: 'unknown', features: [], stale: true });
    assert.equal(isCanvasLockedNow(), false);
    assert.equal(runGate('POST').nexted, true);
});

test('保存画布不属于付费价值，到期后仍放行——否则未落盘的布局永远丢失且自动保存空转', () => {
    setLicenseState({ status: 'expired', features: [] });
    assert.equal(isCanvasLockedNow(), true);
    // useWorkflow 的自动保存走 POST /api/workflows。
    assert.equal(runGate('POST', '/workflows').nexted, true);
    assert.equal(runGate('PUT', '/workflows/w1/title').nexted, true);
    assert.equal(runGate('PUT', '/workflows/w1/cover').nexted, true);
    assert.equal(runGate('POST', '/workflows/w1/reveal-assets').nexted, true);
    assert.equal(runGate('DELETE', '/workflows/w1').nexted, true);
    // 但生成仍然锁死——前缀放行不能被相似路径蹭进来。
    assert.equal(runGate('POST', '/workflows-generate').nexted, false);
    assert.equal(runGate('POST', '/generate/image').nexted, false);
});
