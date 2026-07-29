import { NODE } from '../../shared/connectionRules.js';
import { isBrowserWorkflowVideoModel } from './videoModelCapabilities.js';

export const GOOGLE_FLOW_RECOVERY_TIMEOUT_MS = 18 * 60 * 1000;
export const DEFAULT_GENERATION_RECOVERY_TIMEOUT_MS = 30 * 60 * 1000;
export const PRODUCT_SCENE_ANALYSIS_RECOVERY_TIMEOUT_MS = 4 * 60 * 1000;
export const PRODUCT_SCENE_GENERATION_RECOVERY_TIMEOUT_MS = 13 * 60 * 1000;

export function isBrowserWorkflowGeneration(nodeOrModel) {
    if (typeof nodeOrModel === 'string') {
        return isBrowserWorkflowVideoModel(nodeOrModel)
            || nodeOrModel.startsWith('google-flow-')
            || nodeOrModel.startsWith('jimeng-image-');
    }
    return isBrowserWorkflowVideoModel(nodeOrModel?.videoModel)
        || String(nodeOrModel?.imageModel || '').startsWith('google-flow-')
        || String(nodeOrModel?.imageModel || '').startsWith('jimeng-image-');
}

export function getInterruptedGenerationMessage(node) {
    if (isBrowserWorkflowGeneration(node)) {
        return '生成请求可能已经提交，但应用无法确认最终状态。请先到对应平台历史记录中检查结果，确认没有任务后再重新生成，避免重复消耗额度。';
    }
    return '生成任务已中断或超时，请重新生成。';
}

export function getBackendRestartedGenerationMessage(node) {
    if (isBrowserWorkflowGeneration(node)) {
        return '应用或本地后台在生成过程中被关闭或重启，本地已停止等待。平台任务可能仍在继续，请先到对应平台的历史记录检查；如果已经生成，请下载后拖回画布。确认平台没有任务后再重新生成，避免重复消耗额度。';
    }
    return '应用或本地后台在生成过程中被关闭或重启，本次本地任务已中断，请重新生成。';
}

export function wasGenerationInterruptedByBackendRestart(node, backendStartedAt) {
    const generationStartedAt = Number(node?.generationStartTime);
    const currentBackendStartedAt = Number(backendStartedAt);
    return Number.isFinite(generationStartedAt)
        && generationStartedAt > 0
        && Number.isFinite(currentBackendStartedAt)
        && currentBackendStartedAt > generationStartedAt;
}

// 共享 AI 浏览器 workflow（Google Flow / 即梦）：进程侧 timeout 是 15+2 分钟，
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
    return isBrowserWorkflowGeneration(nodeOrVideoModel)
        ? GOOGLE_FLOW_RECOVERY_TIMEOUT_MS
        : DEFAULT_GENERATION_RECOVERY_TIMEOUT_MS;
}

export function isGenerationRecoveryExpired(node, now = Date.now()) {
    const startedAt = Number(node?.generationStartTime);
    if (!Number.isFinite(startedAt) || startedAt <= 0) return false;
    return now - startedAt >= getGenerationRecoveryTimeoutMs(node);
}
