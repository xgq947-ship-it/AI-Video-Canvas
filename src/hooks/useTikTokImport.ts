/**
 * useTikTokImport.ts
 * 
 * Custom hook for managing TikTok video import state and logic.
 * Handles modal open/close, video node creation after successful import.
 */

import { useState, useCallback } from 'react';
import { NodeData, NodeType, NodeStatus } from '../types';
import { TikTokVideoInfo } from '../components/modals/TikTokImportModal';
import { canvasViewCenter, centerNodeAt, VIDEO_NODE_WIDTH } from '@/shared/canvasCoords.js';
import { getCanvasRect } from '../utils/canvasRect';

// ============================================================================
// TYPES
// ============================================================================

interface UseTikTokImportProps {
    nodes: NodeData[];
    setNodes: React.Dispatch<React.SetStateAction<NodeData[]>>;
    setSelectedNodeIds: React.Dispatch<React.SetStateAction<string[]>>;
    viewport: { x: number; y: number; zoom: number };
}

interface UseTikTokImportReturn {
    isModalOpen: boolean;
    openModal: () => void;
    closeModal: () => void;
    handleVideoImported: (videoUrl: string, videoInfo: TikTokVideoInfo) => void;
}

// ============================================================================
// HOOK
// ============================================================================

export const useTikTokImport = ({
    nodes,
    setNodes,
    setSelectedNodeIds,
    viewport
}: UseTikTokImportProps): UseTikTokImportReturn => {

    // --- State ---
    const [isModalOpen, setIsModalOpen] = useState(false);

    // --- Handlers ---

    const openModal = useCallback(() => {
        setIsModalOpen(true);
    }, []);

    const closeModal = useCallback(() => {
        setIsModalOpen(false);
    }, []);

    /**
     * Handle when a video is successfully imported
     * Creates a new video node on the canvas
     */
    const handleVideoImported = useCallback((videoUrl: string, videoInfo: TikTokVideoInfo) => {
        // 画布可视区中心（避免用 window 中心而漏掉侧边栏宽度）；视频节点宽 385
        const { x: centerX, y: centerY } = centerNodeAt(
            canvasViewCenter(getCanvasRect(), viewport),
            VIDEO_NODE_WIDTH
        );

        // Create prompt from video info
        const prompt = videoInfo.title || 'TikTok Video';

        // Create new video node
        const newNode: NodeData = {
            id: Date.now().toString(),
            type: NodeType.VIDEO,
            x: centerX,
            y: centerY,
            prompt: prompt,
            status: NodeStatus.SUCCESS,
            resultUrl: videoUrl,
            model: 'tiktok-import', // Special model identifier for imported videos
            videoModel: 'tiktok-import',
            aspectRatio: '9:16', // TikTok videos are typically vertical
            resolution: 'Auto',
            videoDuration: videoInfo.duration
        };

        // Add node to canvas
        setNodes(prev => [...prev, newNode]);

        // Select the new node
        setSelectedNodeIds([newNode.id]);

        console.log(`[TikTok Import] Created video node: ${newNode.id}`);
    }, [viewport, setNodes, setSelectedNodeIds]);

    return {
        isModalOpen,
        openModal,
        closeModal,
        handleVideoImported
    };
};
