export type VideoAnalysisInputPort =
  | 'source-video'
  | 'product-reference'
  | 'character-reference'
  | 'scene-reference';

export type VideoAnalysisStatus =
  | 'idle'
  | 'ready'
  | 'analyzing'
  | 'completed'
  | 'outdated'
  | 'error';

export interface VideoAnalysisShot {
  id: string;
  order: number;
  startTime: number;
  endTime: number;
  duration: number;
  summary: string;
  imagePrompt: string;
  videoPrompt: string;
  sourceKeyframeUrl?: string;
  dialogue?: string;
  soundPrompt?: string;
}

export interface VideoAnalysisAssetProfile {
  id: string;
  profileId: string;
  label: string;
  prompt: string;
  aspectRatio: string;
  dependsOn: string[];
}

export interface VideoAnalysisAssetPrompt {
  id: string;
  name: string;
  prompt: string;
  anchorBlock: string;
  primaryProfileId: string;
  referenceRule?: string;
  profiles: VideoAnalysisAssetProfile[];
}

export interface VideoAnalysisAssetGenerationOption {
  enabled: boolean;
  count: number;
}

export interface VideoAnalysisAssetGeneration {
  characters: VideoAnalysisAssetGenerationOption;
  scenes: VideoAnalysisAssetGenerationOption;
  props: VideoAnalysisAssetGenerationOption;
}

export interface VideoAnalysisResult {
  analysisVersion: number;
  global: {
    story: string;
    visualStyle: string;
    aspectRatio: string;
    characterConsistency: string;
    sceneConsistency: string;
    productRequirements: string;
    globalPromptPrefix: string;
    assetPrompts: {
      characters: VideoAnalysisAssetPrompt[];
      scenes: VideoAnalysisAssetPrompt[];
      props: VideoAnalysisAssetPrompt[];
    };
  };
  shots: VideoAnalysisShot[];
}

export interface VideoAnalysisNodeData {
  analysisVersion: number;
  inputRefs: {
    videoNodeId?: string;
    productNodeIds: string[];
    characterNodeIds: string[];
    sceneNodeIds: string[];
  };
  assetGeneration: VideoAnalysisAssetGeneration;
  result?: VideoAnalysisResult;
  generatedGraph?: {
    nodeIds: string[];
    edgeIds: string[];
    generatedAt: string;
  };
  status: VideoAnalysisStatus;
  errorMessage?: string;
  migrationVersion?: number;
}

export const VIDEO_ANALYSIS_SCHEMA_VERSION: number;
export const VIDEO_ANALYSIS_INPUT_PORTS: readonly VideoAnalysisInputPort[];
export const VIDEO_ANALYSIS_PORT_LABELS: Record<VideoAnalysisInputPort, string>;
export const VIDEO_ANALYSIS_ASSET_GENERATION_PROFILE_IDS: {
  readonly characters: readonly string[];
  readonly scenes: readonly string[];
  readonly props: readonly string[];
};
export const VIDEO_ANALYSIS_ASSET_REFERENCE_PROFILE_IDS: {
  readonly characters: string;
  readonly scenes: string;
  readonly props: string;
};
export const VIDEO_ANALYSIS_ASSET_REFERENCE_RULES: {
  readonly characters: string;
  readonly scenes: string;
  readonly props: string;
};
export const VIDEO_ANALYSIS_STATUSES: readonly VideoAnalysisStatus[];
export function createVideoAnalysisNodeData(overrides?: Partial<VideoAnalysisNodeData>): VideoAnalysisNodeData;
export function normalizeVideoAnalysisAssetGeneration(value?: any): VideoAnalysisAssetGeneration;
export function syncVideoAnalysisInputRefs(node: any, inputPortByParentId?: Record<string, string>): any;
export function inferVideoAnalysisInputPort(parentType: string, currentMapping?: Record<string, string>): VideoAnalysisInputPort;
export function assignVideoAnalysisInputPort(node: any, parent: any, targetPortId?: string): any;
export function normalizeVideoAnalysisResult(value?: any): VideoAnalysisResult;
export function markVideoAnalysisDependentsStale(nodes: any[], changedNodeId: string): any[];
export function buildVideoAnalysisResultFromRemix(args: any): VideoAnalysisResult;
