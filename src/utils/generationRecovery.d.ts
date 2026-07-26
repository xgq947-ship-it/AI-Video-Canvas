export const GOOGLE_FLOW_RECOVERY_TIMEOUT_MS: number;
export const DEFAULT_GENERATION_RECOVERY_TIMEOUT_MS: number;
export const PRODUCT_SCENE_ANALYSIS_RECOVERY_TIMEOUT_MS: number;
export const PRODUCT_SCENE_GENERATION_RECOVERY_TIMEOUT_MS: number;

export interface GenerationRecoveryNode {
    type?: string;
    videoModel?: string;
    imageModel?: string;
    generationStartTime?: number;
    productSceneStage?: string;
    sceneAnalysis?: unknown;
    productAnalysis?: unknown;
}

export function isBrowserWorkflowGeneration(
    nodeOrModel?: string | GenerationRecoveryNode | null
): boolean;
export function getInterruptedGenerationMessage(
    node?: GenerationRecoveryNode | null
): string;
export function getBackendRestartedGenerationMessage(
    node?: GenerationRecoveryNode | null
): string;
export function wasGenerationInterruptedByBackendRestart(
    node: GenerationRecoveryNode | null | undefined,
    backendStartedAt: number | string | null | undefined
): boolean;
export function getGenerationRecoveryTimeoutMs(
    nodeOrModel?: string | GenerationRecoveryNode | null
): number;
export function isGenerationRecoveryExpired(
    node: GenerationRecoveryNode | null | undefined,
    now?: number
): boolean;
