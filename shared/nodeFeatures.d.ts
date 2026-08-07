import type { FeatureKey } from './licenseFeatures';

export const NODE_FEATURE_MAP: Readonly<Record<string, FeatureKey>>;

export function requiredFeatureForNode(
  nodeType: string | undefined | null
): FeatureKey | undefined;

export function isPremiumNode(nodeType: string | undefined | null): boolean;
