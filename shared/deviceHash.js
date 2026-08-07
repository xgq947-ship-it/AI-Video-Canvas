/**
 * shared/deviceHash.js
 *
 * 设备哈希纯函数（文档 §7）。与存储/Electron 解耦，便于测试与前后端共用。
 *
 *   deviceHash = SHA-256(installationId + deviceSecret + DEVICE_HASH_NAMESPACE)
 *
 * 服务端只保存 device_hash；原始 installation_id 与 device_secret 不上云。
 * 注意：禁止用硬件序列号 / MAC / 硬盘序列号参与计算。
 */

import { createHash } from 'node:crypto';

/** 固定命名空间，纳入哈希以隔离用途、避免与其他哈希碰撞。 */
export const DEVICE_HASH_NAMESPACE = 'ai-canvas-license-v1';

/**
 * @param {string} installationId 应用配置目录中的 UUID v4
 * @param {string} deviceSecret   Keychain/safeStorage 中的 32 字节随机值（hex/base64 文本）
 * @param {string} [namespace]
 * @returns {string} 小写 hex 的 SHA-256
 */
export function computeDeviceHash(installationId, deviceSecret, namespace = DEVICE_HASH_NAMESPACE) {
  if (typeof installationId !== 'string' || !installationId) {
    throw new TypeError('computeDeviceHash: installationId 必须是非空字符串');
  }
  if (typeof deviceSecret !== 'string' || !deviceSecret) {
    throw new TypeError('computeDeviceHash: deviceSecret 必须是非空字符串');
  }
  return createHash('sha256')
    .update(installationId + deviceSecret + namespace, 'utf8')
    .digest('hex');
}

/**
 * installation_id 的哈希（上报给服务端做去重时用，避免上传原始 installation_id）。
 * @param {string} installationId
 * @returns {string} 小写 hex 的 SHA-256
 */
export function hashInstallationId(installationId) {
  if (typeof installationId !== 'string' || !installationId) {
    throw new TypeError('hashInstallationId: installationId 必须是非空字符串');
  }
  return createHash('sha256').update(installationId, 'utf8').digest('hex');
}
