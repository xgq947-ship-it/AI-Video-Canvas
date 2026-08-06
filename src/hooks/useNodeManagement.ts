/**
 * useNodeManagement.ts
 * 
 * Custom hook for managing node state and operations.
 * Handles node creation, updates, selection, and deletion.
 */

import { useCallback, useState } from 'react';
import { NodeData, NodeType, NodeStatus, Viewport } from '../types';
import { DEFAULT_NODE_WIDTH, paneToCanvas } from '@/shared/canvasCoords.js';
import { assignVideoAnalysisInputPort, createVideoAnalysisNodeData } from '../../shared/videoAnalysis.js';
import { listVideoGenerationProviders } from '../../shared/generationProviders.js';
import { normalizeStickmanSettings } from '../../shared/stickmanDirector.js';
import {
    CINEMATIC_DEFAULT_VIDEO_MODEL,
    normalizeCinematicSettings,
} from '../../shared/cinematicDirector.js';

const applyStickmanNodeDefaults = (node: NodeData): NodeData => {
    if (node.type === NodeType.SCRIPT_INPUT) {
        const settings = normalizeStickmanSettings({});
        node.title = '剧本输入';
        node.prompt = '';
        node.scriptInput = {
            title: '未命名剧本', content: '', notes: '', platform: settings.platform,
        };
    }
    if (node.type === NodeType.REFERENCE_VIDEO) {
        node.title = '参考视频';
        node.model = 'Upload';
        node.aspectRatio = '16:9';
        node.referenceVideo = { sourceType: 'upload' };
    }
    if (node.type === NodeType.STICKMAN_DIRECTOR) {
        node.title = '火柴人视频导演';
        node.director = { ...normalizeStickmanSettings({}), provider: 'auto', status: 'idle' };
    }
    if (node.type === NodeType.STORYBOARD || node.type === NodeType.STORYBOARD_COMPARE) {
        node.title = node.type === NodeType.STORYBOARD_COMPARE ? '分镜对照组' : '分镜列表';
        node.storyboard = { shots: [], expanded: false, compareMode: node.type === NodeType.STORYBOARD_COMPARE, status: 'idle' };
    }
    if (node.type === NodeType.FLOW_BATCH_VIDEO) {
        const model = listVideoGenerationProviders()[0];
        node.title = 'Flow 视频生成';
        node.flowBatch = {
            modelId: model?.id,
            resolution: model?.resolutions?.[0] || 'Auto',
            concurrency: 2,
            aspectRatio: '9:16', width: 1080, height: 1920, duration: 8,
            nativeAudio: true, autoRetry: true, maxRetries: 1, continueOnFailure: true, autoMerge: false,
            status: 'idle', tasks: [],
        };
    }
    if (node.type === NodeType.VIDEO_MERGE) {
        node.title = '视频拼接';
        node.videoMerge = { status: 'idle', outputFormat: 'mp4', fps: 30, skipFailed: true };
    }
    if (node.type === NodeType.CINEMATIC_CAST) {
        node.title = '角色设定';
        node.cinematicCast = {
            characters: [{ id: 'CAST_01', name: '主角', role: 'protagonist', description: '', referenceImages: [] }],
            videoModel: CINEMATIC_DEFAULT_VIDEO_MODEL,
        };
    }
    if (node.type === NodeType.CINEMATIC_DIRECTOR) {
        node.title = '电影短片导演';
        node.cinematicDirector = {
            ...normalizeCinematicSettings({}),
            provider: 'auto',
            status: 'idle',
        };
    }
    if (node.type === NodeType.CINEMATIC_STORYBOARD) {
        node.title = '电影分镜';
        node.cinematicStoryboard = {
            shots: [],
            cast: [],
            expanded: false,
            concurrency: 2,
            status: 'idle',
        };
    }
    if (node.type === NodeType.CINEMATIC_VIDEO_MERGE) {
        node.title = '电影成片拼接';
        node.cinematicVideoMerge = { status: 'idle', outputFormat: 'mp4', fps: 30, skipFailed: true };
    }
    return node;
};

const createNodeData = (
    type: NodeType,
    x: number,
    y: number,
    parentIds: string[] = [],
): NodeData => {
    const node: NodeData = {
        id: crypto.randomUUID(),
        type,
        x,
        y,
        prompt: '',
        status: NodeStatus.IDLE,
        model: 'Banana Pro',
        aspectRatio: 'Auto',
        resolution: 'Auto',
        parentIds: [...parentIds],
    };

    if (type === NodeType.PRODUCT_SCENE_REPLACE) {
        node.title = '产品短视频生成';
        node.productSceneInputMapping = { version: 1 };
        node.imageModel = 'google-flow-nano-banana-pro';
        node.resolution = '2K';
        // 产品短视频以竖版投放为主；这一个比例同时决定替换图和短视频。
        node.aspectRatio = '9:16';
        node.productDimensions = { length: 0, width: 0, height: 0, unit: 'cm' };
        node.preserveProductMarkings = true;
        node.productSceneRecognitionProvider = 'codex-cli';
        node.productSceneImageCount = 1;
        node.productSceneAutoGenerateVideo = false;
        node.productSceneVideoModel = 'gemini-web-video';
        node.productSceneVideoAspectRatio = '9:16';
        node.productSceneVideoDuration = 10;
        node.productSceneVideoGenerateAudio = true;
    }
    if (type === NodeType.VIDEO_ANALYSIS) {
        node.title = '视频分析';
        node.model = 'video-analysis';
        node.videoAnalysis = createVideoAnalysisNodeData({
            status: 'idle',
            inputRefs: { productNodeIds: [], characterNodeIds: [], sceneNodeIds: [] },
        });
        node.outputPortId = 'analysis-output';
    }

    return applyStickmanNodeDefaults(node);
};

export const useNodeManagement = () => {
    // ============================================================================
    // STATE
    // ============================================================================

    const [nodes, setNodes] = useState<NodeData[]>([]);
    const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);

    // ============================================================================
    // NODE OPERATIONS
    // ============================================================================

    /**
     * Adds a new node to the canvas
     * @param type - Type of node to create
     * @param x - Screen X coordinate
     * @param y - Screen Y coordinate
     * @param parentId - Optional parent node ID for connections
     * @param viewport - Current viewport for coordinate conversion
     */
    const addNode = (
        type: NodeType,
        x: number,
        y: number,
        parentId: string | undefined,
        viewport: Viewport
    ) => {
        // 视频复刻已经提升为项目级工作区，不能再创建画布容器节点。
        if (type === NodeType.VIDEO_REMIX) return '';
        // x/y 是面板坐标（相对画布容器，已扣除侧边栏），由 contextMenu.canvasX/canvasY 提供
        const { x: canvasX, y: canvasY } = paneToCanvas(x, y, viewport);
        // 新建节点居中于点击处：横向用卡片真实宽度（365，此前硬编码 340 导致偏 12.5px）；
        // 纵向沿用历史常量 100 —— 节点高度随类型与内容变化（待生成 ~214、出图后 auto），无统一值。
        const halfWidth = DEFAULT_NODE_WIDTH / 2;

        const newNode = createNodeData(
            type,
            parentId ? canvasX : canvasX - halfWidth,
            parentId ? canvasY : canvasY - 100,
            parentId ? [parentId] : [],
        );

        setNodes(prev => [...prev, newNode]);
        setSelectedNodeIds([newNode.id]);

        return newNode.id;
    };

    /**
     * Creates the complete stickman workflow at once. Reference-video
     * analysis is owned by the director node; no standalone analysis node is
     * inserted into new workflows.
     */
    const addStickmanWorkflow = useCallback((
        mode: 'script' | 'reference_video',
        paneX: number,
        paneY: number,
        viewport: Viewport,
    ) => {
        const { x: anchorX, y: anchorY } = paneToCanvas(paneX, paneY, viewport);
        const halfWidth = DEFAULT_NODE_WIDTH / 2;
        const topY = anchorY - 100;
        const step = 520;
        const isReference = mode === 'reference_video';

        const source = createNodeData(
            isReference ? NodeType.REFERENCE_VIDEO : NodeType.SCRIPT_INPUT,
            anchorX - halfWidth,
            topY,
        );
        const scriptNode = isReference
            ? createNodeData(NodeType.SCRIPT_INPUT, anchorX + step, topY, [source.id])
            : undefined;
        if (scriptNode) {
            scriptNode.title = '视频分析剧本';
            scriptNode.scriptInput = {
                ...scriptNode.scriptInput!,
                title: '视频分析剧本',
                content: '',
                notes: '执行导演时先由视频分析生成剧本，再交给火柴人导演 Skill 重新推导分镜。',
            };
        }
        const directorX = anchorX + step * (isReference ? 2 : 1);
        const director = createNodeData(
            NodeType.STICKMAN_DIRECTOR,
            directorX,
            topY,
            [scriptNode?.id || source.id],
        );
        director.director = {
            ...(director.director || { ...normalizeStickmanSettings({}), provider: 'auto' as const, status: 'idle' as const }),
            sourceType: isReference ? 'reference_video' : 'script',
        };
        const storyboard = createNodeData(
            NodeType.STORYBOARD,
            directorX + step,
            topY,
            [director.id],
        );
        const batch = createNodeData(
            NodeType.FLOW_BATCH_VIDEO,
            directorX + step * 2,
            topY,
            [storyboard.id],
        );
        const merge = createNodeData(
            NodeType.VIDEO_MERGE,
            directorX + step * 3,
            topY,
            [batch.id],
        );

        const workflowNodes = [source, ...(scriptNode ? [scriptNode] : []), director, storyboard, batch, merge];

        setNodes(previous => [...previous, ...workflowNodes]);
        setSelectedNodeIds([director.id]);
        return {
            sourceId: source.id,
            scriptId: scriptNode?.id,
            directorId: director.id,
            storyboardId: storyboard.id,
            batchId: batch.id,
            mergeId: merge.id,
        };
    }, []);

    const addStickmanWorkflowFromParent = useCallback((parentNode: NodeData) => {
        const step = 520;
        const scriptNode = createNodeData(
            NodeType.SCRIPT_INPUT,
            parentNode.x + step,
            parentNode.y,
            [parentNode.id],
        );
        scriptNode.title = '视频分析剧本';
        scriptNode.scriptInput = {
            ...scriptNode.scriptInput!,
            title: '视频分析剧本',
            content: '',
            notes: '执行导演时先由视频分析生成剧本，再交给火柴人导演 Skill 重新推导分镜。',
        };
        const director = createNodeData(
            NodeType.STICKMAN_DIRECTOR,
            parentNode.x + step * 2,
            parentNode.y,
            [scriptNode.id],
        );
        director.director = {
            ...(director.director || { ...normalizeStickmanSettings({}), provider: 'auto' as const, status: 'idle' as const }),
            sourceType: 'reference_video',
        };
        const storyboard = createNodeData(
            NodeType.STORYBOARD,
            parentNode.x + step * 3,
            parentNode.y,
            [director.id],
        );
        const batch = createNodeData(
            NodeType.FLOW_BATCH_VIDEO,
            parentNode.x + step * 4,
            parentNode.y,
            [storyboard.id],
        );
        const merge = createNodeData(
            NodeType.VIDEO_MERGE,
            parentNode.x + step * 5,
            parentNode.y,
            [batch.id],
        );
        setNodes(previous => [...previous, scriptNode, director, storyboard, batch, merge]);
        setSelectedNodeIds([director.id]);
        return {
            scriptId: scriptNode.id,
            directorId: director.id,
            storyboardId: storyboard.id,
            batchId: batch.id,
            mergeId: merge.id,
        };
    }, []);

    /**
     * Creates the script-only cinematic workflow described in the product
     * plan. Shot generation lives in the storyboard node, so this graph has
     * exactly five nodes: script, cast, director, storyboard and merge.
     */
    const addCinematicWorkflow = useCallback((
        paneX: number,
        paneY: number,
        viewport: Viewport,
    ) => {
        const { x: anchorX, y: anchorY } = paneToCanvas(paneX, paneY, viewport);
        const halfWidth = DEFAULT_NODE_WIDTH / 2;
        const topY = anchorY - 100;
        const step = 520;
        const source = createNodeData(NodeType.SCRIPT_INPUT, anchorX - halfWidth, topY);
        source.title = '电影剧本输入';
        source.scriptInput = {
            ...source.scriptInput!,
            title: '电影短片剧本',
            content: '',
            notes: '导演会根据剧本重新编排镜头、角色动作、对白和摄影机语言。',
        };
        const cast = createNodeData(NodeType.CINEMATIC_CAST, anchorX - halfWidth, topY + 520);
        const director = createNodeData(
            NodeType.CINEMATIC_DIRECTOR,
            anchorX + step,
            topY,
            [source.id, cast.id],
        );
        const storyboard = createNodeData(
            NodeType.CINEMATIC_STORYBOARD,
            anchorX + step * 2,
            topY,
            [director.id],
        );
        const merge = createNodeData(
            NodeType.CINEMATIC_VIDEO_MERGE,
            anchorX + step * 3,
            topY,
            [storyboard.id],
        );
        setNodes(previous => [...previous, source, cast, director, storyboard, merge]);
        setSelectedNodeIds([director.id]);
        return {
            sourceId: source.id,
            castId: cast.id,
            directorId: director.id,
            storyboardId: storyboard.id,
            mergeId: merge.id,
        };
    }, []);

    /**
     * Updates a node with partial data
     * @param id - Node ID to update
     * @param updates - Partial node data to merge
     */
    // 必须是稳定引用：useGenerationRecovery 把它放进 useEffect 依赖里，每次渲染都换一个
    // 新函数的话，那个「补回缺失结果节点」的 effect 会每帧都跑一遍 —— 既在持续打后端
    // 接口，也会把用户刚删掉的结果节点立刻重建出来。
    const updateNode = useCallback((id: string, updates: Partial<NodeData>) => {
        setNodes(prev => prev.map(n => n.id === id ? { ...n, ...updates } : n));
    }, []);

    /**
     * Deletes a node by ID
     * @param id - Node ID to delete
     */
    const deleteNode = (id: string) => {
        setNodes(prev => prev.filter(n => n.id !== id));
        setSelectedNodeIds(prev => prev.filter(nodeId => nodeId !== id));
    };

    /**
     * Deletes multiple nodes by IDs
     * @param ids - Array of node IDs to delete
     */
    const deleteNodes = (ids: string[]) => {
        setNodes(prev => prev.filter(n => !ids.includes(n.id)));
        setSelectedNodeIds([]);
    };

    /**
     * Clears all node selections
     */
    const clearSelection = () => {
        setSelectedNodeIds([]);
    };

    /**
     * Handles node type selection from context menu
     * Creates new node or deletes existing node
     */
    const handleSelectTypeFromMenu = (
        type: NodeType | 'DELETE',
        contextMenu: any,
        viewport: Viewport,
        onCloseMenu: () => void
    ) => {
        // Handle Delete Action
        if (type === 'DELETE') {
            if (contextMenu.sourceNodeId) {
                deleteNode(contextMenu.sourceNodeId);
            }
            onCloseMenu();
            return;
        }

        if (type === NodeType.VIDEO_REMIX) {
            onCloseMenu();
            return;
        }

        if (contextMenu.type === 'node-connector' && contextMenu.sourceNodeId) {
            const sourceNode = nodes.find(n => n.id === contextMenu.sourceNodeId);
            if (sourceNode) {
                const direction = contextMenu.connectorSide || 'right';
                const GAP = 100;
                const NODE_WIDTH = 340;

                let newNode: NodeData;

                if (direction === 'right') {
                    // Append: Source -> New
                    newNode = createNodeData(
                        type,
                        sourceNode.x + NODE_WIDTH + GAP,
                        sourceNode.y,
                        contextMenu.sourceNodeId ? [contextMenu.sourceNodeId] : [],
                    );
                } else {
                    // Prepend: New -> Source
                    newNode = createNodeData(type, sourceNode.x - NODE_WIDTH - GAP, sourceNode.y);
                    // Update source to add new node as parent
                    const existingParentIds = sourceNode.parentIds || [];
                    updateNode(contextMenu.sourceNodeId, { parentIds: [...existingParentIds, newNode.id] });
                }

                if (type === NodeType.VIDEO_ANALYSIS) {
                    if (sourceNode) {
                        const mapped = assignVideoAnalysisInputPort(newNode, sourceNode);
                        newNode = mapped;
                    }
                }

                setNodes(prev => [...prev, newNode]);
                setSelectedNodeIds([newNode.id]);
            }
        } else {
            // Global menu - add at click position
            addNode(
                type,
                contextMenu.canvasX ?? contextMenu.x,
                contextMenu.canvasY ?? contextMenu.y,
                undefined,
                viewport
            );
        }

        onCloseMenu();
    };

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        nodes,
        setNodes,
        selectedNodeIds,
        setSelectedNodeIds,
        addNode,
        addStickmanWorkflow,
        addStickmanWorkflowFromParent,
        addCinematicWorkflow,
        updateNode,
        deleteNode,
        deleteNodes,
        clearSelection,
        handleSelectTypeFromMenu
    };
};
