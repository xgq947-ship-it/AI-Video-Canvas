import type { NodeData } from '../types';
import type { ProductSceneJob } from '../services/generationService';
export function buildProductSceneResultNode(sourceNode: NodeData, job: ProductSceneJob, now?: number): NodeData;
export function getProductSceneResultRowStep(job: ProductSceneJob): number;
export function upsertProductSceneResultNode(nodes: NodeData[], sourceNode: NodeData, job: ProductSceneJob, now?: number): NodeData[];
