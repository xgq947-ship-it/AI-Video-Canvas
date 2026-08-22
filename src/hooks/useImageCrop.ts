/**
 * useImageCrop.ts
 *
 * 画布图片节点「裁剪」的状态与落盘。
 *
 * 裁剪是就地替换：裁完直接改写本节点的 resultUrl，而不是新建一个节点——
 * 用户想要的就是「把这张 Logo 裁一下」。原图文件仍然留在项目素材里，
 * 节点层面的这一步由画布的撤销栈兜底。
 */

import { useCallback, useState } from 'react';
import { NodeData } from '../types';
import { uploadProjectImage } from '../services/assetService';

interface CropModalState {
    isOpen: boolean;
    nodeId: string | null;
    imageUrl?: string;
}

interface UseImageCropOptions {
    nodes: NodeData[];
    updateNode: (id: string, updates: Partial<NodeData>) => void;
    workflowId: string | null;
    notify: (message: string, options?: { tone?: 'info' | 'error' }) => void;
}

export const useImageCrop = ({ nodes, updateNode, workflowId, notify }: UseImageCropOptions) => {
    const [cropModal, setCropModal] = useState<CropModalState>({ isOpen: false, nodeId: null });
    const [isSavingCrop, setIsSavingCrop] = useState(false);

    const handleOpenImageCrop = useCallback((nodeId: string) => {
        const node = nodes.find(item => item.id === nodeId);
        if (!node?.resultUrl) return;
        // 没有项目就没有落盘位置。与其裁完发现存不下，不如现在就说清楚。
        if (!workflowId) {
            notify('请先保存或打开一个项目，再裁剪图片', { tone: 'error' });
            return;
        }
        setCropModal({ isOpen: true, nodeId, imageUrl: node.resultUrl });
    }, [nodes, workflowId, notify]);

    const handleCloseImageCrop = useCallback(() => {
        setCropModal({ isOpen: false, nodeId: null });
        setIsSavingCrop(false);
    }, []);

    /**
     * 落盘裁剪结果并就地替换节点图片。
     *
     * 失败时保留原图：裁剪没有花掉任何生成额度，重来一次的代价是零，
     * 而把 data URL 塞进节点会在下次保存工作流时被服务端清掉，等于把图弄丢。
     */
    const handleApplyImageCrop = useCallback(async (croppedDataUrl: string) => {
        const nodeId = cropModal.nodeId;
        if (!nodeId || !workflowId) return;
        setIsSavingCrop(true);
        try {
            const blob = await (await fetch(croppedDataUrl)).blob();
            const uploaded = await uploadProjectImage(workflowId, blob, `裁剪-${nodeId}.png`);
            updateNode(nodeId, {
                resultUrl: uploaded.url,
                resultAspectRatio: uploaded.resultAspectRatio,
                aspectRatio: uploaded.aspectRatio,
            });
            notify('已裁剪，可用 ⌘Z 撤销');
        } catch (error) {
            console.error('[Crop] 裁剪结果落盘失败:', error);
            notify(error instanceof Error ? error.message : '裁剪结果保存失败，已保留原图', { tone: 'error' });
        } finally {
            setCropModal({ isOpen: false, nodeId: null });
            setIsSavingCrop(false);
        }
    }, [cropModal.nodeId, workflowId, updateNode, notify]);

    return {
        cropModal,
        isSavingCrop,
        handleOpenImageCrop,
        handleCloseImageCrop,
        handleApplyImageCrop,
    };
};
