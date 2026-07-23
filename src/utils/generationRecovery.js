import { NODE } from '../../shared/connectionRules.js';
import { isBrowserWorkflowVideoModel } from './videoModelCapabilities.js';

export const GOOGLE_FLOW_RECOVERY_TIMEOUT_MS = 18 * 60 * 1000;
export const DEFAULT_GENERATION_RECOVERY_TIMEOUT_MS = 30 * 60 * 1000;
export const PRODUCT_SCENE_ANALYSIS_RECOVERY_TIMEOUT_MS = 4 * 60 * 1000;
export const PRODUCT_SCENE_GENERATION_RECOVERY_TIMEOUT_MS = 13 * 60 * 1000;

// 本地 9222 页面 workflow（Google Flow / 即梦）：进程侧 timeout 是 15+2 分钟，
// 前端恢复窗口取 18 分钟与之对齐，避免节点比后端更早被判超时。
export function getGenerationRecoveryTimeoutMs(nodeOrVideoModel) {
    if (nodeOrVideoModel && typeof nodeOrVideoModel === 'object' && nodeOrVideoModel.type === NODE.PRODUCT_SCENE_REPLACE) {
        // stage 是本次生成写入的权威阶段；重跑时节点上仍留着上一轮的
        // sceneAnalysis/productAnalysis，只有 stage 缺失（旧数据）时才回退到它们。
        const { productSceneStage } = nodeOrVideoModel;
        const hasCompletedAnalysis = productSceneStage
            ? productSceneStage === 'generating'
            : Boolean(nodeOrVideoModel.sceneAnalysis) && Boolean(nodeOrVideoModel.productAnalysis);
        return hasCompletedAnalysis
            ? PRODUCT_SCENE_GENERATION_RECOVERY_TIMEOUT_MS
            : PRODUCT_SCENE_ANALYSIS_RECOVERY_TIMEOUT_MS;
    }
    const videoModel = typeof nodeOrVideoModel === 'string' ? nodeOrVideoModel : nodeOrVideoModel?.videoModel;
    return isBrowserWorkflowVideoModel(videoModel)
        ? GOOGLE_FLOW_RECOVERY_TIMEOUT_MS
        : DEFAULT_GENERATION_RECOVERY_TIMEOUT_MS;
}

export function isGenerationRecoveryExpired(node, now = Date.now()) {
    const startedAt = Number(node?.generationStartTime);
    if (!Number.isFinite(startedAt) || startedAt <= 0) return false;
    return now - startedAt >= getGenerationRecoveryTimeoutMs(node);
}
