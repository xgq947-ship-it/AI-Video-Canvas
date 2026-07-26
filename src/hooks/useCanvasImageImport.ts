import React from 'react';
import { NodeData, NodeStatus, NodeType, Viewport } from '../types';
import { canvasViewCenter, centerNodeAt, screenToCanvas } from '@/shared/canvasCoords.js';

interface UseCanvasImageImportOptions {
    workflowId: string | null;
    viewport: Viewport;
    canvasRef: React.RefObject<HTMLDivElement | null>;
    setNodes: React.Dispatch<React.SetStateAction<NodeData[]>>;
    setSelectedNodeIds: React.Dispatch<React.SetStateAction<string[]>>;
    /** 应用内提示；不传时退化为 console，绝不弹原生 alert。 */
    notify?: (message: string, options?: { tone?: 'info' | 'error' }) => void;
}

/** 同时最多传几张。串行会让拖入 20 张图变成一张张排队等。 */
const UPLOAD_CONCURRENCY = 4;

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

/**
 * 量图片尺寸。
 *
 * 刻意走 object URL 而不是 readAsDataURL：后者会把整张图变成 base64 字符串
 * （体积 ×1.33），一张 100MB 的图光这一步就是 133MB 常驻内存，
 * 而这里只是想知道宽高。
 */
const loadImageSize = (file: File) => new Promise<{ width: number; height: number }>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
        const size = { width: image.naturalWidth, height: image.naturalHeight };
        URL.revokeObjectURL(objectUrl);
        resolve(size);
    };
    image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('无法识别图片尺寸'));
    };
    image.src = objectUrl;
});

/** 以 limit 为上限并发跑任务，保持 tasks 的原始顺序无关性。 */
const runWithConcurrency = async (count: number, limit: number, run: (index: number) => Promise<void>) => {
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, count) }, async () => {
        while (next < count) {
            const index = next;
            next += 1;
            await run(index);
        }
    });
    await Promise.all(workers);
};

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
    setSelectedNodeIds,
    notify
}: UseCanvasImageImportOptions) => {
    const notifyRef = React.useRef(notify);
    React.useEffect(() => {
        notifyRef.current = notify;
    });

    const importImageFiles = React.useCallback(async (
        incomingFiles: File[],
        screenPosition?: { x: number; y: number }
    ) => {
        const report = (message: string, tone: 'info' | 'error' = 'info') => {
            const handler = notifyRef.current;
            if (handler) handler(message, { tone });
            else console.warn('[Canvas Image Import]', message);
        };

        const files = incomingFiles.filter(isSupportedImageFile);
        if (files.length === 0) return;
        if (!workflowId) {
            report('请先新建或打开一个项目，再粘贴或拖入图片。', 'error');
            return;
        }

        const oversized = files.find(file => file.size > 100 * 1024 * 1024);
        if (oversized) {
            report(`图片 ${oversized.name || '未命名图片'} 超过 100MB，无法导入。`, 'error');
            return;
        }

        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const anchor = screenPosition
            ? screenToCanvas(screenPosition.x, screenPosition.y, rect, viewport)
            : canvasViewCenter(rect, viewport);
        const base = centerNodeAt(anchor);

        // 先把占位节点摆上画布：用户拖进来立刻就能看到东西在动，
        // 而不是"什么都没有 → 三十秒后一堵报错文字墙"。
        const placeholders: NodeData[] = files.map((file, index) => ({
            id: crypto.randomUUID(),
            type: NodeType.IMAGE,
            x: base.x + (index % 3) * 400,
            y: base.y + Math.floor(index / 3) * 360,
            prompt: file.name || `粘贴图片_${Date.now()}.png`,
            status: NodeStatus.LOADING,
            model: 'Upload',
            aspectRatio: 'Auto',
            resolution: 'Auto'
        }));

        setNodes(current => [...current, ...placeholders]);
        setSelectedNodeIds(placeholders.map(node => node.id));

        let failedCount = 0;

        await runWithConcurrency(files.length, UPLOAD_CONCURRENCY, async (index) => {
            const file = files[index];
            const placeholder = placeholders[index];
            const displayName = placeholder.prompt as string;

            try {
                const size = await loadImageSize(file);
                // 二进制直传：整个链路不产生 base64 副本，文件名走请求头（编码后传，
                // 因为 HTTP 头只能是 ASCII）。
                const response = await fetch(
                    `/api/projects/${encodeURIComponent(workflowId)}/assets/upload-image-binary`,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': file.type || 'application/octet-stream',
                            'X-Evan-Mime': file.type || '',
                            'X-Evan-Filename': encodeURIComponent(displayName),
                            'X-Evan-Prompt': encodeURIComponent(displayName)
                        },
                        body: file
                    }
                );
                const result = await response.json().catch(() => ({}));
                if (!response.ok || !result.url) throw new Error(result.error || '图片上传失败');

                setNodes(current => current.map(node => (
                    node.id === placeholder.id
                        ? {
                            ...node,
                            status: NodeStatus.SUCCESS,
                            resultUrl: result.url,
                            resultAspectRatio: `${size.width}/${size.height}`,
                            aspectRatio: closestAspectRatio(size.width, size.height)
                        }
                        : node
                )));
            } catch (error) {
                console.error('[Canvas Image Import] Failed:', error);
                failedCount += 1;
                // 失败就地标红，用户一眼看得出是哪一张，不用去读一串文件名。
                setNodes(current => current.map(node => (
                    node.id === placeholder.id
                        ? {
                            ...node,
                            status: NodeStatus.ERROR,
                            errorMessage: error instanceof Error ? error.message : '图片导入失败'
                        }
                        : node
                )));
            }
        });

        if (failedCount > 0) {
            report(
                failedCount === files.length
                    ? '图片导入失败，请检查文件后重试。'
                    : `${failedCount} 张图片导入失败，已在画布上标红。`,
                'error'
            );
        }
    }, [workflowId, viewport, canvasRef, setNodes, setSelectedNodeIds]);

    return { importImageFiles };
};
