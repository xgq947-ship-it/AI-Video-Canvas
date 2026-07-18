export const GOOGLE_FLOW_RECOVERY_TIMEOUT_MS: number;
export const DEFAULT_GENERATION_RECOVERY_TIMEOUT_MS: number;

export function getGenerationRecoveryTimeoutMs(videoModel?: string): number;
export function isGenerationRecoveryExpired(
    node: { generationStartTime?: number; videoModel?: string } | null | undefined,
    now?: number
): boolean;
