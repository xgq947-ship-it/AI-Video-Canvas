/** P1：Google OAuth（Authorization Code + PKCE + OIDC）与桌面会话签发/刷新。 */

import type { Env } from '../env.js';
import { json, errorJson, redirect, html, preflight } from '../lib/http.js';
import { randomToken } from '../lib/crypto.js';
import {
  signState,
  verifyState,
  issueAccessToken,
  verifyAccessToken,
  generateCodeVerifier,
  codeChallengeS256,
} from '../lib/tokens.js';
import { verifyGoogleIdToken } from '../lib/oidc.js';
import {
  findOrCreateUserByGoogle,
  createDesktopLoginCode,
  consumeDesktopLoginCode,
  storeRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
} from '../lib/db.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** GET /auth/google/start?port=NNNN —— 生成 state+PKCE+nonce，跳 Google 授权页。 */
export async function handleGoogleStart(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const portParam = url.searchParams.get('port');
  let port: number | null = null;
  if (portParam !== null) {
    const n = Number(portParam);
    if (!Number.isInteger(n) || n < 1 || n > 65535) return errorJson('BAD_REQUEST', 'port 非法', 400);
    port = n;
  }

  const nonce = randomToken(16);
  const codeVerifier = generateCodeVerifier();
  const challenge = await codeChallengeS256(codeVerifier);
  const state = await signState(env.SESSION_SIGNING_SECRET, { nonce, codeVerifier, port });

  const auth = new URL(GOOGLE_AUTH_URL);
  auth.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  auth.searchParams.set('redirect_uri', env.GOOGLE_REDIRECT_URI);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('scope', 'openid email profile');
  auth.searchParams.set('code_challenge', challenge);
  auth.searchParams.set('code_challenge_method', 'S256');
  auth.searchParams.set('state', state);
  auth.searchParams.set('nonce', nonce);
  // 不申请 access_type=offline / prompt=consent：我们用自签发的会话 refresh token，
  // 不需要 Google 的 refresh token，也不该每次登录都强制弹同意屏（文档 §3.1）。

  return redirect(auth.toString());
}

/** GET /auth/google/callback?code=&state= —— 校验、换 token、验 id_token、建用户、发一次性 code。 */
export async function handleGoogleCallback(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');
  if (oauthError) return html(`<p>Google 授权被拒绝：${escapeHtml(oauthError)}</p>`, 400);
  if (!code || !stateParam) return errorJson('BAD_REQUEST', '缺少 code 或 state', 400);

  const state = await verifyState(env.SESSION_SIGNING_SECRET, stateParam);
  if (!state) return errorJson('BAD_STATE', 'state 校验失败或已过期', 400);

  // 用 code + code_verifier 向 Google 换 token（服务端直连，Client Secret 不出 Worker）
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
      code_verifier: state.codeVerifier,
    }),
  });
  if (!tokenRes.ok) {
    const detail = await tokenRes.text();
    console.error('[oauth] token 交换失败', tokenRes.status, detail);
    return errorJson('TOKEN_EXCHANGE_FAILED', 'Google 令牌交换失败', 502);
  }
  const tokenData = (await tokenRes.json()) as { id_token?: string };
  if (!tokenData.id_token) return errorJson('NO_ID_TOKEN', 'Google 未返回 id_token', 502);

  const verified = await verifyGoogleIdToken(tokenData.id_token, {
    clientId: env.GOOGLE_CLIENT_ID,
    nonce: state.nonce,
  });
  if (!verified.ok || !verified.claims) {
    console.error('[oauth] id_token 校验失败', verified.error);
    return errorJson('ID_TOKEN_INVALID', 'id_token 校验失败', 401);
  }

  const claims = verified.claims;
  const userId = await findOrCreateUserByGoogle(env, {
    sub: claims.sub,
    email: claims.email,
    emailVerified: claims.email_verified,
    name: claims.name,
    picture: claims.picture,
  });

  // 一次性桌面登录码（60-120s），浏览器只带它回客户端
  const loginCode = randomToken(32);
  const ttl = Number(env.DESKTOP_LOGIN_CODE_TTL_SECONDS) || 120;
  await createDesktopLoginCode(env, userId, loginCode, ttl);

  // 回桌面：只允许跳 loopback 主机，防开放重定向
  if (state.port !== null) {
    const allowed = env.ALLOWED_LOOPBACK_HOSTS.split(',').map((h) => h.trim());
    const host = allowed.includes('127.0.0.1') ? '127.0.0.1' : allowed[0] || '127.0.0.1';
    const target = `http://${host}:${state.port}/oauth/callback?code=${encodeURIComponent(loginCode)}`;
    return html(loginBounceHtml(target), 200);
  }

  // 纯浏览器调试路径：不落地明文长期 token，只回一次性 code 供手动 exchange
  return json({
    success: true,
    note: '未带 port（调试模式）。用此 code 调 POST /auth/exchange 换会话。',
    desktop_login_code: loginCode,
    expires_in: ttl,
  });
}

/** POST /auth/exchange { code } —— 一次性 code 换 access + refresh token。 */
export async function handleExchange(req: Request, env: Env): Promise<Response> {
  const body = await safeJson<{ code?: string; device_hash?: string }>(req);
  if (!body?.code) return errorJson('BAD_REQUEST', '缺少 code', 400);

  const userId = await consumeDesktopLoginCode(env, body.code);
  if (!userId) return errorJson('CODE_INVALID', 'code 无效或已使用/过期', 401);

  return issueSession(env, userId, body.device_hash ?? null);
}

/** POST /auth/refresh { refresh_token } —— 轮换 refresh，签发新 access。 */
export async function handleRefresh(req: Request, env: Env): Promise<Response> {
  const body = await safeJson<{ refresh_token?: string; device_hash?: string }>(req);
  if (!body?.refresh_token) return errorJson('BAD_REQUEST', '缺少 refresh_token', 400);

  const refreshTtlDays = Number(env.REFRESH_TOKEN_TTL_DAYS) || 180;
  const newRefresh = randomToken(32);
  // 原子轮换：吊销旧 + 写入新 在一个 batch 里，避免半途失败把用户登出。
  const userId = await rotateRefreshToken(
    env,
    body.refresh_token,
    newRefresh,
    refreshTtlDays,
    body.device_hash ?? null
  );
  if (!userId) return errorJson('REFRESH_INVALID', 'refresh_token 无效或已过期', 401);

  const accessTtl = Number(env.ACCESS_TOKEN_TTL_SECONDS) || 3600;
  const accessToken = await issueAccessToken(env.SESSION_SIGNING_SECRET, userId, accessTtl);
  const user = await env.DB.prepare(
    `SELECT id, email, display_name, avatar_url FROM users WHERE id = ?`
  )
    .bind(userId)
    .first();

  return json({
    success: true,
    access_token: accessToken,
    refresh_token: newRefresh,
    token_type: 'Bearer',
    expires_in: accessTtl,
    user,
  });
}

/** POST /auth/logout { refresh_token } —— 吊销当前会话。 */
export async function handleLogout(req: Request, env: Env): Promise<Response> {
  const body = await safeJson<{ refresh_token?: string }>(req);
  if (body?.refresh_token) await revokeRefreshToken(env, body.refresh_token);
  return json({ success: true });
}

/** GET /auth/me （Bearer access token）—— 便于联调查看当前用户。 */
export async function handleMe(req: Request, env: Env): Promise<Response> {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const claims = await verifyAccessToken(env.SESSION_SIGNING_SECRET, token);
  if (!claims) return errorJson('AUTH_REQUIRED', '需要有效 access token', 401);

  const user = await env.DB.prepare(
    `SELECT id, email, display_name, avatar_url, status FROM users WHERE id = ?`
  )
    .bind(claims.sub)
    .first();
  if (!user) return errorJson('USER_NOT_FOUND', '用户不存在', 404);
  return json({ success: true, user });
}

// ---------- 内部工具 ----------

async function issueSession(env: Env, userId: string, deviceHash: string | null): Promise<Response> {
  const accessTtl = Number(env.ACCESS_TOKEN_TTL_SECONDS) || 3600;
  const refreshTtlDays = Number(env.REFRESH_TOKEN_TTL_DAYS) || 180;

  const accessToken = await issueAccessToken(env.SESSION_SIGNING_SECRET, userId, accessTtl);
  const refreshToken = randomToken(32);
  await storeRefreshToken(env, userId, refreshToken, refreshTtlDays, deviceHash);

  const user = await env.DB.prepare(
    `SELECT id, email, display_name, avatar_url FROM users WHERE id = ?`
  )
    .bind(userId)
    .first();

  return json({
    success: true,
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: accessTtl,
    user,
  });
}

async function safeJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** 回桌面的中转页：自动跳 loopback，并给出手动按钮兜底。 */
function loginBounceHtml(target: string): string {
  const safe = escapeHtml(target);
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>登录成功 · AI Canvas</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#111;color:#eee;display:flex;
min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{text-align:center;max-width:420px;padding:32px}a{color:#7aa2ff}</style></head>
<body><div class="card"><h2>登录成功</h2><p>正在返回 AI Canvas…</p>
<p><a href="${safe}">若未自动跳转，请点此返回应用</a></p></div>
<script>location.replace(${JSON.stringify(target)});</script></body></html>`;
}

export { preflight };
