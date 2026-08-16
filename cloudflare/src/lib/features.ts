/**
 * 服务端功能常量。与仓库根 shared/licenseFeatures.js 保持一致：
 * 本期唯一的高级功能是导演工作流（director_workflow）。
 * Worker 是独立包，不便直接 import 根目录 ESM，这里只保留最小常量副本。
 */

export const FEATURE_DIRECTOR_WORKFLOW = 'director_workflow';

/** 试用与永久授权默认授予的功能集合。 */
export const DEFAULT_GRANTED_FEATURES: string[] = [FEATURE_DIRECTOR_WORKFLOW];

/**
 * 试用天数。改动只影响**新注册设备**——试用起止时间在设备首次注册时写进 D1，
 * 已注册设备手里的旧期限不会因为这里改动而变化。
 * 前端展示用的副本在 shared/licenseFeatures.js，两处必须同步。
 */
export const TRIAL_DAYS = 3;
