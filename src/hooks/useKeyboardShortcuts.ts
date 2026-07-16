/**
 * useKeyboardShortcuts.ts
 * 
 * Handles keyboard shortcuts: undo/redo, copy/paste, delete, escape.
 */

import React, { useCallback, useRef, useEffect } from 'react';
import { NodeData, ContextMenuState, Viewport } from '../types';

interface UseKeyboardShortcutsOptions {
    nodes: NodeData[];
    selectedNodeIds: string[];
    selectedConnection: { parentId: string; childId: string } | null;
    setNodes: React.Dispatch<React.SetStateAction<NodeData[]>>;
    setSelectedNodeIds: React.Dispatch<React.SetStateAction<string[]>>;
    setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState>>;
    deleteNodes: (ids: string[]) => void;
    deleteSelectedConnection: (setNodes: React.Dispatch<React.SetStateAction<NodeData[]>>) => void;
    clearSelection: () => void;
    clearSelectionBox: () => void;
    undo: () => void;
    redo: () => void;
    groupSelected: () => void;
    ungroupSelected: () => void;
    connectSelected: () => void;
    generateSelected: () => void;
    openNewNodeMenu: () => void;
    arrangeCanvas: () => void;
    setViewport: React.Dispatch<React.SetStateAction<Viewport>>;
}

export const useKeyboardShortcuts = ({
    nodes,
    selectedNodeIds,
    selectedConnection,
    setNodes,
    setSelectedNodeIds,
    setContextMenu,
    deleteNodes,
    deleteSelectedConnection,
    clearSelection,
    clearSelectionBox,
    undo,
    redo,
    groupSelected,
    ungroupSelected,
    connectSelected,
    generateSelected,
    openNewNodeMenu,
    arrangeCanvas,
    setViewport
}: UseKeyboardShortcutsOptions) => {
    const clipboardRef = useRef<NodeData[]>([]);
    const isSpacePressedRef = useRef(false);

    // ============================================================================
    // COPY / PASTE / DUPLICATE
    // ============================================================================

    const handleCopy = useCallback(() => {
        if (selectedNodeIds.length > 0) {
            const selectedNodes = nodes.filter(n => selectedNodeIds.includes(n.id));
            clipboardRef.current = JSON.parse(JSON.stringify(selectedNodes));
            console.log(`Copied ${selectedNodes.length} node(s)`);
        }
    }, [nodes, selectedNodeIds]);

    const handlePaste = useCallback(() => {
        if (clipboardRef.current.length > 0) {
            const pasteOffset = 50;
            const newNodes: NodeData[] = clipboardRef.current.map(node => ({
                ...node,
                id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                x: node.x + pasteOffset,
                y: node.y + pasteOffset,
                parentIds: undefined,
                groupId: undefined
            }));

            setNodes(prev => [...prev, ...newNodes]);
            setSelectedNodeIds(newNodes.map(n => n.id));
            console.log(`Pasted ${newNodes.length} node(s)`);
        }
    }, [setNodes, setSelectedNodeIds]);

    const handleDuplicate = useCallback((sourceIds: string[] = selectedNodeIds): string[] => {
        if (sourceIds.length > 0) {
            const selectedNodes = nodes.filter(n => sourceIds.includes(n.id));
            const nodesToDuplicate = JSON.parse(JSON.stringify(selectedNodes));
            const idMap = new Map<string, string>();
            nodesToDuplicate.forEach((node: NodeData) => idMap.set(node.id, crypto.randomUUID()));
            const offset = 20;
            const newNodes: NodeData[] = nodesToDuplicate.map((node: NodeData) => ({
                ...node,
                id: idMap.get(node.id)!,
                x: node.x + offset,
                y: node.y + offset,
                // Preserve connections whose two endpoints are both duplicated.
                parentIds: (node.parentIds || [])
                    .filter(parentId => idMap.has(parentId))
                    .map(parentId => idMap.get(parentId)!),
                groupId: undefined
            }));

            setNodes(prev => [...prev, ...newNodes]);
            setSelectedNodeIds(newNodes.map(n => n.id));
            return newNodes.map(n => n.id);
        }
        return [];
    }, [nodes, selectedNodeIds, setNodes, setSelectedNodeIds]);

    const zoomFromCenter = useCallback((factor: number) => {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        setViewport(prev => {
            const newZoom = Math.min(2, Math.max(0.1, prev.zoom * factor));
            return {
                zoom: newZoom,
                x: cx - (cx - prev.x) * (newZoom / prev.zoom),
                y: cy - (cy - prev.y) * (newZoom / prev.zoom)
            };
        });
    }, [setViewport]);

    const fitCanvas = useCallback(() => {
        if (nodes.length === 0) {
            setViewport({ x: 0, y: 0, zoom: 1 });
            return;
        }
        const nodeWidth = 365;
        const nodeHeight = 480;
        const minX = Math.min(...nodes.map(node => node.x));
        const minY = Math.min(...nodes.map(node => node.y));
        const maxX = Math.max(...nodes.map(node => node.x + nodeWidth));
        const maxY = Math.max(...nodes.map(node => node.y + nodeHeight));
        const padding = 80;
        const availableWidth = Math.max(1, window.innerWidth - padding * 2);
        const availableHeight = Math.max(1, window.innerHeight - padding * 2 - 60);
        const zoom = Math.min(1, Math.max(0.1, Math.min(
            availableWidth / Math.max(1, maxX - minX),
            availableHeight / Math.max(1, maxY - minY)
        )));
        setViewport({
            zoom,
            x: (window.innerWidth - (maxX - minX) * zoom) / 2 - minX * zoom,
            y: 60 + (availableHeight - (maxY - minY) * zoom) / 2 - minY * zoom
        });
    }, [nodes, setViewport]);

    // ============================================================================
    // KEYBOARD EVENT EFFECT
    // ============================================================================

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const activeTag = document.activeElement?.tagName.toLowerCase();
            if (activeTag === 'input' || activeTag === 'textarea') return;
            const mod = e.ctrlKey || e.metaKey;
            const key = e.key.toLowerCase();

            if (e.code === 'Space' && !mod && !e.altKey) {
                e.preventDefault();
                isSpacePressedRef.current = true;
                return;
            }

            if (mod && key === 'z' && !e.shiftKey) {
                e.preventDefault();
                undo();
                return;
            }

            if ((mod && key === 'y') || (mod && e.shiftKey && key === 'z')) {
                e.preventDefault();
                redo();
                return;
            }

            if (mod && key === 'c') {
                e.preventDefault();
                handleCopy();
                return;
            }

            if (mod && key === 'v') {
                e.preventDefault();
                handlePaste();
                return;
            }

            if (mod && key === 'g' && e.shiftKey) {
                e.preventDefault();
                ungroupSelected();
                return;
            }

            if (mod && key === 'g') {
                e.preventDefault();
                groupSelected();
                return;
            }

            if (mod && key === 'l') {
                e.preventDefault();
                connectSelected();
                return;
            }

            if (mod && key === 'd') {
                e.preventDefault();
                handleDuplicate();
                return;
            }

            if (mod && e.key === 'Enter') {
                e.preventDefault();
                generateSelected();
                return;
            }

            if (e.key === 'Tab' && !mod && !e.altKey) {
                e.preventDefault();
                openNewNodeMenu();
                return;
            }

            if (mod && (e.key === '+' || e.key === '=')) {
                e.preventDefault();
                zoomFromCenter(1.15);
                return;
            }

            if (mod && e.key === '-') {
                e.preventDefault();
                zoomFromCenter(1 / 1.15);
                return;
            }

            if (mod && e.key === '0') {
                e.preventDefault();
                fitCanvas();
                return;
            }

            if (e.altKey && e.shiftKey && key === 'f') {
                e.preventDefault();
                arrangeCanvas();
                return;
            }

            // Delete selected nodes or connection
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (selectedNodeIds.length > 0) {
                    deleteNodes(selectedNodeIds);
                    setContextMenu(prev => ({ ...prev, isOpen: false }));
                } else if (selectedConnection) {
                    deleteSelectedConnection(setNodes);
                }
            } else if (e.key === 'Escape') {
                clearSelection();
                clearSelectionBox();
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.code === 'Space') isSpacePressedRef.current = false;
        };

        const handleBlur = () => { isSpacePressedRef.current = false; };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('blur', handleBlur);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', handleBlur);
        };
    }, [
        selectedNodeIds,
        selectedConnection,
        deleteNodes,
        deleteSelectedConnection,
        clearSelection,
        clearSelectionBox,
        undo,
        redo,
        groupSelected,
        ungroupSelected,
        connectSelected,
        generateSelected,
        openNewNodeMenu,
        arrangeCanvas,
        zoomFromCenter,
        fitCanvas,
        handlePaste,
        handleCopy,
        setNodes,
        setContextMenu
    ]);

    return {
        handleCopy,
        handlePaste,
        handleDuplicate,
        isSpacePressedRef
    };
};
