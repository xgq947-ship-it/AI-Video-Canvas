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

import { canUseFeature, isCanvasLocked } from '../../shared/licenseFeatures.js';

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
 * 试用到期后整块画布是否锁死。与 isFeatureAllowed 一样，在收到主进程的第一条
 * license-state 之前恒为 false（未配置授权子系统 = 永不上锁）。
 */
export function isCanvasLockedNow(now = Date.now()) {
  if (currentState === null) return false;
  return isCanvasLocked(currentState, now);
}

/**
 * 全局闸门：试用到期后拒绝一切会改变状态的请求。
 *
 * 挂在所有 /api 路由之前。渲染进程的遮罩层只是好看的提前拦截，本地 Electron
 * 里一开 devtools 就能绕过；真正的锁在这里。
 *
 * 放行只读请求（GET/HEAD/OPTIONS）是刻意的：用户已经生成的成果不能被扣作
 * 人质。画布要能打开、项目要能读、导出清单要能取——桌面端的一键导出正是先
 * GET 清单再由主进程复制文件，所以这条放行同时也保住了导出。
 */
export function blockWhenCanvasLocked(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // 保存画布不是付费价值所在——生成才是。挡住保存只会让到期瞬间尚未落盘的
  // 布局永远丢失，并让自动保存每隔几秒撞一次 403 空转；重命名、封面、
  // 打开素材目录同理，都属于用户处置自己既有成果。
  if (/^\/workflows(\/|$)/u.test(req.path || '')) return next();
  if (!isCanvasLockedNow()) return next();
  return res.status(403).json({
    error: 'CANVAS_LOCKED',
    message: '试用已结束。已生成的成果仍可查看和导出；请激活授权码后继续创作。',
  });
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
