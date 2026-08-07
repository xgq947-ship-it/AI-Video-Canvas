/**
 * 主进程试用/授权状态管理（文档 §12、§20）。
 *
 * 启动顺序（离线优先，文档 §20 LOAD_LOCAL_LICENSE 分支）：
 *   1. loadLocalLicense()：先读本地 SecureStore 里的签名许可证并验签，
 *      通过且 device_hash 匹配当前设备 → 直接进入 licensed，全程不发网络请求。
 *      这是"永久授权成功后支持离线使用"的唯一正确实现——不是"网络失败时降级"，
 *      是从设计上根本不需要网络。
 *   2. 没有本地有效许可证时才 FETCH_DEVICE_STATUS：调 /api/device/status。
 *      服务端说 trial/expired/blocked 照抄那个状态；服务端说 licensed 但本地
 *      没有对应许可证（比如重装了应用、本地文件丢失）→ 自动调 /api/license/restore
 *      补签一份存回本地。
 *
 * 过期（trial）判断用「最近一次可信服务端时间 + 本地单调时钟」，回拨系统时间
 * 无法延长试用；永久授权（licensed）状态不受这个限制，也不受 24 小时复验限制。
 */

import { performance } from 'node:perf_hooks';
import { AUTH_BASE_URL, SECURE_KEYS, LICENSE_PUBLIC_KEY_SPKI_B64URL } from '../authConfig.js';
import { verifyStoredLicense } from './licenseVerifier.js';

function platformLabel() {
  if (process.platform === 'darwin') return 'macOS';
  if (process.platform === 'win32') return 'Windows';
  return process.platform;
}

export function createLicenseManager({
  authManager,
  deviceIdentity,
  secureStore,
  baseUrl = AUTH_BASE_URL,
  appVersion,
  onStateChange,
}) {
  if (!authManager) throw new Error('createLicenseManager: 需要 authManager');
  if (!deviceIdentity) throw new Error('createLicenseManager: 需要 deviceIdentity');
  if (!secureStore) throw new Error('createLicenseManager: 需要 secureStore');

  // 本地验签通过的永久许可证。一旦设置，publicState() 恒返回 licensed，不看 trialSnap。
  let licensedPayload = null; // shared/licenseSignature.js 的 LicensePayload

  // 试用/过期/封禁的最近一次可信快照。null 表示尚未取到。
  let trialSnap = null; // { status, trialStartedAtMs, trialExpiresAtMs, features, serverTimeMs, fetchedAtMono }

  function publicState(stale = false) {
    if (licensedPayload) {
      return {
        status: 'licensed',
        trialStartedAt: null,
        trialExpiresAt: null,
        licensedAt: typeof licensedPayload.issued_at === 'number' ? licensedPayload.issued_at * 1000 : null,
        features: licensedPayload.features,
        stale: false,
      };
    }
    if (!trialSnap) {
      return { status: 'unknown', trialStartedAt: null, trialExpiresAt: null, licensedAt: null, features: [], stale: true };
    }
    // 单调时钟推进的“当前服务端时刻”，不受系统时间回拨影响。
    const effectiveNow = trialSnap.serverTimeMs + (performance.now() - trialSnap.fetchedAtMono);
    let status = trialSnap.status;
    if (status === 'trial' && trialSnap.trialExpiresAtMs && effectiveNow > trialSnap.trialExpiresAtMs) {
      status = 'expired';
    }
    return {
      status,
      trialStartedAt: trialSnap.trialStartedAtMs,
      trialExpiresAt: trialSnap.trialExpiresAtMs,
      licensedAt: null,
      features: trialSnap.features,
      stale,
    };
  }

  function emit(stale = false) {
    try {
      onStateChange?.(publicState(stale));
    } catch (e) {
      console.error('[license] onStateChange 异常：', e.message);
    }
  }

  async function currentDeviceHash() {
    try {
      const identity = await deviceIdentity.ensureIdentity();
      return identity.deviceHash;
    } catch {
      return null;
    }
  }

  /** 把服务端返回的签名许可证验签、存本地、更新状态。验签失败则不落盘、不改状态。 */
  async function applyIssuedLicense(license, deviceHash) {
    const result = await verifyStoredLicense(license, deviceHash, LICENSE_PUBLIC_KEY_SPKI_B64URL);
    if (!result.valid) {
      console.error('[license] 服务端返回的许可证验签失败，拒绝采信：', result.reason);
      return false;
    }
    await secureStore.set(SECURE_KEYS.LICENSE_PAYLOAD, license.payload);
    await secureStore.set(SECURE_KEYS.LICENSE_SIGNATURE, license.signature);
    licensedPayload = result.payload;
    emit(false);
    return true;
  }

  /** 启动时调用：读本地许可证并验签，不发任何网络请求。 */
  async function loadLocalLicense() {
    const payload = await secureStore.get(SECURE_KEYS.LICENSE_PAYLOAD);
    const signature = await secureStore.get(SECURE_KEYS.LICENSE_SIGNATURE);
    if (!payload || !signature) return false;

    const deviceHash = await currentDeviceHash();
    if (!deviceHash) return false;

    const result = await verifyStoredLicense({ payload, signature }, deviceHash, LICENSE_PUBLIC_KEY_SPKI_B64URL);
    if (!result.valid) {
      // 签名损坏/设备不匹配（复制到其他设备）：不清除本地文件（可能只是设备哈希
      // 计算暂时失败之类的瞬时问题），只是这次不采信，继续走 device-status 兜底。
      console.error('[license] 本地许可证验签未通过：', result.reason);
      return false;
    }
    licensedPayload = result.payload;
    emit(false);
    return true;
  }

  async function apiPost(pathname, token, body) {
    const res = await fetch(`${baseUrl}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  }

/** 用授权码激活。成功后落盘许可证并进入 licensed。网络异常不抛出，统一转成失败结果。 */
  async function activate(licenseCode) {
    const token = authManager.getAccessToken?.();
    if (!token) return { success: false, code: 'AUTH_REQUIRED', message: '请先登录' };

    const deviceHash = await currentDeviceHash();
    if (!deviceHash) return { success: false, code: 'DEVICE_ERROR', message: '无法读取设备信息' };

    let ok, data;
    try {
      ({ ok, data } = await apiPost('/api/license/activate', token, {
        license_code: licenseCode,
        device_hash: deviceHash,
      }));
    } catch {
      return { success: false, code: 'NETWORK_ERROR', message: '网络连接失败，请稍后重试' };
    }
    if (!ok || !data?.success) {
      return { success: false, code: data?.code || 'SERVER_ERROR', message: data?.message || '激活失败' };
    }
    const applied = await applyIssuedLicense(data.license, deviceHash);
    if (!applied) return { success: false, code: 'SIGNATURE_INVALID', message: '服务器返回的许可证校验失败' };
    return { success: true };
  }

  /** 服务端记录是 licensed 但本地没有有效许可证时调用（重装/文件丢失后找回）。 */
  async function restoreFromServer() {
    const token = authManager.getAccessToken?.();
    if (!token) return false;
    const deviceHash = await currentDeviceHash();
    if (!deviceHash) return false;

    const { ok, data } = await apiPost('/api/license/restore', token, { device_hash: deviceHash });
    if (!ok || !data?.success) return false;
    return applyIssuedLicense(data.license, deviceHash);
  }

  /**
   * 拉取/复验状态。已有本地验签通过的永久许可证时直接短路返回 licensed，
   * 不发网络请求——文档明确永久授权用户不受周期性联网复验限制。
   */
  async function refresh() {
    if (licensedPayload) {
      emit(false);
      return publicState();
    }

    const token = authManager.getAccessToken?.();
    if (!token) {
      trialSnap = null;
      emit();
      return publicState();
    }

    const deviceHash = await currentDeviceHash();
    let installationIdHash = null;
    try {
      installationIdHash = (await deviceIdentity.ensureIdentity()).installationIdHash;
    } catch {
      /* ignore */
    }

    try {
      const { ok, data } = await apiPost('/api/device/status', token, {
        device_hash: deviceHash,
        installation_id_hash: installationIdHash,
        platform: platformLabel(),
        app_version: appVersion,
      });
      if (ok && data) {
        if (data.license_status === 'licensed') {
          // 服务端说已授权，但走到这里说明本地没有有效许可证——找回一份。
          const restored = await restoreFromServer();
          if (restored) return publicState();
          // 找不回来（比如设备哈希在服务端记录里对不上）：如实反映为 unknown，
          // 不能假装 licensed，也不该错误地掉回 trial。
          trialSnap = null;
          emit(true);
          return publicState(true);
        }
        trialSnap = {
          status: data.license_status,
          trialStartedAtMs: Date.parse(data.trial_started_at) || null,
          trialExpiresAtMs: Date.parse(data.trial_expires_at) || null,
          features: Array.isArray(data.features) ? data.features : [],
          serverTimeMs: Date.parse(data.server_time) || Date.now(),
          fetchedAtMono: performance.now(),
        };
        emit(false);
        return publicState();
      }
      // 401 交给会话刷新周期处理；其余错误保留上次状态并标 stale。
      emit(true);
      return publicState(true);
    } catch {
      // 网络不可用：保留上次可信状态，标 stale，不影响使用。
      emit(true);
      return publicState(true);
    }
  }

  return {
    getState: () => publicState(),
    loadLocalLicense,
    activate,
    refresh,
  };
}
