/**
 * electron/deviceIdentity.js
 *
 * 稳定设备身份（文档 §7）。主进程首启时生成并保存：
 *   installation_id → 应用配置目录明文文件（丢失可重建，不敏感）
 *   device_secret   → SecureStore（safeStorage 加密）
 * 二者 + 固定命名空间算出 device_hash；只有 device_hash 会上云。
 *
 * 关键性质：
 *   - 单纯复制应用目录到别的电脑不能复用授权（device_secret 在本机 Keychain 里）。
 *   - 删除普通配置后，只要 Keychain 里的 device_secret 还在即可重建同一 device_hash。
 *   - 完全重装系统可能丢失 device_secret，此时需管理员处理（本期不做恢复码）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { computeDeviceHash, hashInstallationId } from '../shared/deviceHash.js';

const INSTALLATION_ID_KEY = 'device.installation_id'; // 明文文件里的字段名
const DEVICE_SECRET_KEY = 'device.secret'; // SecureStore 键名

/**
 * @param {{ configDir: string, secureStore: import('./secureStore.d.ts').SecureStore, fileName?: string }} options
 * @returns {{ ensureIdentity(): Promise<{ installationId: string, deviceHash: string, installationIdHash: string }> }}
 */
export function createDeviceIdentity({ configDir, secureStore, fileName = 'device.json' }) {
  if (!configDir) throw new Error('createDeviceIdentity: 需要 configDir');
  if (!secureStore) throw new Error('createDeviceIdentity: 需要 secureStore');
  const filePath = path.join(configDir, fileName);

  function readInstallationId() {
    if (!fs.existsSync(filePath)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const id = parsed?.[INSTALLATION_ID_KEY];
      return typeof id === 'string' && id ? id : null;
    } catch (error) {
      console.error('[DeviceIdentity] 读取 installation_id 失败：', error.message);
      return null;
    }
  }

  function writeInstallationId(installationId) {
    const tmp = `${filePath}.tmp`;
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ [INSTALLATION_ID_KEY]: installationId }), { mode: 0o600 });
    fs.renameSync(tmp, filePath);
  }

  return {
    async ensureIdentity() {
      let installationId = readInstallationId();
      if (!installationId) {
        installationId = randomUUID();
        writeInstallationId(installationId);
      }

      let deviceSecret = await secureStore.get(DEVICE_SECRET_KEY);
      if (!deviceSecret) {
        deviceSecret = randomBytes(32).toString('hex');
        await secureStore.set(DEVICE_SECRET_KEY, deviceSecret);
      }

      return {
        installationId,
        installationIdHash: hashInstallationId(installationId),
        deviceHash: computeDeviceHash(installationId, deviceSecret),
      };
    },
  };
}
