import { useEffect, useState } from 'react';
import { isCanvasLocked } from '../../shared/licenseFeatures.js';
import type { LicenseState } from './useLicense';

/**
 * 画布是否已被试用到期锁死。
 *
 * 需要自己走时钟：试用可能在应用一直开着的时候走完，而 license 状态此刻不会
 * 变化（主进程推的还是同一份 trial 状态），只有「现在几点」变了。每分钟重算
 * 一次，与顶部试用条的刷新节奏一致。
 */
export function useCanvasLocked(license: LicenseState): boolean {
  const [, tick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  return isCanvasLocked(license, Date.now());
}
