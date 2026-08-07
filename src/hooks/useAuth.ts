import { useCallback, useEffect, useState } from 'react';

export type AuthStatus = 'login_required' | 'authenticating' | 'authenticated' | 'offline' | 'error';

export interface AuthUser {
  id: string;
  email?: string;
  display_name?: string;
  avatar_url?: string;
}

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  error: string | null;
}

interface DesktopAuthBridge {
  getConfig(): Promise<{ loginEnabled: boolean }>;
  getState(): Promise<AuthState>;
  signIn(): Promise<AuthState>;
  signOut(): Promise<AuthState>;
  onState(cb: (s: AuthState) => void): () => void;
}

function getBridge(): DesktopAuthBridge | null {
  const w = window as unknown as { evanDesktop?: { auth?: DesktopAuthBridge } };
  return w?.evanDesktop?.auth ?? null;
}

/** 是否运行在桌面壳内（有主进程鉴权桥）。web 预览时为 false。 */
export function hasDesktopAuth(): boolean {
  return getBridge() !== null;
}

/**
 * 订阅主进程鉴权状态并暴露登录/登出动作。
 * 无桥（web 预览/未启用）时保持 login_required，signIn 给出温和提示，不崩。
 */
export function useAuth() {
  const [state, setState] = useState<AuthState>({ status: 'login_required', user: null, error: null });

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    let active = true;
    bridge.getState().then((s) => active && setState(s)).catch(() => {});
    const unsub = bridge.onState((s) => active && setState(s));
    return () => {
      active = false;
      unsub();
    };
  }, []);

  const signIn = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge) {
      setState((s) => ({ ...s, status: 'error', error: '请在桌面应用中登录' }));
      return;
    }
    setState((s) => ({ ...s, status: 'authenticating', error: null }));
    try {
      setState(await bridge.signIn());
    } catch (e) {
      setState((s) => ({ ...s, status: 'error', error: (e as Error)?.message || '登录失败' }));
    }
  }, []);

  const signOut = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge) return;
    setState(await bridge.signOut());
  }, []);

  return { state, signIn, signOut, hasBridge: getBridge() !== null };
}

/**
 * 登录总开关的唯一来源：主进程的 GOOGLE_LOGIN_ENABLED（见 electron/authConfig.js）。
 * 不用构建期 VITE_ 常量——两套开关分别在不同构建流水线配置，一旦不一致就会出现
 * 「登录页弹出但执行层从不锁」或反过来「执行层已锁但登录页从不出现，用户永远进不去」
 * 这类难排查的死锁，参见 electron/main.js 上 ipcMain.handle('auth:get-config') 的注释。
 *
 * 返回 null 表示尚未问到主进程（正在启动中）；调用方应在此期间不渲染任何内容，
 * 既不假设「已启用」也不假设「未启用」。web 预览（无桥）立即解析为 false。
 */
export function useLoginEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) {
      setEnabled(false);
      return;
    }
    let active = true;
    bridge
      .getConfig()
      .then((c) => active && setEnabled(Boolean(c?.loginEnabled)))
      .catch(() => active && setEnabled(false));
    return () => {
      active = false;
    };
  }, []);

  return enabled;
}
