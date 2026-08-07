/**
 * D1 数据访问：用户/oauth 账号 upsert、一次性桌面登录码、refresh token 轮换。
 * 所有写操作走服务端；只保存哈希，不存明文 token/code。
 */

import type { Env } from '../env.js';
import { sha256Hex } from './crypto.js';

export function nowIso(): string {
  return new Date().toISOString();
}

function isoInDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function isoInSeconds(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export interface GoogleProfile {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  picture?: string;
}

/**
 * Google 登录匹配顺序（文档 §6.2）：
 *   1) provider=google + provider_subject=sub → 直接返回 user_id
 *   2) 未找到且 email_verified=true 时按邮箱关联已有用户
 *   3) 否则新建 user + oauth_account
 */
export async function findOrCreateUserByGoogle(env: Env, p: GoogleProfile): Promise<string> {
  const now = nowIso();

  const existing = await env.DB.prepare(
    `SELECT user_id FROM oauth_accounts WHERE provider = 'google' AND provider_subject = ?`
  )
    .bind(p.sub)
    .first<{ user_id: string }>();

  if (existing?.user_id) {
    await env.DB.prepare(
      `UPDATE users SET display_name = COALESCE(?, display_name), avatar_url = COALESCE(?, avatar_url),
        last_seen_at = ?, updated_at = ? WHERE id = ?`
    )
      .bind(p.name ?? null, p.picture ?? null, now, now, existing.user_id)
      .run();
    await env.DB.prepare(
      `UPDATE oauth_accounts SET email = ?, email_verified = ?, updated_at = ?
        WHERE provider = 'google' AND provider_subject = ?`
    )
      .bind(p.email ?? null, p.emailVerified ? 1 : 0, now, p.sub)
      .run();
    return existing.user_id;
  }

  let userId: string | null = null;

  if (p.emailVerified && p.email) {
    const byEmail = await env.DB.prepare(`SELECT id FROM users WHERE lower(email) = lower(?)`)
      .bind(p.email)
      .first<{ id: string }>();
    if (byEmail?.id) userId = byEmail.id;
  }

  if (!userId) {
    userId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, display_name, avatar_url, status, created_at, last_seen_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`
    )
      .bind(userId, p.email ?? null, p.name ?? null, p.picture ?? null, now, now, now)
      .run();
  }

  await env.DB.prepare(
    `INSERT INTO oauth_accounts (id, user_id, provider, provider_subject, email, email_verified, created_at, updated_at)
      VALUES (?, ?, 'google', ?, ?, ?, ?, ?)
      ON CONFLICT(provider, provider_subject) DO UPDATE SET email = excluded.email,
        email_verified = excluded.email_verified, updated_at = excluded.updated_at`
  )
    .bind(crypto.randomUUID(), userId, p.sub, p.email ?? null, p.emailVerified ? 1 : 0, now, now)
    .run();

  return userId;
}

/** 生成并存储一次性桌面登录码的哈希，返回明文 code。 */
export async function createDesktopLoginCode(
  env: Env,
  userId: string,
  code: string,
  ttlSeconds: number,
  pollChallenge: string | null = null
): Promise<void> {
  const codeHash = await sha256Hex(code);
  await env.DB.prepare(
    `INSERT INTO desktop_login_codes (code_hash, user_id, poll_challenge, used, expires_at, created_at)
      VALUES (?, ?, ?, 0, ?, ?)`
  )
    .bind(codeHash, userId, pollChallenge, isoInSeconds(ttlSeconds), nowIso())
    .run();
}

/**
 * 新版桌面登录：客户端只提交高熵 verifier，服务端计算 challenge 后原子消费登录码。
 * challenge 可公开，verifier 不经过浏览器，避免 localhost 回跳被拦截。
 */
export async function consumeDesktopLoginByPollVerifier(
  env: Env,
  pollVerifier: string
): Promise<string | null> {
  const pollChallenge = await sha256Hex(pollVerifier);
  const row = await env.DB.prepare(
    `UPDATE desktop_login_codes SET used = 1
      WHERE poll_challenge = ? AND used = 0 AND expires_at > ?
      RETURNING user_id`
  )
    .bind(pollChallenge, nowIso())
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}

/** 原子消费一次性登录码：未用且未过期才成功，用后即焚。返回 user_id 或 null。 */
export async function consumeDesktopLoginCode(env: Env, code: string): Promise<string | null> {
  const codeHash = await sha256Hex(code);
  const row = await env.DB.prepare(
    `UPDATE desktop_login_codes SET used = 1
      WHERE code_hash = ? AND used = 0 AND expires_at > ?
      RETURNING user_id`
  )
    .bind(codeHash, nowIso())
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}

/** 存储 refresh token 的哈希。 */
export async function storeRefreshToken(
  env: Env,
  userId: string,
  token: string,
  ttlDays: number,
  deviceHash: string | null = null
): Promise<void> {
  const tokenHash = await sha256Hex(token);
  await env.DB.prepare(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, device_hash, status, expires_at, created_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)`
  )
    .bind(crypto.randomUUID(), userId, tokenHash, deviceHash, isoInDays(ttlDays), nowIso())
    .run();
}

/**
 * 轮换 refresh token：把「吊销旧的」与「写入新的」放进同一个 D1 batch 原子事务，
 * 避免中途失败导致旧的已 revoked、新的没落库 → 用户被静默登出。
 * 校验通过（旧 token 仍 active 且未过期）返回 user_id 并已写好新 token；否则返回 null。
 */
export async function rotateRefreshToken(
  env: Env,
  oldToken: string,
  newToken: string,
  ttlDays: number,
  deviceHash: string | null = null
): Promise<string | null> {
  const oldHash = await sha256Hex(oldToken);
  const now = nowIso();

  const found = await env.DB.prepare(
    `SELECT user_id FROM refresh_tokens WHERE token_hash = ? AND status = 'active' AND expires_at > ?`
  )
    .bind(oldHash, now)
    .first<{ user_id: string }>();
  if (!found?.user_id) return null;

  const newHash = await sha256Hex(newToken);
  await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE refresh_tokens SET status = 'revoked', revoked_at = ?, last_used_at = ?
          WHERE token_hash = ? AND status = 'active'`
      )
      .bind(now, now, oldHash),
    env.DB
      .prepare(
        `INSERT INTO refresh_tokens (id, user_id, token_hash, device_hash, status, expires_at, created_at)
          VALUES (?, ?, ?, ?, 'active', ?, ?)`
      )
      .bind(crypto.randomUUID(), found.user_id, newHash, deviceHash, isoInDays(ttlDays), now),
  ]);

  return found.user_id;
}

export interface DeviceRow {
  user_id: string;
  device_hash: string;
  platform: string | null;
  app_version: string | null;
  license_status: string;
  trial_started_at: string;
  trial_expires_at: string;
  activated_at: string | null;
}

/**
 * 幂等 upsert 设备状态：
 *   - 首次插入 → 建 7 天试用，起止时间由服务端生成。
 *   - 已存在 → 只更新 last_seen/app_version/platform，绝不重置试用、不改 user_id
 *     （文档 §6.3：同一设备切换账号不能重开试用）。device_hash 唯一，天然防并发重复建。
 * 返回落库后的设备行。
 */
export async function upsertDeviceStatus(
  env: Env,
  input: {
    userId: string;
    deviceHash: string;
    installationIdHash?: string | null;
    platform?: string | null;
    appVersion?: string | null;
    trialDays: number;
  }
): Promise<DeviceRow> {
  const now = nowIso();
  const trialExpires = isoInDays(input.trialDays);

  await env.DB.prepare(
    `INSERT INTO license_devices
       (id, user_id, device_hash, installation_id_hash, platform, app_version,
        license_status, trial_started_at, trial_expires_at, last_seen_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'trial', ?, ?, ?, ?, ?)
     ON CONFLICT(device_hash) DO UPDATE SET
       last_seen_at = excluded.last_seen_at,
       app_version  = excluded.app_version,
       platform     = excluded.platform,
       updated_at   = excluded.updated_at`
  )
    .bind(
      crypto.randomUUID(),
      input.userId,
      input.deviceHash,
      input.installationIdHash ?? null,
      input.platform ?? null,
      input.appVersion ?? null,
      now,
      trialExpires,
      now,
      now,
      now
    )
    .run();

  const row = await env.DB.prepare(
    `SELECT user_id, device_hash, platform, app_version, license_status,
            trial_started_at, trial_expires_at, activated_at
       FROM license_devices WHERE device_hash = ?`
  )
    .bind(input.deviceHash)
    .first<DeviceRow>();

  if (!row) throw new Error('device upsert failed');
  return row;
}

/**
 * 记录设备当天的活跃事件。event_date 只使用 Worker 的 UTC 日期，客户端无权指定。
 * activity_events 的 (device_hash, event_date) 唯一约束负责跨进程、跨请求幂等。
 */
export async function recordActivityIfNeeded(
  env: Env,
  args: {
    userId: string;
    deviceHash: string;
    appVersion?: string | null;
    platform?: string | null;
  }
): Promise<boolean> {
  const eventDate = new Date().toISOString().slice(0, 10);
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO activity_events
       (user_id, device_hash, event_date, app_version, platform)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(
      args.userId,
      args.deviceHash,
      eventDate,
      args.appVersion ?? null,
      args.platform ?? null
    )
    .run();

  return result.meta.changes === 1;
}

export async function getUserStatus(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT status FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ status: string }>();
  return row?.status ?? null;
}

/** 主动退出：吊销该 refresh token。 */
export async function revokeRefreshToken(env: Env, token: string): Promise<void> {
  const tokenHash = await sha256Hex(token);
  const now = nowIso();
  await env.DB.prepare(
    `UPDATE refresh_tokens SET status = 'revoked', revoked_at = ? WHERE token_hash = ? AND status = 'active'`
  )
    .bind(now, tokenHash)
    .run();
}

// ---------- 授权码激活（文档 §9-11）----------

export interface LicenseDeviceRow {
  id: string;
  user_id: string;
  device_hash: string;
  license_status: string;
  license_key_id: string | null;
  activated_at: string | null;
}

export interface LicenseKeyRow {
  id: string;
  code_hash: string;
  status: string;
  license_type: string;
  bound_device_hash: string | null;
  bound_user_id: string | null;
  features: string; // JSON 文本
}

export async function getLicenseDeviceByHash(env: Env, deviceHash: string): Promise<LicenseDeviceRow | null> {
  const row = await env.DB.prepare(
    `SELECT id, user_id, device_hash, license_status, license_key_id, activated_at
       FROM license_devices WHERE device_hash = ?`
  )
    .bind(deviceHash)
    .first<LicenseDeviceRow>();
  return row ?? null;
}

export async function getLicenseKeyByCodeHash(env: Env, codeHash: string): Promise<LicenseKeyRow | null> {
  const row = await env.DB.prepare(
    `SELECT id, code_hash, status, license_type, bound_device_hash, bound_user_id, features
       FROM license_keys WHERE code_hash = ?`
  )
    .bind(codeHash)
    .first<LicenseKeyRow>();
  return row ?? null;
}

/** 按主键查授权码记录——恢复流程用（用户只提供 device_hash，不重新输入授权码）。 */
export async function getLicenseKeyById(env: Env, id: string): Promise<LicenseKeyRow | null> {
  const row = await env.DB.prepare(
    `SELECT id, code_hash, status, license_type, bound_device_hash, bound_user_id, features
       FROM license_keys WHERE id = ?`
  )
    .bind(id)
    .first<LicenseKeyRow>();
  return row ?? null;
}

/**
 * 原子激活：license_keys 的条件 UPDATE（status='unused' 才成功，防并发重复激活）
 * 与 license_devices 的条件 UPDATE（设备未绑定或已绑定同一把码才允许写，防止一台
 * 设备被两个不同授权码同时抢占）打包进同一个 D1 batch。
 *
 * 调用方必须检查两条语句各自的 meta.changes：都为 1 才算真正激活成功；
 * 任何一条不是 1 都说明发生了并发冲突或状态已变化，调用方需要重新读数据判断具体原因。
 */
export async function activateLicenseAtomic(
  env: Env,
  args: { codeHash: string; keyId: string; deviceHash: string; userId: string; now: string }
): Promise<{ keyChanges: number; deviceChanges: number }> {
  const updateKey = env.DB.prepare(
    `UPDATE license_keys SET status = 'used', activation_count = 1, bound_device_hash = ?,
       bound_user_id = ?, activated_at = ?, updated_at = ? WHERE code_hash = ? AND status = 'unused'`
  ).bind(args.deviceHash, args.userId, args.now, args.now, args.codeHash);

  const updateDevice = env.DB.prepare(
    `UPDATE license_devices SET user_id = ?, license_status = 'licensed', license_key_id = ?,
       activated_at = ?, updated_at = ? WHERE device_hash = ? AND (license_status != 'licensed' OR license_key_id = ?)`
  ).bind(args.userId, args.keyId, args.now, args.now, args.deviceHash, args.keyId);

  const [keyResult, deviceResult] = await env.DB.batch([updateKey, updateDevice]);
  return { keyChanges: keyResult.meta.changes, deviceChanges: deviceResult.meta.changes };
}
