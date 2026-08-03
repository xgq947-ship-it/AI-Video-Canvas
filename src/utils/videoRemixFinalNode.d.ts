import type { NodeData } from '../types';
import type { VideoRemixProject } from '../../shared/videoRemixProjects.js';

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

export function upsertVideoRemixProjectFinalNode(
  nodes: NodeData[],
  remixProject: VideoRemixProject,
  output: VideoRemixFinalNodeOutput,
  position?: { x: number; y: number }
): NodeData[];
