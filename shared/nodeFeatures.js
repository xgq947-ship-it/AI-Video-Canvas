/**
 * shared/nodeFeatures.js
 *
 * 节点类型 → 所需功能键 的单一事实来源（前端 UI 锁定与后端执行层守卫共用）。
 * 节点类型字符串与 src/types.ts 的 NodeType 枚举取值一致。
 *
 * 本期高级范围＝导演工作流（电影导演 + 火柴人导演）。只有下列“导演编排专属”节点
 * 被标为 director_workflow；VIDEO / VIDEO_ANALYSIS / FLOW_BATCH_VIDEO / STORYBOARD /
 * REFERENCE_VIDEO 等被多处复用的通用节点保持免费，避免过度限制。
 * 要调整高级范围，只改这张表即可。
 *
 * Cinematic Video Merge 刻意不在这张表里：它只是把已经生成好的镜头用本地 ffmpeg
 * 拼接成一条成片，不调用任何云端模型、不产生新内容——属于文档 §14.4 明确允许试用
 * 到期后继续使用的“导出已有文件”，不是“新建高级任务”。它和免费的 Video Merge
 * 节点共用同一个后端接口（POST /api/videos/merge），如果重新纳入高级范围，必须让
 * 服务端自己从已落库的节点/工作流数据判断，不能信任客户端传来的 nodeType 字段
 * ——那等同于把权限判断交给一个可以被浏览器 devtools 直接改掉的值。
 */

import { FEATURE_KEYS } from './licenseFeatures.js';

const D = FEATURE_KEYS.DIRECTOR_WORKFLOW;

/** @type {Readonly<Record<string, import('./licenseFeatures.js').FeatureKey>>} */
export const NODE_FEATURE_MAP = Object.freeze({
  // 电影导演工作流
  'Cinematic Director': D,
  'Cinematic Cast': D,
  'Cinematic Storyboard': D,
  // 火柴人导演工作流
  'Stickman Director': D,
  'Storyboard Compare': D,
});

/**
 * 取某节点类型所需的功能键；普通节点返回 undefined（恒可用）。
 * @param {string|undefined|null} nodeType
 * @returns {import('./licenseFeatures.js').FeatureKey|undefined}
 */
export function requiredFeatureForNode(nodeType) {
  if (!nodeType) return undefined;
  return NODE_FEATURE_MAP[nodeType];
}

/**
 * 该节点类型是否属于高级（受授权控制）节点。
 * @param {string|undefined|null} nodeType
 * @returns {boolean}
 */
export function isPremiumNode(nodeType) {
  return requiredFeatureForNode(nodeType) !== undefined;
}
