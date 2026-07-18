export const GOOGLE_FLOW_RECOVERY_TIMEOUT_MS = 18 * 60 * 1000;
export const DEFAULT_GENERATION_RECOVERY_TIMEOUT_MS = 30 * 60 * 1000;

export function getGenerationRecoveryTimeoutMs(videoModel) {
    return videoModel === 'google-flow-omni-flash'
        ? GOOGLE_FLOW_RECOVERY_TIMEOUT_MS
        : DEFAULT_GENERATION_RECOVERY_TIMEOUT_MS;
}

export function isGenerationRecoveryExpired(node, now = Date.now()) {
    const startedAt = Number(node?.generationStartTime);
    if (!Number.isFinite(startedAt) || startedAt <= 0) return false;
    return now - startedAt >= getGenerationRecoveryTimeoutMs(node?.videoModel);
}
