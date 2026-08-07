import { useLicense } from './useLicense';
import { requiredFeatureForNode } from '../../shared/nodeFeatures.js';
import { canUseFeature } from '../../shared/licenseFeatures.js';

/**
 * 该节点类型此刻是否应在 UI 上显示为锁定。只是好看的那一层——真正的判定在
 * 执行层（server/services/licenseGuard.js），这里只是复用同一份 shared 逻辑
 * 尽量保持一致，不能替代执行层。
 *
 * @param nodeType 节点类型字符串（与 src/types.ts 的 NodeType 取值一致）
 */
export function useNodeLocked(nodeType: string | undefined | null): boolean {
  const { state } = useLicense();
  const feature = requiredFeatureForNode(nodeType);
  if (!feature) return false;
  return !canUseFeature(feature, state, Date.now());
}
