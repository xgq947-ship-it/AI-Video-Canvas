/**
 * server/services/licenseGuard.js
 *
 * 节点权限的执行层守卫（文档 §13）。这是不可绕过的一层——UI 只负责好看地
 * 提前拦截，真正的判定在这里：所有高级节点的后端路由执行前都要过这道关。
 *
 * 状态来源：Electron 主进程通过 utilityProcess 的 parentPort 消息把已验证的
 * LicenseState 推进来（见 electron/main.js pushLicenseStateToBackend /
 * server/desktop-entry.js 的 'license-state' 消息处理）。本模块只做只读判断，
 * 不发起任何网络请求、不持久化、不信任客户端直接传入的状态。
 *
 * 默认行为（关键：保证现有用户升级不被锁死）：
 *   在收到主进程的第一条 license-state 消息之前，`currentState` 为 null，
 *   此时一律放行（等同「未配置授权子系统」）。只要 Electron 侧的登录总开关
 *   （GOOGLE_LOGIN_ENABLED）为关，主进程永远不会推送任何消息，本模块也就
 *   永远保持放行——与仓库里“加这层之前”的行为完全一致，零回归风险。
 *   一旦收到过消息（即登录子系统已启用），后续判断严格走 canUseFeature()。
 */

import { canUseFeature } from '../../shared/licenseFeatures.js';

/** @type {import('../../shared/licenseFeatures.d.ts').LicenseState | null} */
let currentState = null;

/**
 * 主进程推送的最新 LicenseState。忽略非对象输入（防御式，不让坏消息破坏整个守卫)。
 * @param {unknown} next
 */
export function setLicenseState(next) {
  if (!next || typeof next !== 'object') return;
  currentState = /** @type {import('../../shared/licenseFeatures.d.ts').LicenseState} */ (next);
}

export function getLicenseState() {
  return currentState;
}

/** 测试专用：把状态清回「未收到任何消息」，即默认放行。 */
export function resetLicenseState() {
  currentState = null;
}

/**
 * @param {string|undefined|null} feature 节点/路由要求的功能键；无要求恒放行
 * @returns {boolean}
 */
export function isFeatureAllowed(feature) {
  if (!feature) return true;
  if (currentState === null) return true; // 登录子系统未启用/尚未收到任何消息
  return canUseFeature(feature, currentState, Date.now());
}

/**
 * Express 中间件工厂：路由固定要求某个功能键时用这个（如导演 run 接口）。
 * 功能键依请求体动态决定的路由（如 /videos/merge 按 nodeType）请直接调用
 * isFeatureAllowed()，不用这个工厂。
 * @param {string} feature
 */
export function requireFeature(feature) {
  return (req, res, next) => {
    if (isFeatureAllowed(feature)) return next();
    return res.status(403).json({
      error: 'FEATURE_LOCKED',
      message: '试用已结束，请先激活授权码后再使用该高级节点',
      feature,
    });
  };
}
