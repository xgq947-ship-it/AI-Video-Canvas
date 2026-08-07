/**
 * 桌面 Google 登录的轮询证明。
 *
 * 浏览器只拿到 SHA-256 challenge，应用保留高熵 verifier。Google 回调完成后，
 * 应用用 verifier 主动向 Worker 领取会话，因此不依赖浏览器访问 localhost。
 */

import { createHash, randomBytes } from 'node:crypto';

export const DEFAULT_LOGIN_POLL_INTERVAL_MS = 1_000;
const REQUEST_TIMEOUT_MS = 10_000;

export function createDesktopPollProof() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier, 'utf8').digest('hex');
  return { verifier, challenge };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postWithTimeout(apiPost, pathname, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await apiPost(pathname, body, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 轮询 Worker，直到 Google 回调完成并签发桌面会话。
 * 202/5xx/暂时网络错误会继续重试；确定性 4xx 立即反馈给用户。
 */
export async function pollDesktopSession({
  apiPost,
  pollVerifier,
  deviceHash,
  timeoutMs,
  intervalMs = DEFAULT_LOGIN_POLL_INTERVAL_MS,
}) {
  if (typeof apiPost !== 'function') throw new Error('登录轮询未配置');
  if (!pollVerifier) throw new Error('登录轮询凭据缺失');

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const requestTimeout = Math.max(1, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now()));
    try {
      const { ok, status, data } = await postWithTimeout(
        apiPost,
        '/auth/poll',
        { poll_verifier: pollVerifier, device_hash: deviceHash },
        requestTimeout
      );
      if (ok && data?.success) return data;
      if (status !== 202 && status < 500) {
        throw new Error(data?.message || `登录确认失败(${status})`);
      }
    } catch (error) {
      // 确定性业务错误直接失败；网络中断、请求超时继续轮询到总超时。
      if (error instanceof Error && /^登录确认失败\(/.test(error.message)) throw error;
      if (error instanceof Error && !['AbortError', 'TypeError'].includes(error.name)) throw error;
    }

    const remaining = deadline - Date.now();
    if (remaining > 0) await delay(Math.min(intervalMs, remaining));
  }

  throw new Error('登录超时，请重试');
}
