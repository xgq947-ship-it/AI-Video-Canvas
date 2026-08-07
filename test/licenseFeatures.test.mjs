import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canUseFeature,
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
