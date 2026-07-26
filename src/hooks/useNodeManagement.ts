/**
 * useNodeManagement.ts
 * 
 * Custom hook for managing node state and operations.
 * Handles node creation, updates, selection, and deletion.
 */

import { useState } from 'react';
import { NodeData, NodeType, NodeStatus, Viewport } from '../types';
import { DEFAULT_NODE_WIDTH, paneToCanvas } from '@/shared/canvasCoords.js';

export const useNodeManagement = () => {
    // ============================================================================
    // STATE
    // ============================================================================

    const [nodes, setNodes] = useState<NodeData[]>([]);
    const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);

    // ============================================================================
    // NODE OPERATIONS
    // ============================================================================

    /**
     * Adds a new node to the canvas
     * @param type - Type of node to create
     * @param x - Screen X coordinate
     * @param y - Screen Y coordinate
     * @param parentId - Optional parent node ID for connections
     * @param viewport - Current viewport for coordinate conversion
     */
    const addNode = (
        type: NodeType,
        x: number,
        y: number,
        parentId: string | undefined,
        viewport: Viewport
    ) => {
        // x/y 是面板坐标（相对画布容器，已扣除侧边栏），由 contextMenu.canvasX/canvasY 提供
        const { x: canvasX, y: canvasY } = paneToCanvas(x, y, viewport);
        // 新建节点居中于点击处：横向用卡片真实宽度（365，此前硬编码 340 导致偏 12.5px）；
        // 纵向沿用历史常量 100 —— 节点高度随类型与内容变化（待生成 ~214、出图后 auto），无统一值。
        const halfWidth = DEFAULT_NODE_WIDTH / 2;

        const newNode: NodeData = {
            id: crypto.randomUUID(),
            type,
            x: parentId ? canvasX : canvasX - halfWidth,
            y: parentId ? canvasY : canvasY - 100,
            prompt: '',
            status: NodeStatus.IDLE,
            model: 'Banana Pro',
            aspectRatio: 'Auto',
            resolution: 'Auto',
            parentIds: parentId ? [parentId] : []
        };

        if (type === NodeType.PRODUCT_SCENE_REPLACE) {
            newNode.title = '产品短视频生成';
            newNode.imageModel = 'google-flow-nano-banana-pro';
            newNode.aspectRatio = '1:1';
            newNode.productDimensions = { length: 0, width: 0, height: 0, unit: 'cm' };
            newNode.preserveProductMarkings = true;
            newNode.productSceneRecognitionProvider = 'codex-cli';
            newNode.productSceneImageCount = 1;
            newNode.productSceneAutoGenerateVideo = false;
            newNode.productSceneVideoModel = 'gemini-web-video';
            newNode.productSceneVideoAspectRatio = '16:9';
            newNode.productSceneVideoDuration = 8;
            newNode.productSceneVideoGenerateAudio = true;
        }

        setNodes(prev => [...prev, newNode]);
        setSelectedNodeIds([newNode.id]);

        return newNode.id;
    };

    /**
     * Updates a node with partial data
     * @param id - Node ID to update
     * @param updates - Partial node data to merge
     */
    const updateNode = (id: string, updates: Partial<NodeData>) => {
        setNodes(prev => prev.map(n => n.id === id ? { ...n, ...updates } : n));
    };

    /**
     * Deletes a node by ID
     * @param id - Node ID to delete
     */
    const deleteNode = (id: string) => {
        setNodes(prev => prev.filter(n => n.id !== id));
        setSelectedNodeIds(prev => prev.filter(nodeId => nodeId !== id));
    };

    /**
     * Deletes multiple nodes by IDs
     * @param ids - Array of node IDs to delete
     */
    const deleteNodes = (ids: string[]) => {
        setNodes(prev => prev.filter(n => !ids.includes(n.id)));
        setSelectedNodeIds([]);
    };

    /**
     * Clears all node selections
     */
    const clearSelection = () => {
        setSelectedNodeIds([]);
    };

    /**
     * Handles node type selection from context menu
     * Creates new node or deletes existing node
     */
    const handleSelectTypeFromMenu = (
        type: NodeType | 'DELETE',
        contextMenu: any,
        viewport: Viewport,
        onCloseMenu: () => void
    ) => {
        // Handle Delete Action
        if (type === 'DELETE') {
            if (contextMenu.sourceNodeId) {
                deleteNode(contextMenu.sourceNodeId);
            }
            onCloseMenu();
            return;
        }

        if (contextMenu.type === 'node-connector' && contextMenu.sourceNodeId) {
            const sourceNode = nodes.find(n => n.id === contextMenu.sourceNodeId);
            if (sourceNode) {
                const direction = contextMenu.connectorSide || 'right';
                const newNodeId = crypto.randomUUID();
                const GAP = 100;
                const NODE_WIDTH = 340;

                let newNode: NodeData;

                if (direction === 'right') {
                    // Append: Source -> New
                    newNode = {
                        id: newNodeId,
                        type,
                        x: sourceNode.x + NODE_WIDTH + GAP,
                        y: sourceNode.y,
                        prompt: '',
                        status: NodeStatus.IDLE,
                        model: 'Banana Pro',
                        aspectRatio: 'Auto',
                        resolution: 'Auto',
                        parentIds: contextMenu.sourceNodeId ? [contextMenu.sourceNodeId] : []
                    };
                } else {
                    // Prepend: New -> Source
                    newNode = {
                        id: newNodeId,
                        type,
                        x: sourceNode.x - NODE_WIDTH - GAP,
                        y: sourceNode.y,
                        prompt: '',
                        status: NodeStatus.IDLE,
                        model: 'Banana Pro',
                        aspectRatio: 'Auto',
                        resolution: 'Auto',
                        parentIds: []
                    };
                    // Update source to add new node as parent
                    const existingParentIds = sourceNode.parentIds || [];
                    updateNode(contextMenu.sourceNodeId, { parentIds: [...existingParentIds, newNodeId] });
                }

                if (type === NodeType.PRODUCT_SCENE_REPLACE) {
                    newNode.title = '产品短视频生成';
                    newNode.imageModel = 'google-flow-nano-banana-pro';
                    newNode.aspectRatio = '1:1';
                    newNode.productDimensions = { length: 0, width: 0, height: 0, unit: 'cm' };
                    newNode.preserveProductMarkings = true;
                    newNode.productSceneRecognitionProvider = 'codex-cli';
                    newNode.productSceneImageCount = 1;
                    newNode.productSceneAutoGenerateVideo = false;
                    newNode.productSceneVideoModel = 'gemini-web-video';
                    newNode.productSceneVideoAspectRatio = '16:9';
                    newNode.productSceneVideoDuration = 8;
                    newNode.productSceneVideoGenerateAudio = true;
                }

                setNodes(prev => [...prev, newNode]);
                setSelectedNodeIds([newNodeId]);
            }
        } else {
            // Global menu - add at click position
            addNode(
                type,
                contextMenu.canvasX ?? contextMenu.x,
                contextMenu.canvasY ?? contextMenu.y,
                undefined,
                viewport
            );
        }

        onCloseMenu();
    };

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        nodes,
        setNodes,
        selectedNodeIds,
        setSelectedNodeIds,
        addNode,
        updateNode,
        deleteNode,
        deleteNodes,
        clearSelection,
        handleSelectTypeFromMenu
    };
};
