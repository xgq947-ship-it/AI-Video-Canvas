/**
 * electron/license/licenseVerifier.js
 *
 * 本地永久许可证验签（文档 §8.2）。客户端只内置公钥，只负责验证，不能签发。
 * 用 shared/licenseSignature.js 的同一份 WebCrypto Ed25519 实现——跟 Worker
 * 签发时用的是同一套代码，不会出现"客户端自己另写一套验签逻辑，细节对不上"。
 *
 * 公钥以参数传入而非在本文件内 import electron/authConfig.js：这样本模块
 * 不依赖 Electron 运行时，可以直接被 node --test 测试。调用方（licenseManager.js，
 * 跑在主进程里）负责传入 authConfig.js 里的 LICENSE_PUBLIC_KEY_SPKI_B64URL。
 */

import { verifyLicenseSignature, decodeLicensePayload, b64urlDecode } from '../../shared/licenseSignature.js';

/**
 * @param {{ payload: string, signature: string }} license
 * @param {string} expectedDeviceHash 当前设备算出的 device_hash
 * @param {string} publicKeySpkiB64url 客户端内置的 Ed25519 公钥（SPKI, base64url）
 * @returns {Promise<{ valid: true, payload: import('../../shared/licenseSignature.js').LicensePayload } | { valid: false, reason: string }>}
 */
export async function verifyStoredLicense(license, expectedDeviceHash, publicKeySpkiB64url) {
  if (!license?.payload || !license?.signature) {
    return { valid: false, reason: 'missing' };
  }

  const spkiDer = b64urlDecode(publicKeySpkiB64url);
  const signatureOk = await verifyLicenseSignature(license.payload, license.signature, spkiDer);
  if (!signatureOk) return { valid: false, reason: 'signature_invalid' };

  let payload;
  try {
    payload = decodeLicensePayload(license.payload);
  } catch {
    return { valid: false, reason: 'payload_malformed' };
  }

  // 复制到其他设备后必须验证失败：签名依然对，但 device_hash 不会匹配当前设备。
  if (payload.device_hash !== expectedDeviceHash) {
    return { valid: false, reason: 'device_mismatch' };
  }
  if (payload.license_type !== 'perpetual') {
    return { valid: false, reason: 'unsupported_license_type' };
  }
  if (!Array.isArray(payload.features)) {
    return { valid: false, reason: 'payload_malformed' };
  }

  return { valid: true, payload };
}
