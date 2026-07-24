/**
 * useAssetHandlers.ts
 * 
 * Handles asset-related operations: selecting from history/library,
 * uploading files, and saving to library.
 * Self-contained with close functions passed as parameters.
 */

import React, { useState, useCallback } from 'react';
import { NodeData, NodeType, NodeStatus, Viewport, ContextMenuState } from '../types';
import { paneToCanvas } from '@/shared/canvasCoords.js';

interface UseAssetHandlersOptions {
    nodes: NodeData[];
    viewport: Viewport;
    contextMenu: ContextMenuState;
    setNodes: React.Dispatch<React.SetStateAction<NodeData[]>>;
    workflowId?: string | null;
}

export const useAssetHandlers = ({
    nodes,
    viewport,
    contextMenu,
    setNodes,
    workflowId,
}: UseAssetHandlersOptions) => {
    // ============================================================================
    // CREATE ASSET MODAL STATE
    // ============================================================================

    const [isCreateAssetModalOpen, setIsCreateAssetModalOpen] = useState(false);
    const [nodeToSnapshot, setNodeToSnapshot] = useState<NodeData | null>(null);

    // ============================================================================
    // HANDLERS
    // ============================================================================

    /**
     * Convert pixel dimensions to closest standard aspect ratio
     * Returns the ratio string (e.g., "16:9", "1:1") for the dropdown
     */
    const getClosestAspectRatio = (width: number, height: number): string => {
        const ratio = width / height;

        // Standard ratios and their numeric values
        const standardRatios = [
            { label: '1:1', value: 1 },
            { label: '16:9', value: 16 / 9 },
            { label: '9:16', value: 9 / 16 },
            { label: '4:3', value: 4 / 3 },
            { label: '3:4', value: 3 / 4 },
            { label: '3:2', value: 3 / 2 },
            { label: '2:3', value: 2 / 3 },
            { label: '5:4', value: 5 / 4 },
            { label: '4:5', value: 4 / 5 },
            { label: '21:9', value: 21 / 9 }
        ];

        // Find closest match
        let closest = standardRatios[0];
        let minDiff = Math.abs(ratio - closest.value);

        for (const r of standardRatios) {
            const diff = Math.abs(ratio - r.value);
            if (diff < minDiff) {
                minDiff = diff;
                closest = r;
            }
        }

        return closest.label;
    };

    /**
     * Open create asset modal for a node
     */
    const handleOpenCreateAsset = useCallback((nodeId: string) => {
        const node = nodes.find(n => n.id === nodeId);
        if (node && (node.type === NodeType.IMAGE || node.type === NodeType.VIDEO)) {
            setNodeToSnapshot(node);
            setIsCreateAssetModalOpen(true);
        } else {
            alert("Please select an Image or Video node to create an asset.");
        }
    }, [nodes]);

    /**
     * Save asset to library. Also tags the source node with the saved asset's
     * name so downstream connections display "@素材名" instead of "参考图N".
     */
    const handleSaveAssetToLibrary = useCallback(async (
        name: string,
        description?: string
    ) => {
        if (!nodeToSnapshot?.resultUrl) return;

        try {
            const response = await fetch('/api/library', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourceUrl: nodeToSnapshot.resultUrl,
                    name,
                    description
                })
            });

            if (!response.ok) throw new Error('Failed to save');
            const { asset } = await response.json();

            const snapshotId = nodeToSnapshot.id;
            setNodes(prev => prev.map(n => n.id === snapshotId
                ? { ...n, assetId: asset.id, assetName: name, assetDescription: description }
                : n));
        } catch (error) {
            console.error("Failed to save asset:", error);
            throw error;
        }
    }, [nodeToSnapshot, setNodes]);

    /**
     * Handle file upload from context menu
     */
    const handleContextUpload = useCallback((file: File) => {
        if (!file) return;
        if (!workflowId) {
            alert('请先新建或打开项目');
            return;
        }

        const isVideo = file.type.startsWith('video/');
        const isImage = file.type.startsWith('image/');

        if (!isVideo && !isImage) return;

        // Check file size (server limit 100MB)
        if (file.size > 100 * 1024 * 1024) {
            alert("File is too large. Maximum size is 100MB.");
            return;
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            const base64Data = e.target?.result as string;

            try {
                const type = isVideo ? 'videos' : 'images';
                const response = await fetch(`/api/assets/${type}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        data: base64Data,
                        prompt: file.name,
                        originalFilename: file.name,
                        mimeType: file.type,
                        workflowId
                    })
                });

                if (!response.ok) {
                    throw new Error('Upload failed');
                }

                const responseData = await response.json();
                const resultUrl = responseData.url;

                // 右键菜单位置 → 画布坐标。
                // 必须用 canvasX/canvasY（面板坐标，已扣除侧边栏）；此前直接用 contextMenu.x
                // （屏幕坐标）会让上传的节点偏出光标一个侧边栏宽度。
                const { x: canvasX, y: canvasY } = paneToCanvas(
                    contextMenu.canvasX ?? contextMenu.x,
                    contextMenu.canvasY ?? contextMenu.y,
                    viewport
                );

                // Detect aspect ratio for images/videos and set both resultAspectRatio and aspectRatio
                const detectAndCreateNode = async () => {
                    let resultAspectRatio: string | undefined;
                    let aspectRatio: string = '16:9'; // Default
                    let detectedDuration: number | undefined;

                    if (isImage) {
                        // Detect image dimensions
                        const img = new Image();
                        await new Promise<void>((resolve) => {
                            img.onload = () => {
                                resultAspectRatio = `${img.naturalWidth}/${img.naturalHeight}`;
                                aspectRatio = getClosestAspectRatio(img.naturalWidth, img.naturalHeight);
                                resolve();
                            };
                            img.onerror = () => resolve();
                            img.src = resultUrl;
                        });
                    } else if (isVideo) {
                        // Detect video dimensions + duration
                        const video = document.createElement('video');
                        await new Promise<void>((resolve) => {
                            video.onloadedmetadata = () => {
                                resultAspectRatio = `${video.videoWidth}/${video.videoHeight}`;
                                aspectRatio = getClosestAspectRatio(video.videoWidth, video.videoHeight);
                                if (isFinite(video.duration) && video.duration > 0) {
                                    detectedDuration = Math.round(video.duration * 100) / 100;
                                }
                                resolve();
                            };
                            video.onerror = () => resolve();
                            video.src = resultUrl;
                        });
                    }

                    const newNode: NodeData = {
                        id: crypto.randomUUID(),
                        type: isVideo ? NodeType.VIDEO : NodeType.IMAGE,
                        x: canvasX,
                        y: canvasY,
                        prompt: file.name,
                        status: NodeStatus.SUCCESS,
                        resultUrl: resultUrl,
                        resultAspectRatio,
                        model: 'Upload',
                        aspectRatio,
                        resolution: 'Auto',
                        // 导入本地视频镜头的真实时长（秒），供漫剧成片按真实长度拼接
                        ...(isVideo && detectedDuration ? { videoDuration: detectedDuration } : {}),
                    };

                    setNodes(prev => [...prev, newNode]);
                };

                await detectAndCreateNode();

            } catch (error) {
                console.error("Upload failed:", error);
                alert("Failed to upload file to server.");
            }
        };
        reader.readAsDataURL(file);
    }, [contextMenu.x, contextMenu.y, viewport.x, viewport.y, viewport.zoom, setNodes, workflowId]);

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        // Create asset modal
        isCreateAssetModalOpen,
        setIsCreateAssetModalOpen,
        nodeToSnapshot,

        // Handlers
        handleOpenCreateAsset,
        handleSaveAssetToLibrary,
        handleContextUpload
    };
};
