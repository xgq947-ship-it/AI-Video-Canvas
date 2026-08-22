/**
 * useImageNodeHandlers.ts
 * 
 * Handles Image node menu actions (Image to Image, Image to Video, Change Angle).
 * Creates connected nodes when users select these options from the placeholder.
 */

import React from 'react';
import { NodeData, NodeType, NodeStatus } from '../types';
import { generateCameraAngle } from '../services/cameraAngleService';
import { uploadProjectImage } from '../services/assetService';

// ============================================================================
// TYPES
// ============================================================================

interface UseImageNodeHandlersOptions {
    nodes: NodeData[];
    setNodes: React.Dispatch<React.SetStateAction<NodeData[]>>;
    setSelectedNodeIds: React.Dispatch<React.SetStateAction<string[]>>;
    workflowId?: string | null;
}

/**
 * 把 Modal 返回的 data URL 落盘成项目里的图片文件，返回 /library/... 地址。
 *
 * 其它所有生成路径都是"写盘 + 返回文件 URL"，只有镜头角度是把 base64 直接塞进
 * 节点的 resultUrl。服务端在保存工作流时会兜底 sanitize，所以不会永久污染
 * project.json，但在那之前这份 base64 一直挂在内存里，而且每次保存都要把它
 * 整个塞进 JSON 请求体。
 *
 * 落盘失败时返回 null，调用方退回 data URL —— 生成配额已经花掉了，绝不能因为
 * 存不下就把结果丢掉。
 */
const persistDataUrlToProject = async (
    workflowId: string,
    dataUrl: string,
    displayName: string
): Promise<string | null> => {
    try {
        const blob = await (await fetch(dataUrl)).blob();
        return (await uploadProjectImage(workflowId, blob, displayName)).url;
    } catch (error) {
        console.warn('[ChangeAngle] 结果落盘失败，暂时使用内存中的 data URL:', error);
        return null;
    }
};

// ============================================================================
// HOOK
// ============================================================================

export const useImageNodeHandlers = ({
    nodes,
    setNodes,
    setSelectedNodeIds,
    workflowId
}: UseImageNodeHandlersOptions) => {
    /**
     * Handle "Image to Image" - creates a new Image node connected to this Image node
     * The current node becomes the input (parent) for the new Image node
     */
    const handleImageToImage = (nodeId: string) => {
        const imageNode = nodes.find(n => n.id === nodeId);
        if (!imageNode) return;

        // Create Image node to the right
        const newNodeId = crypto.randomUUID();
        const GAP = 100;
        const NODE_WIDTH = 340;

        const newImageNode: NodeData = {
            id: newNodeId,
            type: NodeType.IMAGE,
            x: imageNode.x + NODE_WIDTH + GAP,
            y: imageNode.y,
            prompt: '',
            status: NodeStatus.IDLE,
            model: 'Banana Pro',
            aspectRatio: 'Auto',
            resolution: 'Auto',
            parentIds: [nodeId] // Connect to the source image node
        };

        // Add new image node
        setNodes(prev => [...prev, newImageNode]);
        setSelectedNodeIds([newNodeId]);
    };

    /**
     * Handle "Image to Video" - creates a new Video node connected to this Image node
     * The current node becomes the input frame for the new Video node
     */
    const handleImageToVideo = (nodeId: string) => {
        const imageNode = nodes.find(n => n.id === nodeId);
        if (!imageNode) return;

        // Create Video node to the right
        const newNodeId = crypto.randomUUID();
        const GAP = 100;
        const NODE_WIDTH = 340;

        const newVideoNode: NodeData = {
            id: newNodeId,
            type: NodeType.VIDEO,
            x: imageNode.x + NODE_WIDTH + GAP,
            y: imageNode.y,
            prompt: '',
            status: NodeStatus.IDLE,
            model: 'Banana Pro',
            aspectRatio: 'Auto',
            resolution: 'Auto',
            parentIds: [nodeId] // Connect to the source image node
        };

        // Add new video node
        setNodes(prev => [...prev, newVideoNode]);
        setSelectedNodeIds([newNodeId]);
    };

    /**
     * Handle "Change Angle Generate" - calls Modal Camera Angle API
     * Creates a new Image node with the transformed result
     */
    const handleChangeAngleGenerate = React.useCallback(async (nodeId: string) => {
        const imageNode = nodes.find(n => n.id === nodeId);
        if (!imageNode || !imageNode.angleSettings || !imageNode.resultUrl) {
            console.error('[ChangeAngle] Missing required data:', {
                hasNode: !!imageNode,
                hasSettings: !!imageNode?.angleSettings,
                hasResultUrl: !!imageNode?.resultUrl
            });
            return;
        }

        // Create Image node to the right
        const newNodeId = crypto.randomUUID();
        const GAP = 100;
        const NODE_WIDTH = 340;

        // Create placeholder node in LOADING state
        const newImageNode: NodeData = {
            id: newNodeId,
            type: NodeType.CAMERA_ANGLE,
            x: imageNode.x + NODE_WIDTH + GAP,
            y: imageNode.y,
            // Prompt is stored for reference but not displayed in the specialized node
            prompt: `Camera angle: rotation=${imageNode.angleSettings.rotation}°, tilt=${imageNode.angleSettings.tilt}°`,
            status: NodeStatus.LOADING,
            model: 'Qwen Camera Angle',
            imageModel: 'qwen-camera-angle',
            aspectRatio: imageNode.aspectRatio || 'Auto',
            resolution: imageNode.resolution || 'Auto',
            parentIds: [nodeId], // Connect to source

            // Persist angle settings to the new node so controls can be re-opened with same state
            angleSettings: imageNode.angleSettings,
            angleMode: false
        };

        // Add new node and close angle mode on source
        setNodes(prev => [
            ...prev.map(n => n.id === nodeId ? { ...n, angleMode: false } : n),
            newImageNode
        ]);
        setSelectedNodeIds([newNodeId]);

        // Call Modal API
        try {
            console.log('[ChangeAngle] Calling Modal API with settings:', imageNode.angleSettings);

            const result = await generateCameraAngle(
                imageNode.resultUrl,
                imageNode.angleSettings.rotation,
                imageNode.angleSettings.tilt,
                imageNode.angleSettings.scale
            );

            console.log('[ChangeAngle] API success:', {
                seed: result.seed,
                inferenceTimeMs: result.inferenceTimeMs
            });

            // 和其它生成路径一样落盘，节点里存文件 URL 而不是 base64。
            const persistedUrl = workflowId
                ? await persistDataUrlToProject(
                    workflowId,
                    result.imageUrl,
                    `camera_angle_${Date.now()}.png`
                )
                : null;

            // Update node with result
            setNodes(prev => prev.map(n =>
                n.id === newNodeId
                    ? {
                        ...n,
                        status: NodeStatus.SUCCESS,
                        resultUrl: persistedUrl || result.imageUrl,
                        seed: result.seed
                    }
                    : n
            ));
        } catch (error: any) {
            console.error('[ChangeAngle] API error:', error);

            // Update node with error
            setNodes(prev => prev.map(n =>
                n.id === newNodeId
                    ? {
                        ...n,
                        status: NodeStatus.ERROR,
                        errorMessage: error.message || 'Camera angle generation failed'
                    }
                    : n
            ));
        }
    }, [nodes, setNodes, setSelectedNodeIds]);

    return {
        handleImageToImage,
        handleImageToVideo,
        handleChangeAngleGenerate
    };
};
