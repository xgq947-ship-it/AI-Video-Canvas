/**
 * useNodeDragging.ts
 * 
 * Custom hook for managing node dragging functionality.
 * Handles pointer events for dragging nodes around the canvas.
 */

import React, { useEffect, useRef, useState } from 'react';
import { NodeData, Viewport } from '../types';

interface DragNode {
    id: string;
}

export const useNodeDragging = () => {
    // ============================================================================
    // STATE
    // ============================================================================

    const dragNodeRef = useRef<DragNode | null>(null);
    const isPanning = useRef<boolean>(false);
    const [isDragging, setIsDragging] = useState<boolean>(false);

    // 指针事件的触发频率可以远高于屏幕刷新率（高刷鼠标能到 1000Hz）。
    // 每个事件都 setNodes/setViewport 就是每秒上千次全画布 render，
    // 所以这里把位移累积起来，每帧只提交一次。
    const pendingNodeDeltaRef = useRef({ dx: 0, dy: 0 });
    const nodeDragFrameRef = useRef<number | null>(null);
    const pendingPanDeltaRef = useRef({ dx: 0, dy: 0 });
    const panFrameRef = useRef<number | null>(null);
    // 已排期但尚未执行的提交闭包，供松手时同步兜底。
    const pendingNodeFlushRef = useRef<(() => void) | null>(null);
    const pendingPanFlushRef = useRef<(() => void) | null>(null);

    const flushPendingNodeDrag = () => {
        if (nodeDragFrameRef.current !== null) {
            cancelAnimationFrame(nodeDragFrameRef.current);
            nodeDragFrameRef.current = null;
        }
        const flush = pendingNodeFlushRef.current;
        pendingNodeFlushRef.current = null;
        flush?.();
    };

    const flushPendingPan = () => {
        if (panFrameRef.current !== null) {
            cancelAnimationFrame(panFrameRef.current);
            panFrameRef.current = null;
        }
        const flush = pendingPanFlushRef.current;
        pendingPanFlushRef.current = null;
        flush?.();
    };

    useEffect(() => () => {
        if (nodeDragFrameRef.current !== null) cancelAnimationFrame(nodeDragFrameRef.current);
        if (panFrameRef.current !== null) cancelAnimationFrame(panFrameRef.current);
    }, []);

    // ============================================================================
    // EVENT HANDLERS
    // ============================================================================

    /**
     * Starts node dragging
     * @param e - Pointer event
     * @param id - Node ID to drag
     * @param onSelect - Callback to select the node
     */
    const handleNodePointerDown = (
        e: React.PointerEvent,
        id: string,
        onSelect?: (id: string) => void
    ) => {
        e.stopPropagation();
        dragNodeRef.current = { id };
        setIsDragging(true);

        // Select the node
        if (onSelect) {
            onSelect(id);
        }

        if (e.target instanceof HTMLElement) {
            e.target.setPointerCapture(e.pointerId);
        }
    };

    /**
     * Updates node position during drag
     * Returns true if node was dragged, false otherwise
     */
    const updateNodeDrag = (
        e: React.PointerEvent,
        viewport: Viewport,
        onUpdateNodes: (updater: (prev: NodeData[]) => NodeData[]) => void,
        selectedNodeIds: string[] = []
    ): boolean => {
        if (!dragNodeRef.current) return false;

        const nodeId = dragNodeRef.current.id;
        pendingNodeDeltaRef.current.dx += e.movementX / viewport.zoom;
        pendingNodeDeltaRef.current.dy += e.movementY / viewport.zoom;

        // 本帧已经排过队了，只累加位移即可。
        if (nodeDragFrameRef.current !== null) return true;

        // If dragging a selected node, move all selected nodes
        const nodesToMove = selectedNodeIds.includes(nodeId) && selectedNodeIds.length > 1
            ? new Set(selectedNodeIds)
            : new Set([nodeId]);

        const flush = () => {
            const { dx, dy } = pendingNodeDeltaRef.current;
            pendingNodeDeltaRef.current = { dx: 0, dy: 0 };
            if (dx === 0 && dy === 0) return;

            // 刻意不检查 dragNodeRef：松手后可能还剩最后一帧没提交，
            // 丢掉它会让节点在 pointerup 时倒退几个像素。
            onUpdateNodes(prev => prev.map(n => (
                nodesToMove.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n
            )));
        };

        pendingNodeFlushRef.current = flush;
        nodeDragFrameRef.current = requestAnimationFrame(() => {
            nodeDragFrameRef.current = null;
            flush();
        });

        return true;
    };

    /**
     * Ends node dragging
     */
    const endNodeDrag = () => {
        // 松手时立刻把没提交的位移落下去。窗口被隐藏、遮挡或最小化时
        // requestAnimationFrame 会被节流甚至完全不触发（Electron 的
        // backgroundThrottling 默认开启），不能让最后一段位移一直悬着。
        flushPendingNodeDrag();
        dragNodeRef.current = null;
        setIsDragging(false);
    };

    /**
     * Starts canvas panning
     */
    const startPanning = (e: React.PointerEvent) => {
        isPanning.current = true;
        if (e.target instanceof HTMLElement) {
            e.target.setPointerCapture(e.pointerId);
        }
    };

    /**
     * Updates canvas pan position
     * Returns true if panning, false otherwise
     */
    const updatePanning = (
        e: React.PointerEvent,
        onUpdateViewport: (updater: (prev: Viewport) => Viewport) => void
    ): boolean => {
        if (!isPanning.current) return false;

        pendingPanDeltaRef.current.dx += e.movementX;
        pendingPanDeltaRef.current.dy += e.movementY;

        if (panFrameRef.current !== null) return true;

        const flush = () => {
            const { dx, dy } = pendingPanDeltaRef.current;
            pendingPanDeltaRef.current = { dx: 0, dy: 0 };
            if (dx === 0 && dy === 0) return;

            onUpdateViewport(prev => ({
                ...prev,
                x: prev.x + dx,
                y: prev.y + dy
            }));
        };

        pendingPanFlushRef.current = flush;
        panFrameRef.current = requestAnimationFrame(() => {
            panFrameRef.current = null;
            flush();
        });

        return true;
    };

    /**
     * Ends canvas panning
     */
    const endPanning = () => {
        flushPendingPan();
        isPanning.current = false;
    };

    /**
     * Releases pointer capture
     */
    const releasePointerCapture = (e: React.PointerEvent) => {
        if (e.target instanceof HTMLElement && e.target.hasPointerCapture(e.pointerId)) {
            try {
                e.target.releasePointerCapture(e.pointerId);
            } catch (err) {
                // Ignore errors
            }
        }
    };

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        handleNodePointerDown,
        updateNodeDrag,
        endNodeDrag,
        startPanning,
        updatePanning,
        endPanning,
        isDragging,
        isPanning: isPanning.current,
        releasePointerCapture
    };
};
