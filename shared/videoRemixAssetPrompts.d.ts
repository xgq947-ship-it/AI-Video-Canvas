export type VideoRemixAssetKind = 'characters' | 'scenes' | 'props';

export interface VideoRemixAssetConsistencyItem {
  id: string;
  profileId: string;
  label: string;
  description: string;
  aspectRatio: string;
  dependsOn: string[];
  prompt: string;
  status: 'pending' | 'generating' | 'ready' | 'confirmed' | 'failed';
  url?: string;
  source?: 'existing' | 'generated' | 'upload';
  error?: string;
  generatedAt?: string;
  updatedAt?: string;
}

export interface VideoRemixAssetConsistencyPack {
  kind: VideoRemixAssetKind;
  masterPrompt: string;
  anchorBlock: string;
  definitionHash: string;
  primaryProfileId: string;
  primaryConfirmed: boolean;
  confirmed: boolean;
  status: 'draft' | 'generating' | 'partial' | 'ready';
  items: VideoRemixAssetConsistencyItem[];
  updatedAt?: string;
  confirmedAt?: string;
}

export const VIDEO_REMIX_ASSET_PROMPT_PROFILES: Readonly<Record<
  VideoRemixAssetKind,
  readonly string[]
>>;
export const VIDEO_REMIX_ASSET_PRIMARY_PROFILE: Readonly<Record<
  VideoRemixAssetKind,
  string
>>;

export function buildVideoRemixAssetMasterPrompt(kind: VideoRemixAssetKind, asset: unknown): string;
export function buildVideoRemixAssetAnchorBlock(kind: VideoRemixAssetKind, asset: unknown): string;
export function buildVideoRemixAssetConsistencyDefinition(
  kind: VideoRemixAssetKind,
  asset: unknown
): VideoRemixAssetConsistencyPack | null;
export function mergeVideoRemixAssetConsistencyPack(
  definition: VideoRemixAssetConsistencyPack | null,
  stored?: VideoRemixAssetConsistencyPack | null,
  seedImages?: string[]
): VideoRemixAssetConsistencyPack | null;
export function getVideoRemixConsistencyReferenceImages(
  asset: unknown,
  preferredProfileIds?: string[]
): string[];
