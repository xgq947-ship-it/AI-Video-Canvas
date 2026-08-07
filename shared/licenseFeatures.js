/**
 * shared/licenseFeatures.js
 *
 * 授权功能键与权限判断纯函数（前端 UI 层与后端执行层、以及 Electron 主进程共用同一份）。
 * 不依赖 DOM / Electron / Node 专有 API，可在任意运行时与测试中直接引入。
 */

/**
 * 功能键。director_workflow 对应本期选定的高级节点范围（电影/火柴人导演工作流）。
 * 其余键为文档预留，暂未在 nodeFeatures 映射中启用。
 * @typedef {'director_workflow'|'advanced_nodes'|'video_generation'|'batch_generation'|'advanced_export'} FeatureKey
 */

/** @type {Record<string, 'director_workflow'|'advanced_nodes'|'video_generation'|'batch_generation'|'advanced_export'>} */
export const FEATURE_KEYS = Object.freeze({
  DIRECTOR_WORKFLOW: 'director_workflow',
  ADVANCED_NODES: 'advanced_nodes',
  VIDEO_GENERATION: 'video_generation',
  BATCH_GENERATION: 'batch_generation',
  ADVANCED_EXPORT: 'advanced_export',
});

/** 试用与永久授权默认授予的功能集合（本期只有导演工作流是高级）。 */
export const DEFAULT_GRANTED_FEATURES = Object.freeze([FEATURE_KEYS.DIRECTOR_WORKFLOW]);

/** 授权子系统未配置时（VITE_GOOGLE_LOGIN_ENABLED=off）使用的“全解锁”状态。 */
export const UNCONFIGURED_LICENSE_STATE = Object.freeze({
  status: 'licensed',
  features: [...DEFAULT_GRANTED_FEATURES],
  unconfigured: true,
});

/**
 * @typedef {Object} LicenseState
 * @property {'trial'|'expired'|'licensed'|'blocked'|'unknown'} status
 *   'unknown' 是渲染进程专属的过渡态：已登录但主进程尚未拿到第一次
 *   device-status 响应。canUseFeature 对它的处理与其他未识别值一致——
 *   落到最后一行 return false，即高级功能拒绝、普通节点不受影响。
 * @property {number} [trialExpiresAt]  epoch 毫秒；trial 状态下用于判断是否过期
 * @property {string[]} features        已授予的功能键
 * @property {boolean} [unconfigured]   true 表示授权子系统未启用，视为全解锁
 */

/**
 * 判断某功能是否可用。所有节点执行前必须再次调用（不能只靠 UI 禁用）。
 * @param {string|undefined|null} feature 节点要求的功能键；无要求（普通节点）恒为 true
 * @param {LicenseState} license
 * @param {number} now epoch 毫秒
 * @returns {boolean}
 */
export function canUseFeature(feature, license, now) {
  if (!feature) return true;
  if (!license || typeof license !== 'object') return false;

  // 授权子系统未配置：普通与高级节点一律放行，保证现有用户升级不被锁死。
  if (license.unconfigured) return true;

  if (license.status === 'blocked') return false;

  const features = Array.isArray(license.features) ? license.features : [];

  if (license.status === 'trial') {
    return Boolean(
      typeof license.trialExpiresAt === 'number' &&
      now < license.trialExpiresAt &&
      features.includes(feature)
    );
  }

  if (license.status === 'licensed') {
    return features.includes(feature);
  }

  // expired / 其他一律拒绝高级功能。
  return false;
}
