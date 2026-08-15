import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canUseFeature,
  isCanvasLocked,
  FEATURE_KEYS,
  DEFAULT_GRANTED_FEATURES,
  UNCONFIGURED_LICENSE_STATE,
} from '../shared/licenseFeatures.js';

const NOW = Date.UTC(2026, 7, 8); // 2026-08-08
const D = FEATURE_KEYS.DIRECTOR_WORKFLOW;

test('普通节点（无功能要求）恒可用', () => {
  const blocked = { status: 'blocked', features: [] };
  assert.equal(canUseFeature(undefined, blocked, NOW), true);
  assert.equal(canUseFeature(null, blocked, NOW), true);
});

test('试用中且未到期且已授予该功能 → 可用', () => {
  const license = { status: 'trial', trialExpiresAt: NOW + 86_400_000, features: [D] };
  assert.equal(canUseFeature(D, license, NOW), true);
});

test('试用已到期（trialExpiresAt < now）→ 高级功能不可用', () => {
  const license = { status: 'trial', trialExpiresAt: NOW - 1, features: [D] };
  assert.equal(canUseFeature(D, license, NOW), false);
});

test('试用中但未授予该功能 → 不可用', () => {
  const license = { status: 'trial', trialExpiresAt: NOW + 86_400_000, features: [] };
  assert.equal(canUseFeature(D, license, NOW), false);
});

test('已永久授权且授予该功能 → 可用（不看时间）', () => {
  const license = { status: 'licensed', features: [D] };
  assert.equal(canUseFeature(D, license, NOW), true);
});

test('expired 状态一律拒绝高级功能', () => {
  const license = { status: 'expired', features: [D] };
  assert.equal(canUseFeature(D, license, NOW), false);
});

test('blocked 状态一律拒绝高级功能', () => {
  const license = { status: 'blocked', features: [D] };
  assert.equal(canUseFeature(D, license, NOW), false);
});

test('未配置授权子系统 → 全解锁（现有用户升级不被锁死）', () => {
  assert.equal(canUseFeature(D, UNCONFIGURED_LICENSE_STATE, NOW), true);
  assert.ok(UNCONFIGURED_LICENSE_STATE.unconfigured === true);
});

test('非法 license 对象 → 高级功能拒绝，但普通节点仍放行', () => {
  assert.equal(canUseFeature(D, null, NOW), false);
  assert.equal(canUseFeature(D, undefined, NOW), false);
  assert.equal(canUseFeature(undefined, null, NOW), true);
});

test('默认授予集合包含导演工作流', () => {
  assert.ok(DEFAULT_GRANTED_FEATURES.includes(D));
});

// ---------------------------------------------------------------------------
// 到期硬锁：默认放行、只在积极证据下上锁。
// 失败代价不对称——漏锁一次只是少收一份钱，误锁一次会把正在付费使用的用户
// 整个应用砖掉。下面这组「不得上锁」的断言比「必须上锁」的更重要。
// ---------------------------------------------------------------------------

test('试用已过期、已停用、试用时间走完 → 锁死整块画布', () => {
  assert.equal(isCanvasLocked({ status: 'expired', features: [] }, NOW), true);
  assert.equal(isCanvasLocked({ status: 'blocked', features: [] }, NOW), true);
  assert.equal(
    isCanvasLocked({ status: 'trial', trialExpiresAt: NOW - 1, features: [D] }, NOW),
    true,
  );
  // 边界：恰好到点即锁。
  assert.equal(
    isCanvasLocked({ status: 'trial', trialExpiresAt: NOW, features: [D] }, NOW),
    true,
  );
});

test('试用期内、已购授权 → 不锁', () => {
  assert.equal(
    isCanvasLocked({ status: 'trial', trialExpiresAt: NOW + 86_400_000, features: [D] }, NOW),
    false,
  );
  assert.equal(isCanvasLocked({ status: 'licensed', features: [D] }, NOW), false);
});

test('状态未知、授权子系统未启用、脏数据 → 一律不锁，绝不能把应用砖掉', () => {
  // 已登录但主进程还没拿到第一次 device-status；或离线取不到状态。
  assert.equal(isCanvasLocked({ status: 'unknown', features: [], stale: true }, NOW), false);
  assert.equal(isCanvasLocked(UNCONFIGURED_LICENSE_STATE, NOW), false);
  assert.equal(isCanvasLocked(null, NOW), false);
  assert.equal(isCanvasLocked(undefined, NOW), false);
  assert.equal(isCanvasLocked({}, NOW), false);
  assert.equal(isCanvasLocked({ status: '未来新增的状态', features: [] }, NOW), false);
  // trial 但缺失到期时间：判不出来就不锁。
  assert.equal(isCanvasLocked({ status: 'trial', features: [D] }, NOW), false);
});

test('离线保留的旧状态按 status 判断，试用未到期仍可继续用', () => {
  assert.equal(
    isCanvasLocked({ status: 'trial', trialExpiresAt: NOW + 3_600_000, features: [D], stale: true }, NOW),
    false,
  );
  assert.equal(
    isCanvasLocked({ status: 'licensed', features: [D], stale: true }, NOW),
    false,
  );
});
