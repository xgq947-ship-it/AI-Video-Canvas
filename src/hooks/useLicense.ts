import { useCallback, useEffect, useState } from 'react';

export type LicenseStatus = 'unknown' | 'trial' | 'expired' | 'licensed' | 'blocked';

export interface LicenseState {
  status: LicenseStatus;
  /** epoch 毫秒；试用起止时间 */
  trialStartedAt: number | null;
  trialExpiresAt: number | null;
  /** epoch 毫秒；永久授权的激活/签发时间，仅 status==='licensed' 时有值 */
  licensedAt: number | null;
  features: string[];
  /** true 表示当前状态可能已过期（离线/刷新失败保留的旧值） */
  stale: boolean;
}

const INITIAL: LicenseState = {
  status: 'unknown',
  trialStartedAt: null,
  trialExpiresAt: null,
  licensedAt: null,
  features: [],
  stale: true,
};

export interface ActivateResult {
  success: boolean;
  code?: string;
  message?: string;
}

interface LicenseBridge {
  getState(): Promise<LicenseState>;
  refresh(): Promise<LicenseState>;
  activate(licenseCode: string): Promise<ActivateResult>;
  onState(cb: (s: LicenseState) => void): () => void;
}

function getBridge(): LicenseBridge | null {
  const w = window as unknown as { evanDesktop?: { license?: LicenseBridge } };
  return w?.evanDesktop?.license ?? null;
}

/** 订阅主进程推送的试用/授权状态。无桥（web 预览）时保持 unknown。 */
export function useLicense() {
  const [state, setState] = useState<LicenseState>(INITIAL);

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

  const activate = useCallback(async (licenseCode: string): Promise<ActivateResult> => {
    const bridge = getBridge();
    if (!bridge) return { success: false, code: 'NO_BRIDGE', message: '请在桌面应用中操作' };
    return bridge.activate(licenseCode);
  }, []);

  const refresh = useCallback(async (): Promise<LicenseState> => {
    const bridge = getBridge();
    if (!bridge) return INITIAL;
    const next = await bridge.refresh();
    setState(next);
    return next;
  }, []);

  return { state, activate, refresh };
}
