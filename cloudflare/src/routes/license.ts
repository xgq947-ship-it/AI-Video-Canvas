/** P4/P5：授权码激活与同设备重装恢复（文档 §9-11）。 */

import type { Env } from '../env.js';
import { json, errorJson } from '../lib/http.js';
import { verifyAccessToken } from '../lib/tokens.js';
import {
  getUserStatus,
  getLicenseDeviceByHash,
  getLicenseKeyByCodeHash,
  getLicenseKeyById,
  activateLicenseAtomic,
  nowIso,
} from '../lib/db.js';
import { normalizeLicenseCode, hashLicenseCode, signPerpetualLicense } from '../lib/license.js';

async function authUserId(req: Request, env: Env): Promise<string | null> {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const claims = await verifyAccessToken(env.SESSION_SIGNING_SECRET, token);
  return claims?.sub ?? null;
}

async function safeJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

/** POST /api/license/activate { license_code, device_hash, app_version } */
export async function handleLicenseActivate(req: Request, env: Env): Promise<Response> {
  const userId = await authUserId(req, env);
  if (!userId) return errorJson('AUTH_REQUIRED', '需要有效会话', 401);

  const userStatus = await getUserStatus(env, userId);
  if (!userStatus) return errorJson('USER_NOT_FOUND', '用户不存在', 404);
  if (userStatus === 'blocked') return errorJson('USER_BLOCKED', '账号已被禁用', 403);

  const body = await safeJson<{ license_code?: string; device_hash?: string }>(req);
  if (!body?.license_code || !body?.device_hash) {
    return errorJson('BAD_REQUEST', '缺少 license_code 或 device_hash', 400);
  }

  const device = await getLicenseDeviceByHash(env, body.device_hash);
  if (!device) return errorJson('DEVICE_NOT_FOUND', '设备尚未登记，请先完成一次正常登录', 404);
  if (device.license_status === 'blocked') return errorJson('DEVICE_BLOCKED', '当前设备已被禁用', 403);

  const codeHash = await hashLicenseCode(body.license_code, env.LICENSE_CODE_SALT);
  const key = await getLicenseKeyByCodeHash(env, codeHash);
  if (!key) return errorJson('LICENSE_INVALID', '该授权码无效', 400);
  if (key.status === 'revoked') return errorJson('LICENSE_REVOKED', '该授权码已被撤销', 400);
  if (key.status === 'disabled') return errorJson('LICENSE_DISABLED', '该授权码已被禁用', 400);

  const features: string[] = JSON.parse(key.features || '[]');

  // 已被使用：同设备+同用户重复提交同一个已绑定的码 → 幂等重签原许可证；否则拒绝。
  if (key.status === 'used') {
    if (key.bound_device_hash === body.device_hash && key.bound_user_id === userId) {
      try {
        const license = await signPerpetualLicense(env, {
          licenseId: key.id,
          userId,
          deviceHash: body.device_hash,
          features,
        });
        return json({ success: true, license_status: 'licensed', license });
      } catch (err) {
        console.error('[license] 重签失败', err);
        return errorJson('SERVER_ERROR', '服务器内部错误', 500);
      }
    }
    return errorJson('LICENSE_ALREADY_USED', '该授权码已被使用', 409);
  }

  // key.status === 'unused'：设备若已经被别的授权码激活过，拒绝（一台设备只能绑一个码）。
  if (device.license_status === 'licensed' && device.license_key_id && device.license_key_id !== key.id) {
    return errorJson('DEVICE_ALREADY_LICENSED', '当前设备已激活过其他授权码', 409);
  }

  const now = nowIso();
  const { keyChanges, deviceChanges } = await activateLicenseAtomic(env, {
    codeHash,
    keyId: key.id,
    deviceHash: body.device_hash,
    userId,
    now,
  });

  if (keyChanges !== 1) {
    // 并发竞态：别的请求抢先了。重新读一次给出准确结果。
    const recheck = await getLicenseKeyByCodeHash(env, codeHash);
    if (!recheck) return errorJson('LICENSE_INVALID', '该授权码无效', 400);
    if (recheck.status === 'used' && recheck.bound_device_hash === body.device_hash && recheck.bound_user_id === userId) {
      try {
        const license = await signPerpetualLicense(env, {
          licenseId: recheck.id,
          userId,
          deviceHash: body.device_hash,
          features: JSON.parse(recheck.features || '[]'),
        });
        return json({ success: true, license_status: 'licensed', license });
      } catch (err) {
        console.error('[license] 并发重签失败', err);
        return errorJson('SERVER_ERROR', '服务器内部错误', 500);
      }
    }
    return errorJson('LICENSE_ALREADY_USED', '该授权码已被使用', 409);
  }

  if (deviceChanges !== 1) {
    // license_keys 一侧已经判给了这次请求，但 device 一侧因为并发被别的码占用——
    // 真实的异常状态，不能假装成功，也不泄露内部细节给客户端。
    console.error('[license] 激活了 license_keys 但 license_devices 未同步生效，需人工核实', {
      codeHash,
      deviceHash: body.device_hash,
      userId,
    });
    return errorJson('SERVER_ERROR', '激活异常，请联系管理员核实', 500);
  }

  try {
    const license = await signPerpetualLicense(env, {
      licenseId: key.id,
      userId,
      deviceHash: body.device_hash,
      features,
    });
    return json({ success: true, license_status: 'licensed', license });
  } catch (err) {
    console.error('[license] 签发失败', err);
    return errorJson('SERVER_ERROR', '服务器内部错误', 500);
  }
}

/** POST /api/license/restore { device_hash, app_version } —— 同设备重装恢复授权。 */
export async function handleLicenseRestore(req: Request, env: Env): Promise<Response> {
  const userId = await authUserId(req, env);
  if (!userId) return errorJson('AUTH_REQUIRED', '需要有效会话', 401);

  const userStatus = await getUserStatus(env, userId);
  if (!userStatus) return errorJson('USER_NOT_FOUND', '用户不存在', 404);
  if (userStatus === 'blocked') return errorJson('USER_BLOCKED', '账号已被禁用', 403);

  const body = await safeJson<{ device_hash?: string }>(req);
  if (!body?.device_hash) return errorJson('BAD_REQUEST', '缺少 device_hash', 400);

  const device = await getLicenseDeviceByHash(env, body.device_hash);
  if (!device) return errorJson('DEVICE_NOT_FOUND', '设备尚未登记，请先完成一次正常登录', 404);
  if (device.license_status === 'blocked') return errorJson('DEVICE_BLOCKED', '当前设备已被禁用', 403);
  if (device.license_status !== 'licensed' || !device.license_key_id) {
    return errorJson('DEVICE_NOT_LICENSED', '当前设备尚未激活过永久授权', 404);
  }
  // 权威判断：device_hash 一致 + license_devices 记录的 owner 就是当前登录用户
  // （二者在 activate 时被同一个 batch 原子写入，激活时二者恒等）。设备哈希不一致
  // 由 getLicenseDeviceByHash 天然保证（按 device_hash 查出来的行本身就是这台设备）。
  if (device.user_id !== userId) {
    return errorJson('DEVICE_NOT_OWNED', '当前账号不是该设备的授权拥有者，请联系管理员处理换绑', 403);
  }

  const key = await getLicenseKeyById(env, device.license_key_id);
  if (!key) {
    // 数据不一致（license_devices 指向的 license_keys 行不存在）——不应该发生，如实报错。
    console.error('[license] restore：license_devices.license_key_id 指向的记录不存在', {
      deviceHash: body.device_hash,
      licenseKeyId: device.license_key_id,
    });
    return errorJson('SERVER_ERROR', '服务器内部错误', 500);
  }

  try {
    const license = await signPerpetualLicense(env, {
      licenseId: key.id,
      userId,
      deviceHash: body.device_hash,
      features: JSON.parse(key.features || '[]'),
    });
    return json({ success: true, license_status: 'licensed', license });
  } catch (err) {
    console.error('[license] restore 签发失败', err);
    return errorJson('SERVER_ERROR', '服务器内部错误', 500);
  }
}
