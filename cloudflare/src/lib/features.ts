/**
 * 服务端功能常量。与仓库根 shared/licenseFeatures.js 保持一致：
 * 本期唯一的高级功能是导演工作流（director_workflow）。
 * Worker 是独立包，不便直接 import 根目录 ESM，这里只保留最小常量副本。
 */

export const FEATURE_DIRECTOR_WORKFLOW = 'director_workflow';

/** 试用与永久授权默认授予的功能集合。 */
export const DEFAULT_GRANTED_FEATURES: string[] = [FEATURE_DIRECTOR_WORKFLOW];

export const TRIAL_DAYS = 7;
