export type FeatureKey =
  | 'director_workflow'
  | 'advanced_nodes'
  | 'video_generation'
  | 'batch_generation'
  | 'advanced_export';

/**
 * 'unknown' 是渲染进程专属的过渡态（已登录但主进程尚未拿到第一次 device-status
 * 响应）。canUseFeature 把它当未识别值处理：高级功能拒绝，不影响普通节点。
 */
export type LicenseStatus = 'trial' | 'expired' | 'licensed' | 'blocked' | 'unknown';

export interface LicenseState {
  status: LicenseStatus;
  /** epoch 毫秒；trial 状态下用于判断是否过期 */
  trialExpiresAt?: number | null;
  /**
   * 字符串数组而非 FeatureKey[]：运行时来自网络/IPC 传输，不对其做严格
   * 枚举假设——canUseFeature 内部只做 .includes(feature) 字符串比较。
   */
  features: string[];
  /** true 表示授权子系统未启用，视为全解锁 */
  unconfigured?: boolean;
}

export const FEATURE_KEYS: {
  DIRECTOR_WORKFLOW: 'director_workflow';
  ADVANCED_NODES: 'advanced_nodes';
  VIDEO_GENERATION: 'video_generation';
  BATCH_GENERATION: 'batch_generation';
  ADVANCED_EXPORT: 'advanced_export';
};

export const DEFAULT_GRANTED_FEATURES: readonly FeatureKey[];

export const UNCONFIGURED_LICENSE_STATE: Readonly<LicenseState>;

export function canUseFeature(
  feature: FeatureKey | string | undefined | null,
  license: LicenseState,
  now: number
): boolean;
