/** P6：每日活跃上报。POST /api/report-activity（Bearer 会话）。 */

import type { Env } from '../env.js';
import { json, errorJson } from '../lib/http.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { recordActivityIfNeeded } from '../lib/db.js';

async function authUserId(req: Request, env: Env): Promise<string | null> {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const claims = await verifyAccessToken(env.SESSION_SIGNING_SECRET, token);
  return claims?.sub ?? null;
}

export async function handleReportActivity(req: Request, env: Env): Promise<Response> {
  const userId = await authUserId(req, env);
  if (!userId) return errorJson('AUTH_REQUIRED', '需要有效会话', 401);

  let body: {
    device_hash?: unknown;
    app_version?: unknown;
    platform?: unknown;
  } | null = null;
  try {
    body = await req.json();
  } catch {
    /* ignore */
  }

  if (typeof body?.device_hash !== 'string' || !body.device_hash.trim()) {
    return errorJson('BAD_REQUEST', '缺少 device_hash', 400);
  }

  const reported = await recordActivityIfNeeded(env, {
    userId,
    deviceHash: body.device_hash.trim(),
    appVersion: typeof body.app_version === 'string' ? body.app_version : null,
    platform: typeof body.platform === 'string' ? body.platform : null,
  });

  return json({ success: true, reported });
}
