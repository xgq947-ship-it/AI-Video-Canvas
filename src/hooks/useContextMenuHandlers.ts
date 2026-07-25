/**
 * useContextMenuHandlers.ts
 * 
 * Handles context menu operations: double-click, right-click,
 * node context menu, toolbar add button.
 */

import React, { useCallback } from 'react';
import { NodeData, NodeType, ContextMenuState, Viewport } from '../types';

interface UseContextMenuHandlersOptions {
    nodes: NodeData[];
    viewport: Viewport;
    contextMenu: ContextMenuState;
    setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState>>;
    handleOpenCreateAsset: (nodeId: string) => void;
    handleSelectTypeFromMenu: (
        type: NodeType | 'DELETE',
        contextMenu: ContextMenuState,
        viewport: Viewport,
        closeMenu: () => void
    ) => void;
    onDeleteNodes?: (ids: string[]) => void | Promise<void>;
}

export const useContextMenuHandlers = ({
    nodes,
    viewport,
    contextMenu,
    setContextMenu,
    handleOpenCreateAsset,
    handleSelectTypeFromMenu,
    onDeleteNodes
}: UseContextMenuHandlersOptions) => {
    // ============================================================================
    // DOUBLE-CLICK & RIGHT-CLICK
    // ============================================================================

    const handleDoubleClick = useCallback((e: React.MouseEvent) => {
        if ((e.target as HTMLElement).id === 'canvas-background') {
            const rect = e.currentTarget.getBoundingClientRect();
            setContextMenu({
                isOpen: true,
                x: e.clientX,
                y: e.clientY,
                type: 'add-nodes',
                canvasX: e.clientX - rect.left,
                canvasY: e.clientY - rect.top
            });
        }
    }, [setContextMenu]);

    const handleGlobalContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        if ((e.target as HTMLElement).id === 'canvas-background') {
            const rect = e.currentTarget.getBoundingClientRect();
            setContextMenu({
                isOpen: true,
                x: e.clientX,
                y: e.clientY,
                type: 'global',
                canvasX: e.clientX - rect.left,
                canvasY: e.clientY - rect.top
            });
        }
    }, [setContextMenu]);

    // ============================================================================
    // NODE OPERATIONS
    // ============================================================================

    const handleAddNext = useCallback((
        nodeId: string,
        _direction: 'left' | 'right',
        anchor?: { x: number; y: number }
    ) => {
        const sourceNode = nodes.find(n => n.id === nodeId);
        if (!sourceNode) return;

        setContextMenu({
            isOpen: true,
            // 节点连接点短按时，以指针释放位置作为菜单左上角。
            // 拖线后由其他调用方打开时才回退到视口中心。
            x: anchor?.x ?? window.innerWidth / 2,
            y: anchor?.y ?? window.innerHeight / 2,
            type: 'node-connector',
            sourceNodeId: nodeId,
            connectorSide: _direction
        });
    }, [nodes, setContextMenu]);

    const handleNodeContextMenu = useCallback((e: React.MouseEvent, id: string) => {
        e.preventDefault();
        e.stopPropagation();

        const node = nodes.find(n => n.id === id);
        if (!node) return;

        setContextMenu({
            isOpen: true,
            x: e.clientX,
            y: e.clientY,
            type: 'node-options',
            sourceNodeId: id
        });
    }, [nodes, setContextMenu]);

    // ============================================================================
    // CONTEXT MENU ACTIONS
    // ============================================================================

    const handleContextMenuCreateAsset = useCallback(() => {
        if (contextMenu.sourceNodeId) {
            handleOpenCreateAsset(contextMenu.sourceNodeId);
        }
    }, [contextMenu.sourceNodeId, handleOpenCreateAsset]);

    const handleContextMenuSelect = useCallback((type: NodeType | 'DELETE') => {
        if (type === 'DELETE' && contextMenu.sourceNodeId && onDeleteNodes) {
            void onDeleteNodes([contextMenu.sourceNodeId]);
            setContextMenu(previous => ({ ...previous, isOpen: false }));
            return;
        }
        handleSelectTypeFromMenu(
            type,
            contextMenu,
            viewport,
            () => setContextMenu(prev => ({ ...prev, isOpen: false }))
        );
    }, [handleSelectTypeFromMenu, contextMenu, viewport, setContextMenu, onDeleteNodes]);

    const handleToolbarAdd = useCallback((e: React.MouseEvent) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setContextMenu({
            isOpen: true,
            x: rect.right + 12,
            y: 76,
            type: 'global',
            canvasX: window.innerWidth / 2,
            canvasY: window.innerHeight / 2
        });
    }, [setContextMenu]);

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        handleDoubleClick,
        handleGlobalContextMenu,
        handleAddNext,
        handleNodeContextMenu,
        handleContextMenuCreateAsset,
        handleContextMenuSelect,
        handleToolbarAdd
    };
};
