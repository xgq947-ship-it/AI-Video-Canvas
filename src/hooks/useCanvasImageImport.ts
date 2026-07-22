import React from 'react';
import { NodeData, NodeStatus, NodeType, Viewport } from '../types';
import { canvasViewCenter, centerNodeAt, screenToCanvas } from '@/shared/canvasCoords.js';

interface UseCanvasImageImportOptions {
    workflowId: string | null;
    viewport: Viewport;
    canvasRef: React.RefObject<HTMLDivElement | null>;
    setNodes: React.Dispatch<React.SetStateAction<NodeData[]>>;
    setSelectedNodeIds: React.Dispatch<React.SetStateAction<string[]>>;
}

const IMAGE_FILE_RE = /\.(png|jpe?g|webp|gif|avif)$/i;
const SUPPORTED_IMAGE_MIMES = new Set([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/avif'
]);

export const isSupportedImageFile = (file: Pick<File, 'name' | 'type'>) =>
    SUPPORTED_IMAGE_MIMES.has(file.type.toLowerCase()) || IMAGE_FILE_RE.test(file.name || '');

const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
    reader.readAsDataURL(file);
});

const loadImageSize = (dataUrl: string) => new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('无法识别图片尺寸'));
    image.src = dataUrl;
});

const closestAspectRatio = (width: number, height: number) => {
    const ratios = [
        ['1:1', 1], ['16:9', 16 / 9], ['9:16', 9 / 16], ['4:3', 4 / 3],
        ['3:4', 3 / 4], ['3:2', 3 / 2], ['2:3', 2 / 3], ['5:4', 5 / 4],
        ['4:5', 4 / 5], ['21:9', 21 / 9]
    ] as const;
    const ratio = width / height;
    return ratios.reduce((best, current) =>
        Math.abs(current[1] - ratio) < Math.abs(best[1] - ratio) ? current : best
    )[0];
};

export const useCanvasImageImport = ({
    workflowId,
    viewport,
    canvasRef,
    setNodes,
    setSelectedNodeIds
}: UseCanvasImageImportOptions) => {
    const importImageFiles = React.useCallback(async (
        incomingFiles: File[],
        screenPosition?: { x: number; y: number }
    ) => {
        const files = incomingFiles.filter(isSupportedImageFile);
        if (files.length === 0) return;
        if (!workflowId) {
            window.alert('请先新建或打开一个项目，再粘贴或拖入图片。');
            return;
        }

        const oversized = files.find(file => file.size > 100 * 1024 * 1024);
        if (oversized) {
            window.alert(`图片 ${oversized.name || '未命名图片'} 超过 100MB，无法导入。`);
            return;
        }

        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const anchor = screenPosition
            ? screenToCanvas(screenPosition.x, screenPosition.y, rect, viewport)
            : canvasViewCenter(rect, viewport);
        const base = centerNodeAt(anchor);
        const created: NodeData[] = [];
        const failed: string[] = [];

        for (const [index, file] of files.entries()) {
            try {
                const dataUrl = await readAsDataUrl(file);
                const size = await loadImageSize(dataUrl);
                const displayName = file.name || `粘贴图片_${Date.now()}.png`;
                const response = await fetch(`/api/projects/${encodeURIComponent(workflowId)}/assets/upload-image`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        data: dataUrl,
                        prompt: displayName,
                        originalFilename: displayName,
                        mimeType: file.type
                    })
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok || !result.url) throw new Error(result.error || '图片上传失败');

                created.push({
                    id: crypto.randomUUID(),
                    type: NodeType.IMAGE,
                    x: base.x + (index % 3) * 400,
                    y: base.y + Math.floor(index / 3) * 360,
                    prompt: displayName,
                    status: NodeStatus.SUCCESS,
                    resultUrl: result.url,
                    resultAspectRatio: `${size.width}/${size.height}`,
                    model: 'Upload',
                    aspectRatio: closestAspectRatio(size.width, size.height),
                    resolution: 'Auto'
                });
            } catch (error) {
                console.error('[Canvas Image Import] Failed:', error);
                failed.push(file.name || '未命名图片');
            }
        }

        if (created.length > 0) {
            setNodes(current => [...current, ...created]);
            setSelectedNodeIds(created.map(node => node.id));
        }
        if (failed.length > 0) window.alert(`以下图片导入失败：${failed.join('、')}`);
    }, [workflowId, viewport, canvasRef, setNodes, setSelectedNodeIds]);

    return { importImageFiles };
};
