/**
 * 签名 state（PKCE/nonce/loopback 端口的无状态载体）与会话 access token。
 * 两者都用 SESSION_SIGNING_SECRET 做 HMAC；state 经 Google 原样回传，客户端无法篡改。
 */

import { b64urlEncodeString, b64urlDecodeToString, hmacSign, hmacVerify, randomToken } from './crypto.js';

const enc = new TextEncoder();

async function seal(secret: string, obj: unknown): Promise<string> {
  const payload = b64urlEncodeString(JSON.stringify(obj));
  const sig = await hmacSign(secret, payload);
  return `${payload}.${sig}`;
}

async function open<T>(secret: string, token: string): Promise<T | null> {
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!(await hmacVerify(secret, payload, sig))) return null;
  try {
    return JSON.parse(b64urlDecodeToString(payload)) as T;
  } catch {
    return null;
  }
}

// ---------- OAuth state ----------

export interface OAuthState {
  v: 1;
  nonce: string;
  codeVerifier: string;
  port: number | null; // 桌面 loopback 回调端口；null 表示纯浏览器调试
  pollChallenge?: string | null; // 新版桌面轮询挑战；只有客户端持有 verifier
  exp: number; // epoch 秒
}

export async function signState(
  secret: string,
  data: {
    nonce: string;
    codeVerifier: string;
    port: number | null;
    pollChallenge?: string | null;
    ttlSeconds?: number;
  }
): Promise<string> {
  const state: OAuthState = {
    v: 1,
    nonce: data.nonce,
    codeVerifier: data.codeVerifier,
    port: data.port,
    pollChallenge: data.pollChallenge ?? null,
    exp: Math.floor(Date.now() / 1000) + (data.ttlSeconds ?? 600),
  };
  return seal(secret, state);
}

export async function verifyState(secret: string, token: string): Promise<OAuthState | null> {
  const state = await open<OAuthState>(secret, token);
  if (!state || state.v !== 1) return null;
  if (typeof state.exp !== 'number' || state.exp < Math.floor(Date.now() / 1000)) return null;
  if (state.pollChallenge != null && !/^[a-f0-9]{64}$/.test(state.pollChallenge)) return null;
  return state;
}

// ---------- Access token ----------

export interface AccessClaims {
  sub: string; // 内部 user_id
  typ: 'access';
  iat: number;
  exp: number;
}

export async function issueAccessToken(secret: string, userId: string, ttlSeconds: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: AccessClaims = { sub: userId, typ: 'access', iat: now, exp: now + ttlSeconds };
  return seal(secret, claims);
}

export async function verifyAccessToken(secret: string, token: string): Promise<AccessClaims | null> {
  const claims = await open<AccessClaims>(secret, token);
  if (!claims || claims.typ !== 'access') return null;
  if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims;
}

// ---------- PKCE ----------

export function generateCodeVerifier(): string {
  return randomToken(32);
}

export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(verifier));
  // base64url，无 padding
  let str = '';
  for (const b of new Uint8Array(digest)) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
