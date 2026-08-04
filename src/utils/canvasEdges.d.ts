import type { NodeData } from '../types';

export interface CanvasConnection {
  parentId: string;
  childId: string;
}

export function removeCanvasConnection(nodes: NodeData[], connection: CanvasConnection): NodeData[];
export function removeCanvasConnections(nodes: NodeData[], connections: CanvasConnection[]): NodeData[];
export function wouldCreateCycle(nodes: NodeData[], parentId: string, childId: string): boolean;
