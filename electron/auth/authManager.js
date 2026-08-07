/**
 * 主进程会话管理器（文档 §20 客户端状态机的登录部分）。
 *
 * 职责：发起 Google 登录（系统浏览器 + loopback 回调）、用一次性 code 换会话、
 * 把 refresh token 存进 SecureStore、Access Token 到期前自动刷新、退出登录。
 *
 * 安全：Access Token 只留内存；Refresh Token 只经 SecureStore（safeStorage 加密）落盘，
 * 绝不回传渲染进程，绝不写明文文件/localStorage。
 */

import { shell } from 'electron';
import { startLoopbackServer } from './loopbackServer.js';
import { AUTH_BASE_URL, LOGIN_TIMEOUT_MS, SECURE_KEYS } from '../authConfig.js';

/** @typedef {'login_required'|'authenticating'|'authenticated'|'offline'|'error'} AuthStatus */

export function createAuthManager({ secureStore, deviceIdentity, baseUrl = AUTH_BASE_URL, onStateChange }) {
  if (!secureStore) throw new Error('createAuthManager: 需要 secureStore');
  if (!deviceIdentity) throw new Error('createAuthManager: 需要 deviceIdentity');

  /** @type {{ status: AuthStatus, user: any, error: string|null }} */
  let state = { status: 'login_required', user: null, error: null };
  let accessToken = null;
  let accessExpiresAt = 0; // epoch ms
  let refreshTimer = null;

  function setState(next) {
    state = { ...state, ...next };
    try {
      onStateChange?.(publicState());
    } catch (e) {
      console.error('[auth] onStateChange 回调异常：', e.message);
    }
  }

  function publicState() {
    // 只暴露非敏感字段给渲染进程。
    return { status: state.status, user: state.user, error: state.error };
  }

  async function apiPost(pathname, body) {
    const res = await fetch(`${baseUrl}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* 非 JSON 响应 */
    }
    return { ok: res.ok, status: res.status, data };
  }

  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
    if (!accessExpiresAt) return;
    // 到期前 60s 刷新，最少 5s 后。
    const delay = Math.max(5_000, accessExpiresAt - Date.now() - 60_000);
    refreshTimer = setTimeout(() => {
      void refresh();
    }, delay);
    refreshTimer.unref?.();
  }

  function applySession(data) {
    accessToken = data.access_token || null;
    accessExpiresAt = data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : 0;
    scheduleRefresh();
  }

  async function persistSession(data) {
    if (data.refresh_token) await secureStore.set(SECURE_KEYS.REFRESH_TOKEN, data.refresh_token);
    if (data.user?.id) await secureStore.set(SECURE_KEYS.USER_ID, data.user.id);
  }

  async function clearSession() {
    accessToken = null;
    accessExpiresAt = 0;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
    await secureStore.delete(SECURE_KEYS.REFRESH_TOKEN);
    await secureStore.delete(SECURE_KEYS.USER_ID);
  }

  /** 启动时恢复会话：有 refresh token 就刷新；网络不可用则进 offline（保留会话）。 */
  async function loadSession() {
    const refreshToken = await secureStore.get(SECURE_KEYS.REFRESH_TOKEN);
    if (!refreshToken) {
      setState({ status: 'login_required', user: null, error: null });
      return publicState();
    }
    return refresh();
  }

  /** 用存量 refresh token 轮换、刷新 Access Token。 */
  async function refresh() {
    const refreshToken = await secureStore.get(SECURE_KEYS.REFRESH_TOKEN);
    if (!refreshToken) {
      setState({ status: 'login_required', user: null, error: null });
      return publicState();
    }
    let identity;
    try {
      identity = await deviceIdentity.ensureIdentity();
    } catch {
      identity = { deviceHash: null };
    }
    try {
      const { ok, status, data } = await apiPost('/auth/refresh', {
        refresh_token: refreshToken,
        device_hash: identity.deviceHash,
      });
      if (ok && data?.success) {
        await persistSession(data);
        applySession(data);
        setState({ status: 'authenticated', user: data.user || state.user, error: null });
        return publicState();
      }
      if (status === 401) {
        // refresh 失效：清会话，要求重新登录。
        await clearSession();
        setState({ status: 'login_required', user: null, error: null });
        return publicState();
      }
      // 其他服务端错误：保留会话，进 offline（本地会话仍有效可继续用）。
      setState({ status: 'offline', error: data?.message || `刷新失败(${status})` });
      return publicState();
    } catch (networkError) {
      // 网络不可用：已登录用户可继续进入应用（文档 §3.1）。
      setState({ status: 'offline', error: '网络不可用' });
      return publicState();
    }
  }

  /** 发起 Google 登录：系统浏览器 + loopback 回调 + 一次性 code 换会话。 */
  async function signIn() {
    if (state.status === 'authenticating') return publicState();
    setState({ status: 'authenticating', error: null });
    try {
      const identity = await deviceIdentity.ensureIdentity();
      const { port, waitForCode } = await startLoopbackServer({ timeoutMs: LOGIN_TIMEOUT_MS });

      const startUrl = `${baseUrl}/auth/google/start?port=${port}`;
      await shell.openExternal(startUrl);

      const code = await waitForCode();

      const { ok, data, status } = await apiPost('/auth/exchange', {
        code,
        device_hash: identity.deviceHash,
      });
      if (!ok || !data?.success) {
        throw new Error(data?.message || `换取会话失败(${status})`);
      }
      await persistSession(data);
      applySession(data);
      setState({ status: 'authenticated', user: data.user || null, error: null });
      return publicState();
    } catch (error) {
      setState({ status: 'error', error: error.message || '登录失败' });
      return publicState();
    }
  }

  /** 退出登录：尽力吊销服务端 refresh，清本机会话。 */
  async function signOut() {
    const refreshToken = await secureStore.get(SECURE_KEYS.REFRESH_TOKEN);
    if (refreshToken) {
      try {
        await apiPost('/auth/logout', { refresh_token: refreshToken });
      } catch {
        /* 网络失败也要清本地 */
      }
    }
    await clearSession();
    setState({ status: 'login_required', user: null, error: null });
    return publicState();
  }

  return {
    getState: publicState,
    /** 仅供主进程内部（如后续给 Express 下发）取用，不经 IPC 暴露。 */
    getAccessToken: () => accessToken,
    loadSession,
    refresh,
    signIn,
    signOut,
  };
}
