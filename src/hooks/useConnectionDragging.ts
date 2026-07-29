/**
 * useConnectionDragging.ts
 * 
 * Custom hook for managing connection dragging between nodes.
 * Handles drag-to-connect functionality with visual feedback.
 */

import React, { useState, useRef } from 'react';
import { NodeData, NodeType } from '../types';
// @ts-ignore — 纯 JS 共享模块，类型由 shared/connectionRules.d.ts 提供
import { isValidNodeConnection } from '@/shared/connectionRules.js';
import { resolveConnectionDropTarget, ConnectionDropCandidate } from '../utils/connectionDropTarget.js';
import { removeCanvasConnection } from '../utils/canvasEdges.js';

interface ConnectionStart {
    nodeId: string;
    handle: 'left' | 'right';
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

    /** 同步 hover 目标：ref 供同一帧内的命中判定读取，state 供渲染高亮。 */
    const setHoveredTarget = (target: { nodeId: string; side: 'left' | 'right' } | null) => {
        hoveredNodeIdRef.current = target?.nodeId || null;
        hoveredSideRef.current = target?.side || null;
        setHoveredNodeId(target?.nodeId || null);
        setHoveredSide(target?.side || null);
    };

    /**
     * 全部节点矩形的每帧缓存。
     *
     * getBoundingClientRect() 会强制同步布局，而这里要对画布上**每个**节点各取一次。
     * pointermove 在高回报率鼠标上一帧能来好几条（Windows 上尤其明显），逐条重算就是
     * 拖线卡顿的来源。同一帧内不会有任何重绘，缓存一帧既省掉重复布局，也不会算错：
     * 连线拖拽期间只有 tempConnectionEnd / hover 高亮在变，节点位置不动。
     * 按帧而不是按整次拖拽缓存，是为了让拖拽中途的缩放、平移立刻生效。
     */
    const nodeRectCache = useRef<ConnectionDropCandidate[] | null>(null);
    const nodeRectFrame = useRef<number | null>(null);

    const invalidateNodeRects = () => {
        nodeRectCache.current = null;
        nodeRectFrame.current = null;
    };

    const readNodeRects = (): ConnectionDropCandidate[] => {
        if (nodeRectCache.current) return nodeRectCache.current;

        const candidates = Array.from(document.querySelectorAll<HTMLElement>('[data-node-id]'))
            .map(element => {
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
            })
            .filter(candidate => Boolean(candidate.nodeId));

        // 只在拿得到 rAF 时才缓存：拿不到就没有可靠的作废时机，宁可每次重算。
        if (typeof requestAnimationFrame === 'function') {
            nodeRectCache.current = candidates;
            if (nodeRectFrame.current === null) {
                nodeRectFrame.current = requestAnimationFrame(invalidateNodeRects);
            }
        }
        return candidates;
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

        // 指针正下方的节点排在最前，让重叠节点按「最上面的赢」定序；
        // resolveConnectionDropTarget 内部按 nodeId 去重，重复项不影响结果。
        const nodeIdsAtPoint = elementsAtPoint
            .map(element => element.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId)
            .filter((nodeId): nodeId is string => Boolean(nodeId));
        const allCandidates = readNodeRects();
        const candidates = nodeIdsAtPoint.length
            ? [
                ...nodeIdsAtPoint
                    .map(nodeId => allCandidates.find(candidate => candidate.nodeId === nodeId))
                    .filter((candidate): candidate is ConnectionDropCandidate => Boolean(candidate)),
                ...allCandidates,
            ]
            : allCandidates;

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
        invalidateNodeRects();
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
        invalidateNodeRects();
        setIsDraggingConnection(true);
        setConnectionStart({ nodeId, handle: side });
        setTempConnectionEnd({ x: e.clientX, y: e.clientY });
    };

    /**
     * Updates temporary connection end point during drag
     */
    const updateConnectionDrag = (e: React.PointerEvent) => {
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
        onConnectionMade?: (parentId: string, childId: string, currentNodes: NodeData[]) => Partial<NodeData> | void,
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
                onUpdateNodes(prev => {
                    const connectionUpdates = onConnectionMade?.(activeStart.nodeId, targetNodeId, prev) || {};
                    return prev.map(n => {
                        if (n.id === targetNodeId) {
                            const existingParents = n.parentIds || [];
                            // Prevent duplicate connections
                            if (!existingParents.includes(activeStart.nodeId)) {
                                return {
                                    ...n,
                                    parentIds: [...existingParents, activeStart.nodeId],
                                    ...connectionUpdates
                                };
                            }
                        }
                        return n;
                    });
                });
            } else {
                // Connecting to RIGHT connector = target provides output (target is parent)
                // hoveredNode is parent, source is child
                if (!isValidConnection(targetNodeId, activeStart.nodeId)) {
                    // Invalid connection - reset and return
                    resetConnectionDrag();
                    return true;
                }

                // Add target as a parent to source node
                onUpdateNodes(prev => {
                    const connectionUpdates = onConnectionMade?.(targetNodeId, activeStart.nodeId, prev) || {};
                    return prev.map(n => {
                        if (n.id === activeStart.nodeId) {
                            const existingParents = n.parentIds || [];
                            // Prevent duplicate connections
                            if (!existingParents.includes(targetNodeId)) {
                                return {
                                    ...n,
                                    parentIds: [...existingParents, targetNodeId],
                                    ...connectionUpdates
                                };
                            }
                        }
                        return n;
                    });
                });
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

        onUpdateNodes(prev => removeCanvasConnection(prev, selectedConnection));
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
