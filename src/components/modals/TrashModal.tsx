import React, { useCallback, useEffect, useState } from 'react';
import { Image as ImageIcon, Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import { NodeData } from '../../types';
import { readApiResponse } from '../../utils/apiResponse';

interface TrashEntry {
    id: string;
    deletedAt: string;
    expiresAt: string;
    nodeCount: number;
    title: string;
    previewUrl?: string;
}

interface TrashModalProps {
    isOpen: boolean;
    workflowId?: string | null;
    canvasTheme: 'dark' | 'light';
    onClose: () => void;
    onRestoreNodes: (nodes: NodeData[]) => void;
}

const remainingLabel = (expiresAt: string) => {
    const remainingMs = Math.max(0, new Date(expiresAt).getTime() - Date.now());
    const days = Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
    return `${days} 天后自动删除`;
};

export const TrashModal: React.FC<TrashModalProps> = ({
    isOpen,
    workflowId,
    canvasTheme,
    onClose,
    onRestoreNodes
}) => {
    const [entries, setEntries] = useState<TrashEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const isDark = canvasTheme === 'dark';

    const loadEntries = useCallback(async () => {
        if (!workflowId) {
            setEntries([]);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(`/api/projects/${encodeURIComponent(workflowId)}/trash`, {
                cache: 'no-store'
            });
            const result = await readApiResponse<TrashEntry[]>(response, '读取回收站失败');
            setEntries(Array.isArray(result) ? result : []);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : '读取回收站失败');
        } finally {
            setLoading(false);
        }
    }, [workflowId]);

    useEffect(() => {
        if (isOpen) void loadEntries();
    }, [isOpen, loadEntries]);

    const restore = async (entry: TrashEntry) => {
        if (!workflowId || busyId) return;
        setBusyId(entry.id);
        setError(null);
        try {
            const response = await fetch(
                `/api/projects/${encodeURIComponent(workflowId)}/trash/${encodeURIComponent(entry.id)}/restore`,
                { method: 'POST' }
            );
            const result = await readApiResponse<{ restoredNodes?: NodeData[] }>(response, '恢复失败');
            const restoredNodes = Array.isArray(result?.restoredNodes) ? result.restoredNodes : [];
            onRestoreNodes(restoredNodes);
            setEntries(current => current.filter(candidate => candidate.id !== entry.id));
        } catch (restoreError) {
            setError(restoreError instanceof Error ? restoreError.message : '恢复失败');
        } finally {
            setBusyId(null);
        }
    };

    const removePermanently = async (entry: TrashEntry) => {
        if (!workflowId || busyId) return;
        if (!window.confirm('确定从本地永久删除这项内容吗？此操作无法撤销。')) return;
        setBusyId(entry.id);
        setError(null);
        try {
            const response = await fetch(
                `/api/projects/${encodeURIComponent(workflowId)}/trash/${encodeURIComponent(entry.id)}`,
                { method: 'DELETE' }
            );
            await readApiResponse(response, '永久删除失败');
            setEntries(current => current.filter(candidate => candidate.id !== entry.id));
        } catch (deleteError) {
            setError(deleteError instanceof Error ? deleteError.message : '永久删除失败');
        } finally {
            setBusyId(null);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm">
            <div className={`flex max-h-[78vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border shadow-2xl ${
                isDark ? 'border-neutral-700 bg-[#171717] text-white' : 'border-neutral-200 bg-white text-neutral-900'
            }`}>
                <div className={`flex items-center justify-between border-b px-6 py-5 ${isDark ? 'border-neutral-800' : 'border-neutral-200'}`}>
                    <div>
                        <div className="flex items-center gap-2 text-lg font-semibold">
                            <Trash2 size={19} />
                            回收站
                        </div>
                        <p className="mt-1 text-xs text-neutral-500">删除内容保留 7 天，到期后自动从本地清理。</p>
                    </div>
                    <button
                        onClick={onClose}
                        className={`rounded-xl p-2 transition-colors ${isDark ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100'}`}
                        aria-label="关闭回收站"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="min-h-[280px] overflow-y-auto p-5">
                    {error && (
                        <div className="mb-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
                    )}
                    {loading ? (
                        <div className="flex min-h-[240px] items-center justify-center text-neutral-500">
                            <Loader2 size={24} className="animate-spin" />
                        </div>
                    ) : entries.length === 0 ? (
                        <div className="flex min-h-[240px] flex-col items-center justify-center text-center text-neutral-500">
                            <Trash2 size={34} className="mb-3 opacity-50" />
                            <p className="text-sm font-medium">回收站为空</p>
                            <p className="mt-1 text-xs">画布中删除的本地图片会显示在这里。</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {entries.map(entry => (
                                <div
                                    key={entry.id}
                                    className={`overflow-hidden rounded-2xl border ${isDark ? 'border-neutral-700 bg-neutral-900' : 'border-neutral-200 bg-neutral-50'}`}
                                >
                                    <div className={`flex h-36 items-center justify-center overflow-hidden ${isDark ? 'bg-black' : 'bg-neutral-200'}`}>
                                        {entry.previewUrl ? (
                                            <img src={entry.previewUrl} alt={entry.title} className="h-full w-full object-cover" />
                                        ) : (
                                            <ImageIcon size={32} className="text-neutral-500" />
                                        )}
                                    </div>
                                    <div className="p-4">
                                        <div className="truncate text-sm font-medium">{entry.title}</div>
                                        <div className="mt-1 text-xs text-neutral-500">
                                            {entry.nodeCount > 1 ? `${entry.nodeCount} 个节点 · ` : ''}
                                            {remainingLabel(entry.expiresAt)}
                                        </div>
                                        <div className="mt-4 flex gap-2">
                                            <button
                                                onClick={() => void restore(entry)}
                                                disabled={Boolean(busyId)}
                                                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
                                            >
                                                {busyId === entry.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                                                恢复
                                            </button>
                                            <button
                                                onClick={() => void removePermanently(entry)}
                                                disabled={Boolean(busyId)}
                                                className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
                                                    isDark
                                                        ? 'border-red-900/70 text-red-400 hover:bg-red-500/10'
                                                        : 'border-red-200 text-red-600 hover:bg-red-50'
                                                }`}
                                            >
                                                <Trash2 size={14} />
                                                永久删除
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
