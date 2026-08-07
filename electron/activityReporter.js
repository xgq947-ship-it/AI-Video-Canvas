/**
 * P6：主进程每日活跃上报。
 *
 * 同一进程最多真正请求一次；未登录时不消耗这次机会，便于用户稍后登录后上报。
 * 网络、设备身份或服务端错误全部吞掉，只写主进程日志，不影响应用使用。
 */

function platformLabel() {
  if (process.platform === 'darwin') return 'macOS';
  if (process.platform === 'win32') return 'Windows';
  return process.platform;
}

export function createActivityReporter({ authManager, deviceIdentity, baseUrl, appVersion }) {
  if (!authManager) throw new Error('createActivityReporter: 需要 authManager');
  if (!deviceIdentity) throw new Error('createActivityReporter: 需要 deviceIdentity');
  if (!baseUrl) throw new Error('createActivityReporter: 需要 baseUrl');

  const normalizedBaseUrl = String(baseUrl).replace(/\/+$/, '');
  let attempted = false;

  async function reportOnce() {
    if (attempted) return { success: true, reported: false, skipped: 'already_attempted' };

    const token = authManager.getAccessToken?.();
    if (!token) return { success: false, reported: false, skipped: 'auth_required' };

    // 必须在第一个 await 之前占位，避免并发调用同时发出两次请求；失败也不重试。
    attempted = true;

    try {
      const identity = await deviceIdentity.ensureIdentity();
      if (!identity?.deviceHash) throw new Error('无法读取 device_hash');

      const response = await fetch(`${normalizedBaseUrl}/api/report-activity`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          device_hash: identity.deviceHash,
          app_version: appVersion ?? null,
          platform: platformLabel(),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.success !== true) {
        throw new Error(data?.message || `活跃上报失败(${response.status})`);
      }
      return { success: true, reported: data.reported === true };
    } catch (error) {
      console.error('[activity] 活跃上报失败：', error?.message || error);
      return { success: false, reported: false };
    }
  }

  return { reportOnce };
}
