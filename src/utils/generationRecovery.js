export const GOOGLE_FLOW_RECOVERY_TIMEOUT_MS = 18 * 60 * 1000;
export const DEFAULT_GENERATION_RECOVERY_TIMEOUT_MS = 30 * 60 * 1000;

// 本地 9222 页面 workflow（Google Flow / 即梦）：进程侧 timeout 是 15+2 分钟，
// 前端恢复窗口取 18 分钟与之对齐，避免节点比后端更早被判超时。
const BROWSER_WORKFLOW_VIDEO_MODELS = new Set(['google-flow-omni-flash', 'jimeng-seedance-2-0']);

export function getGenerationRecoveryTimeoutMs(videoModel) {
    return BROWSER_WORKFLOW_VIDEO_MODELS.has(videoModel)
        ? GOOGLE_FLOW_RECOVERY_TIMEOUT_MS
        : DEFAULT_GENERATION_RECOVERY_TIMEOUT_MS;
}

export function isGenerationRecoveryExpired(node, now = Date.now()) {
    const startedAt = Number(node?.generationStartTime);
    if (!Number.isFinite(startedAt) || startedAt <= 0) return false;
    return now - startedAt >= getGenerationRecoveryTimeoutMs(node?.videoModel);
}
