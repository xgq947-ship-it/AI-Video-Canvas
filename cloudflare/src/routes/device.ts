/** P2：设备试用状态。POST /api/device/status（Bearer 会话）。 */

import type { Env } from '../env.js';
import { json, errorJson } from '../lib/http.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { upsertDeviceStatus, getUserStatus } from '../lib/db.js';
import { DEFAULT_GRANTED_FEATURES, TRIAL_DAYS } from '../lib/features.js';

async function authUserId(req: Request, env: Env): Promise<string | null> {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const claims = await verifyAccessToken(env.SESSION_SIGNING_SECRET, token);
  return claims?.sub ?? null;
}

export async function handleDeviceStatus(req: Request, env: Env): Promise<Response> {
  const userId = await authUserId(req, env);
  if (!userId) return errorJson('AUTH_REQUIRED', '需要有效会话', 401);

  const userStatus = await getUserStatus(env, userId);
  if (!userStatus) return errorJson('USER_NOT_FOUND', '用户不存在', 404);
  if (userStatus === 'blocked') return errorJson('USER_BLOCKED', '账号已被禁用', 403);

  let body: {
    device_hash?: string;
    installation_id_hash?: string;
    platform?: string;
    app_version?: string;
  } | null = null;
  try {
    body = await req.json();
  } catch {
    /* ignore */
  }
  if (!body?.device_hash || typeof body.device_hash !== 'string') {
    return errorJson('BAD_REQUEST', '缺少 device_hash', 400);
  }

  const device = await upsertDeviceStatus(env, {
    userId,
    deviceHash: body.device_hash,
    installationIdHash: body.installation_id_hash ?? null,
    platform: body.platform ?? null,
    appVersion: body.app_version ?? null,
    trialDays: TRIAL_DAYS,
  });

  const serverTime = new Date().toISOString();

  // 有效状态以服务端时间为准：trial 到期即 expired；blocked/licensed 原样。
  let effective = device.license_status;
  if (effective === 'trial' && serverTime > device.trial_expires_at) {
    effective = 'expired';
  }

  const features = effective === 'blocked' ? [] : DEFAULT_GRANTED_FEATURES;

  return json({
    license_status: effective,
    trial_started_at: device.trial_started_at,
    trial_expires_at: device.trial_expires_at,
    server_time: serverTime,
    features,
  });
}
