/**
 * useConnectionDragging.ts
 * 
 * Custom hook for managing connection dragging between nodes.
 * Handles drag-to-connect functionality with visual feedback.
 */

import React, { useState, useRef } from 'react';
import { NodeData, NodeType, Viewport } from '../types';
// @ts-ignore — 纯 JS 共享模块，类型由 shared/connectionRules.d.ts 提供
import { isValidNodeConnection } from '@/shared/connectionRules.js';
import { resolveConnectionDropTarget } from '../utils/connectionDropTarget.js';

interface ConnectionStart {
    nodeId: string;
    handle: 'left' | 'right';
}

interface CanvasOffset {
    left: number;
    top: number;
}

export const useConnectionDragging = () => {
    // ============================================================================
    // STATE
    // ============================================================================

    const [isDraggingConnection, setIsDraggingConnection] = useState(false);
    const [connectionStart, setConnectionStart] = useState<ConnectionStart | null>(null);
    const [tempConnectionEnd, setTempConnectionEnd] = useState<{ x: number; y: number } | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [hoveredSide, setHoveredSide] = useState<'left' | 'right' | null>(null);
    const [selectedConnection, setSelectedConnection] = useState<{ parentId: string; childId: string } | null>(null);
    const dragStartTime = useRef<number>(0);
    const isDraggingConnectionRef = useRef(false);
    const connectionStartRef = useRef<ConnectionStart | null>(null);
    const hoveredNodeIdRef = useRef<string | null>(null);
    const hoveredSideRef = useRef<'left' | 'right' | null>(null);

    // ============================================================================
    // HELPERS
    // ============================================================================

    /**
     * Checks if mouse is hovering over a node (for connection target)
     * Also determines which side (left or right connector) is being hovered
     * @param mouseX - Screen X coordinate
     * @param mouseY - Screen Y coordinate
     * @param nodes - Array of all nodes
     * @param viewport - Current viewport
     */
    const setHoveredTarget = (target: { nodeId: string; side: 'left' | 'right' } | null) => {
        hoveredNodeIdRef.current = target?.nodeId || null;
        hoveredSideRef.current = target?.side || null;
        setHoveredNodeId(target?.nodeId || null);
        setHoveredSide(target?.side || null);
    };

    const resolveDropTargetAtPoint = (mouseX: number, mouseY: number, sourceNodeId: string) => {
        if (typeof document === 'undefined') return null;

        const elementsAtPoint = typeof document.elementsFromPoint === 'function'
            ? document.elementsFromPoint(mouseX, mouseY)
            : [];
        const connector = elementsAtPoint
            .map(element => element.closest<HTMLElement>('[data-connector-node-id][data-connector-side]'))
            .find((element): element is HTMLElement => Boolean(element));
        const connectorNodeId = connector?.dataset.connectorNodeId;
        const connectorSide = connector?.dataset.connectorSide;
        const connectorTarget: { nodeId: string; side: 'left' | 'right' } | null =
            connectorNodeId && (connectorSide === 'left' || connectorSide === 'right')
            ? { nodeId: connectorNodeId, side: connectorSide }
            : null;

        const rootsAtPoint = elementsAtPoint
            .map(element => element.closest<HTMLElement>('[data-node-id]'))
            .filter((element): element is HTMLElement => Boolean(element));
        const allRoots = Array.from(document.querySelectorAll<HTMLElement>('[data-node-id]'));
        const orderedRoots = [...rootsAtPoint, ...allRoots];
        const candidates = orderedRoots.map(element => {
            const rect = element.getBoundingClientRect();
            return {
                nodeId: element.dataset.nodeId || '',
                rect: {
                    left: rect.left,
                    top: rect.top,
                    right: rect.right,
                    bottom: rect.bottom,
                    width: rect.width,
                    height: rect.height,
                },
            };
        }).filter(candidate => Boolean(candidate.nodeId));

        return resolveConnectionDropTarget({
            point: { x: mouseX, y: mouseY },
            sourceNodeId,
            candidates,
            connectorTarget,
        });
    };

    const checkHoveredNode = (mouseX: number, mouseY: number) => {
        const start = connectionStartRef.current;
        setHoveredTarget(start ? resolveDropTargetAtPoint(mouseX, mouseY, start.nodeId) : null);
    };

    const resetConnectionDrag = () => {
        isDraggingConnectionRef.current = false;
        connectionStartRef.current = null;
        setIsDraggingConnection(false);
        setConnectionStart(null);
        setTempConnectionEnd(null);
        setHoveredTarget(null);
    };

    // ============================================================================
    // EVENT HANDLERS
    // ============================================================================

    /**
     * Starts connection dragging from a connector button
     */
    const handleConnectorPointerDown = (
        e: React.PointerEvent,
        nodeId: string,
        side: 'left' | 'right'
    ) => {
        e.stopPropagation();
        e.preventDefault();
        if (e.currentTarget instanceof HTMLElement) {
            e.currentTarget.setPointerCapture(e.pointerId);
        }
        dragStartTime.current = Date.now();
        isDraggingConnectionRef.current = true;
        connectionStartRef.current = { nodeId, handle: side };
        setIsDraggingConnection(true);
        setConnectionStart({ nodeId, handle: side });
        setTempConnectionEnd({ x: e.clientX, y: e.clientY });
    };

    /**
     * Updates temporary connection end point during drag
     */
    const updateConnectionDrag = (
        e: React.PointerEvent,
        nodes: NodeData[],
        viewport: Viewport,
        canvasOffset?: CanvasOffset
    ) => {
        if (!isDraggingConnectionRef.current) return false;

        setTempConnectionEnd({ x: e.clientX, y: e.clientY });
        checkHoveredNode(e.clientX, e.clientY);
        return true;
    };

    /**
     * Completes connection drag and creates connection if valid
     * Returns true if connection was handled, false otherwise
     * @param nodes - All nodes for validation
     * @param onConnectionMade - Optional callback called with (parentId, childId) when connection is created
     */
    const completeConnectionDrag = (
        onAddNext: (
            nodeId: string,
            direction: 'left' | 'right',
            anchor?: { x: number; y: number }
        ) => void,
        onUpdateNodes: (updater: (prev: NodeData[]) => NodeData[]) => void,
        nodes: NodeData[],
        onConnectionMade?: (parentId: string, childId: string) => void,
        pointerPosition?: { x: number; y: number }
    ): boolean => {
        const activeStart = connectionStartRef.current;
        if (!isDraggingConnectionRef.current || !activeStart) return false;

        const dragDuration = Date.now() - dragStartTime.current;
        const dropTarget = pointerPosition
            ? resolveDropTargetAtPoint(pointerPosition.x, pointerPosition.y, activeStart.nodeId)
            : (hoveredNodeIdRef.current && hoveredSideRef.current
                ? { nodeId: hoveredNodeIdRef.current, side: hoveredSideRef.current }
                : null);

        /**
         * 校验连接是否合法：节点类型规则见 utils/connectionRules.ts（纯函数，已单测覆盖）。
         */
        const isValidConnection = (parentId: string, childId: string): boolean => {
            const parentNode = nodes.find(n => n.id === parentId);
            const childNode = nodes.find(n => n.id === childId);
            if (!parentNode || !childNode) return false;
            if (parentId === childId) return false;
            return isValidNodeConnection(parentNode.type, childNode.type);
        };

        // Short click - open menu
        if (dragDuration < 200 && !dropTarget) {
            onAddNext(activeStart.nodeId, activeStart.handle, pointerPosition);
        }
        // Drag to node - create connection based on target side
        else if (dropTarget) {
            const { nodeId: targetNodeId, side: targetSide } = dropTarget;
            if (targetSide === 'left') {
                // Connecting to LEFT connector = target receives input (target is child)
                // source is parent, hoveredNode is child
                if (!isValidConnection(activeStart.nodeId, targetNodeId)) {
                    // Invalid connection - reset and return
                    resetConnectionDrag();
                    return true;
                }

                // Add source as a parent to target node
                onUpdateNodes(prev => prev.map(n => {
                    if (n.id === targetNodeId) {
                        const existingParents = n.parentIds || [];
                        // Prevent duplicate connections
                        if (!existingParents.includes(activeStart.nodeId)) {
                            return { ...n, parentIds: [...existingParents, activeStart.nodeId] };
                        }
                    }
                    return n;
                }));
                // Notify about new connection: source is parent, hoveredNode is child
                onConnectionMade?.(activeStart.nodeId, targetNodeId);
            } else {
                // Connecting to RIGHT connector = target provides output (target is parent)
                // hoveredNode is parent, source is child
                if (!isValidConnection(targetNodeId, activeStart.nodeId)) {
                    // Invalid connection - reset and return
                    resetConnectionDrag();
                    return true;
                }

                // Add target as a parent to source node
                onUpdateNodes(prev => prev.map(n => {
                    if (n.id === activeStart.nodeId) {
                        const existingParents = n.parentIds || [];
                        // Prevent duplicate connections
                        if (!existingParents.includes(targetNodeId)) {
                            return { ...n, parentIds: [...existingParents, targetNodeId] };
                        }
                    }
                    return n;
                }));
                // Notify about new connection: hoveredNode is parent, source is child
                onConnectionMade?.(targetNodeId, activeStart.nodeId);
            }
        }

        // Reset state
        resetConnectionDrag();
        return true;
    };

    /**
     * Handles clicking on a connection line to select it
     */
    const handleEdgeClick = (e: React.MouseEvent, parentId: string, childId: string) => {
        e.stopPropagation();
        setSelectedConnection({ parentId, childId });
    };

    /**
     * Deletes the currently selected connection
     */
    const deleteSelectedConnection = (onUpdateNodes: (updater: (prev: NodeData[]) => NodeData[]) => void) => {
        if (!selectedConnection) return false;

        onUpdateNodes(prev => prev.map(n => {
            if (n.id === selectedConnection.childId) {
                const existingParents = n.parentIds || [];
                return { ...n, parentIds: existingParents.filter(pid => pid !== selectedConnection.parentId) };
            }
            return n;
        }));
        setSelectedConnection(null);
        return true;
    };

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        isDraggingConnection,
        connectionStart,
        tempConnectionEnd,
        hoveredNodeId,
        selectedConnection,
        setSelectedConnection,
        handleConnectorPointerDown,
        updateConnectionDrag,
        completeConnectionDrag,
        handleEdgeClick,
        deleteSelectedConnection
    };
};
