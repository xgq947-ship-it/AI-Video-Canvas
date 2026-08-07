/**
 * electron/secureStore.js
 *
 * 主进程专属的安全存储（文档 §15）。用 Electron safeStorage 加密后落盘：
 *   - macOS → Keychain 派生密钥；Windows → DPAPI。两平台都覆盖（本仓库同时出 mac/win 包）。
 * 只有主进程能用 safeStorage；utilityProcess 里的 Express 服务拿不到，因此
 * refresh token / device_secret / 签名许可证一律由主进程独占保管。
 *
 * 存储形态：单个 JSON 文件，key → base64(safeStorage 密文)。每个值单独加密。
 * 保存的逻辑键（见文档 §15.2）：
 *   auth.refresh_token / auth.user_id / device.secret / license.payload / license.signature
 *
 * 明确不做：明文写盘、写 localStorage、把值回传渲染进程/服务进程。
 */

import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';

/**
 * @param {{ dir: string, fileName?: string }} options dir 通常为 app.getPath('userData')
 * @returns {import('./secureStore.d.ts').SecureStore}
 */
export function createSecureStore({ dir, fileName = 'secure-store.json' }) {
  if (!dir) throw new Error('createSecureStore: 需要 dir');
  const filePath = path.join(dir, fileName);

  function assertEncryptionAvailable() {
    // 首启在 app ready 之后调用即可用。不可用时拒绝落盘，绝不退化成明文。
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage 加密不可用：拒绝明文保存敏感数据');
    }
  }

  /** @returns {Record<string, string>} key → base64 密文 */
  function readAll() {
    if (!fs.existsSync(filePath)) return {};
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      console.error('[SecureStore] 读取失败，按空处理：', error.message);
      return {};
    }
  }

  /** @param {Record<string, string>} all */
  function writeAll(all) {
    const tmp = `${filePath}.tmp`;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(all), { mode: 0o600 });
    fs.renameSync(tmp, filePath); // 原子替换，避免写一半损坏
  }

  return {
    isAvailable() {
      try {
        return safeStorage.isEncryptionAvailable();
      } catch {
        return false;
      }
    },

    async get(key) {
      const all = readAll();
      const b64 = all[key];
      if (typeof b64 !== 'string') return null;
      try {
        assertEncryptionAvailable();
        return safeStorage.decryptString(Buffer.from(b64, 'base64'));
      } catch (error) {
        console.error(`[SecureStore] 解密 ${key} 失败：`, error.message);
        return null;
      }
    },

    async set(key, value) {
      if (typeof value !== 'string') throw new TypeError('SecureStore.set: value 必须是字符串');
      assertEncryptionAvailable();
      const all = readAll();
      all[key] = safeStorage.encryptString(value).toString('base64');
      writeAll(all);
    },

    async delete(key) {
      const all = readAll();
      if (key in all) {
        delete all[key];
        writeAll(all);
      }
    },
  };
}
