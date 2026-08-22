import React from 'react';
import { NodeData, NodeStatus, NodeType, Viewport } from '../types';
import { canvasViewCenter, centerNodeAt, screenToCanvas } from '@/shared/canvasCoords.js';
import {
    buildDetailRemixInputMapping,
    createDetailRemixNodeData,
    syncDetailRemixInputRefs,
} from '../../shared/detailRemix.js';
import { uploadProjectImage } from '../services/assetService';
import {
    buildDetailRemixFolderPlacements,
    detailRemixFolderFilePath,
    detailRemixFolderName,
    reflowDetailRemixFolderNodes,
    sortDetailRemixFolderFiles,
    type DetailRemixFolderRole,
} from '../utils/detailRemixFolderImport.js';

interface UseCanvasImageImportOptions {
    workflowId: string | null;
    viewport: Viewport;
    canvasRef: React.RefObject<HTMLDivElement | null>;
    setNodes: React.Dispatch<React.SetStateAction<NodeData[]>>;
    setSelectedNodeIds: React.Dispatch<React.SetStateAction<string[]>>;
    /** 应用内提示；不传时退化为 console，绝不弹原生 alert。 */
    notify?: (message: string, options?: { tone?: 'info' | 'error' }) => void;
    beginHistoryTransaction?: (label: string) => string | null;
    commitHistoryTransaction?: (
        transactionId: string,
        nodes: NodeData[],
        selectedNodeIds?: string[],
    ) => void;
    rollbackHistoryTransaction?: (transactionId: string) => void;
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

const uploadProjectImageFile = (
    workflowId: string,
    file: File,
    displayName: string,
    signal?: AbortSignal,
) => uploadProjectImage(workflowId, file, displayName, signal);

const roleKey = (role: DetailRemixFolderRole): 'competitorDetailNodeIds' | 'ownDetailNodeIds' => (
    role === 'competitor' ? 'competitorDetailNodeIds' : 'ownDetailNodeIds'
);

const patchDetailRemixFolderRole = (
    controller: NodeData,
    role: DetailRemixFolderRole,
    nodeIds: string[],
    folderImport: Record<string, unknown>,
) => {
    const current = createDetailRemixNodeData(controller.detailRemix || {});
    const inputRefs = {
        ...current.inputRefs,
        [roleKey(role)]: nodeIds,
    };
    const nextState = createDetailRemixNodeData({
        ...current,
        inputRefs,
        folderImports: {
            ...current.folderImports,
            [role]: folderImport,
        },
        status: current.jobId ? 'outdated' : current.status,
        needsRegeneration: Boolean(current.jobId),
    });
    const mapping = buildDetailRemixInputMapping(inputRefs);
    return syncDetailRemixInputRefs({
        ...controller,
        parentIds: Object.keys(mapping),
        inputPortByParentId: mapping,
        detailRemix: nextState,
    }, mapping) as NodeData;
};

export const useCanvasImageImport = ({
    workflowId,
    viewport,
    canvasRef,
    setNodes,
    setSelectedNodeIds,
    notify,
    beginHistoryTransaction,
    commitHistoryTransaction,
    rollbackHistoryTransaction,
}: UseCanvasImageImportOptions) => {
    const notifyRef = React.useRef(notify);
    React.useEffect(() => {
        notifyRef.current = notify;
    });
    const activeImportRef = React.useRef<{
        id: string;
        controller: AbortController;
        cancelled: boolean;
        label: string;
    } | null>(null);

    const beginImport = React.useCallback((label: string) => {
        if (activeImportRef.current) return null;
        const id = beginHistoryTransaction?.(label) || crypto.randomUUID();
        const session = { id, controller: new AbortController(), cancelled: false, label };
        activeImportRef.current = session;
        return session;
    }, [beginHistoryTransaction]);

    const finishImport = React.useCallback((
        session: NonNullable<typeof activeImportRef.current>,
        finalNodes: NodeData[],
        finalSelectedNodeIds: string[],
    ) => {
        if (activeImportRef.current !== session || session.cancelled) return;
        activeImportRef.current = null;
        commitHistoryTransaction?.(session.id, finalNodes, finalSelectedNodeIds);
    }, [commitHistoryTransaction]);

    const cancelActiveImport = React.useCallback(() => {
        const session = activeImportRef.current;
        if (!session) return false;
        session.cancelled = true;
        session.controller.abort();
        activeImportRef.current = null;
        rollbackHistoryTransaction?.(session.id);
        const handler = notifyRef.current;
        if (handler) handler(`已撤销${session.label}，画布已恢复到导入前`, { tone: 'info' });
        return true;
    }, [rollbackHistoryTransaction]);

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
        const session = beginImport(`导入 ${files.length} 张图片`);
        if (!session) {
            report('另一批图片仍在导入，请完成或撤销后再试。', 'error');
            return;
        }
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

        let latestNodes: NodeData[] = [];
        setNodes(current => {
            latestNodes = [...current, ...placeholders];
            return latestNodes;
        });
        setSelectedNodeIds(placeholders.map(node => node.id));

        let failedCount = 0;

        await runWithConcurrency(files.length, UPLOAD_CONCURRENCY, async (index) => {
            const file = files[index];
            const placeholder = placeholders[index];
            const displayName = placeholder.prompt as string;

            try {
                const uploaded = await uploadProjectImageFile(
                    workflowId,
                    file,
                    displayName,
                    session.controller.signal,
                );
                if (session.cancelled) return;

                setNodes(current => {
                    latestNodes = current.map(node => (
                    node.id === placeholder.id
                        ? {
                            ...node,
                            status: NodeStatus.SUCCESS,
                            resultUrl: uploaded.url,
                            resultAspectRatio: uploaded.resultAspectRatio,
                            aspectRatio: uploaded.aspectRatio,
                        }
                        : node
                    ));
                    return latestNodes;
                });
            } catch (error) {
                if (session.cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
                console.error('[Canvas Image Import] Failed:', error);
                failedCount += 1;
                // 失败就地标红，用户一眼看得出是哪一张，不用去读一串文件名。
                setNodes(current => {
                    latestNodes = current.map(node => (
                    node.id === placeholder.id
                        ? {
                            ...node,
                            status: NodeStatus.ERROR,
                            errorMessage: error instanceof Error ? error.message : '图片导入失败'
                        }
                        : node
                    ));
                    return latestNodes;
                });
            }
        });

        if (session.cancelled) return;

        if (failedCount > 0) {
            report(
                failedCount === files.length
                    ? '图片导入失败，请检查文件后重试。'
                    : `${failedCount} 张图片导入失败，已在画布上标红。`,
                'error'
            );
        }
        const committedNodes = await new Promise<NodeData[]>(resolve => {
            setNodes(current => {
                resolve(current);
                return current;
            });
        });
        finishImport(session, committedNodes, placeholders.map(node => node.id));
    }, [workflowId, viewport, canvasRef, setNodes, setSelectedNodeIds, beginImport, finishImport]);

    const importDetailRemixFolder = React.useCallback(async (
        controller: Pick<NodeData, 'id' | 'x' | 'y'>,
        role: DetailRemixFolderRole,
        incomingFiles: File[],
    ) => {
        const report = (message: string, tone: 'info' | 'error' = 'info') => {
            const handler = notifyRef.current;
            if (handler) handler(message, { tone });
            else console.warn('[Detail Remix Folder Import]', message);
        };
        if (!workflowId) {
            report('请先新建或打开项目，再导入详情文件夹。', 'error');
            return { importedNodeIds: [], failedNodeIds: [] };
        }

        const files = sortDetailRemixFolderFiles(incomingFiles.filter(isSupportedImageFile));
        if (files.length === 0) {
            report('所选文件夹里没有可用的 PNG、JPEG、WebP、GIF 或 AVIF 图片。', 'error');
            return { importedNodeIds: [], failedNodeIds: [] };
        }
        const oversized = files.find(file => file.size > 100 * 1024 * 1024);
        if (oversized) {
            report(`图片 ${oversized.name || '未命名图片'} 超过 100MB，无法导入。`, 'error');
            return { importedNodeIds: [], failedNodeIds: [] };
        }

        const fallbackName = role === 'competitor' ? '竞品详情文件夹' : '我的详情文件夹';
        const folderName = detailRemixFolderName(files, fallbackName);
        const placements = buildDetailRemixFolderPlacements(controller, role, files.length);
        const session = beginImport(`导入“${folderName}”`);
        if (!session) {
            report('另一批图片仍在导入，请完成或撤销后再试。', 'error');
            return { importedNodeIds: [], failedNodeIds: [] };
        }
        const startedAt = new Date().toISOString();
        const placeholders: NodeData[] = files.map((file, index) => ({
            id: crypto.randomUUID(),
            type: NodeType.IMAGE,
            title: `${role === 'competitor' ? '竞品详情' : '我的详情'} ${String(index + 1).padStart(2, '0')}`,
            x: placements[index].x,
            y: placements[index].y,
            prompt: file.name || `${fallbackName}_${index + 1}`,
            status: NodeStatus.LOADING,
            model: 'Upload',
            aspectRatio: 'Auto',
            resolution: 'Auto',
            detailRemixImport: {
                controllerNodeId: controller.id,
                role,
                folderName,
                relativePath: detailRemixFolderFilePath(file),
                order: index,
            },
        }));
        const placeholderIds = placeholders.map(node => node.id);
        let latestNodes: NodeData[] = [];
        setNodes(current => {
            const currentController = current.find(node => node.id === controller.id);
            if (!currentController) {
                latestNodes = current;
                return current;
            }
            const currentRefs = createDetailRemixNodeData(currentController.detailRemix || {}).inputRefs;
            const previousRoleIds = new Set(currentRefs[roleKey(role)]);
            const replaceableFolderNodeIds = new Set(current
                .filter(node => (
                    previousRoleIds.has(node.id)
                    && node.detailRemixImport?.controllerNodeId === controller.id
                    && node.detailRemixImport?.role === role
                ))
                .map(node => node.id));
            const withoutReplacedFolder = current.filter(node => !replaceableFolderNodeIds.has(node.id));
            const next = [
                ...withoutReplacedFolder.map(node => node.id === controller.id
                    ? patchDetailRemixFolderRole(node, role, placeholderIds, {
                        folderName,
                        status: 'uploading',
                        total: files.length,
                        uploaded: 0,
                        failed: 0,
                        nodeIds: placeholderIds,
                        startedAt,
                    })
                    : node),
                ...placeholders,
            ];
            latestNodes = reflowDetailRemixFolderNodes(next, controller.id);
            return latestNodes;
        });
        setSelectedNodeIds([controller.id]);

        const successfulIds = new Set<string>();
        const failedIds = new Set<string>();
        await runWithConcurrency(files.length, UPLOAD_CONCURRENCY, async index => {
            const file = files[index];
            const placeholder = placeholders[index];
            let nodePatch: Partial<NodeData>;
            try {
                const uploaded = await uploadProjectImageFile(
                    workflowId,
                    file,
                    file.name || placeholder.prompt,
                    session.controller.signal,
                );
                if (session.cancelled) return;
                successfulIds.add(placeholder.id);
                nodePatch = {
                    status: NodeStatus.SUCCESS,
                    resultUrl: uploaded.url,
                    resultAspectRatio: uploaded.resultAspectRatio,
                    aspectRatio: uploaded.aspectRatio,
                    errorMessage: undefined,
                };
            } catch (error) {
                if (session.cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
                console.error('[Detail Remix Folder Import] Failed:', error);
                failedIds.add(placeholder.id);
                nodePatch = {
                    status: NodeStatus.ERROR,
                    errorMessage: error instanceof Error ? error.message : '图片导入失败',
                };
            }
            setNodes(current => {
                latestNodes = reflowDetailRemixFolderNodes(current.map(node => {
                    if (node.id === placeholder.id) return { ...node, ...nodePatch };
                    if (node.id !== controller.id) return node;
                    const currentNodeIds = placeholders
                        .filter(item => !failedIds.has(item.id))
                        .map(item => item.id);
                    return patchDetailRemixFolderRole(node, role, currentNodeIds, {
                        folderName,
                        status: 'uploading',
                        total: files.length,
                        uploaded: successfulIds.size,
                        failed: failedIds.size,
                        nodeIds: currentNodeIds,
                        startedAt,
                    });
                }), controller.id);
                return latestNodes;
            });
        });

        if (session.cancelled) return { importedNodeIds: [], failedNodeIds: [] };

        const importedNodeIds = placeholders.filter(node => successfulIds.has(node.id)).map(node => node.id);
        const failedNodeIds = placeholders.filter(node => failedIds.has(node.id)).map(node => node.id);
        const completedAt = new Date().toISOString();
        const committedNodes = await new Promise<NodeData[]>(resolve => {
            setNodes(current => {
                latestNodes = reflowDetailRemixFolderNodes(current.map(node => node.id === controller.id
                    ? patchDetailRemixFolderRole(node, role, importedNodeIds, {
                    folderName,
                    status: importedNodeIds.length === 0
                        ? 'failed'
                        : failedNodeIds.length > 0 ? 'partial_failed' : 'completed',
                    total: files.length,
                    uploaded: importedNodeIds.length,
                    failed: failedNodeIds.length,
                    nodeIds: importedNodeIds,
                    startedAt,
                    completedAt,
                    })
                    : node), controller.id);
                resolve(latestNodes);
                return latestNodes;
            });
        });
        report(
            failedNodeIds.length > 0
                ? `${folderName} 已导入 ${importedNodeIds.length}/${files.length} 张，失败图片已在画布标红。`
                : `${folderName} 已按文件名顺序导入 ${importedNodeIds.length} 张。`,
            failedNodeIds.length > 0 ? 'error' : 'info',
        );
        finishImport(session, committedNodes, [controller.id]);
        return { importedNodeIds, failedNodeIds, folderName };
    }, [workflowId, setNodes, setSelectedNodeIds, beginImport, finishImport]);

    return { importImageFiles, importDetailRemixFolder, cancelActiveImport };
};
