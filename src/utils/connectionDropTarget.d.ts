export interface ConnectionDropRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

export interface ConnectionDropCandidate {
    nodeId: string;
    rect: ConnectionDropRect;
}

export interface ConnectionDropTarget {
    nodeId: string;
    side: 'left' | 'right';
}

export const CONNECTION_DROP_SLOP_PX: number;

export function resolveConnectionDropTarget(options: {
    point: { x: number; y: number };
    sourceNodeId: string;
    candidates: ConnectionDropCandidate[];
    connectorTarget?: ConnectionDropTarget | null;
    slop?: number;
}): ConnectionDropTarget | null;
