/**
 * WorkflowPanel.tsx
 * 
 * Panel for browsing and managing saved workflows.
 * Shows list of workflows with options to load, delete, or edit cover.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Trash2, Loader2, Maximize2, Pencil, Check, FolderOpen } from 'lucide-react';
import { LazyImage } from './LazyImage';
import { NodeData, NodeStatus, NodeType } from '../types';
import { getNodeHeight, getNodeWidth } from './canvas/ConnectionsLayer';
import { calculateConnectionPath } from '../utils/connectionHelpers';

type WorkflowPreviewNode = Pick<
    NodeData,
    'id' | 'type' | 'x' | 'y' | 'status' | 'resultUrl' | 'resultAspectRatio' | 'aspectRatio' | 'parentIds'
>;

interface WorkflowSummary {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodeCount: number;
    coverUrl?: string;
    description?: string;
    previewNodes?: WorkflowPreviewNode[];
}

interface AssetMetadata {
    id: string;
    url: string;
    prompt?: string;
    createdAt: string;
}

interface WorkflowPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onLoadWorkflow: (workflowId: string) => void;
    onRenameWorkflow?: (workflowId: string, title: string, nodes: NodeData[]) => void;
    currentWorkflowId?: string;
    panelY?: number;
    panelLeft?: number;
    canvasTheme?: 'dark' | 'light';
}

const WorkflowCanvasThumbnail: React.FC<{
    nodes: WorkflowPreviewNode[];
    title: string;
    isDark: boolean;
}> = ({ nodes, title, isDark }) => {
    const preview = React.useMemo(() => {
        if (nodes.length === 0) return null;

        const normalizedNodes = nodes.map(node => ({
            ...node,
            prompt: '',
            model: '',
            resolution: '',
        })) as NodeData[];
        const rectangles = normalizedNodes.map(node => {
            const parent = node.parentIds?.length
                ? normalizedNodes.find(item => item.id === node.parentIds?.[0])
                : undefined;
            return {
                node,
                width: getNodeWidth(node, parent),
                height: getNodeHeight(node, parent),
            };
        });
        const minX = Math.min(...rectangles.map(item => item.node.x));
        const minY = Math.min(...rectangles.map(item => item.node.y));
        const maxX = Math.max(...rectangles.map(item => item.node.x + item.width));
        const maxY = Math.max(...rectangles.map(item => item.node.y + item.height));
        const contentWidth = Math.max(1, maxX - minX);
        const contentHeight = Math.max(1, maxY - minY);
        const padding = Math.max(60, Math.max(contentWidth, contentHeight) * 0.06);

        return {
            rectangles,
            viewBox: `${minX - padding} ${minY - padding} ${contentWidth + padding * 2} ${contentHeight + padding * 2}`,
        };
    }, [nodes]);

    if (!preview) {
        return (
            <div className={`flex h-full items-center justify-center text-sm ${isDark ? 'text-neutral-600' : 'text-neutral-400'}`}>
                空画布
            </div>
        );
    }

    return (
        <svg
            className="h-full w-full"
            viewBox={preview.viewBox}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={`${title} 画布缩略图`}
        >
            {preview.rectangles.flatMap(({ node }) => (node.parentIds || []).map(parentId => {
                const parent = preview.rectangles.find(item => item.node.id === parentId);
                const child = preview.rectangles.find(item => item.node.id === node.id);
                if (!parent || !child) return null;
                const path = calculateConnectionPath(
                    parent.node.x + parent.width,
                    parent.node.y + parent.height / 2,
                    child.node.x,
                    child.node.y + child.height / 2,
                    'right'
                );
                return (
                    <path
                        key={`${parentId}-${node.id}`}
                        d={path}
                        fill="none"
                        stroke={isDark ? '#525252' : '#a3a3a3'}
                        strokeWidth="1.5"
                        vectorEffect="non-scaling-stroke"
                        opacity="0.7"
                    />
                );
            }))}
            {preview.rectangles.map(({ node, width, height }) => {
                const hasImage = node.type === NodeType.IMAGE
                    && node.status === NodeStatus.SUCCESS
                    && Boolean(node.resultUrl);
                return (
                    <g key={node.id}>
                        <rect
                            x={node.x}
                            y={node.y}
                            width={width}
                            height={height}
                            rx="18"
                            fill={isDark ? '#303030' : '#e5e5e5'}
                            stroke={isDark ? '#666' : '#a3a3a3'}
                            strokeWidth="1"
                            vectorEffect="non-scaling-stroke"
                        />
                        {hasImage && (
                            <image
                                href={node.resultUrl}
                                x={node.x}
                                y={node.y}
                                width={width}
                                height={height}
                                preserveAspectRatio="xMidYMid slice"
                            />
                        )}
                    </g>
                );
            })}
        </svg>
    );
};

export const WorkflowPanel: React.FC<WorkflowPanelProps> = ({
    isOpen,
    onClose,
    onLoadWorkflow,
    onRenameWorkflow,
    currentWorkflowId,
    panelY = 200,
    panelLeft = 80,
    canvasTheme = 'dark'
}) => {
    const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
    const [loading, setLoading] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    // Inline rename state (double-click a card's title)
    const [editingTitleFor, setEditingTitleFor] = useState<string | null>(null);
    const [editingTitleValue, setEditingTitleValue] = useState('');
    const titleInputRef = useRef<HTMLInputElement>(null);

    // Cover editing state
    const [editingCoverFor, setEditingCoverFor] = useState<string | null>(null);
    const [coverAssets, setCoverAssets] = useState<AssetMetadata[]>([]);
    const [loadingAssets, setLoadingAssets] = useState(false);

    // Pagination state for cover image modal
    const COVERS_PER_PAGE = 9;
    const [visibleCoverCount, setVisibleCoverCount] = useState(COVERS_PER_PAGE);
    const loadMoreRef = useRef<HTMLDivElement>(null);

    // Theme helper
    const isDark = canvasTheme === 'dark';

    // Fetch workflows on open
    useEffect(() => {
        if (isOpen) {
            fetchWorkflows();
        }
    }, [isOpen]);

    const fetchWorkflows = async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/workflows');
            if (response.ok) {
                const data = await response.json();
                setWorkflows(data);
            }
        } catch (error) {
            console.error('Failed to fetch workflows:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            const response = await fetch(`/api/workflows/${id}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                setWorkflows(prev => prev.filter(w => w.id !== id));
            }
        } catch (error) {
            console.error('Failed to delete workflow:', error);
        }
        setDeleteConfirm(null);
    };

    const startRenaming = (workflow: WorkflowSummary, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingTitleFor(workflow.id);
        setEditingTitleValue(workflow.title || '');
    };

    const cancelRenaming = () => {
        setEditingTitleFor(null);
        setEditingTitleValue('');
    };

    const commitRenaming = async () => {
        const id = editingTitleFor;
        const title = editingTitleValue.trim();
        if (!id) return;
        const original = workflows.find(w => w.id === id)?.title || '';
        if (!title || title === original) {
            cancelRenaming();
            return;
        }
        try {
            const response = await fetch(`/api/workflows/${id}/title`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || '项目重命名失败');
            setWorkflows(prev => prev.map(w => (w.id === id ? {
                ...w,
                title: result.title || title,
                coverUrl: result.coverUrl ?? w.coverUrl,
                previewNodes: Array.isArray(result.nodes) ? result.nodes : w.previewNodes
            } : w)));
            onRenameWorkflow?.(id, result.title || title, Array.isArray(result.nodes) ? result.nodes : []);
        } catch (error) {
            console.error('Failed to rename workflow:', error);
            window.alert(error instanceof Error ? error.message : '项目重命名失败');
        }
        cancelRenaming();
    };

    useEffect(() => {
        if (editingTitleFor && titleInputRef.current) {
            titleInputRef.current.focus();
            titleInputRef.current.select();
        }
    }, [editingTitleFor]);

    const handleRevealAssets = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            const response = await fetch(`/api/workflows/${id}/reveal-assets`, {
                method: 'POST'
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                console.error('Failed to reveal assets folder:', data.error);
            }
        } catch (error) {
            console.error('Failed to reveal assets folder:', error);
        }
    };

    // Load more covers callback for infinite scroll
    const loadMoreCovers = useCallback(() => {
        setVisibleCoverCount(prev => Math.min(prev + COVERS_PER_PAGE, coverAssets.length));
    }, [coverAssets.length]);

    // Intersection Observer effect for infinite scroll
    useEffect(() => {
        if (!editingCoverFor || loadingAssets) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && visibleCoverCount < coverAssets.length) {
                    loadMoreCovers();
                }
            },
            { threshold: 0.1, rootMargin: '100px' }
        );

        if (loadMoreRef.current) {
            observer.observe(loadMoreRef.current);
        }

        return () => observer.disconnect();
    }, [editingCoverFor, loadingAssets, visibleCoverCount, coverAssets.length, loadMoreCovers]);

    const openCoverEditor = async (workflowId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingCoverFor(workflowId);
        setLoadingAssets(true);
        setVisibleCoverCount(COVERS_PER_PAGE); // Reset pagination

        try {
            const response = await fetch('/api/assets/images');
            if (response.ok) {
                const data = await response.json();
                setCoverAssets(data);
            }
        } catch (error) {
            console.error('Failed to fetch assets:', error);
        } finally {
            setLoadingAssets(false);
        }
    };

    const selectCover = async (assetUrl: string) => {
        if (!editingCoverFor) return;

        try {
            const response = await fetch(`/api/workflows/${editingCoverFor}/cover`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ coverUrl: assetUrl })
            });

            if (response.ok) {
                // Update local state
                setWorkflows(prev => prev.map(w =>
                    w.id === editingCoverFor
                        ? { ...w, coverUrl: assetUrl }
                        : w
                ));
            }
        } catch (error) {
            console.error('Failed to update cover:', error);
        }

        setEditingCoverFor(null);
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
        });
    };

    if (!isOpen) return null;

    return (
        <>
            {/* Main Panel */}
            <div
                className={`fixed backdrop-blur-xl border rounded-2xl shadow-2xl z-40 flex flex-col overflow-hidden max-h-[500px] transition-colors duration-300 ${isDark ? 'bg-[#0a0a0a]/95 border-neutral-800' : 'bg-white/95 border-neutral-200'}`}
                style={{
                    left: panelLeft,
                    width: Math.max(320, Math.min(700, window.innerWidth - panelLeft - 24)),
                    top: Math.min(Math.max(72, window.innerHeight - 520), Math.max(72, panelY))
                }}
            >
                {/* Header */}
                <div className={`flex items-center justify-between px-5 py-4 border-b ${isDark ? 'border-neutral-800' : 'border-neutral-200'}`}>
                    <h2 className={`font-medium ${isDark ? 'text-white' : 'text-neutral-900'}`}>我的工作流</h2>
                    <button
                        onClick={onClose}
                        className={`transition-colors ${isDark ? 'text-neutral-500 hover:text-white' : 'text-neutral-400 hover:text-neutral-900'}`}
                    >
                        <Maximize2 size={18} />
                    </button>
                </div>

                {/* Content */}
                <div
                    className="flex-1 overflow-y-auto p-4"
                    style={{
                        scrollbarWidth: 'thin',
                        scrollbarColor: isDark ? '#525252 #171717' : '#d4d4d4 #fafafa'
                    }}
                >
                    {loading ? (
                        <div className="flex items-center justify-center h-40">
                            <Loader2 className="animate-spin text-neutral-500" size={24} />
                        </div>
                    ) : (
                        workflows.length === 0 ? (
                            <div className="flex items-center justify-center h-40 text-neutral-500">
                                暂无工作流
                            </div>
                        ) : (
                            <div className="grid grid-cols-3 gap-4">
                                {workflows.map(workflow => (
                                    <div
                                        key={workflow.id}
                                        onClick={() => onLoadWorkflow(workflow.id)}
                                        className={`rounded-xl overflow-hidden cursor-pointer transition-all group ${workflow.id === currentWorkflowId
                                            ? 'ring-2 ring-blue-500'
                                            : ''
                                            }`}
                                    >
                                        {/* Thumbnail */}
                                        <div className={`relative flex aspect-[4/3] items-center justify-center overflow-hidden ${isDark ? 'bg-[#202020]' : 'bg-neutral-200'}`}>
                                            {workflow.coverUrl ? (
                                                <img
                                                    src={workflow.coverUrl}
                                                    alt={workflow.title}
                                                    className="w-full h-full object-cover"
                                                    loading="lazy"
                                                />
                                            ) : (
                                                <WorkflowCanvasThumbnail
                                                    nodes={workflow.previewNodes || []}
                                                    title={workflow.title || '未命名项目'}
                                                    isDark={isDark}
                                                />
                                            )}

                                            {/* Action buttons */}
                                            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                                {/* Reveal assets folder in Finder */}
                                                <button
                                                    onClick={(e) => handleRevealAssets(workflow.id, e)}
                                                    className="p-1.5 bg-black/50 hover:bg-blue-500 rounded-lg transition-all"
                                                    title="在 Finder 中打开项目素材"
                                                >
                                                    <FolderOpen size={14} className="text-white" />
                                                </button>
                                                {/* Edit cover button */}
                                                <button
                                                    onClick={(e) => openCoverEditor(workflow.id, e)}
                                                    className="p-1.5 bg-black/50 hover:bg-blue-500 rounded-lg transition-all"
                                                    title="编辑封面"
                                                >
                                                    <Pencil size={14} className="text-white" />
                                                </button>
                                                {/* Delete button */}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setDeleteConfirm(workflow.id);
                                                    }}
                                                    className="p-1.5 bg-black/50 hover:bg-red-500 rounded-lg transition-all"
                                                    title="删除工作流"
                                                >
                                                    <Trash2 size={14} className="text-white" />
                                                </button>
                                            </div>
                                        </div>
                                        {/* Info */}
                                        <div className={`p-3 ${isDark ? 'bg-neutral-900/50' : 'bg-neutral-100/90'}`}>
                                            {editingTitleFor === workflow.id ? (
                                                <input
                                                    ref={titleInputRef}
                                                    value={editingTitleValue}
                                                    onChange={(e) => setEditingTitleValue(e.target.value)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onBlur={commitRenaming}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') { e.currentTarget.blur(); }
                                                        else if (e.key === 'Escape') { cancelRenaming(); }
                                                    }}
                                                    className={`w-full font-medium text-sm bg-transparent border-b outline-none ${isDark ? 'text-white border-neutral-600' : 'text-neutral-900 border-neutral-400'}`}
                                                />
                                            ) : (
                                                <h3
                                                    onClick={(e) => e.stopPropagation()}
                                                    onDoubleClick={(e) => startRenaming(workflow, e)}
                                                    title="双击重命名"
                                                    className={`font-medium text-sm truncate ${isDark ? 'text-white' : 'text-neutral-900'}`}
                                                >
                                                    {workflow.title || '未命名'}
                                                </h3>
                                            )}
                                            <p className={`text-xs mt-0.5 ${isDark ? 'text-neutral-500' : 'text-neutral-600'}`}>
                                                {workflow.nodeCount} 个节点
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )
                    )}
                </div>
            </div>

            {/* Delete Confirmation Modal */}
            {deleteConfirm && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-[#1a1a1a] border border-neutral-700 rounded-2xl p-6 w-[340px] shadow-2xl">
                        <h3 className="text-lg font-semibold text-white mb-2">删除工作流</h3>
                        <p className="text-neutral-400 text-sm mb-6">
                            确认删除这个工作流吗？删除后无法恢复。
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setDeleteConfirm(null)}
                                className="px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white text-sm transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={() => handleDelete(deleteConfirm)}
                                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm transition-colors"
                            >
                                删除
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Cover Selection Modal */}
            {editingCoverFor && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="bg-[#1a1a1a] border border-neutral-700 rounded-2xl p-6 w-[500px] max-h-[500px] shadow-2xl flex flex-col">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-white">选择封面图片</h3>
                            <button
                                onClick={() => setEditingCoverFor(null)}
                                className="p-1.5 hover:bg-neutral-800 rounded-lg text-neutral-400 hover:text-white transition-colors"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {loadingAssets ? (
                            <div className="flex items-center justify-center h-40">
                                <Loader2 className="animate-spin text-neutral-500" size={24} />
                            </div>
                        ) : coverAssets.length === 0 ? (
                            <div className="flex items-center justify-center h-40 text-neutral-500">
                                暂无可用图片，请先生成图片。
                            </div>
                        ) : (
                            <div className="grid grid-cols-3 gap-3 overflow-y-auto flex-1">
                                {coverAssets.slice(0, visibleCoverCount).map(asset => (
                                    <button
                                        key={asset.id}
                                        onClick={() => selectCover(asset.url)}
                                        className="h-32 w-full rounded-lg overflow-hidden hover:ring-2 hover:ring-blue-500 transition-all relative group bg-neutral-900"
                                    >
                                        <LazyImage
                                            src={asset.url}
                                            alt="Cover option"
                                            className="w-full h-full"
                                            placeholderClassName="rounded-lg"
                                            rootMargin="100px"
                                        />
                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                                            <Check size={24} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                    </button>
                                ))}

                                {/* Load more sentinel - triggers infinite scroll */}
                                {visibleCoverCount < coverAssets.length && (
                                    <div
                                        ref={loadMoreRef}
                                        className="col-span-3 flex items-center justify-center py-4"
                                    >
                                        <Loader2 className="animate-spin text-neutral-500" size={20} />
                                        <span className="ml-2 text-neutral-500 text-sm">Loading more...</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
};
