/**
 * shared/licenseSignature.js
 *
 * 永久许可证签名的编码/签发/验签（文档 §8）。全部用 WebCrypto（globalThis.crypto.subtle），
 * Cloudflare Worker、Node 22+、Electron 主进程三处原生都有，不需要按环境分支实现，
 * 也不需要任何额外依赖（不加 tweetnacl 之类的包）。
 *
 * 签名契约（关键，破坏它会让验签在"看起来什么都对"的情况下悄悄失败）：
 *   对 payload 的 base64url **字符串本身**的 ASCII 字节签名，不是重新序列化的 JSON。
 *   签发方（Worker）和验证方（客户端/服务端）都必须把 payloadB64url 当不透明字符串
 *   处理——只在验签通过之后才 decode 读字段，绝不在验签前 decode 再重新 encode。
 */

const enc = new TextEncoder();

function b64urlEncode(bytes) {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * 把许可证 payload 对象编码成 base64url JSON 字符串。签发方唯一入口——
 * 之后签名的就是这个函数返回的字符串本身，不能再动它。
 * @param {object} payload
 * @returns {string}
 */
export function encodeLicensePayload(payload) {
  return b64urlEncode(enc.encode(JSON.stringify(payload)));
}

/**
 * 从 base64url 字符串解出 payload 对象。只用于验签通过之后读字段展示，
 * 绝不能把 decode 的结果重新编码后拿去验签（那样等于验证了一份新造的字符串）。
 * @param {string} payloadB64url
 * @returns {object}
 */
export function decodeLicensePayload(payloadB64url) {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64url)));
}

/**
 * 用 PKCS8 DER 私钥对 payloadB64url 字符串签名。只应在服务端（Worker）调用——
 * 私钥不允许进入客户端，这个函数本身在客户端也能跑，但客户端永远拿不到私钥参数。
 * @param {string} payloadB64url
 * @param {Uint8Array} pkcs8Der
 * @returns {Promise<string>} 签名的 base64url
 */
export async function signLicensePayload(payloadB64url, pkcs8Der) {
  const key = await crypto.subtle.importKey('pkcs8', pkcs8Der, { name: 'Ed25519' }, false, ['sign']);
  const sig = await crypto.subtle.sign('Ed25519', key, enc.encode(payloadB64url));
  return b64urlEncode(new Uint8Array(sig));
}

/**
 * 用 SPKI DER 公钥验证 payloadB64url 的签名。客户端与服务端都会调用。
 * 任何异常（格式错误、密钥不匹配等）一律返回 false，不抛错——调用方不需要
 * 区分"密钥损坏"和"签名不对"，两者都意味着不可信。
 * @param {string} payloadB64url
 * @param {string} signatureB64url
 * @param {Uint8Array} spkiDer
 * @returns {Promise<boolean>}
 */
export async function verifyLicenseSignature(payloadB64url, signatureB64url, spkiDer) {
  try {
    const key = await crypto.subtle.importKey('spki', spkiDer, { name: 'Ed25519' }, false, ['verify']);
    const sig = b64urlDecode(signatureB64url);
    return await crypto.subtle.verify('Ed25519', key, sig, enc.encode(payloadB64url));
  } catch {
    return false;
  }
}

/**
 * 解析 PEM 文本，提取原始 DER 字节。用于把 .dev.vars / wrangler secret 里存的
 * PEM 格式密钥转成 WebCrypto importKey 需要的 DER。
 * @param {string} pem
 * @returns {Uint8Array}
 */
export function pemToDer(pem) {
  const base64 = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export { b64urlEncode, b64urlDecode };
