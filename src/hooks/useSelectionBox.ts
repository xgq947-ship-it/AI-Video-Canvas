/**
 * useSelectionBox.ts
 * 
 * Custom hook for managing selection box functionality.
 * Handles drag-to-select behavior for selecting multiple nodes.
 */

import React, { useState, useRef } from 'react';
import { SelectionBox, NodeData, Viewport } from '../types';
import { paneToCanvas, screenToPane } from '@/shared/canvasCoords.js';

export const useSelectionBox = () => {
    // ============================================================================
    // STATE
    // ============================================================================

    const emptySelectionBox = (): SelectionBox => ({
        isActive: false,
        startX: 0,
        startY: 0,
        endX: 0,
        endY: 0
    });
    const [selectionBox, setSelectionBox] = useState<SelectionBox>(emptySelectionBox);
    // State is for painting the rectangle. Gesture completion must read a ref:
    // pointerup can arrive before React commits the pointerdown/pointermove state.
    const selectionBoxRef = useRef<SelectionBox>(selectionBox);

    const isSelecting = useRef<boolean>(false);

    // ============================================================================
    // HELPERS
    // ============================================================================

    /**
     * Check if a node intersects with the selection box
     * @param node - Node to check
     * @param box - Selection box coordinates
     * @param viewport - Current viewport state
     * @returns true if node intersects with selection box
     */
    const isNodeInSelectionBox = (
        node: NodeData,
        box: SelectionBox,
        viewport: Viewport
    ): boolean => {
        // Convert selection box screen coordinates to canvas coordinates
        const boxLeft = Math.min(box.startX, box.endX);
        const boxRight = Math.max(box.startX, box.endX);
        const boxTop = Math.min(box.startY, box.endY);
        const boxBottom = Math.max(box.startY, box.endY);

        // 框选坐标是面板坐标（相对画布容器）→ 换算成节点世界坐标
        const topLeft = paneToCanvas(boxLeft, boxTop, viewport);
        const bottomRight = paneToCanvas(boxRight, boxBottom, viewport);
        const canvasBoxLeft = topLeft.x;
        const canvasBoxTop = topLeft.y;
        const canvasBoxRight = bottomRight.x;
        const canvasBoxBottom = bottomRight.y;

        // Node dimensions (340x300 from CanvasNode component)
        const nodeLeft = node.x;
        const nodeRight = node.x + 340;
        const nodeTop = node.y;
        const nodeBottom = node.y + 300;

        // Rectangle intersection check
        return !(
            canvasBoxRight < nodeLeft ||
            canvasBoxLeft > nodeRight ||
            canvasBoxBottom < nodeTop ||
            canvasBoxTop > nodeBottom
        );
    };

    // ============================================================================
    // EVENT HANDLERS
    // ============================================================================

    /**
     * Start selection box drag
     * @param e - Pointer event
     */
    const startSelection = (e: React.PointerEvent) => {
        // 屏幕坐标 → 面板坐标（相对画布容器，扣除侧边栏宽度）
        const rect = e.currentTarget.getBoundingClientRect();
        const { x: relativeX, y: relativeY } = screenToPane(e.clientX, e.clientY, rect);

        const next = {
            isActive: true,
            startX: relativeX,
            startY: relativeY,
            endX: relativeX,
            endY: relativeY
        };
        isSelecting.current = true;
        selectionBoxRef.current = next;
        setSelectionBox(next);
    };

    /**
     * Update selection box end coordinates during drag
     * @param e - Pointer event
     * @returns true if selection box is being updated, false otherwise
     */
    const updateSelection = (e: React.PointerEvent): boolean => {
        if (!isSelecting.current) return false;

        // 屏幕坐标 → 面板坐标（相对画布容器，扣除侧边栏宽度）
        const rect = e.currentTarget.getBoundingClientRect();
        const { x: relativeX, y: relativeY } = screenToPane(e.clientX, e.clientY, rect);

        const next = {
            ...selectionBoxRef.current,
            endX: relativeX,
            endY: relativeY
        };
        selectionBoxRef.current = next;
        setSelectionBox(next);

        return true;
    };

    /**
     * Complete selection and return selected node IDs
     * @param nodes - All nodes on the canvas
     * @param viewport - Current viewport state
     * @returns Array of selected node IDs, or null when no selection gesture is active
     */
    const endSelection = (
        nodes: NodeData[],
        viewport: Viewport
    ): string[] | null => {
        // Callers must ask the ref-backed operation directly instead of first
        // consulting a render-time boolean snapshot. A quick down/up can finish
        // before React commits the state update; that stale snapshot used to skip
        // this cleanup and the next node drag was swallowed by the orphaned box.
        if (!isSelecting.current) return null;

        const selectedIds = nodes
            .filter(node => isNodeInSelectionBox(node, selectionBoxRef.current, viewport))
            .map(node => node.id);

        // Clear selection box
        const empty = emptySelectionBox();
        isSelecting.current = false;
        selectionBoxRef.current = empty;
        setSelectionBox(empty);

        return selectedIds;
    };

    /**
     * Clear selection box state
     */
    const clearSelectionBox = () => {
        isSelecting.current = false;
        selectionBoxRef.current = emptySelectionBox();
        setSelectionBox(prev => prev.isActive
            || prev.startX !== 0
            || prev.startY !== 0
            || prev.endX !== 0
            || prev.endY !== 0
            ? emptySelectionBox()
            : prev);
    };

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        selectionBox,
        startSelection,
        updateSelection,
        endSelection,
        clearSelectionBox
    };
};
