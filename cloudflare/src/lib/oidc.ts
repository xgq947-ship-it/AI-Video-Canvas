/**
 * Google OIDC id_token 校验（文档 §4.2：校验签名 + iss/aud/exp/nonce）。
 * id_token 虽然来自服务端换取（TLS 直连 Google token 端点），仍按最佳实践做 JWKS 验签。
 */

import { b64urlDecode } from './crypto.js';

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const VALID_ISS = new Set(['https://accounts.google.com', 'accounts.google.com']);

interface Jwk {
  kid: string;
  n: string;
  e: string;
  alg?: string;
  kty: string;
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

async function getJwks(): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetch(GOOGLE_JWKS_URL);
  if (!res.ok) throw new Error(`JWKS 拉取失败: ${res.status}`);
  const data = (await res.json()) as { keys: Jwk[] };
  jwksCache = { keys: data.keys, fetchedAt: Date.now() };
  return data.keys;
}

function decodeSegment(seg: string): any {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(seg)));
}

export interface GoogleIdClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  iss: string;
  aud: string;
  exp: number;
  nonce?: string;
}

export interface VerifyResult {
  ok: boolean;
  claims?: GoogleIdClaims;
  error?: string;
}

export async function verifyGoogleIdToken(
  idToken: string,
  expected: { clientId: string; nonce: string }
): Promise<VerifyResult> {
  const parts = idToken.split('.');
  if (parts.length !== 3) return { ok: false, error: 'id_token 格式错误' };

  let header: { kid?: string; alg?: string };
  let claims: GoogleIdClaims;
  try {
    header = decodeSegment(parts[0]);
    claims = decodeSegment(parts[1]);
  } catch {
    return { ok: false, error: 'id_token 解码失败' };
  }

  if (header.alg !== 'RS256') return { ok: false, error: '不支持的签名算法' };

  // 验签
  const keys = await getJwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, error: '找不到匹配的 JWKS 公钥' };

  let signatureValid = false;
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    signatureValid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(parts[2]), signingInput);
  } catch (e) {
    return { ok: false, error: `验签异常: ${(e as Error).message}` };
  }
  if (!signatureValid) return { ok: false, error: 'id_token 签名无效' };

  // 声明校验
  if (!VALID_ISS.has(claims.iss)) return { ok: false, error: 'iss 不匹配' };
  if (claims.aud !== expected.clientId) return { ok: false, error: 'aud 不匹配' };
  if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000))
    return { ok: false, error: 'id_token 已过期' };
  if (claims.nonce !== expected.nonce) return { ok: false, error: 'nonce 不匹配' };

  return { ok: true, claims };
}
