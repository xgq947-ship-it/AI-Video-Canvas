/**
 * 授权码标准化/哈希 + 永久许可证签发。哈希方式必须与
 * scripts/generate-license-codes.mjs 的 normalizeCode/hashCode 完全一致
 * ——否则管理员生成的码在这里永远验不出来。
 */

import type { Env } from '../env.js';
import { sha256Hex } from './crypto.js';
import { encodeLicensePayload, signLicensePayload, pemToDer } from '../../../shared/licenseSignature.js';

/** 标准化授权码：去空白 + 转大写。与生成脚本保持逐字节一致。 */
export function normalizeLicenseCode(code: string): string {
  return code.trim().toUpperCase();
}

export async function hashLicenseCode(code: string, salt: string): Promise<string> {
  return sha256Hex(normalizeLicenseCode(code) + salt);
}

export interface LicensePayload {
  license_id: string;
  user_id: string;
  device_hash: string;
  license_type: string;
  features: string[];
  issued_at: number;
  version: 1;
}

export interface SignedLicense {
  payload: string;
  signature: string;
}

/**
 * 签发永久许可证（文档 §8.1）。私钥只存在于 Worker Secret，绝不出这个文件。
 * @throws 私钥未配置时抛错——调用方应捕获并返回 SERVER_ERROR，不泄露细节。
 */
export async function signPerpetualLicense(
  env: Env,
  args: { licenseId: string; userId: string; deviceHash: string; features: string[] }
): Promise<SignedLicense> {
  if (!env.LICENSE_PRIVATE_KEY_PEM_B64) {
    throw new Error('LICENSE_PRIVATE_KEY_PEM_B64 未配置');
  }
  const pem = atob(env.LICENSE_PRIVATE_KEY_PEM_B64);
  const pkcs8Der = pemToDer(pem);

  const payload: LicensePayload = {
    license_id: args.licenseId,
    user_id: args.userId,
    device_hash: args.deviceHash,
    license_type: 'perpetual',
    features: args.features,
    issued_at: Math.floor(Date.now() / 1000),
    version: 1,
  };

  const payloadB64url = encodeLicensePayload(payload);
  const signature = await signLicensePayload(payloadB64url, pkcs8Der);
  return { payload: payloadB64url, signature };
}
