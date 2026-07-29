import type { NodeData } from '../types';

export interface ProductSceneInputMapping {
  version: 1;
  sceneReferenceNodeId?: string;
  productImageNodeId?: string;
  promptSourceNodeId?: string;
}

export const PRODUCT_SCENE_INPUT_MAPPING_VERSION: 1;
export function resolveProductSceneInputMapping(node: NodeData, allNodes: NodeData[]): ProductSceneInputMapping;
export function productSceneInputMappingPatch(mapping: ProductSceneInputMapping): Partial<NodeData>;
export function productSceneInputMappingNeedsSync(node: NodeData, mapping: ProductSceneInputMapping): boolean;
export function assignProductSceneInputOnConnect(node: NodeData, parentNode: NodeData, allNodes: NodeData[]): Partial<NodeData>;
