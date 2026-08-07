import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  computeDeviceHash,
  hashInstallationId,
  DEVICE_HASH_NAMESPACE,
} from '../shared/deviceHash.js';

const INSTALL = '11111111-2222-3333-4444-555555555555';
const SECRET = 'a'.repeat(64); // 32 字节 hex

test('device_hash 是确定性的 SHA-256（同输入同输出）', () => {
  const a = computeDeviceHash(INSTALL, SECRET);
  const b = computeDeviceHash(INSTALL, SECRET);
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('device_hash 等于文档定义 sha256(installationId + deviceSecret + namespace)', () => {
  const expected = createHash('sha256')
    .update(INSTALL + SECRET + DEVICE_HASH_NAMESPACE, 'utf8')
    .digest('hex');
  assert.equal(computeDeviceHash(INSTALL, SECRET), expected);
});

test('installation_id 变化 → device_hash 变化', () => {
  const a = computeDeviceHash(INSTALL, SECRET);
  const b = computeDeviceHash('00000000-0000-0000-0000-000000000000', SECRET);
  assert.notEqual(a, b);
});

test('device_secret 变化 → device_hash 变化（复制应用目录换机器也复用不了授权）', () => {
  const a = computeDeviceHash(INSTALL, SECRET);
  const b = computeDeviceHash(INSTALL, 'b'.repeat(64));
  assert.notEqual(a, b);
});

test('命名空间纳入哈希，隔离用途', () => {
  const a = computeDeviceHash(INSTALL, SECRET, 'ai-canvas-license-v1');
  const b = computeDeviceHash(INSTALL, SECRET, 'other-namespace');
  assert.notEqual(a, b);
});

test('缺参报错，避免用空串算出可预测哈希', () => {
  assert.throws(() => computeDeviceHash('', SECRET), TypeError);
  assert.throws(() => computeDeviceHash(INSTALL, ''), TypeError);
  assert.throws(() => hashInstallationId(''), TypeError);
});

test('hashInstallationId 为确定性 SHA-256', () => {
  assert.equal(hashInstallationId(INSTALL), hashInstallationId(INSTALL));
  assert.match(hashInstallationId(INSTALL), /^[0-9a-f]{64}$/);
});
