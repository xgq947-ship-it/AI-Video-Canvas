/**
 * SelectionBoundingBox.tsx
 * 
 * Renders a bounding box around selected nodes with resize handles.
 * Shows "Group" button for multi-selection and group toolbar when grouped.
 */

import React, { useEffect, useRef, useState } from 'react';
import { NodeData, NodeGroup, NodeType } from '../../types';
import { VIDEO_ANALYSIS_NODE_HEIGHT } from '../../features/video-analysis/VideoAnalysisNode';
import { getFlowBatchVideoNodeHeight, getStickmanStoryboardNodeHeight, SCRIPT_INPUT_NODE_HEIGHT, SCRIPT_INPUT_REFERENCE_NODE_HEIGHT } from '../../features/stickman-director/StickmanWorkflowNodes';
import { CINEMATIC_CAST_NODE_HEIGHT, CINEMATIC_DIRECTOR_NODE_HEIGHT, CINEMATIC_VIDEO_MERGE_NODE_HEIGHT, getCinematicStoryboardNodeHeight } from '../../features/cinematic-director/CinematicWorkflowNodes';

interface SelectionBoundingBoxProps {
    selectedNodes: NodeData[];
    group?: NodeGroup;
    viewport: { x: number; y: number; zoom: number };
    onGroup: () => void;
    onUngroup: () => void;
    onBoundingBoxPointerDown: (e: React.PointerEvent) => void;
    onRenameGroup?: (groupId: string, newLabel: string) => void;
    onSortNodes?: (direction: 'horizontal' | 'vertical' | 'grid') => void;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get the width of a node based on its type
 * @param node - The node to calculate width for
 * @param allNodes - All nodes in the selection (to find parent for Editor nodes)
 */
const getNodeWidth = (node: NodeData, allNodes?: NodeData[]): number => {
    // Image Editor with input from parent: width depends on parent's aspect ratio
    if (node.type === NodeType.IMAGE_EDITOR) {
        // Find parent node in the selection
        const parentId = node.parentIds?.[0];
        const parentNode = parentId ? allNodes?.find(n => n.id === parentId) : undefined;
        if (parentNode?.resultUrl && parentNode?.resultAspectRatio) {
            const parts = parentNode.resultAspectRatio.split('/');
            if (parts.length === 2) {
                const aspectRatio = parseFloat(parts[0]) / parseFloat(parts[1]);
                // For portrait images: height=500px, width=500*aspectRatio
                // For landscape images: width is capped at 500px
                if (aspectRatio < 1) {
                    return 500 * aspectRatio;
                } else {
                    return 500;
                }
            }
        }
        // Empty: width 340px
        return 340;
    }

    if (node.type === NodeType.VIDEO) return 385;
    if (node.type === NodeType.PRODUCT_SCENE_REPLACE) return 460;
    if (node.type === NodeType.VIDEO_REMIX) return 420;
    if (node.type === NodeType.VIDEO_ANALYSIS) return 420;
    if ([NodeType.REFERENCE_VIDEO, NodeType.SCRIPT_INPUT, NodeType.STICKMAN_DIRECTOR, NodeType.STORYBOARD, NodeType.STORYBOARD_COMPARE, NodeType.FLOW_BATCH_VIDEO, NodeType.VIDEO_MERGE, NodeType.CINEMATIC_CAST, NodeType.CINEMATIC_DIRECTOR, NodeType.CINEMATIC_STORYBOARD, NodeType.CINEMATIC_VIDEO_MERGE].includes(node.type)) return 430;
    return 365;
};

/**
 * Estimate the height of a node based on its type and aspect ratio.
 * This accounts for the content area + any controls/padding.
 * @param node - The node to calculate height for
 * @param allNodes - All nodes in the selection (to find parent for Editor nodes)
 */
const getNodeHeight = (node: NodeData, allNodes?: NodeData[]): number => {
    // 控制节点固定高度：成图落在它自动创建的子 Image 节点上，自身不展示结果。
    // 716 是浏览器里实测的卡片高度，改动节点表单后要重新量，否则连线端点会偏。
    if (node.type === NodeType.PRODUCT_SCENE_REPLACE) return 716;
    if (node.type === NodeType.VIDEO_REMIX) return 306;
    if (node.type === NodeType.VIDEO_ANALYSIS) return VIDEO_ANALYSIS_NODE_HEIGHT;
    if (node.type === NodeType.REFERENCE_VIDEO) return 300;
    if (node.type === NodeType.SCRIPT_INPUT) {
        const parent = node.parentIds?.map(id => allNodes?.find(item => item.id === id)).find(Boolean);
        const isReferenceScript = parent?.type === NodeType.VIDEO || parent?.type === NodeType.REFERENCE_VIDEO;
        return isReferenceScript ? SCRIPT_INPUT_REFERENCE_NODE_HEIGHT : SCRIPT_INPUT_NODE_HEIGHT;
    }
    if (node.type === NodeType.STICKMAN_DIRECTOR) return 600;
    if (node.type === NodeType.STORYBOARD || node.type === NodeType.STORYBOARD_COMPARE) return getStickmanStoryboardNodeHeight(node.storyboard);
    if (node.type === NodeType.FLOW_BATCH_VIDEO) {
        const parent = node.parentIds?.map(id => allNodes?.find(item => item.id === id)).find(Boolean);
        return getFlowBatchVideoNodeHeight(parent?.storyboard);
    }
    if (node.type === NodeType.VIDEO_MERGE) return 300;
    if (node.type === NodeType.CINEMATIC_CAST) return CINEMATIC_CAST_NODE_HEIGHT;
    if (node.type === NodeType.CINEMATIC_DIRECTOR) return CINEMATIC_DIRECTOR_NODE_HEIGHT;
    if (node.type === NodeType.CINEMATIC_STORYBOARD) return getCinematicStoryboardNodeHeight(node.cinematicStoryboard);
    if (node.type === NodeType.CINEMATIC_VIDEO_MERGE) return CINEMATIC_VIDEO_MERGE_NODE_HEIGHT;
    const baseWidth = getNodeWidth(node, allNodes);

    // Handle Image Editor nodes
    if (node.type === NodeType.IMAGE_EDITOR) {
        // Find parent node in the selection
        const parentId = node.parentIds?.[0];
        const parentNode = parentId ? allNodes?.find(n => n.id === parentId) : undefined;
        if (parentNode?.resultUrl && parentNode?.resultAspectRatio) {
            const parts = parentNode.resultAspectRatio.split('/');
            if (parts.length === 2) {
                const aspectRatio = parseFloat(parts[0]) / parseFloat(parts[1]);
                // For portrait: height = 500px
                // For landscape: height = 500 / aspectRatio
                if (aspectRatio < 1) {
                    return 500;
                } else {
                    return 500 / aspectRatio;
                }
            }
        }
        // Empty: minHeight 380px
        return 380;
    }

    // Parse aspect ratio to calculate content height for Image/Video nodes
    let aspectRatio = 16 / 9; // Default

    // First priority: use resultAspectRatio if available (actual generated content dimensions)
    if (node.resultAspectRatio) {
        const parts = node.resultAspectRatio.split('/');
        if (parts.length === 2) {
            aspectRatio = parseFloat(parts[0]) / parseFloat(parts[1]);
        }
    } else if (node.aspectRatio && node.aspectRatio !== 'Auto') {
        // Use selected aspect ratio
        const parts = node.aspectRatio.split(':');
        if (parts.length === 2) {
            aspectRatio = parseFloat(parts[0]) / parseFloat(parts[1]);
        }
    } else {
        // Empty/placeholder state: Both Image and Video use 4/3
        aspectRatio = 4 / 3;
    }

    // Calculate content height from aspect ratio
    return baseWidth / aspectRatio;
};

export const SelectionBoundingBox: React.FC<SelectionBoundingBoxProps> = ({
    selectedNodes,
    group,
    viewport,
    onGroup,
    onUngroup,
    onBoundingBoxPointerDown,
    onRenameGroup,
    onSortNodes
}) => {
    // ============================================================================
    // STATE
    // ============================================================================

    const [isEditingLabel, setIsEditingLabel] = useState(false);
    const [editedLabel, setEditedLabel] = useState('');
    const [showSortDropdown, setShowSortDropdown] = useState(false);
    const [isGroupHovered, setIsGroupHovered] = useState(false);
    const boundingBoxRef = useRef<HTMLDivElement>(null);
    const groupToolbarRef = useRef<HTMLDivElement>(null);
    const groupLabelRef = useRef<HTMLDivElement>(null);
    const isGrouped = !!group;

    // 分组框本身必须让点击穿透到内部节点，因此不能依赖 CSS :hover。
    // 使用真实屏幕坐标判断鼠标是否位于分组、工具栏或两者之间的移动走廊。
    useEffect(() => {
        if (!isGrouped) {
            setIsGroupHovered(false);
            return;
        }

        const handlePointerMove = (event: PointerEvent) => {
            const box = boundingBoxRef.current?.getBoundingClientRect();
            if (!box) return;
            const toolbar = groupToolbarRef.current?.getBoundingClientRect();
            const insideBox = event.clientX >= box.left && event.clientX <= box.right
                && event.clientY >= box.top && event.clientY <= box.bottom;
            const insideToolbar = !!toolbar
                && event.clientX >= toolbar.left && event.clientX <= toolbar.right
                && event.clientY >= toolbar.top && event.clientY <= toolbar.bottom;
            const insideToolbarBridge = !!toolbar
                && event.clientX >= Math.min(box.left, toolbar.left)
                && event.clientX <= Math.max(box.right, toolbar.right)
                && event.clientY >= toolbar.top
                && event.clientY <= box.top;
            // 组名挂在分组框左外侧，鼠标从框上移过去的途中会短暂离开框本身；
            // 把组名自身与它到框之间的横向走廊也算作 hover，否则名字会在指过去的路上闪掉。
            const label = groupLabelRef.current?.getBoundingClientRect();
            const insideLabel = !!label
                && event.clientX >= label.left && event.clientX <= label.right
                && event.clientY >= label.top && event.clientY <= label.bottom;
            const insideLabelBridge = !!label
                && event.clientX >= label.right && event.clientX <= box.left
                && event.clientY >= label.top && event.clientY <= label.bottom;
            const hovered = insideBox || insideToolbar || insideToolbarBridge || insideLabel || insideLabelBridge;

            setIsGroupHovered(previous => previous === hovered ? previous : hovered);
            if (!hovered) setShowSortDropdown(false);
        };

        window.addEventListener('pointermove', handlePointerMove, { passive: true });
        return () => window.removeEventListener('pointermove', handlePointerMove);
    }, [isGrouped]);

    // ============================================================================
    // CALCULATIONS
    // ============================================================================

    // Don't render for 0 nodes or single nodes (unless it's a group)
    if (selectedNodes.length === 0) return null;
    if (selectedNodes.length === 1 && !group) return null;

    // Calculate bounding box from all selected nodes with proper dimensions
    const PADDING_X = 50; // Horizontal padding (accounts for + connectors on sides)
    const PADDING_TOP = 30; // Top padding for node titles
    const PADDING_BOTTOM = 50; // Bottom padding for controls

    const minX = Math.min(...selectedNodes.map(n => n.x)) - PADDING_X;
    const minY = Math.min(...selectedNodes.map(n => n.y)) - PADDING_TOP;
    const maxX = Math.max(...selectedNodes.map(n => n.x + getNodeWidth(n, selectedNodes))) + PADDING_X;
    const maxY = Math.max(...selectedNodes.map(n => n.y + getNodeHeight(n, selectedNodes))) + PADDING_BOTTOM;

    const width = maxX - minX;
    const height = maxY - minY;

    const showGroupButton = selectedNodes.length > 1 && !isGrouped;

    // 多选与分组操作始终保持固定屏幕尺寸，不跟随画布缩放。
    const uiScale = 1 / Math.max(viewport.zoom, 0.01);
    // 工具条与方框之间的间距：纯布局定位（bottom: 100% + gap），不与 scale 混合在同一个 transform 里，
    // 避免 translateY(-100%) 与 scale() 叠加导致的随缩放偏移（该位移会被内层的 scale 再次放大/缩小）。
    const stackGap = 8 / Math.max(viewport.zoom, 0.01);

    // ============================================================================
    // RENDER
    // ============================================================================

    return (
        <div
            ref={boundingBoxRef}
            className="absolute pointer-events-none"
            style={{
                left: minX,
                top: minY,
                width,
                height,
                border: isGrouped ? '2px solid #6366f1' : '2px dashed #6366f1',
                borderRadius: '12px',
                backgroundColor: isGrouped ? 'rgba(99, 102, 241, 0.06)' : 'transparent',
                zIndex: 60
            }}
        >
            {/* 只让四条边框接收拖动事件，内部区域完整透传给节点。 */}
            {[
                { key: 'top', top: -5, left: 0, width: '100%', height: 10 },
                { key: 'right', top: 0, right: -5, width: 10, height: '100%' },
                { key: 'bottom', bottom: -5, left: 0, width: '100%', height: 10 },
                { key: 'left', top: 0, left: -5, width: 10, height: '100%' }
            ].map(({ key, ...edgeStyle }) => (
                <div
                    key={key}
                    className="absolute pointer-events-auto cursor-move"
                    style={edgeStyle}
                    onPointerDown={onBoundingBoxPointerDown}
                />
            ))}

            {/* Resize Handles */}
            {[
                { pos: 'top-left', cursor: 'nw-resize', top: -4, left: -4 },
                { pos: 'top', cursor: 'n-resize', top: -4, left: '50%', transform: 'translateX(-50%)' },
                { pos: 'top-right', cursor: 'ne-resize', top: -4, right: -4 },
                { pos: 'right', cursor: 'e-resize', top: '50%', right: -4, transform: 'translateY(-50%)' },
                { pos: 'bottom-right', cursor: 'se-resize', bottom: -4, right: -4 },
                { pos: 'bottom', cursor: 's-resize', bottom: -4, left: '50%', transform: 'translateX(-50%)' },
                { pos: 'bottom-left', cursor: 'sw-resize', bottom: -4, left: -4 },
                { pos: 'left', cursor: 'w-resize', top: '50%', left: -4, transform: 'translateY(-50%)' }
            ].map(handle => (
                <div
                    key={handle.pos}
                    className="absolute w-2 h-2 bg-white border border-indigo-500 rounded-sm pointer-events-auto"
                    style={{
                        top: handle.top,
                        left: handle.left,
                        right: handle.right,
                        bottom: handle.bottom,
                        transform: handle.transform,
                        cursor: handle.cursor
                    }}
                    onPointerDown={onBoundingBoxPointerDown}
                />
            ))}

            {/* Group Label (when grouped) - Positioned on left side */}
            {isGrouped && group && (
                isEditingLabel ? (
                    <input
                        type="text"
                        value={editedLabel}
                        onChange={(e) => setEditedLabel(e.target.value)}
                        onBlur={() => {
                            if (editedLabel.trim() && onRenameGroup) {
                                onRenameGroup(group.id, editedLabel.trim());
                            }
                            setIsEditingLabel(false);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                if (editedLabel.trim() && onRenameGroup) {
                                    onRenameGroup(group.id, editedLabel.trim());
                                }
                                setIsEditingLabel(false);
                            } else if (e.key === 'Escape') {
                                setIsEditingLabel(false);
                            }
                        }}
                        autoFocus
                        className="absolute text-sm font-medium text-white bg-indigo-600 px-3 py-1 rounded pointer-events-auto outline-none whitespace-nowrap"
                        style={{
                            top: 8,
                            right: 'calc(100% + 8px)',
                            transform: `scale(${uiScale})`,
                            transformOrigin: 'top right'
                        }}
                    />
                ) : (
                    // 组名默认隐藏，鼠标移到分组上才淡入：分组框左外侧长期挂一块紫色标签
                    // 会盖住画布、也抢视觉焦点。隐藏时同时关掉命中，避免空白处出现看不见的可点区域。
                    <div
                        ref={groupLabelRef}
                        className={`absolute text-sm font-medium text-white bg-indigo-600 px-3 py-1 rounded cursor-text whitespace-nowrap transition-opacity duration-150 ${
                            isGroupHovered ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                        }`}
                        style={{
                            top: 8,
                            right: 'calc(100% + 8px)',
                            transform: `scale(${uiScale})`,
                            transformOrigin: 'top right'
                        }}
                        onDoubleClick={() => {
                            setEditedLabel(group.label);
                            setIsEditingLabel(true);
                        }}
                    >
                        {group.label}
                    </div>
                )
            )}

            {/* Group Button (when multiple nodes selected but not grouped) */}
            {showGroupButton && (
                <div
                    className="absolute flex gap-1.5 pointer-events-auto"
                    style={{
                        bottom: `calc(100% + ${stackGap}px)`,
                        right: 0,
                        transform: `scale(${uiScale})`,
                        transformOrigin: 'bottom right'
                    }}
                >
                    <button
                        onClick={onGroup}
                        className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-neutral-700 bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white shadow-xl transition-colors hover:bg-neutral-800"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="3" width="7" height="7" />
                            <rect x="14" y="3" width="7" height="7" />
                            <rect x="14" y="14" width="7" height="7" />
                            <rect x="3" y="14" width="7" height="7" />
                        </svg>
                        打组
                    </button>
                </div>
            )}

            {/* Group Toolbar (when grouped) */}
            {isGrouped && isGroupHovered && (
                <div
                    ref={groupToolbarRef}
                    className="absolute flex gap-1.5 pointer-events-auto"
                    style={{
                        bottom: `calc(100% + ${stackGap}px)`,
                        left: '50%',
                        transform: `translateX(-50%) scale(${uiScale})`,
                        transformOrigin: 'bottom center'
                    }}
                >
                    {/* Sort Button with Dropdown */}
                    <div className="relative">
                        <button
                            onClick={() => setShowSortDropdown(!showSortDropdown)}
                            className="shrink-0 whitespace-nowrap bg-neutral-900 border border-neutral-700 hover:bg-neutral-800 text-white text-xs px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="4" y1="6" x2="20" y2="6" />
                                <line x1="4" y1="12" x2="16" y2="12" />
                                <line x1="4" y1="18" x2="12" y2="18" />
                            </svg>
                            排列
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="6 9 12 15 18 9" />
                            </svg>
                        </button>
                        {/* Dropdown Menu - Appears above */}
                        {showSortDropdown && (
                            <div className="absolute bottom-full mb-1 left-0 w-32 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl overflow-hidden z-50">
                                <button
                                    onClick={() => {
                                        onSortNodes?.('horizontal');
                                        setShowSortDropdown(false);
                                    }}
                                    className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-white hover:bg-neutral-700 transition-colors"
                                >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <line x1="4" y1="12" x2="20" y2="12" />
                                        <polyline points="14 6 20 12 14 18" />
                                    </svg>
                                    横向排列
                                </button>
                                <button
                                    onClick={() => {
                                        onSortNodes?.('vertical');
                                        setShowSortDropdown(false);
                                    }}
                                    className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-white hover:bg-neutral-700 transition-colors"
                                >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <line x1="12" y1="4" x2="12" y2="20" />
                                        <polyline points="6 14 12 20 18 14" />
                                    </svg>
                                    纵向排列
                                </button>
                                <button
                                    onClick={() => {
                                        onSortNodes?.('grid');
                                        setShowSortDropdown(false);
                                    }}
                                    className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-white hover:bg-neutral-700 transition-colors"
                                >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <rect x="3" y="3" width="7" height="7" />
                                        <rect x="14" y="3" width="7" height="7" />
                                        <rect x="3" y="14" width="7" height="7" />
                                        <rect x="14" y="14" width="7" height="7" />
                                    </svg>
                                    网格（3列）
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Ungroup Button */}
                    <button
                        onClick={onUngroup}
                        className="shrink-0 whitespace-nowrap bg-neutral-900 border border-neutral-700 hover:bg-neutral-800 text-white text-xs px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="3" width="7" height="7" />
                            <rect x="14" y="3" width="7" height="7" />
                            <rect x="14" y="14" width="7" height="7" />
                            <rect x="3" y="14" width="7" height="7" />
                            <line x1="3" y1="3" x2="21" y2="21" />
                        </svg>
                        取消分组
                    </button>



                </div>
            )}
        </div>
    );
};
