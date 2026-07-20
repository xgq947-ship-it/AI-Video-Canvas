/**
 * App.tsx
 * 
 * Main application component for Evan.
 * Orchestrates canvas, nodes, connections, and user interactions.
 * Uses custom hooks for state management and logic separation.
 */

import React, { useState, useEffect, useRef } from 'react';
import { TopBar } from './components/TopBar';
import { COLLAPSED_SIDEBAR_WIDTH, EXPANDED_SIDEBAR_WIDTH, ProjectSidebar, type SidebarAssetPreview } from './components/ProjectSidebar';
import { CanvasNode } from './components/canvas/CanvasNode';
import { ConnectionsLayer } from './components/canvas/ConnectionsLayer';
import { ContextMenu } from './components/ContextMenu';
import { ContextMenuState, NodeData, NodeStatus, NodeType } from './types';
import { generateImage, generateVideo } from './services/generationService';
import { useCanvasNavigation } from './hooks/useCanvasNavigation';
import { useNodeManagement } from './hooks/useNodeManagement';
import { useConnectionDragging } from './hooks/useConnectionDragging';
import { useNodeDragging } from './hooks/useNodeDragging';
import { useGeneration } from './hooks/useGeneration';
import { useSelectionBox } from './hooks/useSelectionBox';
import { useGroupManagement } from './hooks/useGroupManagement';
import { useHistory } from './hooks/useHistory';
import { useCanvasTitle } from './hooks/useCanvasTitle';
import { useWorkflow } from './hooks/useWorkflow';
import { useImageEditor } from './hooks/useImageEditor';
import { useVideoEditor } from './hooks/useVideoEditor';
import { usePanelState } from './hooks/usePanelState';
import { useAssetHandlers } from './hooks/useAssetHandlers';
import { useTextNodeHandlers } from './hooks/useTextNodeHandlers';
import { useImageNodeHandlers } from './hooks/useImageNodeHandlers';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useContextMenuHandlers } from './hooks/useContextMenuHandlers';
import { useAutoSave } from './hooks/useAutoSave';
import { useGenerationRecovery } from './hooks/useGenerationRecovery';
import { useVideoFrameExtraction } from './hooks/useVideoFrameExtraction';
import { extractVideoLastFrame } from './utils/videoHelpers';
import { SelectionBoundingBox } from './components/canvas/SelectionBoundingBox';
import { WorkflowPanel } from './components/WorkflowPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { ImageEditorModal } from './components/modals/ImageEditorModal';
import { VideoEditorModal } from './components/modals/VideoEditorModal';
import { ExpandedMediaModal } from './components/modals/ExpandedMediaModal';
import { CreateAssetModal } from './components/modals/CreateAssetModal';
import { TikTokImportModal } from './components/modals/TikTokImportModal';
import { AssetLibraryPanel, type LibraryAsset } from './components/AssetLibraryPanel';
import { useTikTokImport } from './hooks/useTikTokImport';
import { useStoryboardGenerator } from './hooks/useStoryboardGenerator';
import { StoryboardGeneratorModal } from './components/modals/StoryboardGeneratorModal';
import { StoryboardVideoModal } from './components/modals/StoryboardVideoModal';
import { isValidNodeConnection } from '@/shared/connectionRules.js';
import { canvasViewCenter, centerNodeAt, computeFitViewport, screenToCanvas, DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '@/shared/canvasCoords.js';
import { ZOOM_MIN, ZOOM_MAX } from '@/shared/zoom.js';
import { getCanvasRect } from './utils/canvasRect';
import { MapPinned } from 'lucide-react';
import { CanvasMinimap } from './components/canvas/CanvasMinimap';
import { CanvasZoomControl } from './components/canvas/CanvasZoomControl';
import { collectNodeReferences } from './utils/nodeReferences.js';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

// Helper to convert URL/Blob to Base64
const urlToBase64 = async (url: string): Promise<string> => {
  if (url.startsWith('data:image')) return url;

  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error("Error converting URL to base64:", e);
    return "";
  }
};

export default function App() {
  // ============================================================================
  // STATE
  // ============================================================================

  const [hasApiKey] = useState(true); // Backend handles API key
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    type: 'global'
  });

  const [canvasTheme, setCanvasTheme] = useState<'dark' | 'light'>('dark');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarAssetPreview, setSidebarAssetPreview] = useState<(SidebarAssetPreview & { panelY: number }) | null>(null);
  const [isMinimapOpen, setIsMinimapOpen] = useState(false);

  // Panel state management (history, asset library, expand)
  const {
    isHistoryPanelOpen,
    historyPanelY,
    handleHistoryClick: panelHistoryClick,
    openHistoryPanel,
    closeHistoryPanel,
    expandedImageUrl,
    handleExpandImage,
    handleCloseExpand,
    isAssetLibraryOpen,
    assetLibraryY,
    assetLibraryVariant,
    handleAssetsClick: panelAssetsClick,
    closeAssetLibrary,
    openAssetLibraryModal
  } = usePanelState();

  const [canvasHoveredNodeId, setCanvasHoveredNodeId] = useState<string | null>(null);


  // Canvas title state (via hook)
  const {
    canvasTitle,
    setCanvasTitle,
    isEditingTitle,
    setIsEditingTitle,
    editingTitleValue,
    setEditingTitleValue,
    canvasTitleInputRef
  } = useCanvasTitle();

  const {
    viewport,
    setViewport,
    canvasRef,
    handleWheel: baseHandleWheel
  } = useCanvasNavigation();

  // Wrap handleWheel to pass hovered node for zoom-to-center
  const handleWheel = (e: React.WheelEvent) => {
    const hoveredNode = canvasHoveredNodeId ? nodes.find(n => n.id === canvasHoveredNodeId) : undefined;
    baseHandleWheel(e, hoveredNode);
  };

  const {
    nodes,
    setNodes,
    selectedNodeIds,
    setSelectedNodeIds,
    addNode,
    updateNode,
    deleteNode,
    deleteNodes,
    clearSelection,
    handleSelectTypeFromMenu
  } = useNodeManagement();

  const {
    isDraggingConnection,
    connectionStart,
    tempConnectionEnd,
    hoveredNodeId: connectionHoveredNodeId,
    selectedConnection,
    setSelectedConnection,
    handleConnectorPointerDown,
    updateConnectionDrag,
    completeConnectionDrag,
    handleEdgeClick,
    deleteSelectedConnection
  } = useConnectionDragging();

  const {
    handleNodePointerDown,
    updateNodeDrag,
    endNodeDrag,
    startPanning,
    updatePanning,
    endPanning,
    isDragging,
    releasePointerCapture
  } = useNodeDragging();

  const {
    selectionBox,
    isSelecting,
    startSelection,
    updateSelection,
    endSelection,
    clearSelectionBox
  } = useSelectionBox();

  const {
    groups,
    setGroups, // For workflow loading
    groupNodes,
    ungroupNodes,
    cleanupInvalidGroups,
    getCommonGroup,
    sortGroupNodes,
    renameGroup
  } = useGroupManagement();

  // History for undo/redo
  const {
    present: historyState,
    undo,
    redo,
    pushHistory,
    canUndo,
    canRedo
  } = useHistory({ nodes, groups }, 50);

  // Mark as dirty when nodes or title change
  const isInitialMount = React.useRef(true);
  const lastLoadingCountRef = React.useRef(0);
  const ignoreNextChange = React.useRef(false);

  // Workflow management
  const {
    workflowId,
    isWorkflowPanelOpen,
    workflowPanelY,
    handleSaveWorkflow,
    handleLoadWorkflow,
    handleWorkflowsClick,
    closeWorkflowPanel,
    resetWorkflowId
  } = useWorkflow({
    nodes,
    groups,
    viewport,
    canvasTitle,
    setNodes,
    setGroups,
    setViewport,
    setSelectedNodeIds,
    setCanvasTitle,
    setEditingTitleValue,
    ignoreNextChangeRef: ignoreNextChange,
    onPanelOpen: () => {
      closeHistoryPanel();
      closeAssetLibrary();
    }
  });

  // Simple dirty flag for unsaved changes tracking
  const [isDirty, setIsDirty] = React.useState(false);
  const hasUnsavedChanges = isDirty && nodes.length > 0;

  React.useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    if (ignoreNextChange.current) {
      ignoreNextChange.current = false;
      return;
    }

    setIsDirty(true);

    // Trigger immediate save if any node JUST entered LOADING state
    const currentLoadingCount = nodes.filter(n => n.status === NodeStatus.LOADING).length;
    if (currentLoadingCount > lastLoadingCountRef.current) {
      console.log('[App] New loading node detected, triggering immediate save for recovery protection');
      handleSaveWithTracking();
    }
    lastLoadingCountRef.current = currentLoadingCount;
  }, [nodes, canvasTitle]);

  // Update saved state after workflow save
  const handleSaveWithTracking = async () => {
    await handleSaveWorkflow();
    setIsDirty(false);
  };

  // Load workflow and update tracking
  const handleLoadWithTracking = async (id: string) => {
    ignoreNextChange.current = true;
    await handleLoadWorkflow(id);
    setIsDirty(false);
  };

  const nodesRef = React.useRef(nodes);
  React.useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const { handleGenerate: handleGenerateNow } = useGeneration({
    nodes,
    updateNode
  });

  // Keep the low-level generator current. Dependency orchestration below always
  // calls the latest render so completed parent outputs become real references.
  const handleGenerateNowRef = React.useRef(handleGenerateNow);
  React.useEffect(() => {
    handleGenerateNowRef.current = handleGenerateNow;
  }, [handleGenerateNow]);

  const generationPromisesRef = React.useRef(new Map<string, Promise<NodeData>>());

  const waitForNodeResult = React.useCallback((
    nodeId: string,
    before?: Pick<NodeData, 'status' | 'resultUrl' | 'codexJobId' | 'generationStartTime'>
  ): Promise<NodeData> => new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let observedNewAttempt = !before;

    const timer = window.setInterval(() => {
      const current = nodesRef.current.find(node => node.id === nodeId);
      if (!current) {
        window.clearInterval(timer);
        reject(new Error('等待生成时节点已被删除'));
        return;
      }

      if (before && (
        current.status === NodeStatus.LOADING ||
        current.resultUrl !== before.resultUrl ||
        current.codexJobId !== before.codexJobId ||
        current.generationStartTime !== before.generationStartTime
      )) {
        observedNewAttempt = true;
      }

      if (observedNewAttempt && current.status === NodeStatus.ERROR) {
        window.clearInterval(timer);
        reject(new Error(current.errorMessage || '上游节点生成失败'));
        return;
      }

      if (
        observedNewAttempt &&
        current.status !== NodeStatus.LOADING &&
        current.errorMessage
      ) {
        window.clearInterval(timer);
        reject(new Error(current.errorMessage));
        return;
      }

      if (
        observedNewAttempt &&
        current.status === NodeStatus.SUCCESS &&
        current.resultUrl &&
        (!before || current.resultUrl !== before.resultUrl || current.codexJobId !== before.codexJobId)
      ) {
        window.clearInterval(timer);
        resolve(current);
        return;
      }

      if (Date.now() - startedAt > 60 * 60 * 1000) {
        window.clearInterval(timer);
        reject(new Error('等待上游节点超时，请检查图片生成队列'));
      }
    }, 300);
  }), []);

  const runNodeWithDependencies = React.useCallback(async function runNodeWithDependencies(
    nodeId: string,
    ancestry: string[] = []
  ): Promise<NodeData> {
    if (ancestry.includes(nodeId)) {
      throw new Error('节点连线存在循环，无法执行工作流');
    }

    const existing = generationPromisesRef.current.get(nodeId);
    if (existing) return existing;

    const task = (async () => {
      let current = nodesRef.current.find(node => node.id === nodeId);
      if (!current) throw new Error('找不到需要生成的节点');

      const parentIds = (current.parentIds || []).filter(parentId => {
        const parent = nodesRef.current.find(node => node.id === parentId);
        return parent && parent.type !== NodeType.TEXT;
      });

      for (const parentId of parentIds) {
        const parent = nodesRef.current.find(node => node.id === parentId);
        if (!parent) continue;

        if (parent.status === NodeStatus.LOADING) {
          await waitForNodeResult(parentId);
        } else if (parent.status !== NodeStatus.SUCCESS || !parent.resultUrl) {
          await runNodeWithDependencies(parentId, [...ancestry, nodeId]);
        }
      }

      current = nodesRef.current.find(node => node.id === nodeId);
      if (!current) throw new Error('生成前节点已被删除');

      if (current.status === NodeStatus.LOADING) {
        return waitForNodeResult(nodeId);
      }

      const before = {
        status: current.status,
        resultUrl: current.resultUrl,
        codexJobId: current.codexJobId,
        generationStartTime: current.generationStartTime
      };

      await handleGenerateNowRef.current(nodeId);
      return waitForNodeResult(nodeId, before);
    })();

    generationPromisesRef.current.set(nodeId, task);
    try {
      return await task;
    } finally {
      if (generationPromisesRef.current.get(nodeId) === task) {
        generationPromisesRef.current.delete(nodeId);
      }
    }
  }, [waitForNodeResult]);

  const handleGenerate = React.useCallback(async (nodeId: string) => {
    try {
      await runNodeWithDependencies(nodeId);
    } catch (error: any) {
      console.error('[Workflow Generation]', error);
      window.alert(error?.message || '工作流生成失败');
    }
  }, [runNodeWithDependencies]);

  // All node-generation entry points use the dependency-aware wrapper.
  const handleGenerateRef = React.useRef(handleGenerate);
  React.useEffect(() => {
    handleGenerateRef.current = handleGenerate;
  }, [handleGenerate]);

  // Create new canvas
  const handleNewCanvas = () => {
    ignoreNextChange.current = true;
    setNodes([]);
    setGroups([]); // Reset groups for new canvas
    setSelectedNodeIds([]);
    setCanvasTitle('未命名项目');
    setEditingTitleValue('未命名项目');
    resetWorkflowId(); // Important: ensures new workflow gets a new ID
    setViewport({ x: 0, y: 0, zoom: 1 });
    setIsDirty(false);
  };

  const handleDeleteCurrentProject = React.useCallback(async () => {
    if (!workflowId) return;
    if (!window.confirm(`确定删除“${canvasTitle}”吗？此操作无法撤销。`)) return;
    try {
      const response = await fetch(`/api/workflows/${workflowId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('删除项目失败');
      handleNewCanvas();
    } catch (error) {
      console.error('Failed to delete current workflow:', error);
      window.alert('项目删除失败，请稍后重试。');
    }
  }, [workflowId, canvasTitle]);

  /**
   * 给新手一次性搭好完整的 0-1 漫剧骨架。
   * 所有原子节点仍可单独增删，模板只负责减少重复搭建。
   */
  const handleCreateMangaWorkflow = React.useCallback(() => {
    const storyId = crypto.randomUUID();
    const imageId = crypto.randomUUID();
    const videoId = crypto.randomUUID();
    const audioId = crypto.randomUUID();
    const sfxId = crypto.randomUUID();
    const bgmId = crypto.randomUUID();
    const subtitleId = crypto.randomUUID();
    const renderId = crypto.randomUUID();

    const base = {
      prompt: '',
      status: NodeStatus.IDLE,
      model: 'Banana Pro',
      aspectRatio: '16:9',
      resolution: 'Auto',
    };

    const workflowNodes: NodeData[] = [
      { ...base, id: storyId, type: NodeType.TEXT, title: '1. 故事与剧本', x: 0, y: 0, parentIds: [] },
      { ...base, id: imageId, type: NodeType.IMAGE, title: '2. 关键帧图片', x: 420, y: 0, parentIds: [storyId], resolution: '1K' },
      { ...base, id: videoId, type: NodeType.VIDEO, title: '3. 镜头视频', x: 840, y: 0, parentIds: [imageId], videoDuration: 5 },
      {
        ...base,
        id: renderId,
        type: NodeType.RENDER,
        title: '8. 输出成片',
        x: 1260,
        y: 0,
        parentIds: [videoId, audioId, sfxId, bgmId, subtitleId],
        compWidth: 1280,
        compHeight: 720,
        compFps: 24,
      },
      {
        ...base,
        id: audioId,
        type: NodeType.AUDIO,
        title: '4. 角色配音',
        x: 0,
        y: 440,
        parentIds: [storyId],
        speaker: '林默',
        ttsProvider: 'minimax',
        voiceId: 'yuanboxiaoshu',
        voiceSpeed: 1,
        audioVolume: 1,
      },
      { ...base, id: sfxId, type: NodeType.SFX, title: '5. 音效', x: 360, y: 440, parentIds: [], audioVolume: 0.9 },
      { ...base, id: bgmId, type: NodeType.BGM, title: '6. 背景音乐', x: 720, y: 440, parentIds: [], audioVolume: 0.15, fadeIn: 1, fadeOut: 1, ducking: true },
      { ...base, id: subtitleId, type: NodeType.SUBTITLE, title: '7. 字幕', x: 1080, y: 440, parentIds: [storyId], timelineStart: 0, timelineEnd: 3 },
    ];

    ignoreNextChange.current = true;
    setNodes(workflowNodes);
    setGroups([]);
    setSelectedNodeIds([]);
    setCanvasTitle('AI漫剧新项目');
    setEditingTitleValue('AI漫剧新项目');
    resetWorkflowId();
    setViewport({ x: 90, y: 82, zoom: 0.62 });
    setIsDirty(true);
    setContextMenu(prev => ({ ...prev, isOpen: false }));
  }, [resetWorkflowId, setEditingTitleValue, setGroups, setNodes, setSelectedNodeIds, setViewport]);

  // Image editor modal
  const {
    editorModal,
    handleOpenImageEditor,
    handleCloseImageEditor,
    handleUpload
  } = useImageEditor({ nodes, updateNode });

  // Video editor modal
  const {
    videoEditorModal,
    handleOpenVideoEditor,
    handleCloseVideoEditor,
    handleExportTrimmedVideo
  } = useVideoEditor({ nodes, updateNode });

  /**
   * Routes editor open to the correct handler based on node type
   */
  const handleOpenEditor = React.useCallback((nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    if (node.type === NodeType.VIDEO_EDITOR) {
      handleOpenVideoEditor(nodeId);
    } else {
      handleOpenImageEditor(nodeId);
    }
  }, [nodes, handleOpenVideoEditor, handleOpenImageEditor]);

  // Text node handlers
  const {
    handleWriteContent,
    handleTextToVideo,
    handleTextToImage
  } = useTextNodeHandlers({ nodes, updateNode, setNodes, setSelectedNodeIds });

  // Image node handlers
  const {
    handleImageToImage,
    handleImageToVideo,
    handleChangeAngleGenerate
  } = useImageNodeHandlers({ nodes, setNodes, setSelectedNodeIds, onGenerateNode: handleGenerate });

  // Asset handlers (create asset modal)
  const {
    isCreateAssetModalOpen,
    setIsCreateAssetModalOpen,
    nodeToSnapshot,
    handleOpenCreateAsset,
    handleSaveAssetToLibrary,
    handleContextUpload
  } = useAssetHandlers({ nodes, viewport, contextMenu, setNodes });

  // Keyboard shortcuts (copy/paste/delete/undo/redo)
  const groupSelected = React.useCallback(() => {
    if (selectedNodeIds.length >= 2) groupNodes(selectedNodeIds, setNodes);
  }, [selectedNodeIds, groupNodes, setNodes]);

  const ungroupSelected = React.useCallback(() => {
    const groupIds = [...new Set(nodes
      .filter(node => selectedNodeIds.includes(node.id) && node.groupId)
      .map(node => node.groupId!))];
    groupIds.forEach(groupId => ungroupNodes(groupId, setNodes));
  }, [nodes, selectedNodeIds, ungroupNodes, setNodes]);

  const connectSelected = React.useCallback(() => {
    if (selectedNodeIds.length < 2) return;
    const ordered = nodes
      .filter(node => selectedNodeIds.includes(node.id))
      .sort((a, b) => a.x - b.x || a.y - b.y);
    setNodes(prev => prev.map(node => {
      const childIndex = ordered.findIndex(item => item.id === node.id);
      if (childIndex <= 0) return node;
      const parent = ordered[childIndex - 1];
      if (!isValidNodeConnection(parent.type, node.type)) return node;
      const parentIds = node.parentIds || [];
      return parentIds.includes(parent.id)
        ? node
        : { ...node, parentIds: [...parentIds, parent.id] };
    }));
  }, [nodes, selectedNodeIds, setNodes]);

  const generateSelected = React.useCallback(async () => {
    const generatableTypes = new Set([
      NodeType.IMAGE,
      NodeType.IMAGE_EDITOR,
      NodeType.LOCAL_IMAGE_MODEL,
      NodeType.VIDEO
    ]);
    const selected = nodes.filter(node =>
      selectedNodeIds.includes(node.id) &&
      generatableTypes.has(node.type)
    );
    if (selected.length === 0) return;

    await Promise.all(selected.map(node => handleGenerateRef.current(node.id)));
  }, [nodes, selectedNodeIds]);

  const openNewNodeMenu = React.useCallback(() => {
    const sidebarWidth = sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : EXPANDED_SIDEBAR_WIDTH;
    const canvasCenterX = (window.innerWidth - sidebarWidth) / 2;
    setContextMenu({
      isOpen: true,
      x: sidebarWidth + canvasCenterX,
      y: window.innerHeight / 2,
      canvasX: canvasCenterX,
      canvasY: window.innerHeight / 2,
      type: 'add-nodes'
    });
  }, [sidebarCollapsed]);

  const arrangeCanvas = React.useCallback(() => {
    const ids = selectedNodeIds.length > 1 ? selectedNodeIds : nodes.map(node => node.id);
    if (ids.length < 2) return;
    const ordered = nodes
      .filter(node => ids.includes(node.id))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const columns = Math.max(1, Math.ceil(Math.sqrt(ordered.length)));
    const startX = Math.min(...ordered.map(node => node.x));
    const startY = Math.min(...ordered.map(node => node.y));
    const positions = new Map(ordered.map((node, index) => [node.id, {
      x: startX + (index % columns) * 440,
      y: startY + Math.floor(index / columns) * 520
    }]));
    setNodes(prev => prev.map(node => positions.has(node.id) ? { ...node, ...positions.get(node.id)! } : node));
  }, [nodes, selectedNodeIds, setNodes]);

  /**
   * 侧边栏点击「画布元素」→ 跳转到该节点：居中并缩放到刚好铺满画布可视区。
   * 节点实际渲染宽高并不统一（文本/待生成 365、视频 385、出图后的图片节点 auto 随比例变），
   * 所以不用猜测常量，而是直接量测该节点当前的真实 DOM 尺寸（CanvasNode 各分支已标注
   * data-node-id），再按当前 zoom 换算回世界坐标尺寸，交给 computeFitViewport 算出目标视口。
   */
  const locateNodeFromSidebar = React.useCallback((id: string) => {
    const node = nodes.find(item => item.id === id);
    if (!node) return;
    setSelectedNodeIds([id]);

    const rect = getCanvasRect();
    const nodeEl = document.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
    const box = nodeEl
      ? (() => {
        const domRect = nodeEl.getBoundingClientRect();
        return {
          x: node.x,
          y: node.y,
          width: domRect.width / viewport.zoom,
          height: domRect.height / viewport.zoom,
        };
      })()
      : { x: node.x, y: node.y, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT }; // 节点尚未渲染时的兜底

    setViewport(prev => ({
      ...prev,
      ...computeFitViewport(rect, box, { minZoom: ZOOM_MIN, maxZoom: ZOOM_MAX }),
    }));
  }, [nodes, viewport.zoom, setSelectedNodeIds, setViewport]);

  const {
    handleCopy,
    handlePaste,
    handleDuplicate,
    isSpacePressedRef
  } = useKeyboardShortcuts({
    nodes,
    selectedNodeIds,
    selectedConnection,
    setNodes,
    setSelectedNodeIds,
    setContextMenu,
    deleteNodes,
    deleteSelectedConnection,
    clearSelection,
    clearSelectionBox,
    undo,
    redo,
    groupSelected,
    ungroupSelected,
    connectSelected,
    generateSelected,
    openNewNodeMenu,
    arrangeCanvas,
    setViewport
  });

  // Auto-Save Management
  const { lastSaveTime: lastAutoSaveTime } = useAutoSave({
    isDirty,
    nodes,
    onSave: handleSaveWithTracking,
    interval: 60000 // Save every 60 seconds
  });

  // Generation Recovery Management
  useGenerationRecovery({
    nodes,
    updateNode
  });

  // Video Frame Extraction (auto-extract lastFrame for videos missing thumbnails)
  useVideoFrameExtraction({
    nodes,
    updateNode
  });

  // TikTok Import Tool
  const {
    isModalOpen: isTikTokModalOpen,
    openModal: openTikTokModal,
    closeModal: closeTikTokModal,
    handleVideoImported: handleTikTokVideoImported
  } = useTikTokImport({
    nodes,
    setNodes,
    setSelectedNodeIds,
    viewport
  });

  // Storyboard Generator Tool
  const handleCreateStoryboardNodes = React.useCallback((
    newNodeData: Partial<NodeData>[],
    groupInfo?: { groupId: string; groupLabel: string }
  ) => {
    console.log('[Storyboard] handleCreateStoryboardNodes called with', newNodeData.length, 'nodes, groupInfo:', !!groupInfo);
    const newNodes: NodeData[] = newNodeData.map(data => ({
      id: data.id || crypto.randomUUID(),
      type: data.type || NodeType.IMAGE,
      x: data.x || 0,
      y: data.y || 0,
      prompt: data.prompt || '',
      status: data.status || NodeStatus.IDLE,
      model: data.model || 'codex-imagegen',
      imageModel: data.imageModel,
      aspectRatio: data.aspectRatio || '16:9',
      resolution: data.resolution || '1K',
      title: data.title,
      parentIds: data.parentIds || [],
      groupId: data.groupId,
      characterReferenceUrls: data.characterReferenceUrls
    }));

    setNodes(prev => [...prev, ...newNodes]);

    // Auto-group the storyboard nodes
    if (groupInfo && newNodes.length > 0) {
      const newGroup = {
        id: groupInfo.groupId,
        nodeIds: newNodes.map(n => n.id),
        label: groupInfo.groupLabel,
        // Save story context if available to help AI understand the full narrative later
        storyContext: (groupInfo as any).storyContext
      };
      setGroups(prev => [...prev, newGroup]);
    }

    if (newNodes.length > 0) {
      setSelectedNodeIds(newNodes.map(n => n.id));
    }

    // Auto-trigger generation for each storyboard node with a small delay
    // to ensure state is updated before generation starts
    if (groupInfo) {
      setTimeout(() => {
        console.log('[Storyboard] Auto-triggering generation for', newNodes.length, 'nodes');
        newNodes.forEach((node, index) => {
          // Stagger generation calls slightly to avoid overwhelming the API
          setTimeout(() => {
            console.log(`[Storyboard] Starting generation for node ${index + 1}:`, node.id);
            // Use ref to get the latest handleGenerate function
            handleGenerateRef.current(node.id);
          }, index * 500); // 500ms delay between each node
        });
      }, 100); // Initial delay to let state settle
    }
  }, [setNodes, setSelectedNodeIds, setGroups]);

  const storyboardGenerator = useStoryboardGenerator({
    onCreateNodes: handleCreateStoryboardNodes,
    viewport
  });

  const handleEditStoryboard = React.useCallback((groupId: string) => {
    const group = groups.find(g => g.id === groupId);
    if (group?.storyContext) {
      console.log('[App] Editing storyboard:', groupId);
      storyboardGenerator.editStoryboard(group.storyContext);
    }
  }, [groups, storyboardGenerator]);

  // Storyboard Video Modal State
  const [storyboardVideoModal, setStoryboardVideoModal] = useState<{
    isOpen: boolean;
    nodes: NodeData[];
    storyContext?: { story: string; scripts: any[] };
  }>({ isOpen: false, nodes: [] });

  const handleCreateStoryboardVideo = React.useCallback((targetNodeIds?: string[]) => {
    // Determine which nodes to use: explicit list or current selection
    const nodeIdsToCheck = targetNodeIds || selectedNodeIds;

    // Filter for Image nodes only (can't make video from text/video directly in this flow)
    const selectedImageNodes = nodes.filter(n => nodeIdsToCheck.includes(n.id) && n.type === NodeType.IMAGE);

    if (selectedImageNodes.length === 0) {
      console.warn("No image nodes selected for video generation. Checked IDs:", nodeIdsToCheck);
      return;
    }

    // Check if nodes belong to a group with story context
    const firstNode = selectedImageNodes[0];
    const group = firstNode.groupId ? groups.find(g => g.id === firstNode.groupId) : undefined;
    const storyContext = group?.storyContext;

    if (storyContext) {
      console.log('[App] Found Story Context for Video Modal:', {
        storyLength: storyContext.story.length,
        scriptsCount: storyContext.scripts.length
      });
    }

    setStoryboardVideoModal({
      isOpen: true,
      nodes: selectedImageNodes,
      storyContext
    });
  }, [nodes, selectedNodeIds, groups]);

  const handleGenerateStoryVideos = React.useCallback((
    prompts: Record<string, string>,
    settings: { model: string; duration: number; resolution: string; },
    activeNodeIds?: string[]
  ) => {
    // Close modal
    setStoryboardVideoModal(prev => ({ ...prev, isOpen: false }));

    const newNodes: NodeData[] = [];
    // Use activeNodeIds to filter source nodes if provided, otherwise use all
    const sourceNodes = activeNodeIds
      ? storyboardVideoModal.nodes.filter(n => activeNodeIds.includes(n.id))
      : storyboardVideoModal.nodes;

    // Calculate layout bounds of the ENTIRE storyboard to position videos to the RIGHT
    // Use all storyboard nodes to properly calculate the bounding box
    const allStoryboardNodes = storyboardVideoModal.nodes;

    // Assume a default width if not present (though images usually have it)
    const DEFAULT_WIDTH = 400;

    // Find the rightmost edge of the entire group
    const groupMaxX = Math.max(...allStoryboardNodes.map(n => n.x + ((n as any).width || DEFAULT_WIDTH)));

    // Calculate the left edge of the group to maintain relative offsets
    const groupMinX = Math.min(...allStoryboardNodes.map(n => n.x));

    // Shift Amount: Move everything to the right of the group with a gap
    const GAP_X = 100;
    const xOffset = groupMaxX + GAP_X - groupMinX;

    sourceNodes.forEach((sourceNode) => {
      // Create a new Video node for each image
      const newNodeId = crypto.randomUUID();
      const PROMPT = prompts[sourceNode.id] || sourceNode.prompt || 'Animated video';

      const newVideoNode: NodeData = {
        id: newNodeId,
        type: NodeType.VIDEO,
        // Clone the layout pattern but shifted to the right
        x: sourceNode.x + xOffset,
        y: sourceNode.y,
        prompt: PROMPT,
        status: NodeStatus.IDLE, // Will switch to LOADING when generated
        model: settings.model,
        videoModel: settings.model, // Explicitly set video model
        videoDuration: settings.duration,
        aspectRatio: sourceNode.aspectRatio || '16:9',
        resolution: settings.resolution,
        parentIds: [sourceNode.id], // Connect to source image
        // groupId: undefined, // Explicitly NOT in the group
        videoMode: 'frame-to-frame', // Important for image-to-video
        inputUrl: sourceNode.resultUrl, // Pass image as input
      };

      newNodes.push(newVideoNode);
    });

    // added new nodes to state
    setNodes(prev => [...prev, ...newNodes]);

    // Auto-trigger generation (staggered)
    setTimeout(() => {
      newNodes.forEach((node, index) => {
        setTimeout(() => {
          handleGenerateRef.current(node.id);
        }, index * 1000); // 1s delay between each to avoid rate limits
      });
    }, 500);

  }, [storyboardVideoModal.nodes, setNodes]);

  // Context menu handlers
  const {
    handleDoubleClick,
    handleGlobalContextMenu,
    handleAddNext,
    handleNodeContextMenu,
    handleContextMenuCreateAsset,
    handleContextMenuSelect,
    handleToolbarAdd
  } = useContextMenuHandlers({
    nodes,
    viewport,
    contextMenu,
    setContextMenu,
    handleOpenCreateAsset,
    handleSelectTypeFromMenu
  });

  // Wrapper functions that pass closeWorkflowPanel to panel handlers
  const handleHistoryClick = (e: React.MouseEvent) => {
    panelHistoryClick(e, closeWorkflowPanel);
  };

  const handleAssetsClick = (e: React.MouseEvent) => {
    setSidebarAssetPreview(null);
    panelAssetsClick(e, closeWorkflowPanel);
  };

  const handleContextMenuAddAssets = () => {
    setSidebarAssetPreview(null);
    openAssetLibraryModal(contextMenu.y, closeWorkflowPanel);
  };

  const handleContextMenuOpenHistory = () => {
    setSidebarAssetPreview(null);
    openHistoryPanel(contextMenu.y, closeWorkflowPanel);
  };

  const handleSidebarAssetPreview = (asset: SidebarAssetPreview, e: React.MouseEvent<HTMLElement>) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setSidebarAssetPreview({ ...asset, panelY: rect.top });
    closeAssetLibrary();
    closeHistoryPanel();
    closeWorkflowPanel();
  };

  /**
   * Convert pixel dimensions to closest standard aspect ratio
   */
  const getClosestAspectRatio = (width: number, height: number): string => {
    const ratio = width / height;
    const standardRatios = [
      { label: '1:1', value: 1 },
      { label: '16:9', value: 16 / 9 },
      { label: '9:16', value: 9 / 16 },
      { label: '4:3', value: 4 / 3 },
      { label: '3:4', value: 3 / 4 },
      { label: '3:2', value: 3 / 2 },
      { label: '2:3', value: 2 / 3 },
      { label: '5:4', value: 5 / 4 },
      { label: '4:5', value: 4 / 5 },
      { label: '21:9', value: 21 / 9 }
    ];

    let closest = standardRatios[0];
    let minDiff = Math.abs(ratio - closest.value);

    for (const r of standardRatios) {
      const diff = Math.abs(ratio - r.value);
      if (diff < minDiff) {
        minDiff = diff;
        closest = r;
      }
    }

    return closest.label;
  };

  /**
   * Convert pixel dimensions to closest video aspect ratio (only 16:9 or 9:16)
   */
  const getClosestVideoAspectRatio = (width: number, height: number): string => {
    const ratio = width / height;
    // Video models only support 16:9 (1.78) and 9:16 (0.56)
    // If wider than 1:1 (ratio > 1), use 16:9; otherwise use 9:16
    return ratio >= 1 ? '16:9' : '9:16';
  };

  /**
   * Handle selecting an asset from history - creates new node with the image/video
   */
  const handleSelectAsset = (
    type: 'images' | 'videos',
    url: string,
    prompt: string,
    model?: string,
    dropPosition?: { x: number; y: number },
    metadata?: Partial<NodeData>
  ) => {
    // 有落点用落点，否则放画布可视区中心（canvasViewCenter 已扣除侧边栏宽度）
    const center = centerNodeAt(canvasViewCenter(getCanvasRect(), viewport));
    const posX = dropPosition ? dropPosition.x : center.x;
    const posY = dropPosition ? dropPosition.y : center.y;

    // Create node with detected aspect ratio
    const createNode = (resultAspectRatio?: string, aspectRatio?: string) => {
      const isVideo = type === 'videos';
      // Use the original model from asset metadata, or fall back to defaults
      const defaultModel = isVideo ? 'seedance-2-0' : 'codex-imagegen';
      const nodeModel = model || defaultModel;

      const newNode: NodeData = {
        id: Date.now().toString(),
        type: isVideo ? NodeType.VIDEO : NodeType.IMAGE,
        x: posX,
        y: posY,
        prompt: prompt,
        status: NodeStatus.SUCCESS,
        resultUrl: url,
        resultAspectRatio,
        model: nodeModel,
        videoModel: isVideo ? nodeModel : undefined,
        imageModel: !isVideo ? nodeModel : undefined,
        aspectRatio: aspectRatio || '16:9',
        resolution: isVideo ? 'Auto' : '1K',
        ...metadata
      };

      setNodes(prev => [...prev, newNode]);
      closeHistoryPanel();
      closeAssetLibrary();
    };

    if (type === 'images') {
      // Detect image dimensions
      const img = new Image();
      img.onload = () => {
        const resultAspectRatio = `${img.naturalWidth}/${img.naturalHeight}`;
        const aspectRatio = getClosestAspectRatio(img.naturalWidth, img.naturalHeight);
        console.log(`[App] Image loaded: ${img.naturalWidth}x${img.naturalHeight} -> ${aspectRatio}`);
        createNode(resultAspectRatio, aspectRatio);
      };
      img.onerror = () => {
        console.log('[App] Image load error, using default 16:9');
        createNode(undefined, '16:9');
      };
      img.src = url;
    } else {
      // Detect video dimensions
      const video = document.createElement('video');
      video.onloadedmetadata = () => {
        const resultAspectRatio = `${video.videoWidth}/${video.videoHeight}`;
        // Use video-specific function that only returns 16:9 or 9:16
        const aspectRatio = getClosestVideoAspectRatio(video.videoWidth, video.videoHeight);
        console.log(`[App] Video loaded: ${video.videoWidth}x${video.videoHeight} -> ${aspectRatio}`);
        createNode(resultAspectRatio, aspectRatio);
      };
      video.onerror = () => {
        console.log('[App] Video load error, using default 16:9');
        createNode(undefined, '16:9');
      };
      video.src = url;
    }
  };

  const resolveCharacterNodeMetadata = async (asset: Partial<LibraryAsset>): Promise<Partial<NodeData>> => {
    let characterReferenceUrls: string[] | undefined;

    if (asset.category === 'Character' && asset.characterId) {
      try {
        const response = await fetch('/api/library');
        const libraryAssets: LibraryAsset[] = response.ok ? await response.json() : [];
        const sameCharacter = libraryAssets.filter(item =>
          item.type === 'image' && item.characterId === asset.characterId
        );
        const identityFace = sameCharacter.find(item => item.characterAssetRole === 'identity-face');
        const identityAngles = sameCharacter.find(item => item.characterAssetRole === 'identity-angles')
          || sameCharacter.find(item => item.characterAssetRole === 'identity-expression');
        const identityBoard = sameCharacter.find(item => item.characterAssetRole === 'identity-board')
          || sameCharacter.find(item => item.characterAssetRole === 'identity-fullbody');
        const sameLook = asset.lookId
          ? sameCharacter.filter(item => item.lookId === asset.lookId)
          : [];

        characterReferenceUrls = [
          identityFace?.url,
          identityAngles?.url,
          identityBoard?.url,
          ...sameLook.map(item => item.url),
          asset.url
        ].filter((url, index, urls): url is string => Boolean(url) && urls.indexOf(url) === index);
      } catch (error) {
        console.error('Failed to resolve character references:', error);
      }
    }

    return {
      characterId: asset.characterId,
      characterName: asset.characterName,
      characterAssetRole: asset.characterAssetRole,
      lookId: asset.lookId,
      lookName: asset.lookName,
      characterReferenceUrls,
      // 从素材库拖入画布的节点即代表该素材的一次应用，连线引用也应显示素材名
      assetId: asset.id,
      assetName: asset.name,
      assetDescription: asset.description
    };
  };

  const handleLibrarySelect = async (asset: LibraryAsset) => {
    const characterMetadata = await resolveCharacterNodeMetadata(asset);
    handleSelectAsset(
      asset.type === 'image' ? 'images' : 'videos',
      asset.url,
      asset.name || 'Asset Library Item',
      undefined,
      undefined,
      characterMetadata
    );
    closeAssetLibrary();
  };

  /**
   * 尾帧成图：抽取视频最后一帧，存成真实素材并在画布生成一个图片节点。
   * 复用既有的 extractVideoLastFrame（已设 crossOrigin，不会污染 canvas）。
   * 帧存到 library/images/ 而非直接用 data URL，保证刷新后仍在、可下载、不撑大存档。
   * 注意：连接规则不允许 视频→图片，因此新节点不与源视频相连，保持独立。
   */
  const handleExtractLastFrame = async (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node?.resultUrl) return;

    try {
      const dataUrl = await extractVideoLastFrame(node.resultUrl.split('?')[0]);
      const namePrefix = (node.title || node.prompt || '视频').slice(0, 20);

      const resp = await fetch('/api/assets/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: dataUrl, prompt: `${namePrefix}_尾帧` }),
      });
      if (!resp.ok) { alert('尾帧保存失败'); return; }
      const saved = await resp.json();
      if (!saved?.url) { alert('尾帧保存失败'); return; }

      // 读取帧尺寸以锁定节点比例
      const size = await new Promise<{ w: number; h: number } | null>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve(null);
        img.src = dataUrl;
      });

      const newNode: NodeData = {
        id: crypto.randomUUID(),
        type: NodeType.IMAGE,
        x: node.x + 460, // 放在源视频右侧
        y: node.y,
        prompt: `${namePrefix} 尾帧`,
        status: NodeStatus.SUCCESS,
        resultUrl: saved.url,
        resultAspectRatio: size ? `${size.w}/${size.h}` : undefined,
        model: 'Last Frame',
        aspectRatio: size ? getClosestAspectRatio(size.w, size.h) : '16:9',
        resolution: 'Auto',
      };
      setNodes(prev => [...prev, newNode]);
      setSelectedNodeIds([newNode.id]);
    } catch (e) {
      console.error('Extract last frame failed', e);
      alert('尾帧提取失败：无法读取该视频');
    }
  };

  // Custom MIME type used when dragging an asset out of the sidebar onto the canvas
  const ASSET_DRAG_TYPE = 'application/x-twitcanva-asset';

  /** Allow dropping sidebar assets onto the canvas (must preventDefault to enable drop) */
  const handleCanvasDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(ASSET_DRAG_TYPE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  /** Create an image/video node where a sidebar asset was dropped on the canvas */
  const handleCanvasDrop = async (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(ASSET_DRAG_TYPE);
    if (!raw) return;
    e.preventDefault();

    let asset: Partial<LibraryAsset> & { prompt?: string };
    try {
      asset = JSON.parse(raw);
    } catch {
      return;
    }
    if (!asset?.url) return;

    // 落点（屏幕坐标）→ 画布坐标，并让节点居中于光标
    const { x: canvasX, y: canvasY } = centerNodeAt(
      screenToCanvas(e.clientX, e.clientY, getCanvasRect(), viewport)
    );

    const characterMetadata = await resolveCharacterNodeMetadata(asset);
    handleSelectAsset(
      asset.type === 'video' ? 'videos' : 'images',
      asset.url,
      asset.prompt || asset.name || 'Asset Library Item',
      undefined,
      { x: canvasX, y: canvasY },
      characterMetadata
    );
  };

  // Create asset modal (isCreateAssetModalOpen, handleOpenCreateAsset, handleSaveAssetToLibrary) provided by useAssetHandlers hook

  // ============================================================================
  // EFFECTS
  // ============================================================================

  // Prevent default zoom behavior
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleNativeWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };

    canvas.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleNativeWheel);
  }, []);

  // Keyboard shortcuts (handleCopy, handlePaste, handleDuplicate) provided by useKeyboardShortcuts hook

  // Cleanup invalid groups (groups with less than 2 nodes)
  useEffect(() => {
    cleanupInvalidGroups(nodes, setNodes);
  }, [nodes, cleanupInvalidGroups]);

  // Track state changes for undo/redo (only after drag ends, not during)
  const isApplyingHistory = React.useRef(false);

  useEffect(() => {
    // Don't push to history if we're currently applying history (undo/redo)
    if (isApplyingHistory.current) {
      isApplyingHistory.current = false;
      return;
    }

    // Don't push to history while dragging (wait until drag ends)
    if (isDragging) {
      return;
    }

    // Push to history when nodes or groups change
    pushHistory({ nodes, groups });
  }, [nodes, groups, isDragging]);

  // Apply history state when undo/redo is triggered
  // IMPORTANT: Don't revert nodes if any node is in LOADING status (generation in progress)
  useEffect(() => {
    // Skip if any node is currently generating - don't interrupt the loading state
    const hasLoadingNode = nodes.some(n => n.status === NodeStatus.LOADING);
    if (hasLoadingNode) {
      return;
    }

    if (historyState.nodes !== nodes) {
      isApplyingHistory.current = true;
      setNodes(historyState.nodes);
    }
  }, [historyState]);

  // Simple wrapper for updateNode (sync code removed - TEXT node prompts are combined at generation time)
  const updateNodeWithSync = React.useCallback((id: string, updates: Partial<NodeData>) => {
    updateNode(id, updates);
  }, [updateNode]);

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).id === 'canvas-background') {
      if (e.button === 0 && isSpacePressedRef.current) {
        e.preventDefault();
        startPanning(e);
        setSelectedConnection(null);
        setContextMenu(prev => ({ ...prev, isOpen: false }));
        return;
      }
      // Left-click (button 0): Start selection box
      if (e.button === 0) {
        startSelection(e);
        clearSelection();
        setSelectedConnection(null);
        setContextMenu(prev => ({ ...prev, isOpen: false }));
        closeWorkflowPanel();
        closeHistoryPanel();
        closeAssetLibrary();
        setSidebarAssetPreview(null);
        setIsMinimapOpen(false);
      }
      // Middle-click (button 1) or other: Start panning
      else {
        startPanning(e);
        setSelectedConnection(null);
        setContextMenu(prev => ({ ...prev, isOpen: false }));
      }
    }
  };

  const handleGlobalPointerMove = (e: React.PointerEvent) => {
    // 1. Handle Selection Box Update
    if (updateSelection(e)) return;

    // 2. Handle Node Dragging
    if (updateNodeDrag(e, viewport, setNodes, selectedNodeIds)) return;

    // 3. Handle Connection Dragging
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (updateConnectionDrag(e, nodes, viewport, canvasRect ? { left: canvasRect.left, top: canvasRect.top } : undefined)) return;

    // 4. Handle Canvas Panning (disabled when selection box is active)
    if (!isSelecting) {
      updatePanning(e, setViewport);
    }
  };

  /**
   * Handle when a connection is made between nodes
   * Syncs prompt if parent is a Text node
   */
  const handleConnectionMade = React.useCallback((parentId: string, childId: string) => {
    // Find the parent node
    const parentNode = nodes.find(n => n.id === parentId);
    if (!parentNode) return;

    // If parent is a Text node, sync its prompt to the child
    if (parentNode.type === NodeType.TEXT && parentNode.prompt) {
      updateNode(childId, { prompt: parentNode.prompt });
    }
  }, [nodes, updateNode]);

  const handleGlobalPointerUp = (e: React.PointerEvent) => {
    // 1. Handle Selection Box End
    if (isSelecting) {
      const selectedIds = endSelection(nodes, viewport);
      setSelectedNodeIds(selectedIds);
      releasePointerCapture(e);
      return;
    }

    // 2. Handle Connection Drop
    if (completeConnectionDrag(
      handleAddNext,
      setNodes,
      nodes,
      handleConnectionMade,
      { x: e.clientX, y: e.clientY }
    )) {
      releasePointerCapture(e);
      return;
    }

    // 3. Stop Panning
    endPanning();

    // 4. Stop Node Dragging
    endNodeDrag();

    // 5. Release capture
    releasePointerCapture(e);
  };

  // Context menu handlers provided by useContextMenuHandlers hook
  // handleDoubleClick, handleGlobalContextMenu, handleAddNext, handleNodeContextMenu,
  // handleContextMenuCreateAsset, handleContextMenuSelect, handleToolbarAdd


  return (
    <div className={`w-screen h-screen ${canvasTheme === 'dark' ? 'bg-[#050505] text-white' : 'bg-neutral-50 text-neutral-900'} overflow-hidden select-none font-sans transition-colors duration-300`}>
      {!storyboardGenerator.isModalOpen && !isTikTokModalOpen && (
        <ProjectSidebar
          nodes={nodes}
          groups={groups}
          selectedNodeIds={selectedNodeIds}
          workflowId={workflowId}
          onSelectNode={locateNodeFromSidebar}
          onSelectNodes={setSelectedNodeIds}
          onCreateGroup={() => { if (selectedNodeIds.length >= 2) groupNodes(selectedNodeIds, setNodes, '新分组'); }}
          onRenameGroup={renameGroup}
          onUngroup={(groupId) => ungroupNodes(groupId, setNodes)}
          onLocateNode={locateNodeFromSidebar}
          onAddNode={openNewNodeMenu}
          onOpenWorkflows={handleWorkflowsClick}
          onOpenHistory={handleHistoryClick}
          onOpenAssets={handleAssetsClick}
          onPreviewAsset={handleSidebarAssetPreview}
          onOpenStoryboard={storyboardGenerator.openModal}
          onCreateProject={handleNewCanvas}
          onDeleteProject={handleDeleteCurrentProject}
          onCollapsedChange={setSidebarCollapsed}
          canvasTheme={canvasTheme}
        />
      )}

      {/* Workflow Panel */}
      <WorkflowPanel
        isOpen={isWorkflowPanelOpen}
        onClose={closeWorkflowPanel}
        onLoadWorkflow={handleLoadWithTracking}
        onRenameWorkflow={(id, title, renamedNodes) => {
          if (id !== workflowId) return;
          ignoreNextChange.current = true;
          setCanvasTitle(title);
          setEditingTitleValue(title);
          if (renamedNodes.length > 0) setNodes(renamedNodes);
        }}
        currentWorkflowId={workflowId || undefined}
        panelY={workflowPanelY}
        panelLeft={(sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : EXPANDED_SIDEBAR_WIDTH) + 20}
        canvasTheme={canvasTheme}
      />

      {/* History Panel */}
      <HistoryPanel
        isOpen={isHistoryPanelOpen}
        onClose={closeHistoryPanel}
        onSelectAsset={handleSelectAsset}
        panelY={historyPanelY}
        panelLeft={(sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : EXPANDED_SIDEBAR_WIDTH) + 20}
        canvasTheme={canvasTheme}
        workflowId={workflowId || undefined}
      />

      <AssetLibraryPanel
        isOpen={isAssetLibraryOpen}
        onClose={closeAssetLibrary}
        onSelectAsset={handleLibrarySelect}
        panelY={assetLibraryY}
        panelLeft={(sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : EXPANDED_SIDEBAR_WIDTH) + 20}
        variant={assetLibraryVariant}
        canvasTheme={canvasTheme}
      />

      <AssetLibraryPanel
        isOpen={Boolean(sidebarAssetPreview)}
        onClose={() => setSidebarAssetPreview(null)}
        onSelectAsset={handleLibrarySelect}
        panelY={sidebarAssetPreview?.panelY ?? 100}
        panelLeft={(sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : EXPANDED_SIDEBAR_WIDTH) + 20}
        variant="panel"
        canvasTheme={canvasTheme}
        previewAsset={sidebarAssetPreview}
      />

      <CreateAssetModal
        isOpen={isCreateAssetModalOpen}
        onClose={() => setIsCreateAssetModalOpen(false)}
        nodeToSnapshot={nodeToSnapshot}
        onSave={handleSaveAssetToLibrary}
      />

      {/* TikTok Import Modal */}
      <TikTokImportModal
        isOpen={isTikTokModalOpen}
        onClose={closeTikTokModal}
        onVideoImported={handleTikTokVideoImported}
      />

      {/* Storyboard Generator Modal */}
      <StoryboardGeneratorModal
        isOpen={storyboardGenerator.isModalOpen}
        onClose={storyboardGenerator.closeModal}
        state={storyboardGenerator.state}
        onSetStep={storyboardGenerator.setStep}
        onToggleCharacter={storyboardGenerator.toggleCharacter}
        onSetSceneCount={storyboardGenerator.setSceneCount}
        onSetStory={storyboardGenerator.setStory}
        onUpdateScript={storyboardGenerator.updateScript}
        onGenerateScripts={storyboardGenerator.generateScripts}
        onBrainstormStory={storyboardGenerator.brainstormStory}
        onOptimizeStory={storyboardGenerator.optimizeStory}
        onGenerateComposite={storyboardGenerator.generateComposite}
        onRegenerateComposite={storyboardGenerator.regenerateComposite}
        onCreateNodes={storyboardGenerator.createStoryboardNodes}
      />

      {/* Top Bar */}
      {/* Top Bar */}
      {!storyboardGenerator.isModalOpen && !isTikTokModalOpen && (
        <TopBar
          canvasTitle={canvasTitle}
          isEditingTitle={isEditingTitle}
          editingTitleValue={editingTitleValue}
          canvasTitleInputRef={canvasTitleInputRef}
          setCanvasTitle={setCanvasTitle}
          setIsEditingTitle={setIsEditingTitle}
          setEditingTitleValue={setEditingTitleValue}
          onSave={handleSaveWithTracking}
          onNew={handleNewCanvas}
          hasUnsavedChanges={hasUnsavedChanges}
          canvasTheme={canvasTheme}
          onToggleTheme={() => setCanvasTheme(prev => prev === 'dark' ? 'light' : 'dark')}
          lastAutoSaveTime={lastAutoSaveTime}
          showBrand={false}
          sidebarOffset={sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : EXPANDED_SIDEBAR_WIDTH}
        />
      )}

      {/* Canvas */}
      <div
        ref={canvasRef}
        id="canvas-background"
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        style={{ left: sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : EXPANDED_SIDEBAR_WIDTH }}
        onPointerDown={handlePointerDown}
        onPointerMove={handleGlobalPointerMove}
        onPointerUp={handleGlobalPointerUp}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleGlobalContextMenu}
        onDragOver={handleCanvasDragOver}
        onDrop={handleCanvasDrop}
      >
        <div
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            transformOrigin: '0 0',
            width: '100%',
            height: '100%',
            pointerEvents: 'none'
          }}
        >
          {/* Background Grid */}
          <div
            className="absolute -top-[10000px] -left-[10000px] w-[20000px] h-[20000px]"
            style={{
              backgroundImage: canvasTheme === 'dark'
                ? 'radial-gradient(#666 1px, transparent 1px)'
                : 'radial-gradient(#ccc 1px, transparent 1px)',
              backgroundSize: '20px 20px',
              opacity: canvasTheme === 'dark' ? 0.5 : 0.8
            }}
          />

          {/* SVG Layer for Connections */}
          <svg className="absolute top-0 left-0 w-full h-full overflow-visible pointer-events-none z-0">
            <ConnectionsLayer
              nodes={nodes}
              viewport={viewport}
              canvasTheme={canvasTheme}
              isDraggingConnection={isDraggingConnection}
              connectionStart={connectionStart}
              tempConnectionEnd={tempConnectionEnd}
              canvasOffset={(() => {
                const rect = canvasRef.current?.getBoundingClientRect();
                return rect ? { left: rect.left, top: rect.top } : undefined;
              })()}
              selectedConnection={selectedConnection}
              onEdgeClick={handleEdgeClick}
            />
          </svg>

          {/* Nodes Layer */}
          <div className="pointer-events-auto">
            {nodes.map(node => (
              <CanvasNode
                key={node.id}
                data={node}
                allNodes={nodes}
                inputUrl={(() => {
                  // Get first parent's result for display (multiple inputs handled in generation)
                  if (!node.parentIds || node.parentIds.length === 0) return undefined;
                  const parent = nodes.find(n => n.id === node.parentIds![0]);

                  // VIDEO_EDITOR nodes need the actual video URL from parent Video node
                  if (node.type === NodeType.VIDEO_EDITOR && parent?.type === NodeType.VIDEO) {
                    return parent.resultUrl;
                  }

                  // For other nodes, if parent is video, use lastFrame for image preview
                  if (parent?.type === NodeType.VIDEO && parent.lastFrame) {
                    return parent.lastFrame;
                  }
                  return parent?.resultUrl;
                })()}
                connectedReferences={collectNodeReferences(node.parentIds, nodes)}
                onUpdate={updateNodeWithSync}
                onGenerate={handleGenerate}
                onAddNext={handleAddNext}
                selected={selectedNodeIds.includes(node.id)}
                showControls={selectedNodeIds.length === 1 && selectedNodeIds.includes(node.id)}
                onNodePointerDown={(e) => {
                  if (e.altKey) {
                    const sourceIds = selectedNodeIds.includes(node.id) && selectedNodeIds.length > 1
                      ? selectedNodeIds
                      : [node.id];
                    const duplicatedIds = handleDuplicate(sourceIds);
                    if (duplicatedIds.length > 0) {
                      handleNodePointerDown(e, duplicatedIds[0], undefined);
                    }
                    return;
                  }
                  // If shift is held, preserve selection for multi-drag/multi-select
                  if (e.shiftKey) {
                    if (selectedNodeIds.includes(node.id)) {
                      handleNodePointerDown(e, node.id, undefined);
                    } else {
                      // Add to selection
                      setSelectedNodeIds(prev => [...prev, node.id]);
                      handleNodePointerDown(e, node.id, undefined);
                    }
                  } else {
                    // No shift: always select just this node (to show its controls)
                    setSelectedNodeIds([node.id]);
                    handleNodePointerDown(e, node.id, undefined);
                  }
                }}
                onContextMenu={handleNodeContextMenu}
                onSelect={(id) => setSelectedNodeIds([id])}
                onConnectorDown={handleConnectorPointerDown}
                isHoveredForConnection={connectionHoveredNodeId === node.id}
                onOpenEditor={handleOpenEditor}
                onUpload={handleUpload}
                onExpand={handleExpandImage}
                onWriteContent={handleWriteContent}
                onTextToVideo={handleTextToVideo}
                onTextToImage={handleTextToImage}
                onImageToImage={handleImageToImage}
                onImageToVideo={handleImageToVideo}
                onChangeAngleGenerate={handleChangeAngleGenerate}
                onExtractLastFrame={handleExtractLastFrame}
                zoom={viewport.zoom}
                onMouseEnter={() => setCanvasHoveredNodeId(node.id)}
                onMouseLeave={() => setCanvasHoveredNodeId(null)}
                canvasTheme={canvasTheme}
              />
            ))}
          </div>



          {/* Selection Bounding Box - for selected nodes (2 or more) */}
          {selectedNodeIds.length > 1 && !selectionBox.isActive && (
            <SelectionBoundingBox
              selectedNodes={nodes.filter(n => selectedNodeIds.includes(n.id))}
              group={getCommonGroup(selectedNodeIds)}
              viewport={viewport}
              onGroup={() => groupNodes(selectedNodeIds, setNodes)}
              onUngroup={() => {
                const group = getCommonGroup(selectedNodeIds);
                if (group) ungroupNodes(group.id, setNodes);
              }}
              onBoundingBoxPointerDown={(e) => {
                // Start dragging all selected nodes when clicking on bounding box
                e.stopPropagation();
                if (selectedNodeIds.length > 0) {
                  handleNodePointerDown(e, selectedNodeIds[0], undefined);
                }
              }}
              onRenameGroup={renameGroup}
              onSortNodes={(direction) => {
                const group = getCommonGroup(selectedNodeIds);
                if (group) sortGroupNodes(group.id, direction, nodes, setNodes);
              }}
              onEditStoryboard={handleEditStoryboard}
            />
          )}

          {/* Group Bounding Boxes - for all groups (even when not selected) */}
          {groups.map(group => {
            const groupNodes = nodes.filter(n => n.groupId === group.id);

            // Don't render if group has less than 2 nodes
            if (groupNodes.length < 2) return null;

            const isSelected = groupNodes.every(n => selectedNodeIds.includes(n.id)) && groupNodes.length > 0;

            // Don't render if this group is already shown above (when selected)
            if (isSelected) return null;

            return (
              <SelectionBoundingBox
                key={group.id}
                selectedNodes={groupNodes}
                group={group}
                viewport={viewport}
                onGroup={() => { }} // Already grouped
                onUngroup={() => ungroupNodes(group.id, setNodes)}
                onBoundingBoxPointerDown={(e) => {
                  // Select all nodes in this group and start dragging
                  e.stopPropagation();
                  const nodeIds = groupNodes.map(n => n.id);
                  setSelectedNodeIds(nodeIds);
                  if (nodeIds.length > 0) {
                    handleNodePointerDown(e, nodeIds[0], undefined);
                  }
                }}
                onRenameGroup={renameGroup}
                onSortNodes={(direction) => sortGroupNodes(group.id, direction, nodes, setNodes)}
                onCreateVideo={() => {
                  // Pass group nodes directly to avoid selection state race conditions
                  const groupNodeIds = nodes.filter(n => n.groupId === group.id).map(n => n.id);
                  handleCreateStoryboardVideo(groupNodeIds);
                }}
                onEditStoryboard={handleEditStoryboard}
              />
            );
          })}
        </div>

        {/* Selection Box Overlay — 直接放在 #canvas-background 内（变换层的兄弟），
            使其 left/top 与 marquee 坐标同源（相对画布左上角），避免被侧边栏宽度整体偏移。 */}
        {selectionBox.isActive && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: Math.min(selectionBox.startX, selectionBox.endX),
              top: Math.min(selectionBox.startY, selectionBox.endY),
              width: Math.abs(selectionBox.endX - selectionBox.startX),
              height: Math.abs(selectionBox.endY - selectionBox.startY),
              border: '2px solid #3b82f6',
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              zIndex: 1000
            }}
          />
        )}
      </div >

      {/* Context Menu */}
      <ContextMenu
        state={contextMenu}
        onClose={() => setContextMenu(prev => ({ ...prev, isOpen: false }))}
        onSelectType={handleContextMenuSelect}
        onUpload={handleContextUpload}
        onUndo={undo}
        onRedo={redo}
        onPaste={handlePaste}
        onCopy={handleCopy}
        onDuplicate={handleDuplicate}
        onCreateAsset={handleContextMenuCreateAsset}
        onAddAssets={handleContextMenuAddAssets}
        onCreateMangaWorkflow={handleCreateMangaWorkflow}
        onOpenStoryboard={storyboardGenerator.openModal}
        onOpenHistory={handleContextMenuOpenHistory}
        canCreateMangaWorkflow={nodes.length === 0}
        canUndo={canUndo}
        canRedo={canRedo}
        canvasTheme={canvasTheme}
      />

      {/* Canvas navigation controls */}
      {!storyboardGenerator.isModalOpen && !isTikTokModalOpen && (
        <div
          className="fixed bottom-6 z-50 flex flex-col items-start gap-2 transition-all duration-300"
          style={{ left: (sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : EXPANDED_SIDEBAR_WIDTH) + 24 }}
        >
          {isMinimapOpen && (
            <CanvasMinimap
              nodes={nodes}
              viewport={viewport}
              setViewport={setViewport}
              canvasWidth={Math.max(1, window.innerWidth - (sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : EXPANDED_SIDEBAR_WIDTH))}
              canvasHeight={window.innerHeight}
              canvasTheme={canvasTheme}
            />
          )}
          <div className={`flex items-center gap-1 rounded-2xl border px-1.5 py-1.5 shadow-xl ${canvasTheme === 'dark' ? 'border-neutral-700 bg-neutral-900/95' : 'border-neutral-200 bg-white/95 backdrop-blur-sm'}`}>
            <div className="group relative">
              <button
                type="button"
                aria-label="画布小地图"
                aria-pressed={isMinimapOpen}
                onClick={() => setIsMinimapOpen(open => !open)}
                className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${isMinimapOpen
                  ? canvasTheme === 'dark' ? 'bg-neutral-700 text-white' : 'bg-neutral-200 text-neutral-900'
                  : canvasTheme === 'dark' ? 'text-neutral-300 hover:bg-neutral-800 hover:text-white' : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
                  }`}
              >
                <MapPinned size={19} />
              </button>
              <div className={`pointer-events-none absolute bottom-full left-1/2 mb-3 -translate-x-1/2 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs opacity-0 shadow-xl transition-opacity group-hover:opacity-100 ${canvasTheme === 'dark' ? 'border-neutral-700 bg-[#242424] text-white' : 'border-neutral-200 bg-white text-neutral-800'}`}>
                画布小地图
              </div>
            </div>
            <CanvasZoomControl
              nodes={nodes}
              viewport={viewport}
              setViewport={setViewport}
              canvasTheme={canvasTheme}
            />
          </div>
        </div>
      )}

      <ImageEditorModal
        isOpen={editorModal.isOpen}
        nodeId={editorModal.nodeId || ''}
        imageUrl={editorModal.imageUrl}
        initialPrompt={nodes.find(n => n.id === editorModal.nodeId)?.prompt}
        initialModel={nodes.find(n => n.id === editorModal.nodeId)?.imageModel || 'codex-imagegen'}
        initialAspectRatio={nodes.find(n => n.id === editorModal.nodeId)?.aspectRatio || 'Auto'}
        initialResolution={nodes.find(n => n.id === editorModal.nodeId)?.resolution || '1K'}
        initialElements={nodes.find(n => n.id === editorModal.nodeId)?.editorElements as any}
        initialCanvasData={nodes.find(n => n.id === editorModal.nodeId)?.editorCanvasData}
        initialCanvasSize={nodes.find(n => n.id === editorModal.nodeId)?.editorCanvasSize}
        initialBackgroundUrl={nodes.find(n => n.id === editorModal.nodeId)?.editorBackgroundUrl}
        onClose={handleCloseImageEditor}
        onGenerate={async (sourceId, prompt, count) => {
          handleCloseImageEditor();

          const sourceNode = nodes.find(n => n.id === sourceId);
          if (!sourceNode) return;

          // Get settings from source node (which were updated by the modal)
          const imageModel = sourceNode.imageModel || 'codex-imagegen';
          const aspectRatio = sourceNode.aspectRatio || 'Auto';
          const resolution = sourceNode.resolution || '1K';

          const startX = sourceNode.x + 360; // Source width + gap
          const startY = sourceNode.y;

          const newNodes: NodeData[] = [];

          const yStep = 500;
          const totalHeight = (count - 1) * yStep;
          const startYOffset = -totalHeight / 2;

          // Create N nodes with inherited settings
          for (let i = 0; i < count; i++) {
            newNodes.push({
              id: crypto.randomUUID(),
              type: NodeType.IMAGE,
              x: startX,
              y: startY + startYOffset + (i * yStep),
              prompt: prompt,
              status: NodeStatus.LOADING,
              model: 'Banana Pro',
              imageModel: imageModel,
              aspectRatio: aspectRatio,
              resolution: resolution,
              parentIds: [sourceId]
            });
          }

          // Add new nodes and edges immediately
          // Note: State updates might be batched
          setNodes(prev => [...prev, ...newNodes]);

          // Convert editor image to base64 for generation reference
          let imageBase64: string | undefined = undefined;
          if (editorModal.imageUrl) {
            imageBase64 = await urlToBase64(editorModal.imageUrl);
          }

          newNodes.forEach(async (node) => {
            try {
              const resultUrl = await generateImage({
                prompt: node.prompt || '',
                imageBase64: imageBase64,
                imageModel: imageModel,
                aspectRatio: aspectRatio,
                resolution: resolution
              });
              updateNode(node.id, { status: NodeStatus.SUCCESS, resultUrl });
            } catch (error: any) {
              updateNode(node.id, { status: NodeStatus.ERROR, errorMessage: error.message });
            }
          });
        }}
        onUpdate={updateNode}
      />

      {/* Storyboard Video Generation Modal */}
      <StoryboardVideoModal
        isOpen={storyboardVideoModal.isOpen}
        onClose={() => setStoryboardVideoModal(prev => ({ ...prev, isOpen: false }))}
        scenes={storyboardVideoModal.nodes}
        storyContext={storyboardVideoModal.storyContext}
        onCreateVideos={handleGenerateStoryVideos}
      />

      {/* Video Editor Modal */}
      <VideoEditorModal
        isOpen={videoEditorModal.isOpen}
        nodeId={videoEditorModal.nodeId}
        videoUrl={videoEditorModal.videoUrl}
        initialTrimStart={nodes.find(n => n.id === videoEditorModal.nodeId)?.trimStart}
        initialTrimEnd={nodes.find(n => n.id === videoEditorModal.nodeId)?.trimEnd}
        onClose={handleCloseVideoEditor}
        onExport={handleExportTrimmedVideo}
      />

      {/* Fullscreen Media Preview Modal */}
      <ExpandedMediaModal
        mediaUrl={expandedImageUrl}
        onClose={handleCloseExpand}
      />
    </div >
  );
}
