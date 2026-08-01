import type { NodeData } from '../types';

export interface VideoRemixFinalNodeOutput {
  nodeId: string;
  url: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  aspectRatio: string;
}

export function upsertVideoRemixFinalNode(
  nodes: NodeData[],
  remixNodeId: string,
  output: VideoRemixFinalNodeOutput
): NodeData[];
