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
import { ContextMenuState, isMangaNode, NodeData, NodeStatus, NodeType } from './types';
import {
  dismissProductSceneResultNodes,
  generateImage,
  generateImageBatch,
  generateVideo,
  type ProductSceneJob
} from './services/generationService';
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
import { isSupportedImageFile, useCanvasImageImport } from './hooks/useCanvasImageImport';
import { useContextMenuHandlers } from './hooks/useContextMenuHandlers';
import { useToasts } from './hooks/useToasts';
import { useCanvasEditLock } from './hooks/useCanvasEditLock';
import { ToastStack } from './components/ToastStack';
import { useAutoSave } from './hooks/useAutoSave';
import { useGenerationRecovery } from './hooks/useGenerationRecovery';
import { useVideoFrameExtraction } from './hooks/useVideoFrameExtraction';
import { useAutoSubtitleRecovery } from './hooks/useAutoSubtitleRecovery';
import { extractVideoLastFrame } from './utils/videoHelpers';
import { createAdditionalImagePlacements } from './utils/imageBatchLayout';
import { readApiResponse } from './utils/apiResponse';
import { SelectionBoundingBox } from './components/canvas/SelectionBoundingBox';
import { WorkflowPanel } from './components/WorkflowPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { ImageEditorModal } from './components/modals/ImageEditorModal';
import { VideoEditorModal } from './components/modals/VideoEditorModal';
import { ExpandedMediaModal } from './components/modals/ExpandedMediaModal';
import { CreateAssetModal } from './components/modals/CreateAssetModal';
import { CreateProjectModal } from './components/modals/CreateProjectModal';
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
import { collectNodeReferences, type NodeReference } from './utils/nodeReferences.js';
import { upsertProductSceneResultNode } from './utils/productSceneResult.js';
import { getImageGenerationProvider } from '@/shared/generationProviders.js';
import { assignProductSceneInputOnConnect } from './utils/productSceneInputMapping.js';
import { VideoRemixWorkspace } from './features/video-remix/VideoRemixWorkspace';
import {
  createVideoRemixState,
  replaceVideoRemixSource,
  setVideoRemixSourceError,
} from '@/shared/videoRemix.js';
import { useCanvasVideoAsReference } from './features/video-remix/videoRemixService';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

// 只有这几类节点会把 allNodes 传下去（漫剧成片/产品场景替换要用全量节点组装 manifest）。
// 其余节点不该拿到这个每帧都变的数组，否则 CanvasNode 的 memo 形同虚设。
const NODE_TYPES_NEEDING_ALL_NODES = new Set<NodeType>([
  NodeType.PRODUCT_SCENE_REPLACE,
  ...Object.values(NodeType).filter(isMangaNode)
]);

type CanvasHistoryState = { nodes: NodeData[]; groups: ReturnType<typeof useGroupManagement>['groups'] };

// Nodes and groups are always updated immutably. Reference equality therefore
// preserves the existing history semantics without serializing every media URL.
const isSameCanvasHistoryState = (left: CanvasHistoryState, right: CanvasHistoryState) =>
  left.nodes === right.nodes && left.groups === right.groups;

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
  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] = useState(false);
  const [isMinimapOpen, setIsMinimapOpen] = useState(false);
  const [videoRemixWorkspaceNodeId, setVideoRemixWorkspaceNodeId] = useState<string | null>(null);

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

  const { toasts, showToast, dismissToast } = useToasts();

  // 悬停节点只被滚轮缩放用来定位光标下的节点，没有任何 UI 依赖它。
  // 放在 state 里意味着"鼠标划过画布"就会重渲染整个 App 和全部节点，
  // 所以这里用 ref：hover 变化不产生 render。
  const canvasHoveredNodeIdRef = useRef<string | null>(null);
  const handleNodeMouseEnter = React.useCallback((id: string) => {
    canvasHoveredNodeIdRef.current = id;
  }, []);
  const handleNodeMouseLeave = React.useCallback(() => {
    canvasHoveredNodeIdRef.current = null;
  }, []);


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
    const hoveredId = canvasHoveredNodeIdRef.current;
    const hoveredNode = hoveredId ? nodes.find(n => n.id === hoveredId) : undefined;
    baseHandleWheel(e, hoveredNode);
  };

  const {
    nodes,
    setNodes,
    selectedNodeIds,
    setSelectedNodeIds,
    addNode,
    updateNode,
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
  } = useHistory({ nodes, groups }, 50, isSameCanvasHistoryState);

  // Mark as dirty when nodes or title change
  const isInitialMount = React.useRef(true);
  const lastLoadingCountRef = React.useRef(0);
  const ignoreNextChange = React.useRef(false);
  const canvasChangeVersionRef = React.useRef(0);

  // Workflow management
  const {
    workflowId,
    projectDirName,
    isWorkflowPanelOpen,
    workflowPanelY,
    handleSaveWorkflow,
    handleLoadWorkflow,
    handleWorkflowsClick,
    closeWorkflowPanel,
    resetWorkflowId,
    handleCreateWorkflow
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

  // 项目级编辑锁：没有当前项目时画布只读（见 useCanvasEditLock）。
  // 必须在 workflowId 可用之后、所有编辑入口之前建立。
  const canvasEditLock = useCanvasEditLock({
    workflowId,
    notify: message => showToast(message, { tone: 'error' })
  });
  const { canEditCanvas } = canvasEditLock;


  /**
   * 已经移进回收站、但节点可能被撤销拿回来的记录。
   *
   * 删除项目图片节点时，图片文件会被移进 .trash；而撤销（Ctrl+Z）只还原画布状态，
   * 不碰磁盘 —— 节点方框回来了，图片却 404。这里记下「哪几个节点的图片进了哪个
   * 回收站条目」，节点一旦重新出现在画布上就把文件还原回去。
   */
  const pendingTrashRef = React.useRef<{ entryId: string; nodeIds: string[] }[]>([]);
  const trashDeleteInFlight = React.useRef(false);
  const deleteNodesWithTrash = React.useCallback(async (ids: string[]) => {
    const uniqueIds = [...new Set(ids)];
    const deleted = nodes.filter(node => uniqueIds.includes(node.id));
    const hasProjectImage = Boolean(workflowId) && deleted.some(node =>
      [NodeType.IMAGE, NodeType.IMAGE_EDITOR, NodeType.CAMERA_ANGLE].includes(node.type)
      && typeof node.resultUrl === 'string'
      && /\/library\/projects\/[^/]+\/images\//.test(node.resultUrl)
    );

    // 产品短视频任务的结果节点（图片和视频都算）删掉后要在任务里记一笔，否则画布恢复
    // 逻辑会把它当成「结果还在但节点丢了」，下一轮就原样长回来 —— 表现就是删不掉。
    // 视频节点走不到下面的回收站分支，所以这一步必须在分支之前做。
    if (workflowId) {
      void dismissProductSceneResultNodes(uniqueIds, workflowId);
    }

    if (!hasProjectImage) {
      deleteNodes(uniqueIds);
      return;
    }
    if (trashDeleteInFlight.current) return;

    // 图片文件移入回收站需要一次磁盘往返。先清掉选中态，让图片节点下方的提示词
    // 控制面板立即消失；否则图片文件已经移动时，控制面板仍会留在画布上，看起来像
    // “图片删了但文字节点删不掉”。真正节点仍在请求成功后统一删除。
    setSelectedNodeIds(previous => previous.filter(id => !uniqueIds.includes(id)));
    trashDeleteInFlight.current = true;
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(workflowId!)}/trash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeIds: uniqueIds, nodes })
      });
      const result = await readApiResponse<{ entry?: { id?: string } }>(response, '移入回收站失败');
      // 记下这次删除对应的回收站条目：撤销只会把节点还原到画布上，图片文件还在
      // .trash 里，节点回来了却是一个「Failed to load」的空框。见 pendingTrashRef。
      const entryId = result?.entry?.id;
      if (entryId) {
        pendingTrashRef.current = [
          ...pendingTrashRef.current.filter(record => record.entryId !== entryId),
          { entryId, nodeIds: uniqueIds }
        ].slice(-20);
      }
      deleteNodes(uniqueIds);
    } catch (error) {
      console.error('Failed to move canvas image to trash:', error);
      window.alert(error instanceof Error ? error.message : '移入回收站失败，图片没有删除');
    } finally {
      trashDeleteInFlight.current = false;
    }
  }, [workflowId, nodes, deleteNodes, setSelectedNodeIds]);

  // Simple dirty flag for unsaved changes tracking
  const [isDirty, setIsDirty] = React.useState(false);
  const hasUnsavedChanges = isDirty && nodes.length > 0;

  // Any generated/imported local media is adopted by the active project as soon
  // as it appears on a node. The server copies across projects, so references
  // never couple one project's lifetime to another project.
  const adoptingProjectAssets = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (!workflowId || !projectDirName) return;
    const currentPrefix = `/library/projects/${encodeURIComponent(projectDirName)}/`;
    const fields: Array<keyof Pick<NodeData, 'resultUrl' | 'lastFrame' | 'editorCanvasData' | 'editorBackgroundUrl' | 'mediaUrl' | 'renderOutputUrl'>> = [
      'resultUrl', 'lastFrame', 'editorCanvasData', 'editorBackgroundUrl', 'mediaUrl', 'renderOutputUrl'
    ];

    const pathnameOf = (value: string) => {
      try { return value.startsWith('http') ? new URL(value).pathname : value.split('?')[0]; }
      catch { return value.split('?')[0]; }
    };

    for (const node of nodes) {
      for (const field of fields) {
        const sourceUrl = node[field];
        if (typeof sourceUrl !== 'string') continue;
        const pathname = pathnameOf(sourceUrl);
        if (!pathname.startsWith('/library/') || pathname.startsWith(currentPrefix)) continue;
        const key = `${workflowId}:${node.id}:${field}:${sourceUrl}`;
        if (adoptingProjectAssets.current.has(key)) continue;
        adoptingProjectAssets.current.add(key);
        void fetch(`/api/projects/${encodeURIComponent(workflowId)}/assets/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceUrl })
        }).then(async response => {
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || '项目素材入库失败');
          setNodes(current => current.map(item => item.id === node.id && item[field] === sourceUrl
            ? { ...item, [field]: data.url }
            : item));
        }).catch(error => {
          console.error('[Project Assets] Failed to adopt asset:', error);
        }).finally(() => {
          adoptingProjectAssets.current.delete(key);
        });
        return;
      }
    }
  }, [workflowId, projectDirName, nodes, setNodes]);

  React.useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    if (ignoreNextChange.current) {
      ignoreNextChange.current = false;
      return;
    }

    canvasChangeVersionRef.current += 1;
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
    const savingVersion = canvasChangeVersionRef.current;
    await handleSaveWorkflow();
    // A loading snapshot can finish saving after generation has already
    // produced new nodes. Do not mark those newer canvas changes as saved.
    if (canvasChangeVersionRef.current === savingVersion) {
      setIsDirty(false);
    }
  };

  // Load workflow and update tracking
  const handleLoadWithTracking = async (id: string) => {
    ignoreNextChange.current = true;
    await handleLoadWorkflow(id);
    setIsDirty(false);
  };

  const handleRefreshCurrentCanvas = async () => {
    if (!workflowId) throw new Error('请先新建或打开项目');
    // 刷新不是丢弃：先把当前改动完整保存，再从项目文件重载，以便恢复后台任务状态，
    // 同时避免用户把“刷新画布”误当成浏览器刷新而丢掉一分钟内尚未自动保存的内容。
    await handleSaveWithTracking();
    await handleLoadWithTracking(workflowId);
  };

  const nodesRef = React.useRef(nodes);
  React.useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const { handleGenerate: handleGenerateNow } = useGeneration({
    nodes,
    updateNode,
    addNodes: newNodes => setNodes(previous => [...previous, ...newNodes]),
    workflowId
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

  const clearCanvas = React.useCallback((title = '未命名项目') => {
    ignoreNextChange.current = true;
    setNodes([]);
    setGroups([]); // Reset groups for new canvas
    setSelectedNodeIds([]);
    setCanvasTitle(title);
    setEditingTitleValue(title);
    setViewport({ x: 0, y: 0, zoom: 1 });
    setIsDirty(false);
  }, [setNodes, setGroups, setSelectedNodeIds, setCanvasTitle, setEditingTitleValue, setViewport]);

  const handleRequestNewProject = React.useCallback(() => {
    setIsCreateProjectModalOpen(true);
  }, []);

  const handleCreateProject = React.useCallback(async (title: string, locationId?: string | null) => {
    const workflow = await handleCreateWorkflow(title, locationId);
    clearCanvas(workflow.title);
  }, [handleCreateWorkflow, clearCanvas]);

  const handleNewCanvas = React.useCallback(() => {
    clearCanvas();
    resetWorkflowId();
  }, [clearCanvas, resetWorkflowId]);

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
  } = useImageNodeHandlers({ nodes, setNodes, setSelectedNodeIds, onGenerateNode: handleGenerate, workflowId });

  // Asset handlers (create asset modal)
  const {
    isCreateAssetModalOpen,
    setIsCreateAssetModalOpen,
    nodeToSnapshot,
    handleOpenCreateAsset,
    handleSaveAssetToLibrary,
    handleContextUpload
  } = useAssetHandlers({ nodes, viewport, contextMenu, setNodes, workflowId });

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
    setNodes(prev => {
      const ordered = prev
        .filter(node => selectedNodeIds.includes(node.id))
        .sort((a, b) => a.x - b.x || a.y - b.y);
      return prev.map(node => {
        const childIndex = ordered.findIndex(item => item.id === node.id);
        if (childIndex <= 0) return node;
        const parent = ordered[childIndex - 1];
        if (!isValidNodeConnection(parent.type, node.type)) return node;
        const parentIds = node.parentIds || [];
        return parentIds.includes(parent.id)
          ? node
          : {
            ...node,
            parentIds: [...parentIds, parent.id],
            ...(parent.type === NodeType.TEXT && parent.prompt ? { prompt: parent.prompt } : {}),
            ...(node.type === NodeType.PRODUCT_SCENE_REPLACE
              ? assignProductSceneInputOnConnect(node, parent, prev)
              : {}),
          };
      });
    });
  }, [selectedNodeIds, setNodes]);

  const generateSelected = React.useCallback(async () => {
    const generatableTypes = new Set([
      NodeType.IMAGE,
      NodeType.IMAGE_EDITOR,
      NodeType.PRODUCT_SCENE_REPLACE,
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
    // 工具栏「新建节点」与快捷键共用这个入口，同样受项目级编辑锁约束。
    if (!canvasEditLock.guard()) return;
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
  }, [sidebarCollapsed, canvasEditLock]);

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

  const { importImageFiles } = useCanvasImageImport({
    workflowId,
    viewport,
    canvasRef,
    setNodes,
    setSelectedNodeIds,
    notify: showToast
  });

  /**
   * 侧边栏点击「画布元素」→ 跳转到该节点：居中并缩放到刚好铺满画布可视区。
   * 节点实际渲染宽高并不统一（文本/待生成 365、视频 385、出图后的图片节点 auto 随比例变），
   * 所以不用猜测常量，而是直接量测该节点当前的真实 DOM 尺寸（CanvasNode 各分支已标注
   * data-node-id），再按当前 zoom 换算回世界坐标尺寸，交给 computeFitViewport 算出目标视口。
   */
  const locateNodeFromSidebar = React.useCallback((id: string) => {
    const node = nodes.find(item => item.id === id);
    if (!node) return;
    setSelectedConnection(null);
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
  }, [nodes, viewport.zoom, setSelectedConnection, setSelectedNodeIds, setViewport]);

  const revealCurrentProject = React.useCallback(async () => {
    if (!workflowId) {
      showToast('请先打开项目', { tone: 'error' });
      return;
    }
    if (!window.evanDesktop?.revealProject) {
      showToast('打开项目目录仅在 Evan 桌面应用中可用', { tone: 'error' });
      return;
    }
    try {
      await window.evanDesktop.revealProject(workflowId);
      showToast('已打开项目目录');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '无法打开项目目录', { tone: 'error' });
    }
  }, [workflowId, showToast]);

  const renameSidebarNode = React.useCallback((id: string, displayName: string, syncAsset = true) => {
    const nextName = displayName.trim();
    if (!nextName) return;
    updateNode(id, { displayName: nextName });
    if (!syncAsset) return;

    const node = nodes.find(item => item.id === id);
    const mediaUrl = node?.resultUrl || node?.editorBackgroundUrl || node?.lastFrame;
    if (!workflowId || !mediaUrl) return;
    try {
      const pathname = mediaUrl.startsWith('http')
        ? new URL(mediaUrl).pathname
        : mediaUrl.split('?')[0];
      const segments = pathname.split('/').filter(Boolean).map(segment => decodeURIComponent(segment));
      if (
        segments.at(-4) !== 'projects'
        || segments.at(-3) !== projectDirName
        || segments.at(-2) !== 'images'
        || !segments.at(-1)
      ) return;
      const filename = segments.at(-1)!;
      void fetch(
        `/api/projects/${encodeURIComponent(workflowId)}/assets/images/${encodeURIComponent(filename)}/display-name`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName: nextName }),
        }
      ).then(async response => {
        if (response.ok) return;
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || '图片名称未能同步到素材列表');
      }).catch(error => {
        showToast(error instanceof Error ? error.message : '图片名称未能同步到素材列表', { tone: 'error' });
      });
    } catch {
      // Non-project/data/blob URLs still keep their project-level displayName.
    }
  }, [nodes, workflowId, projectDirName, updateNode, showToast]);

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
    deleteNodes: deleteNodesWithTrash,
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
    setViewport,
    onPasteImageFiles: importImageFiles
  });

  // Auto-Save Management
  const { lastSaveTime: lastAutoSaveTime } = useAutoSave({
    isDirty,
    nodes,
    onSave: handleSaveWithTracking,
    interval: 60000 // Save every 60 seconds
  });

  const handleProductSceneCompleted = React.useCallback((sourceNode: NodeData, job: ProductSceneJob) => {
    if (!job.resultUrl) return;
    setNodes(previous => upsertProductSceneResultNode(previous, sourceNode, job));
  }, [setNodes]);

  // Generation Recovery Management
  useGenerationRecovery({
    nodes,
    updateNode,
    workflowId,
    onProductSceneCompleted: handleProductSceneCompleted,
  });

  const handleSubtitleCompleted = React.useCallback(() => {
    showToast('带字幕视频已生成');
  }, [showToast]);
  const handleSubtitleFailed = React.useCallback((message: string) => {
    showToast(message, { tone: 'error', duration: 6500 });
  }, [showToast]);

  useAutoSubtitleRecovery({
    nodes,
    updateNode,
    onCompleted: handleSubtitleCompleted,
    onFailed: handleSubtitleFailed,
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
    handleSelectTypeFromMenu,
    onDeleteNodes: deleteNodesWithTrash,
    canEdit: canvasEditLock.guard
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

  const handleSidebarAssetPreview = (asset: SidebarAssetPreview, anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
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
        body: JSON.stringify({ data: dataUrl, prompt: `${namePrefix}_尾帧`, workflowId }),
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
    const hasExternalFiles = e.dataTransfer.types.includes('Files');
    if (e.dataTransfer.types.includes(ASSET_DRAG_TYPE) || hasExternalFiles) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  /** Create an image/video node where a sidebar asset was dropped on the canvas */
  const handleCanvasDrop = async (e: React.DragEvent) => {
    // 拖入图片同样是在写当前画布，没有项目时直接拦下。
    if (!canvasEditLock.guard()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const externalFiles = Array.from(e.dataTransfer.files);
    if (externalFiles.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      const droppedImages = externalFiles.filter(isSupportedImageFile);
      if (droppedImages.length === 0) {
        showToast('目前支持拖入 PNG、JPEG、WebP、GIF 或 AVIF 图片。', { tone: 'error' });
        return;
      }
      await importImageFiles(droppedImages, { x: e.clientX, y: e.clientY });
      return;
    }

    const raw = e.dataTransfer.getData(ASSET_DRAG_TYPE);
    if (!raw) return;
    e.preventDefault();

    let asset: any;
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

    if (asset.type === 'audio') {
      const newNode: NodeData = {
        id: crypto.randomUUID(),
        type: NodeType.AUDIO,
        x: canvasX,
        y: canvasY,
        prompt: asset.prompt || asset.name || '音频素材',
        status: NodeStatus.SUCCESS,
        mediaUrl: asset.url,
        model: 'Upload',
        aspectRatio: '16:9',
        resolution: 'Auto',
        ttsSource: 'imported'
      };
      setNodes(current => [...current, newNode]);
      setSelectedNodeIds([newNode.id]);
      return;
    }

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
  const isPushingLocalHistory = React.useRef(false);

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
    // 标记本次 historyState 变化来自当前画布，避免下面的同步 effect 在
    // pushHistory 生效前用旧 present 覆盖异步生成刚新增的结果节点。
    isPushingLocalHistory.current = true;
    pushHistory({ nodes, groups });
  }, [nodes, groups, isDragging]);

  // Apply history state when undo/redo is triggered
  // IMPORTANT: Don't revert nodes if any node is in LOADING status (generation in progress)
  useEffect(() => {
    if (isPushingLocalHistory.current) {
      if (historyState.nodes === nodes && historyState.groups === groups) {
        isPushingLocalHistory.current = false;
      }
      return;
    }

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

  // 撤销把删掉的节点拿回来时，把它的图片文件也从回收站还原回去。
  //
  // 挂在 nodes 上而不是 undo 上：撤销是异步生效的，而且「节点又出现了」这个条件
  // 对撤销、重做、以及其它任何让它回来的路径都成立，不用逐个入口去接。
  const restoreTrashInFlight = React.useRef(false);
  useEffect(() => {
    if (!workflowId || restoreTrashInFlight.current) return;
    if (pendingTrashRef.current.length === 0) return;

    const presentIds = new Set(nodes.map(node => node.id));
    const record = pendingTrashRef.current.find(item => item.nodeIds.some(id => presentIds.has(id)));
    if (!record) return;

    restoreTrashInFlight.current = true;
    pendingTrashRef.current = pendingTrashRef.current.filter(item => item.entryId !== record.entryId);
    void (async () => {
      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(workflowId)}/trash/${encodeURIComponent(record.entryId)}/restore`,
          { method: 'POST' }
        );
        await readApiResponse(response, '恢复图片失败');
        // 文件回来了，但 <img> 已经记住了那次 404，必须换个 URL 才会重新请求。
        setNodes(current => current.map(node => (
          record.nodeIds.includes(node.id) && typeof node.resultUrl === 'string' && node.resultUrl
            ? { ...node, resultUrl: `${node.resultUrl.split('?')[0]}?t=${Date.now()}` }
            : node
        )));
      } catch (error) {
        console.error('Failed to restore trashed image after undo:', error);
        showToast('撤销已还原节点，但图片没能从回收站取回，请在回收站中手动恢复。', { tone: 'error' });
      } finally {
        restoreTrashInFlight.current = false;
      }
    })();
  }, [nodes, workflowId, setNodes, showToast]);

  // Simple wrapper for updateNode (sync code removed - TEXT node prompts are combined at generation time)
  const updateNodeWithSync = React.useCallback((id: string, updates: Partial<NodeData>) => {
    updateNode(id, updates);
  }, [updateNode]);

  const handleUseCanvasVideoAsReference = React.useCallback(async () => {
    if (!canvasEditLock.guard()) return;
    const sourceNode = nodes.find(node => node.id === contextMenu.sourceNodeId);
    if (!sourceNode || sourceNode.type !== NodeType.VIDEO || !sourceNode.resultUrl) {
      showToast('当前节点没有可用的视频结果', { tone: 'error' });
      return;
    }
    if (!workflowId) {
      showToast('请先新建或打开项目', { tone: 'error' });
      return;
    }

    const remixNodeId = crypto.randomUUID();
    const initialRemix = createVideoRemixState({ remixId: remixNodeId });
    let targetY = sourceNode.y;
    const targetX = sourceNode.x + DEFAULT_NODE_WIDTH + 100;
    while (nodes.some(node => Math.abs(node.x - targetX) < 430 && Math.abs(node.y - targetY) < 320)) {
      targetY += 340;
    }
    const remixNode: NodeData = {
      id: remixNodeId,
      type: NodeType.VIDEO_REMIX,
      title: 'Video Remix',
      x: targetX,
      y: targetY,
      prompt: '',
      status: NodeStatus.IDLE,
      model: 'Banana Pro',
      aspectRatio: 'Auto',
      resolution: 'Auto',
      parentIds: [sourceNode.id],
      videoRemix: initialRemix,
    };

    setNodes(previous => [...previous, remixNode]);
    setSelectedNodeIds([remixNodeId]);
    setVideoRemixWorkspaceNodeId(remixNodeId);

    try {
      const source = await useCanvasVideoAsReference({
        workflowId,
        remixId: remixNodeId,
        sourceUrl: sourceNode.resultUrl,
        title: sourceNode.displayName || sourceNode.resultName || sourceNode.title || '画布视频',
      });
      setNodes(previous => previous.map(node => node.id === remixNodeId
        ? {
            ...node,
            videoRemix: replaceVideoRemixSource(node.videoRemix, source),
          }
        : node));
      showToast('参考视频已复制到当前项目');
    } catch (error) {
      const message = error instanceof Error ? error.message : '画布视频导入失败';
      setNodes(previous => previous.map(node => node.id === remixNodeId
        ? {
            ...node,
            videoRemix: setVideoRemixSourceError(node.videoRemix, message),
          }
        : node));
      showToast(message, { tone: 'error' });
    }
  }, [
    canvasEditLock,
    contextMenu.sourceNodeId,
    nodes,
    setNodes,
    setSelectedNodeIds,
    showToast,
    workflowId,
  ]);

  const subtitleLaunchesRef = useRef(new Set<string>());
  const handleAutoSubtitle = React.useCallback(async (sourceNodeId: string) => {
    if (!canvasEditLock.guard()) return;
    const source = nodes.find(node => node.id === sourceNodeId);
    if (!source?.resultUrl || source.type !== NodeType.VIDEO) {
      showToast('当前节点没有可识别的视频', { tone: 'error' });
      return;
    }
    if (!workflowId) {
      showToast('请先新建或打开项目', { tone: 'error' });
      return;
    }
    if (subtitleLaunchesRef.current.has(sourceNodeId) || nodes.some(node =>
      node.subtitleSourceNodeId === sourceNodeId &&
      node.status === NodeStatus.LOADING &&
      ['queued', 'extracting', 'transcribing', 'rendering'].includes(node.subtitleJobStatus || 'queued')
    )) {
      showToast('这个视频正在生成字幕');
      return;
    }

    subtitleLaunchesRef.current.add(sourceNodeId);
    const resultNodeId = crypto.randomUUID();
    const targetX = source.x + 485;
    let targetY = source.y;
    while (nodes.some(node => Math.abs(node.x - targetX) < 390 && Math.abs(node.y - targetY) < 280)) {
      targetY += 320;
    }
    const resultNode: NodeData = {
      id: resultNodeId,
      type: NodeType.VIDEO,
      title: '字幕视频',
      x: targetX,
      y: targetY,
      prompt: '',
      status: NodeStatus.LOADING,
      parentIds: [sourceNodeId],
      model: '自动字幕',
      videoModel: '自动字幕',
      videoDuration: source.videoDuration,
      aspectRatio: source.aspectRatio || '16:9',
      resolution: source.resolution || 'Auto',
      subtitleSourceNodeId: sourceNodeId,
      subtitleJobStatus: 'queued',
      subtitleJobStage: 'queued',
      subtitleJobProgress: 0,
    };
    setNodes(previous => [...previous, resultNode]);
    setSelectedNodeIds([resultNodeId]);
    showToast('正在识别人声并生成字幕视频…', { duration: 5000 });

    try {
      const response = await fetch('/api/auto-subtitles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId,
          sourceNodeId,
          resultNodeId,
          sourceVideoUrl: source.resultUrl,
        }),
      });
      const job = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(job.error || '自动字幕任务提交失败');
      updateNode(resultNodeId, {
        subtitleJobId: job.jobId,
        subtitleJobStatus: job.status,
        subtitleJobStage: job.stage,
        subtitleJobProgress: job.progress,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '自动字幕任务提交失败';
      updateNode(resultNodeId, {
        status: NodeStatus.ERROR,
        subtitleJobStatus: 'failed',
        errorMessage: message,
      });
      showToast(message, { tone: 'error', duration: 6500 });
    } finally {
      subtitleLaunchesRef.current.delete(sourceNodeId);
    }
  }, [canvasEditLock, nodes, setNodes, setSelectedNodeIds, showToast, updateNode, workflowId]);

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  // 画布容器的屏幕偏移只在窗口 resize / 侧边栏折叠时变化，但原来拖连线时每个
  // pointermove 都要 getBoundingClientRect()，render 里还要再读一次。
  // 写完 DOM 立刻读几何量会强制同步重排 —— 在拖拽路径上就是每帧一次。
  // 这里缓存下来：ResizeObserver 负责布局变化，指针按下时再兜底刷新一次。
  const canvasOffsetRef = useRef<{ left: number; top: number } | undefined>(undefined);
  const [canvasOffset, setCanvasOffset] = useState<{ left: number; top: number } | undefined>(undefined);

  const refreshCanvasOffset = React.useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const next = rect ? { left: rect.left, top: rect.top } : undefined;
    canvasOffsetRef.current = next;
    setCanvasOffset(previous => (
      previous?.left === next?.left && previous?.top === next?.top ? previous : next
    ));
  }, [canvasRef]);

  useEffect(() => {
    refreshCanvasOffset();
    window.addEventListener('resize', refreshCanvasOffset);
    window.addEventListener('scroll', refreshCanvasOffset, true);

    const element = canvasRef.current;
    // 侧边栏折叠有 CSS 过渡，按下即读会拿到动画前的值；ResizeObserver 会在
    // 每一帧布局稳定后回调，所以过渡结束时缓存一定是最新的。
    const observer = typeof ResizeObserver !== 'undefined' && element
      ? new ResizeObserver(refreshCanvasOffset)
      : null;
    if (observer && element) observer.observe(element);

    return () => {
      window.removeEventListener('resize', refreshCanvasOffset);
      window.removeEventListener('scroll', refreshCanvasOffset, true);
      observer?.disconnect();
    };
  }, [refreshCanvasOffset, canvasRef]);

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
    if (updateConnectionDrag(e)) return;

    // 4. Handle Canvas Panning (disabled when selection box is active)
    if (!isSelecting) {
      updatePanning(e, setViewport);
    }
  };

  /**
   * Handle when a connection is made between nodes
   * Syncs prompt if parent is a Text node
   */
  const handleConnectionMade = React.useCallback((
    parentId: string,
    childId: string,
    currentNodes: NodeData[] = nodes
  ): Partial<NodeData> => {
    const parentNode = currentNodes.find(n => n.id === parentId);
    const childNode = currentNodes.find(n => n.id === childId);
    if (!parentNode || !childNode) return {};

    const updates: Partial<NodeData> = {};
    if (parentNode.type === NodeType.TEXT && parentNode.prompt) {
      updates.prompt = parentNode.prompt;
    }
    if (childNode.type === NodeType.PRODUCT_SCENE_REPLACE) {
      Object.assign(updates, assignProductSceneInputOnConnect(childNode, parentNode, currentNodes));
    }
    return updates;
  }, [nodes]);

  const handleCanvasEdgeClick = React.useCallback((
    event: React.MouseEvent,
    parentId: string,
    childId: string
  ) => {
    // Edge and node selections are mutually exclusive. This also prevents a
    // stale selected child node from winning the subsequent Delete key.
    setSelectedNodeIds([]);
    handleEdgeClick(event, parentId, childId);
  }, [handleEdgeClick, setSelectedNodeIds]);

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

  // ==========================================================================
  // 画布节点的稳定 props
  //
  // CanvasNode 已经用 React.memo 包起来了，但 memo 只有在 props 引用稳定时才有用。
  // 下面这几块负责消除"每次 render 都换新引用"的 props：内联箭头函数、
  // 每帧重新计算的派生数组。拖一个节点时 setNodes 每帧触发一次 render，
  // 没有这些处理，60 个节点就是每帧 60 次子树重建。
  // ==========================================================================

  // 每个节点用于预览的上游产物 URL。字符串按值比较，直接重算即可。
  const nodeInputUrls = React.useMemo(() => {
    const byId = new Map(nodes.map(item => [item.id, item]));
    const map = new Map<string, string | undefined>();
    for (const node of nodes) {
      const parentId = node.parentIds?.[0];
      const parent = parentId ? byId.get(parentId) : undefined;
      if (!parent) {
        map.set(node.id, undefined);
      } else if (node.type === NodeType.VIDEO_EDITOR && parent.type === NodeType.VIDEO) {
        // VIDEO_EDITOR nodes need the actual video URL from parent Video node
        map.set(node.id, parent.resultUrl);
      } else if (parent.type === NodeType.VIDEO && parent.lastFrame) {
        // For other nodes, if parent is video, use lastFrame for image preview
        map.set(node.id, parent.lastFrame);
      } else {
        map.set(node.id, parent.resultUrl);
      }
    }
    return map;
  }, [nodes]);

  // collectNodeReferences 每次都返回新数组。它只依赖 parentIds 和被指向的父节点对象，
  // 所以这些引用没变时复用上一次的数组——否则拖拽期间每个节点的 connectedReferences
  // 都是新引用，memo 会全部失效。
  const referenceCacheRef = useRef(new Map<string, { deps: unknown[]; value: NodeReference[] }>());
  const nodeConnectedReferences = React.useMemo(() => {
    const byId = new Map(nodes.map(item => [item.id, item]));
    const previous = referenceCacheRef.current;
    const nextCache = new Map<string, { deps: unknown[]; value: NodeReference[] }>();
    const result = new Map<string, NodeReference[]>();

    for (const node of nodes) {
      const deps: unknown[] = [node.parentIds];
      for (const parentId of node.parentIds || []) deps.push(byId.get(parentId));

      const cached = previous.get(node.id);
      const reusable = Boolean(cached)
        && cached!.deps.length === deps.length
        && cached!.deps.every((dep, index) => dep === deps[index]);

      const value = reusable ? cached!.value : collectNodeReferences(node.parentIds, nodes);
      nextCache.set(node.id, { deps, value });
      result.set(node.id, value);
    }

    referenceCacheRef.current = nextCache;
    return result;
  }, [nodes]);

  // 这十几个回调来自不同的 hook，稳定性无法逐个保证。用 ref 转发：
  // 传给 CanvasNode 的引用永远不变，内部始终调用最新实现。
  const latestNodeCallbacks = {
    updateNodeWithSync,
    handleGenerate,
    handleAddNext,
    handleNodeContextMenu,
    handleConnectorPointerDown,
    handleOpenEditor,
    handleUpload,
    handleExpandImage,
    handleWriteContent,
    handleTextToVideo,
    handleTextToImage,
    handleImageToImage,
    handleImageToVideo,
    handleChangeAngleGenerate,
    handleExtractLastFrame,
    handleAutoSubtitle,
    setVideoRemixWorkspaceNodeId,
    handleDuplicate,
    handleNodePointerDown,
    setSelectedNodeIds,
    selectedNodeIds
  };
  const nodeCallbacksRef = useRef(latestNodeCallbacks);
  useEffect(() => {
    nodeCallbacksRef.current = latestNodeCallbacks;
  });

  const stableNodeHandlers = React.useMemo(() => ({
    onUpdate: (id: string, updates: Partial<NodeData>) =>
      nodeCallbacksRef.current.updateNodeWithSync(id, updates),
    onGenerate: (id: string) => nodeCallbacksRef.current.handleGenerate(id),
    onAddNext: (id: string, type: 'left' | 'right', anchor?: { x: number; y: number }) =>
      nodeCallbacksRef.current.handleAddNext(id, type, anchor),
    onContextMenu: (e: React.MouseEvent, id: string) =>
      nodeCallbacksRef.current.handleNodeContextMenu(e, id),
    onConnectorDown: (e: React.PointerEvent, id: string, side: 'left' | 'right') => {
      // 连线拖拽全程读缓存的画布偏移，开始时兜底刷新一次（每次手势一次，不是每帧）。
      refreshCanvasOffset();
      nodeCallbacksRef.current.handleConnectorPointerDown(e, id, side);
    },
    onSelect: (id: string) => {
      setSelectedConnection(null);
      nodeCallbacksRef.current.setSelectedNodeIds([id]);
    },
    onOpenEditor: (id: string) => nodeCallbacksRef.current.handleOpenEditor(id),
    onUpload: (id: string, imageDataUrl: string) =>
      nodeCallbacksRef.current.handleUpload(id, imageDataUrl),
    onExpand: (imageUrl: string) => nodeCallbacksRef.current.handleExpandImage(imageUrl),
    onWriteContent: (id: string) => nodeCallbacksRef.current.handleWriteContent(id),
    onTextToVideo: (id: string) => nodeCallbacksRef.current.handleTextToVideo(id),
    onTextToImage: (id: string) => nodeCallbacksRef.current.handleTextToImage(id),
    onImageToImage: (id: string) => nodeCallbacksRef.current.handleImageToImage(id),
    onImageToVideo: (id: string) => nodeCallbacksRef.current.handleImageToVideo(id),
    onChangeAngleGenerate: (id: string) =>
      nodeCallbacksRef.current.handleChangeAngleGenerate(id),
    onExtractLastFrame: (id: string) => nodeCallbacksRef.current.handleExtractLastFrame(id),
    onAutoSubtitle: (id: string) => nodeCallbacksRef.current.handleAutoSubtitle(id),
    onOpenVideoRemix: (id: string) => nodeCallbacksRef.current.setVideoRemixWorkspaceNodeId(id),
    onNodePointerDown: (e: React.PointerEvent, id: string) => {
      setSelectedConnection(null);
      const current = nodeCallbacksRef.current;
      const currentSelection = current.selectedNodeIds;
      if (e.altKey) {
        const sourceIds = currentSelection.includes(id) && currentSelection.length > 1
          ? currentSelection
          : [id];
        const duplicatedIds = current.handleDuplicate(sourceIds);
        if (duplicatedIds.length > 0) {
          current.handleNodePointerDown(e, duplicatedIds[0], undefined);
        }
        return;
      }
      // If shift is held, preserve selection for multi-drag/multi-select
      if (e.shiftKey) {
        if (!currentSelection.includes(id)) {
          // Add to selection
          current.setSelectedNodeIds(previous => [...previous, id]);
        }
        current.handleNodePointerDown(e, id, undefined);
        return;
      }
      // No shift: always select just this node (to show its controls)
      current.setSelectedNodeIds([id]);
      current.handleNodePointerDown(e, id, undefined);
    }
  }), [refreshCanvasOffset]);

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
          onCreateProject={handleRequestNewProject}
          onDeleteProject={handleDeleteCurrentProject}
          onRevealProject={revealCurrentProject}
          onRenameNode={renameSidebarNode}
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

      <CreateProjectModal
        isOpen={isCreateProjectModalOpen}
        onClose={() => setIsCreateProjectModalOpen(false)}
        onCreate={handleCreateProject}
        canvasTheme={canvasTheme}
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
          onRefresh={handleRefreshCurrentCanvas}
          onNew={handleRequestNewProject}
          hasUnsavedChanges={hasUnsavedChanges}
          canvasTheme={canvasTheme}
          onToggleTheme={() => setCanvasTheme(prev => prev === 'dark' ? 'light' : 'dark')}
          lastAutoSaveTime={lastAutoSaveTime}
          workflowId={workflowId}
          onRestoreNodes={(restoredNodes) => {
            if (restoredNodes.length === 0) return;
            setNodes(current => {
              const currentIds = new Set(current.map(node => node.id));
              return [...current, ...restoredNodes.filter(node => !currentIds.has(node.id))];
            });
            setSelectedNodeIds(restoredNodes.map(node => node.id));
          }}
          showBrand={false}
          sidebarOffset={sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : EXPANDED_SIDEBAR_WIDTH}
        />
      )}

      {/* 没有项目时的只读提示。刻意只加一层提示，不改动画布本身的结构与样式。 */}
      {!canEditCanvas && (
        <div
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
          style={{ left: sidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : EXPANDED_SIDEBAR_WIDTH }}
        >
          <div className="rounded-2xl border border-neutral-700/70 bg-black/70 px-5 py-3 text-center backdrop-blur-sm">
            <p className="text-sm font-medium text-neutral-100">请先新建项目，再开始编辑画布</p>
            <p className="mt-1 text-[11px] text-neutral-400">点击顶部「+ 新建」创建项目后即可添加节点</p>
          </div>
        </div>
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
              canvasOffset={canvasOffset}
              selectedConnection={selectedConnection}
              onEdgeClick={handleCanvasEdgeClick}
            />
          </svg>

          {/* Nodes Layer */}
          <div className="pointer-events-auto">
            {nodes.map(node => (
              <CanvasNode
                workflowId={workflowId || undefined}
                key={node.id}
                data={node}
                // allNodes 只有漫剧成片/产品场景节点用得上（组装 manifest）。
                // 无差别下发会让每个节点在拖拽时都收到新数组，memo 直接失效。
                allNodes={NODE_TYPES_NEEDING_ALL_NODES.has(node.type) ? nodes : undefined}
                inputUrl={nodeInputUrls.get(node.id)}
                connectedReferences={nodeConnectedReferences.get(node.id)}
                onUpdate={stableNodeHandlers.onUpdate}
                onGenerate={stableNodeHandlers.onGenerate}
                onAddNext={stableNodeHandlers.onAddNext}
                selected={selectedNodeIds.includes(node.id)}
                showControls={selectedNodeIds.length === 1 && selectedNodeIds.includes(node.id)}
                onNodePointerDown={stableNodeHandlers.onNodePointerDown}
                onContextMenu={stableNodeHandlers.onContextMenu}
                onSelect={stableNodeHandlers.onSelect}
                onConnectorDown={stableNodeHandlers.onConnectorDown}
                isHoveredForConnection={connectionHoveredNodeId === node.id}
                onOpenEditor={stableNodeHandlers.onOpenEditor}
                onUpload={stableNodeHandlers.onUpload}
                onExpand={stableNodeHandlers.onExpand}
                onWriteContent={stableNodeHandlers.onWriteContent}
                onTextToVideo={stableNodeHandlers.onTextToVideo}
                onTextToImage={stableNodeHandlers.onTextToImage}
                onImageToImage={stableNodeHandlers.onImageToImage}
                onImageToVideo={stableNodeHandlers.onImageToVideo}
                onChangeAngleGenerate={stableNodeHandlers.onChangeAngleGenerate}
                onExtractLastFrame={stableNodeHandlers.onExtractLastFrame}
                onAutoSubtitle={stableNodeHandlers.onAutoSubtitle}
                onOpenVideoRemix={stableNodeHandlers.onOpenVideoRemix}
                zoom={viewport.zoom}
                onMouseEnter={handleNodeMouseEnter}
                onMouseLeave={handleNodeMouseLeave}
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
        onPaste={canvasEditLock.withGuard(handlePaste)}
        onCopy={handleCopy}
        onDuplicate={handleDuplicate}
        onCreateAsset={handleContextMenuCreateAsset}
        onUseAsReferenceVideo={() => void handleUseCanvasVideoAsReference()}
        canUseAsReferenceVideo={nodes.some(node =>
          node.id === contextMenu.sourceNodeId
          && node.type === NodeType.VIDEO
          && Boolean(node.resultUrl)
        )}
        onAddAssets={handleContextMenuAddAssets}
        onOpenStoryboard={storyboardGenerator.openModal}
        onOpenHistory={handleContextMenuOpenHistory}
        canUndo={canUndo}
        canRedo={canRedo}
        canvasTheme={canvasTheme}
      />

      {videoRemixWorkspaceNodeId && nodes.find(node => node.id === videoRemixWorkspaceNodeId) && (
        <VideoRemixWorkspace
          node={nodes.find(node => node.id === videoRemixWorkspaceNodeId)!}
          workflowId={workflowId || undefined}
          canvasTheme={canvasTheme}
          onUpdateNode={updateNodeWithSync}
          onClose={() => setVideoRemixWorkspaceNodeId(null)}
        />
      )}

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
        initialGenerationCount={nodes.find(n => n.id === editorModal.nodeId)?.imageGenerationCount || 1}
        initialElements={nodes.find(n => n.id === editorModal.nodeId)?.editorElements as any}
        initialCanvasData={nodes.find(n => n.id === editorModal.nodeId)?.editorCanvasData}
        initialCanvasSize={nodes.find(n => n.id === editorModal.nodeId)?.editorCanvasSize}
        initialBackgroundUrl={nodes.find(n => n.id === editorModal.nodeId)?.editorBackgroundUrl}
        onClose={handleCloseImageEditor}
        onGenerate={async (sourceId, prompt, count, generationSettings) => {
          handleCloseImageEditor();

          const sourceNode = nodes.find(n => n.id === sourceId);
          if (!sourceNode) return;

          // Use the modal's current values directly. React may not have committed
          // the preceding onUpdate yet when the generate callback starts.
          const imageModel = generationSettings.imageModel;
          const aspectRatio = generationSettings.aspectRatio;
          const resolution = generationSettings.resolution;

          // Flow / 即梦原生支持一次返回多张图。纯文生图仍向右横排且不连线；
          // 带参考素材时改为纵向排列，并让每张结果都连接同一组参考节点。
          if (getImageGenerationProvider(imageModel)?.supportsMultipleOutputs) {
            updateNode(sourceId, {
              prompt,
              imageModel,
              aspectRatio,
              resolution,
              imageGenerationCount: Math.min(4, Math.max(1, count)),
              status: NodeStatus.LOADING,
              generationStartTime: Date.now(),
              errorMessage: undefined
            });

            try {
              let imageBase64: string | undefined;
              if (editorModal.imageUrl) {
                imageBase64 = await urlToBase64(editorModal.imageUrl);
              }
              const rawResultUrls = await generateImageBatch({
                workflowId: workflowId || '',
                prompt,
                imageBase64,
                imageModel,
                aspectRatio,
                resolution,
                nodeId: sourceId,
                count: Math.min(4, Math.max(1, count))
              });
              const generatedAt = Date.now();
              const resultUrls = rawResultUrls.slice(0, 4).map(
                (url, index) => `${url}${url.includes('?') ? '&' : '?'}t=${generatedAt}-${index}`
              );
              const connectedReferenceParentIds = collectNodeReferences(sourceNode.parentIds, nodes)
                .filter(reference =>
                  (reference.kind === 'image' || reference.kind === 'video')
                  && Boolean(reference.previewUrl || reference.url)
                )
                .map(reference => reference.id);
              const hasReferenceImage = Boolean(editorModal.imageUrl);

              const additionalNodes: NodeData[] = createAdditionalImagePlacements(
                sourceNode,
                resultUrls,
                hasReferenceImage
                  ? {
                    layout: 'vertical',
                    parentIds: connectedReferenceParentIds
                  }
                  : undefined
              ).map((placement, index) => ({
                id: crypto.randomUUID(),
                type: NodeType.IMAGE,
                title: `${getImageGenerationProvider(imageModel)?.name || '生成'} ${index + 2}`,
                x: placement.x,
                y: placement.y,
                prompt,
                status: NodeStatus.SUCCESS,
                resultUrl: placement.resultUrl,
                model: sourceNode.model || 'Banana Pro',
                imageModel,
                imageGenerationCount: Math.min(4, Math.max(1, count)),
                aspectRatio,
                resolution,
                parentIds: placement.parentIds
              }));

              // Commit the first result and all additional nodes atomically. This
              // prevents a save between the two updates from persisting half a batch.
              setNodes(previous => [
                ...previous.map(node => node.id === sourceId ? {
                  ...node,
                  status: NodeStatus.SUCCESS,
                  resultUrl: resultUrls[0],
                  prompt,
                  imageModel,
                  aspectRatio,
                  resolution,
                  imageGenerationCount: Math.min(4, Math.max(1, count)),
                  generationStartTime: undefined,
                  errorMessage: undefined
                } : node),
                ...additionalNodes
              ]);
            } catch (error: any) {
              updateNode(sourceId, {
                status: NodeStatus.ERROR,
                errorMessage: error.message
              });
            }
            return;
          }

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
                workflowId: workflowId || '',
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

      {/* 应用内提示（替代会冻住渲染进程的 window.alert） */}
      <ToastStack toasts={toasts} onDismiss={dismissToast} canvasTheme={canvasTheme} />
    </div >
  );
}
