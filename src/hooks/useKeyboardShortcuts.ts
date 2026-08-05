/**
 * useKeyboardShortcuts.ts
 * 
 * Handles keyboard shortcuts: undo/redo, copy/paste, delete, escape.
 */

import React, { useCallback, useRef, useEffect } from 'react';
import { NodeData, ContextMenuState, Viewport } from '../types';
import { canvasHistoryShortcut, isTextEditingTarget } from '../utils/keyboardShortcuts.js';
import { computeFitViewport, DEFAULT_NODE_WIDTH } from '@/shared/canvasCoords.js';
import { ZOOM_MIN, ZOOM_MAX } from '@/shared/zoom.js';
import { getCanvasRect } from '../utils/canvasRect';

/**
 * fit 时用来估算节点占位高度。
 * 不用 DEFAULT_NODE_HEIGHT(300)：那是新建节点的初始高度，带结果预览的节点远高于此，
 * 用它会让 fit 之后画布底部被截掉。480 沿用原实现，是偏保守（宁可多留白）的估计。
 */
const FIT_NODE_HEIGHT = 480;

interface UseKeyboardShortcutsOptions {
    nodes: NodeData[];
    selectedNodeIds: string[];
    selectedConnection: { parentId: string; childId: string } | null;
    setNodes: React.Dispatch<React.SetStateAction<NodeData[]>>;
    setSelectedNodeIds: React.Dispatch<React.SetStateAction<string[]>>;
    setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState>>;
    deleteNodes: (ids: string[]) => void;
    deleteSelectedConnection: (setNodes: React.Dispatch<React.SetStateAction<NodeData[]>>) => boolean;
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
    toggleShortcutHelp: () => void;
    setViewport: React.Dispatch<React.SetStateAction<Viewport>>;
    onPasteImageFiles?: (files: File[]) => void | Promise<void>;
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
    toggleShortcutHelp,
    setViewport,
    onPasteImageFiles
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
                // 与 handleDuplicate 保持一致：Date.now()+Math.random() 在同一毫秒内
                // 批量粘贴时有碰撞风险，crypto.randomUUID 没有。
                id: crypto.randomUUID(),
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

    // 收敛到 shared/canvasCoords 的 computeFitViewport。
    //
    // 这里原本是第三套手写的 fit 实现：自己算 padding、把节点尺寸硬编码成
    // 365 × 480，而 App.tsx 的「适合选中节点」和 useWorkflow 的加载后 fit 用的都是
    // computeFitViewport（有 6 条单测覆盖）。三套逻辑各算各的，结果自然对不上。
    //
    // 节点高度按 FIT_NODE_HEIGHT 估算而不是用 DEFAULT_NODE_HEIGHT(300)：后者是
    // 「新建节点时的初始高度」，带结果预览的节点实际要高得多，用 300 去 fit 会把
    // 画布底部截掉。这里沿用原实现的 480，是贴近真实渲染高度的保守估计。
    const fitCanvas = useCallback(() => {
        if (nodes.length === 0) {
            setViewport({ x: 0, y: 0, zoom: 1 });
            return;
        }
        const minX = Math.min(...nodes.map(node => node.x));
        const minY = Math.min(...nodes.map(node => node.y));
        const maxX = Math.max(...nodes.map(node => node.x + DEFAULT_NODE_WIDTH));
        const maxY = Math.max(...nodes.map(node => node.y + FIT_NODE_HEIGHT));
        setViewport(computeFitViewport(getCanvasRect(), {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
        }, { minZoom: ZOOM_MIN, maxZoom: Math.min(1, ZOOM_MAX) }));
    }, [nodes, setViewport]);

    // ============================================================================
    // KEYBOARD EVENT EFFECT
    // ============================================================================

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (isTextEditingTarget(document.activeElement)) return;
            const mod = e.ctrlKey || e.metaKey;
            const key = e.key.toLowerCase();
            const historyAction = canvasHistoryShortcut(e);

            if (e.code === 'Space' && !mod && !e.altKey) {
                e.preventDefault();
                isSpacePressedRef.current = true;
                return;
            }

            // `?` 唤出快捷键速查表。不判 Shift：不同键盘布局下 `?` 的组合不一样，
            // 直接认最终字符最稳。
            if (e.key === '?' && !mod && !e.altKey) {
                e.preventDefault();
                toggleShortcutHelp();
                return;
            }

            if (historyAction === 'undo') {
                e.preventDefault();
                undo();
                return;
            }

            if (historyAction === 'redo') {
                e.preventDefault();
                redo();
                return;
            }

            if (mod && key === 'c') {
                e.preventDefault();
                handleCopy();
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
                e.preventDefault();
                // A visible selected edge always wins over stale node selection.
                // Edge deletion must never enter the node/trash path.
                if (selectedConnection) {
                    deleteSelectedConnection(setNodes);
                } else if (selectedNodeIds.length > 0) {
                    deleteNodes(selectedNodeIds);
                    setContextMenu(prev => ({ ...prev, isOpen: false }));
                }
                return;
            } else if (e.key === 'Escape') {
                clearSelection();
                clearSelectionBox();
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.code === 'Space') isSpacePressedRef.current = false;
        };

        const handlePasteEvent = (e: ClipboardEvent) => {
            const active = document.activeElement as HTMLElement | null;
            const activeTag = active?.tagName.toLowerCase();
            if (activeTag === 'input' || activeTag === 'textarea' || active?.isContentEditable) return;

            const imageFiles = Array.from(e.clipboardData?.items || [])
                .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
                .map(item => item.getAsFile())
                .filter((file): file is File => Boolean(file));

            if (imageFiles.length > 0 && onPasteImageFiles) {
                e.preventDefault();
                void onPasteImageFiles(imageFiles);
                return;
            }

            if (clipboardRef.current.length > 0) {
                e.preventDefault();
                handlePaste();
            }
        };

        const handleBlur = () => { isSpacePressedRef.current = false; };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('paste', handlePasteEvent);
        window.addEventListener('blur', handleBlur);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('paste', handlePasteEvent);
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
        toggleShortcutHelp,
        zoomFromCenter,
        fitCanvas,
        handlePaste,
        handleCopy,
        onPasteImageFiles,
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
