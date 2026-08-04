/**
 * ConnectionsLayer.tsx
 * 
 * Renders the SVG connections between nodes on the canvas.
 * Includes permanent connections and temporary drag connections.
 */

import React from 'react';
import { NodeData, NodeStatus, NodeType, Viewport } from '../../types';
import { calculateConnectionPath } from '../../utils/connectionHelpers';
import { VIDEO_ANALYSIS_INPUT_PORTS } from '../../../shared/videoAnalysis.js';
import { VIDEO_ANALYSIS_NODE_HEIGHT } from '../../features/video-analysis/VideoAnalysisNode';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get the width of a node based on its type and content
 * @param node - The node to calculate width for
 * @param parentNode - Optional parent node (used for Editor nodes to determine width when they have input content)
 */
export const getNodeWidth = (node: NodeData, parentNode?: NodeData): number => {
    // Image Editor with input from parent: width depends on aspect ratio
    if (node.type === NodeType.IMAGE_EDITOR) {
        const hasInput = parentNode && parentNode.status === NodeStatus.SUCCESS && parentNode.resultUrl;
        if (hasInput && parentNode.resultAspectRatio) {
            const parts = parentNode.resultAspectRatio.split('/');
            if (parts.length === 2) {
                const aspectRatio = parseFloat(parts[0]) / parseFloat(parts[1]);
                // For portrait images: height=500px, width=500*aspectRatio
                // For landscape images: width is capped at 500px
                if (aspectRatio < 1) {
                    return 500 * aspectRatio;
                } else {
                    return 500;
                }
            }
        }
        // Empty: width 340px
        return 340;
    }

    // Video nodes are wider
    if (node.type === NodeType.VIDEO) return 385;
    // Camera Angle nodes have fixed width
    if (node.type === NodeType.CAMERA_ANGLE) return 340;
    if (node.type === NodeType.PRODUCT_SCENE_REPLACE) return 460;
    if (node.type === NodeType.VIDEO_REMIX) return 420;
    if (node.type === NodeType.VIDEO_ANALYSIS) return 420;
    if ([NodeType.REFERENCE_VIDEO, NodeType.SCRIPT_INPUT, NodeType.STICKMAN_DIRECTOR, NodeType.STORYBOARD, NodeType.STORYBOARD_COMPARE, NodeType.FLOW_BATCH_VIDEO, NodeType.VIDEO_MERGE].includes(node.type)) return 430;
    // Image and other nodes
    return 365;
};

/**
 * Estimate the height of a node based on its type and aspect ratio.
 * The node card height is determined by the content's aspect ratio or min-height for empty states.
 * Note: The title label is positioned ABOVE the card (-top-8), not inside it.
 * @param node - The node to calculate height for
 * @param parentNode - Optional parent node (used for Editor nodes to determine if they have input content)
 */
export const getNodeHeight = (node: NodeData, parentNode?: NodeData): number => {
    const baseWidth = getNodeWidth(node, parentNode);
    const hasContent = node.status === NodeStatus.SUCCESS && node.resultUrl;

    // Handle Image Editor nodes
    if (node.type === NodeType.IMAGE_EDITOR) {
        // Check if has input from parent
        const hasInput = parentNode && parentNode.status === NodeStatus.SUCCESS && parentNode.resultUrl;
        if (hasInput && parentNode.resultAspectRatio) {
            // Use parent's aspect ratio to calculate actual dimensions
            // Image Editor with content: width=auto maxWidth=500px, image has maxHeight=500px
            const parts = parentNode.resultAspectRatio.split('/');
            if (parts.length === 2) {
                const aspectRatio = parseFloat(parts[0]) / parseFloat(parts[1]);
                // For portrait images (aspectRatio < 1): height is capped at 500px
                // For landscape images (aspectRatio >= 1): width is capped at 500px
                if (aspectRatio < 1) {
                    // Portrait: height = 500px, width = 500 * aspectRatio
                    return 500;
                } else {
                    // Landscape: width = 500px, height = 500 / aspectRatio
                    return 500 / aspectRatio;
                }
            }
        }
        // Empty: minHeight 380px
        return 380;
    }

    // Handle Camera Angle nodes
    if (node.type === NodeType.CAMERA_ANGLE) {
        const hasContent = node.status === NodeStatus.SUCCESS && node.resultUrl;
        if (hasContent && node.resultAspectRatio) {
            // Use actual result dimensions when content exists
            const parts = node.resultAspectRatio.split('/');
            if (parts.length === 2) {
                const aspectRatio = parseFloat(parts[0]) / parseFloat(parts[1]);
                return 340 / aspectRatio; // width is 340px
            }
        }
        // Loading/empty state: minHeight 340px (see CanvasNode.tsx Camera Angle section)
        return 340;
    }

    // 控制节点固定高度：成图落在它自动创建的子 Image 节点上，自身不展示结果。
    // 716 是浏览器里实测的卡片高度，改动节点表单后要重新量，否则连线端点会偏。
    if (node.type === NodeType.PRODUCT_SCENE_REPLACE) return 716;
    if (node.type === NodeType.VIDEO_REMIX) return 306;
    if (node.type === NodeType.VIDEO_ANALYSIS) return VIDEO_ANALYSIS_NODE_HEIGHT;
    if (node.type === NodeType.REFERENCE_VIDEO) return 300;
    if (node.type === NodeType.SCRIPT_INPUT) return 500;
    if (node.type === NodeType.STICKMAN_DIRECTOR) return 600;
    if (node.type === NodeType.STORYBOARD || node.type === NodeType.STORYBOARD_COMPARE) return Math.max(430, node.storyboard?.expanded ? 470 + (node.storyboard.shots.length * 180) : 310);
    if (node.type === NodeType.FLOW_BATCH_VIDEO) return 420;
    if (node.type === NodeType.VIDEO_MERGE) return 300;

    // Parse aspect ratio to calculate content height for Image/Video nodes
    let aspectRatio: number;

    if (hasContent && node.resultAspectRatio) {
        // Use actual result dimensions when content exists
        const parts = node.resultAspectRatio.split('/');
        if (parts.length === 2) {
            aspectRatio = parseFloat(parts[0]) / parseFloat(parts[1]);
        } else {
            aspectRatio = 16 / 9;
        }
    } else if (hasContent && node.aspectRatio && node.aspectRatio !== 'Auto') {
        // Use selected aspect ratio for content
        const parts = node.aspectRatio.split(':');
        if (parts.length === 2) {
            aspectRatio = parseFloat(parts[0]) / parseFloat(parts[1]);
        } else {
            aspectRatio = 16 / 9;
        }
    } else {
        // Empty/placeholder state: Both Image and Video use 4/3 (see NodeContent.tsx line 307)
        aspectRatio = 4 / 3;
    }

    // Calculate content height from aspect ratio
    return baseWidth / aspectRatio;
};

interface Connection {
    parentId: string;
    childId: string;
}

interface ConnectionsLayerProps {
    nodes: NodeData[];
    viewport: Viewport;
    // Connection dragging state
    isDraggingConnection: boolean;
    connectionStart: { nodeId: string; handle: 'left' | 'right'; portId?: string } | null;
    tempConnectionEnd: { x: number; y: number } | null;
    canvasOffset?: { left: number; top: number };
    // Selection
    selectedConnection: Connection | null;
    onEdgeClick: (e: React.MouseEvent, parentId: string, childId: string) => void;
    canvasTheme?: 'dark' | 'light';
}

const videoAnalysisPortCenterY = (node: NodeData, portId?: string) => {
    const index = VIDEO_ANALYSIS_INPUT_PORTS.indexOf(String(portId || '') as typeof VIDEO_ANALYSIS_INPUT_PORTS[number]);
    return index >= 0 ? node.y + 90 + index * 36 : undefined;
};

export const ConnectionsLayer: React.FC<ConnectionsLayerProps> = ({
    nodes,
    viewport,
    isDraggingConnection,
    connectionStart,
    tempConnectionEnd,
    canvasOffset = { left: 0, top: 0 },
    selectedConnection,
    onEdgeClick,
    canvasTheme = 'dark'
}) => {
    // Render permanent connections between nodes
    const connections: React.ReactNode[] = [];

    nodes.forEach(node => {
        if (!node.parentIds || node.parentIds.length === 0) return;

        node.parentIds.forEach(parentId => {
            const parent = nodes.find(n => n.id === parentId);
            if (!parent) return;

            const startX = parent.x + getNodeWidth(parent);
            const startY = parent.y + getNodeHeight(parent) / 2;
            const endX = node.x;
            const endY = node.type === NodeType.VIDEO_ANALYSIS
                ? videoAnalysisPortCenterY(node, node.inputPortByParentId?.[parentId])
                    || node.y + getNodeHeight(node, parent) / 2
                : node.y + getNodeHeight(node, parent) / 2;

            const path = calculateConnectionPath(startX, startY, endX, endY, 'right');
            const isSelected = selectedConnection?.parentId === parentId && selectedConnection?.childId === node.id;

            connections.push(
                <g
                    key={`${parent.id}-${node.id}`}
                    onClick={(e) => onEdgeClick(e, parent.id, node.id)}
                    className="connection-edge cursor-pointer group pointer-events-auto"
                    data-connection={`${parent.id}-${node.id}`}
                >
                    <path className="connection-hit-area" d={path} stroke="transparent" strokeWidth="20" fill="none" />
                    <path
                        d={path}
                        stroke={isSelected
                            ? (canvasTheme === 'dark' ? '#fff' : '#2563eb')
                            : (canvasTheme === 'dark' ? '#444' : '#d1d5db')}
                        strokeWidth="2"
                        fill="none"
                        className={`transition-colors ${!isSelected ? (canvasTheme === 'dark' ? 'group-hover:stroke-neutral-300' : 'group-hover:stroke-neutral-500') : ''}`}
                    />
                    <path
                        d={path}
                        stroke="#2563eb"
                        strokeWidth="9"
                        fill="none"
                        className="connection-energy-glow pointer-events-none"
                    />
                    <path
                        d={path}
                        stroke="#7dd3fc"
                        strokeWidth="4"
                        strokeLinecap="round"
                        fill="none"
                        markerEnd="url(#connection-energy-arrow)"
                        className="connection-energy-flow pointer-events-none"
                    />
                </g>
            );
        });
    });

    // Render temporary drag connection
    let tempLine = null;
    if (isDraggingConnection && connectionStart && tempConnectionEnd) {
        const startNode = nodes.find(n => n.id === connectionStart.nodeId);
        if (startNode) {
            const startX = connectionStart.handle === 'right' ? startNode.x + getNodeWidth(startNode) : startNode.x;
            const startY = startNode.type === NodeType.VIDEO_ANALYSIS && connectionStart.handle === 'left'
                ? videoAnalysisPortCenterY(startNode, connectionStart.portId)
                    || startNode.y + getNodeHeight(startNode) / 2
                : startNode.y + getNodeHeight(startNode) / 2;
            const endX = (tempConnectionEnd.x - canvasOffset.left - viewport.x) / viewport.zoom;
            const endY = (tempConnectionEnd.y - canvasOffset.top - viewport.y) / viewport.zoom;

            const path = calculateConnectionPath(
                startX,
                startY,
                endX,
                endY,
                connectionStart.handle
            );

            tempLine = (
                <path
                    d={path}
                    stroke={canvasTheme === 'dark' ? '#fff' : '#2563eb'}
                    strokeWidth="2"
                    strokeDasharray="5,5"
                    fill="none"
                    className="pointer-events-none opacity-50"
                />
            );
        }
    }

    return (
        <>
            <defs>
                <marker
                    id="connection-energy-arrow"
                    viewBox="0 0 8 8"
                    refX="7"
                    refY="4"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto-start-reverse"
                >
                    <path d="M 0 0 L 8 4 L 0 8 z" fill="#7dd3fc" />
                </marker>
            </defs>
            <style>{`
                @keyframes connection-energy-travel {
                    from { stroke-dashoffset: 0; }
                    to { stroke-dashoffset: -40; }
                }

                .connection-energy-glow,
                .connection-energy-flow {
                    opacity: 0;
                    transition: opacity 160ms ease, stroke-width 160ms ease;
                }

                .connection-energy-glow {
                    filter: drop-shadow(0 0 4px #2563eb) drop-shadow(0 0 9px #38bdf8);
                }

                .connection-energy-flow {
                    stroke-dasharray: 11 9;
                    filter: drop-shadow(0 0 3px #7dd3fc);
                    animation: connection-energy-travel 650ms linear infinite;
                }

                .connection-edge:hover .connection-energy-glow {
                    opacity: 0.72;
                }

                .connection-edge:hover .connection-energy-flow {
                    opacity: 1;
                }
            `}</style>
            {connections}
            {tempLine}
        </>
    );
};
