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
  cancelGeneration as requestCancelGeneration,
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
import { usePanelState } from './hooks/usePanelState';
import { useAssetHandlers } from './hooks/useAssetHandlers';
import { useTextNodeHandlers } from './hooks/useTextNodeHandlers';
import { useImageNodeHandlers } from './hooks/useImageNodeHandlers';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { isSupportedImageFile, useCanvasImageImport } from './hooks/useCanvasImageImport';
import { useContextMenuHandlers } from './hooks/useContextMenuHandlers';
import { TOAST_PERSIST, useToasts } from './hooks/useToasts';
import { useCanvasEditLock } from './hooks/useCanvasEditLock';
import { ToastStack } from './components/ToastStack';
import { ShortcutHelpModal } from './components/modals/ShortcutHelpModal';
import { useAutoSave } from './hooks/useAutoSave';
import { useGenerationRecovery } from './hooks/useGenerationRecovery';
import { useDetailRemixRecovery } from './hooks/useDetailRemixRecovery';
import { useVideoFrameExtraction } from './hooks/useVideoFrameExtraction';
import { extractVideoLastFrame } from './utils/videoHelpers';
import { createAdditionalImagePlacements } from './utils/imageBatchLayout';
import { readApiResponse } from './utils/apiResponse';
import { createCanvasSaveScheduler, type CanvasSaveScheduler } from './utils/canvasSaveScheduler.js';
import { SelectionBoundingBox } from './components/canvas/SelectionBoundingBox';
import { WorkflowPanel } from './components/WorkflowPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { ImageEditorModal } from './components/modals/ImageEditorModal';
import { ExpandedMediaModal } from './components/modals/ExpandedMediaModal';
import { CreateAssetModal } from './components/modals/CreateAssetModal';
import { CreateProjectModal } from './components/modals/CreateProjectModal';
import { TikTokImportModal } from './components/modals/TikTokImportModal';
import { AssetLibraryPanel, type LibraryAsset } from './components/AssetLibraryPanel';
import { useTikTokImport } from './hooks/useTikTokImport';
import { isValidNodeConnection } from '@/shared/connectionRules.js';
import { canvasViewCenter, centerNodeAt, computeFitViewport, screenToCanvas, DEFAULT_NODE_WIDTH, DEFAULT_NODE_HEIGHT } from '@/shared/canvasCoords.js';
import { ZOOM_MIN, ZOOM_MAX } from '@/shared/zoom.js';
import { getCanvasRect } from './utils/canvasRect';
import { visibleNodeIds } from './utils/viewportCulling.js';
import { MapPinned } from 'lucide-react';
import { CanvasMinimap } from './components/canvas/CanvasMinimap';
import { CanvasZoomControl } from './components/canvas/CanvasZoomControl';
import { collectNodeReferences, type NodeReference } from './utils/nodeReferences.js';
import { upsertProductSceneResultNode } from './utils/productSceneResult.js';
import { upsertDetailRemixResultNodes } from './utils/detailRemixResult.js';
import { getImageGenerationProvider } from '@/shared/generationProviders.js';
import { listVideoGenerationProviders } from '@/shared/generationProviders.js';
import { assignProductSceneInputOnConnect } from './utils/productSceneInputMapping.js';
import { dismissDetailRemixResultNodes } from './services/detailRemixService';
import {
  normalizeVideoRemixProjects,
  type VideoRemixProject,
} from '@/shared/videoRemixProjects.js';
import { analyzeVideoAnalysisNode } from './features/video-analysis/videoAnalysisService';
import { buildVideoRemixGraph } from './features/video-analysis/remixGraphBuilder';
import {
  assignVideoAnalysisInputPort,
  createVideoAnalysisNodeData,
  markVideoAnalysisDependentsStale,
} from '../shared/videoAnalysis.js';
import {
  assignDetailRemixInputPort,
  markDetailRemixDependentsStale,
} from '../shared/detailRemix.js';
import type { VideoAnalysisNodeData } from '../shared/videoAnalysis.js';
import {
  generateStickmanShotVideo,
  getStickmanMergeJob,
  runStickmanDirector,
  submitStickmanMerge,
} from './features/stickman-director/stickmanDirectorService';
import { createStickmanScriptFromAnalysis, mergeStickmanShotsPreservingGeneration, normalizeStickmanSettings, rollupStickmanGenerationStatus } from '../shared/stickmanDirector.js';
import type { StickmanDirectorOutput, StickmanShot } from '../shared/stickmanDirector.js';
import {
  generateCinematicShotVideo,
  getCinematicMergeJob,
  runCinematicDirector,
  submitCinematicMerge,
} from './features/cinematic-director/cinematicDirectorService';
import {
  mergeCinematicShotsPreservingGeneration,
  normalizeCinematicCast,
  normalizeCinematicDirectorOutput,
  normalizeCinematicSettings,
  rollupCinematicGenerationStatus,
  validateCinematicReferenceBudget,
} from '../shared/cinematicDirector.js';
import type { CinematicDirectorOutput, CinematicShot } from '../shared/cinematicDirector.js';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

// 只有这几类节点会把 allNodes 传下去（漫剧成片/产品场景替换要用全量节点组装 manifest）。
// 其余节点不该拿到这个每帧都变的数组，否则 CanvasNode 的 memo 形同虚设。
const NODE_TYPES_NEEDING_ALL_NODES = new Set<NodeType>([
  NodeType.PRODUCT_SCENE_REPLACE,
  NodeType.DETAIL_PAGE_REMIX,
  NodeType.VIDEO_ANALYSIS,
  NodeType.REFERENCE_VIDEO,
  NodeType.SCRIPT_INPUT,
  NodeType.STICKMAN_DIRECTOR,
  NodeType.STORYBOARD,
  NodeType.STORYBOARD_COMPARE,
  NodeType.FLOW_BATCH_VIDEO,
  NodeType.VIDEO_MERGE,
  NodeType.CINEMATIC_CAST,
  NodeType.CINEMATIC_DIRECTOR,
  NodeType.CINEMATIC_STORYBOARD,
  NodeType.CINEMATIC_VIDEO_MERGE,
  ...Object.values(NodeType).filter(isMangaNode)
]);

type CanvasHistoryState = {
  nodes: NodeData[];
  groups: ReturnType<typeof useGroupManagement>['groups'];
  selectedNodeIds: string[];
};

type SpecialGenerationKind = 'stickman' | 'cinematic';
type SpecialRunControl = {
  kind: SpecialGenerationKind;
  storyboardId: string;
  paused: boolean;
};
type SpecialShotController = {
  kind: SpecialGenerationKind;
  storyboardId: string;
  shotId: string;
  nodeId: string;
  controller: AbortController;
};

const specialRunKey = (kind: SpecialGenerationKind, storyboardId: string) => `${kind}:${storyboardId}`;
const specialShotKey = (kind: SpecialGenerationKind, storyboardId: string, shotId: string) => `${kind}:${storyboardId}:${shotId}`;

type StickmanScriptDraft = Pick<NonNullable<NodeData['scriptInput']>, 'title' | 'content' | 'notes' | 'platform'>;

const pickStickmanScriptInput = (
  source: Partial<StickmanScriptDraft> | undefined,
  fallbackTitle = '未命名剧本',
  fallbackPlatform = '抖音',
): StickmanScriptDraft => ({
  title: String(source?.title || fallbackTitle),
  content: String(source?.content || ''),
  notes: String(source?.notes || ''),
  platform: String(source?.platform || fallbackPlatform),
});

// 单个节点的媒体指纹。**只在节点对象引用变化时**才需要重算，见下方 useEffect。
const nodeMediaSignature = (node: NodeData) => [
  node.resultUrl || '',
  node.lastFrame || '',
  node.mediaUrl || '',
  node.renderOutputUrl || '',
  node.videoMerge?.outputUrl || '',
  (node.storyboard?.shots || []).map(shot => [
    shot.id,
    shot.generation?.status || '',
    shot.generation?.videoUrl || '',
  ].join(':')).join(','),
].join('|');

type MediaEntry = { node: NodeData; sig: string };

// 媒体产物/LOADING 变化后的落盘延迟。够短，崩溃时丢的内容有限；
// 够长，能把批量生成里密集到达的变化合并成一次写盘。
const CANVAS_SAVE_DEBOUNCE_MS = 1200;

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
  const [isImportingLocalProject, setIsImportingLocalProject] = useState(false);
  const [isMinimapOpen, setIsMinimapOpen] = useState(false);
  const [videoRemixes, setVideoRemixes] = useState<VideoRemixProject[]>([]);

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
  const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState(false);
  const toggleShortcutHelp = React.useCallback(() => setIsShortcutHelpOpen(open => !open), []);

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
    // 节点内部的 textarea、下拉框和列表继续优先消费普通滚轮事件，
    // 但 Ctrl/Cmd + 滚轮属于画布缩放，鼠标悬停在节点内时也必须放行。
    const isZoomGesture = e.ctrlKey || e.metaKey;
    if (!isZoomGesture && e.target instanceof Element && e.target.closest('[data-node-id]')) return;

    const hoveredId = canvasHoveredNodeIdRef.current;
    const hoveredNode = hoveredId ? nodes.find(n => n.id === hoveredId) : undefined;
    baseHandleWheel(e, hoveredNode);
  };

  const {
    nodes,
    setNodes,
    selectedNodeIds,
    setSelectedNodeIds,
    addStickmanWorkflow,
    addStickmanWorkflowFromParent,
    addCinematicWorkflow,
    updateNode,
    deleteNodes,
    clearSelection,
    handleSelectTypeFromMenu
  } = useNodeManagement();

  const {
    isDraggingConnection,
    connectionStart,
    tempConnectionEnd,
    selectedConnection,
    setSelectedConnection,
    handleConnectorPointerDown,
    updateConnectionDrag,
    completeConnectionDrag,
    resetConnectionDrag,
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
    releasePointerCapture,
    abortPointerInteractions
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
    commitHistoryTransition,
    canUndo,
    canRedo
  } = useHistory({ nodes, groups, selectedNodeIds }, 50, isSameCanvasHistoryState);
  const isApplyingHistory = React.useRef(false);
  const isPushingLocalHistory = React.useRef(false);
  const activeCanvasHistoryTransactionRef = React.useRef<{
    id: string;
    label: string;
    before: CanvasHistoryState;
  } | null>(null);
  const groupsRef = React.useRef(groups);
  groupsRef.current = groups;
  const selectedNodeIdsRef = React.useRef(selectedNodeIds);
  selectedNodeIdsRef.current = selectedNodeIds;
  const [activeCanvasHistoryTransactionId, setActiveCanvasHistoryTransactionId] = React.useState<string | null>(null);
  const cancelActiveImportRef = React.useRef<(() => boolean) | null>(null);

  const beginCanvasHistoryTransaction = React.useCallback((label: string) => {
    if (activeCanvasHistoryTransactionRef.current) return null;
    const id = crypto.randomUUID();
    activeCanvasHistoryTransactionRef.current = {
      id,
      label,
      before: { nodes, groups: groupsRef.current, selectedNodeIds: selectedNodeIdsRef.current },
    };
    setActiveCanvasHistoryTransactionId(id);
    return id;
  }, [nodes]);

  const commitCanvasHistoryTransaction = React.useCallback((
    transactionId: string,
    finalNodes: NodeData[],
    finalSelectedNodeIds?: string[],
  ) => {
    const transaction = activeCanvasHistoryTransactionRef.current;
    if (!transaction || transaction.id !== transactionId) return;
    activeCanvasHistoryTransactionRef.current = null;
    setActiveCanvasHistoryTransactionId(null);
    isPushingLocalHistory.current = true;
    commitHistoryTransition(transaction.before, {
      nodes: finalNodes,
      groups: groupsRef.current,
      selectedNodeIds: finalSelectedNodeIds || selectedNodeIdsRef.current,
    });
  }, [commitHistoryTransition]);

  const rollbackCanvasHistoryTransaction = React.useCallback((transactionId: string) => {
    const transaction = activeCanvasHistoryTransactionRef.current;
    if (!transaction || transaction.id !== transactionId) return;
    activeCanvasHistoryTransactionRef.current = null;
    setActiveCanvasHistoryTransactionId(null);
    isApplyingHistory.current = true;
    setNodes(transaction.before.nodes);
    setGroups(transaction.before.groups);
    setSelectedNodeIds(transaction.before.selectedNodeIds);
  }, [setGroups, setNodes, setSelectedNodeIds]);

  const handleCanvasUndo = React.useCallback(() => {
    if (cancelActiveImportRef.current?.()) return;
    undo();
  }, [undo]);

  const handleCanvasRedo = React.useCallback(() => {
    if (activeCanvasHistoryTransactionRef.current) return;
    redo();
  }, [redo]);

  // Mark as dirty when nodes or title change
  const isInitialMount = React.useRef(true);
  const lastLoadingCountRef = React.useRef(0);
  const ignoreNextChange = React.useRef(false);
  // null 表示"还没建立基线"：首次运行只记录，不触发保存。
  const mediaEntriesRef = React.useRef<Map<string, MediaEntry> | null>(null);
  const saveSchedulerRef = React.useRef<CanvasSaveScheduler | null>(null);
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
    openWorkflowPanel,
    closeWorkflowPanel,
    resetWorkflowId,
    handleCreateWorkflow
  } = useWorkflow({
    nodes,
    groups,
    viewport,
    canvasTitle,
    videoRemixes,
    setNodes,
    setGroups,
    setViewport,
    setSelectedNodeIds,
    setCanvasTitle,
    setEditingTitleValue,
    setVideoRemixes,
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
   * 删除项目图片/视频节点时，本地文件会被移进 .trash；而撤销（Ctrl+Z）只还原画布状态，
   * 不碰磁盘 —— 节点方框回来了，素材却 404。这里记下「哪几个节点的素材进了哪个
   * 回收站条目」，节点一旦重新出现在画布上就把文件还原回去。
   */
  const pendingTrashRef = React.useRef<{ entryId: string; nodeIds: string[] }[]>([]);
  const trashDeleteInFlight = React.useRef(false);
  const deleteNodesWithTrash = React.useCallback(async (ids: string[]) => {
    const uniqueIds = [...new Set(ids)];
    const deleted = nodes.filter(node => uniqueIds.includes(node.id));
    const trashableMediaTypes = new Set<NodeType>([
      NodeType.IMAGE,
      NodeType.IMAGE_EDITOR,
      NodeType.CAMERA_ANGLE,
      NodeType.VIDEO,
      NodeType.REFERENCE_VIDEO,
      NodeType.FLOW_BATCH_VIDEO,
      NodeType.VIDEO_MERGE,
      NodeType.CINEMATIC_VIDEO_MERGE,
      NodeType.RENDER,
    ]);
    const hasProjectMedia = Boolean(workflowId) && deleted.some(node => {
      if (!trashableMediaTypes.has(node.type)) return false;
      const urls = [
        node.resultUrl,
        node.lastFrame,
        node.editorCanvasData,
        node.editorBackgroundUrl,
        node.mediaUrl,
        node.renderOutputUrl,
        ...(node.imageVersions || []).map(version => version?.url),
      ];
      return urls.some(url => (
        typeof url === 'string'
        && /\/library\/projects\/[^/]+\/(?:images|videos)\//.test(url)
      ));
    });

    // 产品短视频任务的结果节点（图片和视频都算）删掉后要在任务里记一笔，否则画布恢复
    // 逻辑会把它当成「结果还在但节点丢了」，下一轮就原样长回来 —— 表现就是删不掉。
    // 视频节点走不到下面的回收站分支，所以这一步必须在分支之前做。
    if (workflowId) {
      void dismissProductSceneResultNodes(uniqueIds, workflowId);
      void dismissDetailRemixResultNodes(uniqueIds, workflowId);
    }

    if (!hasProjectMedia) {
      deleteNodes(uniqueIds);
      return;
    }
    if (trashDeleteInFlight.current) return;

    // 本地素材移入回收站需要一次磁盘往返。先清掉选中态，让节点下方的提示词
    // 控制面板立即消失；否则素材文件已经移动时，控制面板仍会留在画布上，看起来像
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
      // 记下这次删除对应的回收站条目：撤销只会把节点还原到画布上，素材文件还在
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
      console.error('Failed to move canvas media to trash:', error);
      window.alert(error instanceof Error ? error.message : '移入回收站失败，素材没有删除');
    } finally {
      trashDeleteInFlight.current = false;
    }
  }, [workflowId, nodes, deleteNodes, setSelectedNodeIds]);

  // Simple dirty flag for unsaved changes tracking
  const [isDirty, setIsDirty] = React.useState(false);
  const hasUnsavedChanges = isDirty && (nodes.length > 0 || videoRemixes.length > 0);

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

    // 有节点新进入 LOADING：排一次保存做崩溃恢复保护。
    // 以前这里是同步直接调用 handleSaveWithTracking()，批量生成时 N 个分镜进入
    // LOADING 就是 N 次全量写盘。改走统一调度器后窗口内合并成一次。
    const currentLoadingCount = nodes.filter(n => n.status === NodeStatus.LOADING).length;
    if (currentLoadingCount > lastLoadingCountRef.current) {
      saveSchedulerRef.current?.request();
    }
    lastLoadingCountRef.current = currentLoadingCount;
  }, [nodes, canvasTitle, videoRemixes]);

  // Update saved state after workflow save
  const handleSaveWithTracking = async () => {
    const savingVersion = canvasChangeVersionRef.current;
    // 这一次保存已经把当前状态写下去了，排在后面的那次就没必要了。
    // （调度器自己触发时 timer 已经是空的，cancel 是空操作。）
    saveSchedulerRef.current?.cancel();
    await handleSaveWorkflow();
    // A loading snapshot can finish saving after generation has already
    // produced new nodes. Do not mark those newer canvas changes as saved.
    if (canvasChangeVersionRef.current === savingVersion) {
      setIsDirty(false);
    }
  };

  // Generated media is written to disk before the corresponding React state
  // becomes stable. Persist the canvas as soon as a result URL or storyboard
  // shot video appears, instead of waiting for the 60-second periodic save.
  //
  // 这个 effect 依赖 `nodes`，所以拖拽期间每帧都会跑。以前它每帧都把全画布
  // （每个节点 6 个字段 + 每个分镜 3 个字段）拼成一个巨型字符串再比较，代价随
  // 项目规模线性增长，而它要检测的"是否出现新媒体产物"跟节点坐标毫无关系。
  //
  // 现在改成按节点比对：节点都是不可变更新的，**引用没变就意味着媒体字段没变**，
  // 可以整个跳过。拖拽时只有被拖的那一两个节点引用会变，于是每帧只算 1~2 个
  // 指纹，也不再产生那个大字符串。
  //
  // 与旧实现的一处差异：旧的大字符串按数组顺序拼接，所以**节点重排也会触发一次
  // 保存**；这里用 id 作键，与顺序无关。这是有意的——排序没有产生任何媒体产物，
  // 那次写盘是多余的，排序本身仍会走 setIsDirty + 60 秒自动保存。
  React.useEffect(() => {
    const previous = mediaEntriesRef.current;
    const next = new Map<string, MediaEntry>();
    // 节点数变化即为增/删；数量相同但 id 变了会在循环里被 `!prev` 抓到。
    let changed = previous === null || previous.size !== nodes.length;

    for (const node of nodes) {
      const prev = previous?.get(node.id);
      if (prev && prev.node === node) {
        next.set(node.id, prev);
        continue;
      }
      const sig = nodeMediaSignature(node);
      if (!prev || prev.sig !== sig) changed = true;
      next.set(node.id, { node, sig });
    }

    mediaEntriesRef.current = next;
    if (previous === null || !changed || !workflowId) return;

    saveSchedulerRef.current?.request();
  }, [nodes, workflowId]);

  // 保存调度器：媒体产物与 LOADING 两条路径共用，窗口内合并成一次写盘。
  const handleSaveWithTrackingRef = React.useRef(handleSaveWithTracking);
  handleSaveWithTrackingRef.current = handleSaveWithTracking;

  React.useEffect(() => {
    const scheduler = createCanvasSaveScheduler({
      delayMs: CANVAS_SAVE_DEBOUNCE_MS,
      save: () => handleSaveWithTrackingRef.current(),
      onError: error => console.error('[Canvas Persistence] 自动落盘失败：', error),
    });
    saveSchedulerRef.current = scheduler;

    // 关窗/刷新前把待写的那一次发出去。注意这是**尽力而为**：flush 只保证 fetch
    // 被发起（没有用 keepalive），浏览器不一定等它完成再卸载。
    const flushBeforeUnload = () => { scheduler.flush(); };
    window.addEventListener('beforeunload', flushBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', flushBeforeUnload);
      // 卸载前同样先 flush 再停，不能直接丢掉排期。
      scheduler.flush();
      scheduler.stop();
      saveSchedulerRef.current = null;
    };
  }, []);

  // Load workflow and update tracking
  const handleLoadWithTracking = async (id: string) => {
    ignoreNextChange.current = true;
    const loaded = await handleLoadWorkflow(id);
    if (loaded?.migratedVideoRemixes) {
      canvasChangeVersionRef.current += 1;
      setIsDirty(true);
    } else {
      setIsDirty(false);
    }
    return loaded;
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

  const { handleGenerate: handleGenerateNow, cancelNodeGeneration } = useGeneration({
    nodes,
    updateNode,
    addNodes: newNodes => setNodes(previous => [...previous, ...newNodes]),
    workflowId,
    notify: (message, options) => showToast(message, {
      tone: 'error',
      duration: TOAST_PERSIST,
      action: options?.action,
    })
  });

  // Keep the low-level generator current. Dependency orchestration below always
  // calls the latest render so completed parent outputs become real references.
  const handleGenerateNowRef = React.useRef(handleGenerateNow);
  React.useEffect(() => {
    handleGenerateNowRef.current = handleGenerateNow;
  }, [handleGenerateNow]);

  const generationPromisesRef = React.useRef(new Map<string, Promise<NodeData>>());

  // 导演工作流的一个批次会包含多个普通视频请求，不能复用单节点生成 hook 的
  // controller；这里按镜头登记 controller，同时保存批次的暂停状态。
  const specialRunControlsRef = React.useRef(new Map<string, SpecialRunControl>());
  const specialShotControllersRef = React.useRef(new Map<string, SpecialShotController>());
  const cancelledSpecialShotsRef = React.useRef(new Set<string>());

  // 取消生成：先叫停服务端，再清掉本地那条等待中的 promise，
  // 否则 waitForNodeResult 会一直挂到一小时超时，之后点重新生成没有任何反应。
  const handleCancelGeneration = React.useCallback(async (nodeId: string) => {
    const result = await cancelNodeGeneration(nodeId);
    generationPromisesRef.current.delete(nodeId);
    if (result && !result.submitted) showToast('生成任务已取消');
    return result;
  }, [cancelNodeGeneration, showToast]);

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

      if (current.videoAnalysisAssetRole === 'angle') {
        const mainNodeId = current.videoAnalysisAssetMainNodeId;
        const mainNode = mainNodeId
          ? nodesRef.current.find(node => node.id === mainNodeId)
          : undefined;
        if (!mainNode?.resultUrl || !mainNode.videoAnalysisAssetMainLocked) {
          throw new Error('请先生成并锁定该资产的主图，再生成其他角度');
        }
      }

      const parentIds = [...new Set([
        ...(current.parentIds || []),
        ...Object.values(current.inheritedReferences || {}).flat(),
      ])].filter(parentId => {
        const parent = nodesRef.current.find(node => node.id === parentId);
        // Video Analysis is a completed semantic source for generated remix
        // nodes, not a generatable media dependency. Keep its canvas edge so
        // the relationship remains visible, but do not recurse into the
        // analysis node when a keyframe is generated.
        return parent
          && parent.type !== NodeType.TEXT
          && parent.type !== NodeType.VIDEO_ANALYSIS
          && parent.type !== NodeType.PRODUCT_SCENE_REPLACE
          && parent.type !== NodeType.DETAIL_PAGE_REMIX;
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
    setVideoRemixes([]);
    setSelectedNodeIds([]);
    setCanvasTitle(title);
    setEditingTitleValue(title);
    setViewport({ x: 0, y: 0, zoom: 1 });
    setIsDirty(false);
  }, [setNodes, setGroups, setSelectedNodeIds, setCanvasTitle, setEditingTitleValue, setViewport]);

  const handleRequestNewProject = React.useCallback(() => {
    setIsCreateProjectModalOpen(true);
  }, []);

  const handleOpenExistingProject = React.useCallback(() => {
    openWorkflowPanel(72);
  }, [openWorkflowPanel]);

  const handleImportLocalProject = React.useCallback(async () => {
    if (!window.evanDesktop?.selectLocalProject || !window.evanDesktop.importLocalProject) {
      showToast('选择本地项目仅在 Evan 桌面应用中可用', { tone: 'error' });
      return;
    }

    setIsImportingLocalProject(true);
    try {
      const selection = await window.evanDesktop.selectLocalProject();
      if (selection.canceled) return;
      const workflow = await window.evanDesktop.importLocalProject(selection.importId);
      const loaded = await handleLoadWithTracking(workflow.id);
      if (!loaded) throw new Error('本地项目已添加，但打开项目失败，请重试');
      showToast(`已添加并打开本地项目：${workflow.title || selection.name}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '本地项目导入失败', { tone: 'error', duration: TOAST_PERSIST });
    } finally {
      setIsImportingLocalProject(false);
    }
  }, [handleLoadWithTracking, showToast]);

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

  /**
   * Opens the image editor for image editor nodes.
   */
  const handleOpenEditor = React.useCallback((nodeId: string) => {
    handleOpenImageEditor(nodeId);
  }, [handleOpenImageEditor]);

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
  } = useImageNodeHandlers({ nodes, setNodes, setSelectedNodeIds, workflowId });

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
        if (node.type === NodeType.VIDEO_ANALYSIS) {
          const mapped = assignVideoAnalysisInputPort(node, parent);
          return {
            ...mapped,
            parentIds: Object.keys(mapped.inputPortByParentId || {}),
          };
        }
        if (node.type === NodeType.DETAIL_PAGE_REMIX) {
          const mapped = assignDetailRemixInputPort(node, parent);
          return {
            ...mapped,
            parentIds: Object.keys(mapped.inputPortByParentId || {}),
          };
        }
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

  const { importImageFiles, importDetailRemixFolder, cancelActiveImport } = useCanvasImageImport({
    workflowId,
    viewport,
    canvasRef,
    setNodes,
    setSelectedNodeIds,
    notify: showToast,
    beginHistoryTransaction: beginCanvasHistoryTransaction,
    commitHistoryTransaction: commitCanvasHistoryTransaction,
    rollbackHistoryTransaction: rollbackCanvasHistoryTransaction,
  });
  cancelActiveImportRef.current = cancelActiveImport;

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
    undo: handleCanvasUndo,
    redo: handleCanvasRedo,
    groupSelected,
    ungroupSelected,
    connectSelected,
    generateSelected,
    openNewNodeMenu,
    arrangeCanvas,
    toggleShortcutHelp,
    setViewport,
    onPasteImageFiles: importImageFiles
  });

  // Auto-Save Management
  const { lastSaveTime: lastAutoSaveTime } = useAutoSave({
    isDirty,
    nodes,
    persistableItemCount: nodes.length + videoRemixes.length,
    onSave: handleSaveWithTracking,
    interval: 60000 // Save every 60 seconds
  });

  const handleProductSceneCompleted = React.useCallback((sourceNode: NodeData, job: ProductSceneJob) => {
    if (!job.resultUrl) return;
    setNodes(previous => upsertProductSceneResultNode(previous, sourceNode, job));
  }, [setNodes]);

  const handleDetailRemixResults = React.useCallback((sourceNode: NodeData, job: import('./services/detailRemixService').DetailRemixJob) => {
    setNodes(previous => upsertDetailRemixResultNodes(previous, sourceNode, job));
  }, [setNodes]);

  // Generation Recovery Management
  useGenerationRecovery({
    nodes,
    updateNode,
    workflowId,
    onProductSceneCompleted: handleProductSceneCompleted,
  });

  useDetailRemixRecovery({
    nodes,
    updateNode,
    workflowId,
    onResults: handleDetailRemixResults,
  });

  // Video Frame Extraction (auto-extract lastFrame for videos missing thumbnails)
  useVideoFrameExtraction({
    nodes,
    updateNode
  });

  // TikTok Import Tool
  const {
    isModalOpen: isTikTokModalOpen,
    closeModal: closeTikTokModal,
    handleVideoImported: handleTikTokVideoImported
  } = useTikTokImport({
    setNodes,
    setSelectedNodeIds,
    viewport
  });

  // Context menu handlers
  const {
    handleDoubleClick,
    handleGlobalContextMenu,
    handleAddNext,
    handleNodeContextMenu,
    handleContextMenuCreateAsset,
    handleContextMenuSelect
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

  const handleCreateStickmanWorkflow = React.useCallback((mode: 'script' | 'reference_video') => {
    if (!canvasEditLock.guard()) return;
    const rect = getCanvasRect();
    const paneX = contextMenu.canvasX ?? contextMenu.x - rect.left;
    const paneY = contextMenu.canvasY ?? contextMenu.y - rect.top;
    addStickmanWorkflow(mode, paneX, paneY, viewport);
    showToast(
      mode === 'reference_video'
        ? '已创建参考视频工作流：上传参考视频后执行导演，会先生成剧本再推导分镜'
        : '已创建剧本工作流：填写“剧本输入”后，点击“执行火柴人导演 Skill”',
    );
  }, [addStickmanWorkflow, canvasEditLock, contextMenu.canvasX, contextMenu.canvasY, contextMenu.x, contextMenu.y, showToast, viewport]);

  const handleCreateCinematicWorkflow = React.useCallback(() => {
    if (!canvasEditLock.guard()) return;
    const rect = getCanvasRect();
    const paneX = contextMenu.canvasX ?? contextMenu.x - rect.left;
    const paneY = contextMenu.canvasY ?? contextMenu.y - rect.top;
    addCinematicWorkflow(paneX, paneY, viewport);
    showToast('已创建电影短片工作流：填写剧本、准备角色参考图后执行导演');
  }, [addCinematicWorkflow, canvasEditLock, contextMenu.canvasX, contextMenu.canvasY, contextMenu.x, contextMenu.y, showToast, viewport]);

  const handleCreateDetailRemixWorkflow = React.useCallback(() => {
    if (!canvasEditLock.guard()) return;
    handleContextMenuSelect(NodeType.DETAIL_PAGE_REMIX);
    showToast('已创建商品详情复刻：导入两组详情，系统会自动匹配我方产品角度并生成最终详情');
  }, [canvasEditLock, handleContextMenuSelect, showToast]);

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

    // Folder/batch imports publish several LOADING/progress updates. They are
    // committed as one history entry when the import transaction finishes.
    if (activeCanvasHistoryTransactionRef.current) {
      return;
    }

    // Push to history when nodes or groups change
    // 标记本次 historyState 变化来自当前画布，避免下面的同步 effect 在
    // pushHistory 生效前用旧 present 覆盖异步生成刚新增的结果节点。
    isPushingLocalHistory.current = true;
    pushHistory({ nodes, groups, selectedNodeIds });
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

    if (historyState.nodes !== nodes || historyState.groups !== groups) {
      isApplyingHistory.current = true;
      if (historyState.nodes !== nodes) setNodes(historyState.nodes);
      if (historyState.groups !== groups) setGroups(historyState.groups);
      setSelectedNodeIds(historyState.selectedNodeIds.filter(id => (
        historyState.nodes.some(node => node.id === id)
      )));
    }
  }, [historyState, nodes, groups, setGroups, setNodes, setSelectedNodeIds]);

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
    const currentNode = nodes.find(node => node.id === id);
    const nextUpdates: Partial<NodeData> = { ...updates };
    // Editing an auto-generated prompt freezes only that node. Re-analysis can
    // still update the analysis result and every other unlocked shot.
    if (
      updates.prompt !== undefined
      && currentNode?.origin?.type === 'video-remix'
      && (currentNode.origin.role === 'keyframe'
        || currentNode.origin.role === 'video'
        || currentNode.origin.role === 'asset')
    ) {
      nextUpdates.promptSource = 'user';
      nextUpdates.promptLocked = true;
    }
    updateNode(id, nextUpdates);
    if (
      updates.resultUrl !== undefined
      || updates.lastFrame !== undefined
      || updates.mediaUrl !== undefined
      || updates.editorBackgroundUrl !== undefined
      || updates.characterReferenceUrls !== undefined
    ) {
      setNodes(current => markDetailRemixDependentsStale(
        markVideoAnalysisDependentsStale(current, id),
        id,
      ));
    }
  }, [nodes, setNodes, updateNode]);

  const handleUseCanvasVideoAsReference = React.useCallback(() => {
    if (!canvasEditLock.guard()) return;
    const sourceNode = nodes.find(node => node.id === contextMenu.sourceNodeId);
    if (!sourceNode || (sourceNode.type !== NodeType.VIDEO && sourceNode.type !== NodeType.REFERENCE_VIDEO) || !sourceNode.resultUrl) {
      showToast('当前节点没有可用的视频结果', { tone: 'error' });
      return;
    }
    addStickmanWorkflowFromParent(sourceNode);
    showToast('已创建火柴人参考视频工作流，执行导演时会先生成视频分析剧本，再交给导演 Skill');
  }, [
    addStickmanWorkflowFromParent,
    canvasEditLock,
    contextMenu.sourceNodeId,
    nodes,
    showToast,
  ]);

  const handleAnalyzeVideoNode = React.useCallback(async (analysisNodeId: string) => {
    if (!canvasEditLock.guard()) return;
    if (!workflowId) {
      showToast('请先新建或打开项目', { tone: 'error' });
      return;
    }
    const analysisNode = nodes.find(node => node.id === analysisNodeId && node.type === NodeType.VIDEO_ANALYSIS);
    if (!analysisNode) return;
    const inputRefs = analysisNode.videoAnalysis?.inputRefs || {
      productNodeIds: [],
      characterNodeIds: [],
      sceneNodeIds: [],
    };
    const sourceNode = inputRefs.videoNodeId
      ? nodes.find(node => node.id === inputRefs.videoNodeId)
      : undefined;
    if (!sourceNode?.resultUrl) {
      showToast('请先连接一个已有视频结果的参考视频节点', { tone: 'error' });
      return;
    }

    // Ensure local media is adopted and base64 is sanitized before the server
    // resolves the source/reference paths for the HTTP analyzer.
    try {
      await handleSaveWithTracking();
    } catch (error) {
      const message = error instanceof Error ? error.message : '分析前保存项目失败';
      showToast(message, { tone: 'error' });
      return;
    }
    // Saving may rewrite base64/cross-project URLs. Read the persisted snapshot
    // after the save so the analyzer never receives the pre-normalization URL.
    const persistedNodes = nodesRef.current;
    const persistedAnalysisNode = persistedNodes.find(node => node.id === analysisNodeId);
    const persistedInputRefs = persistedAnalysisNode?.videoAnalysis?.inputRefs || inputRefs;
    const persistedSourceNode = persistedInputRefs.videoNodeId
      ? persistedNodes.find(node => node.id === persistedInputRefs.videoNodeId)
      : sourceNode;
    const persistedSourceUrl = persistedSourceNode?.resultUrl || sourceNode.resultUrl;
    const referenceEntries: Array<{ url: string; label: string }> = [];
    const addReferenceNodes = (ids: string[], label: string) => {
      ids.forEach(id => {
        const node = persistedNodes.find(item => item.id === id);
        const url = node?.resultUrl || node?.editorBackgroundUrl;
        if (!url) return;
        referenceEntries.push({
          url,
          label: node?.displayName || node?.title || label,
        });
      });
    };
    addReferenceNodes(persistedInputRefs.productNodeIds || [], '产品参考图');
    addReferenceNodes(persistedInputRefs.characterNodeIds || [], '人物参考图');
    addReferenceNodes(persistedInputRefs.sceneNodeIds || [], '场景参考图');
    if (!persistedSourceUrl) {
      showToast('参考视频保存后不可用，请重新生成或导入', { tone: 'error' });
      return;
    }
    setNodes(current => current.map(node => node.id === analysisNodeId
      ? {
          ...node,
          status: NodeStatus.LOADING,
          errorMessage: undefined,
          videoAnalysis: createVideoAnalysisNodeData({
            ...node.videoAnalysis,
            status: 'analyzing',
            errorMessage: undefined,
          }),
        }
      : node));

    try {
      const payload = await analyzeVideoAnalysisNode({
        workflowId,
        nodeId: analysisNodeId,
        sourceUrl: persistedSourceUrl,
        title: persistedSourceNode?.title || sourceNode.title || '参考视频',
        referenceImages: referenceEntries,
      });
      const currentNodes = nodesRef.current;
      const currentAnalysis = currentNodes.find(node => node.id === analysisNodeId);
      if (!currentAnalysis) return;
      const built = buildVideoRemixGraph({
        analysisNode: {
          ...currentAnalysis,
          videoAnalysis: createVideoAnalysisNodeData({
            ...currentAnalysis.videoAnalysis,
            status: 'analyzing',
          }),
        },
        result: payload.result,
        existingNodes: currentNodes,
        existingGroups: groups,
      });
      setNodes(built.nodes);
      setGroups(current => [...current.filter(group => group.id !== built.group.id), built.group]);
      setSelectedNodeIds([analysisNodeId]);
      showToast(`已生成 ${payload.result.shots.length} 个镜头工作流，可逐个生成关键帧和视频`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '视频分析失败';
      setNodes(current => current.map(node => node.id === analysisNodeId
        ? {
            ...node,
            status: NodeStatus.ERROR,
            errorMessage: message,
            videoAnalysis: createVideoAnalysisNodeData({
              ...node.videoAnalysis,
              status: 'error',
              errorMessage: message,
            }),
          }
        : node));
      showToast(message, { tone: 'error', duration: TOAST_PERSIST });
    }
  }, [canvasEditLock, groups, handleSaveWithTracking, nodes, setGroups, setNodes, setSelectedNodeIds, showToast, workflowId]);

  const analyzeStickmanReferenceVideo = React.useCallback(async (
    directorNodeId: string,
    sourceNode: NodeData,
    inputRefs: {
      productNodeIds?: string[];
      characterNodeIds?: string[];
      sceneNodeIds?: string[];
    } = {},
    scriptNodeId?: string,
  ) => {
    if (!workflowId) throw new Error('请先新建或打开项目');
    if (!sourceNode.resultUrl) throw new Error('请先准备好参考视频');

    try {
      await handleSaveWithTracking();
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : '分析前保存项目失败');
    }

    const persistedNodes = nodesRef.current;
    const persistedSourceNode = persistedNodes.find(node => node.id === sourceNode.id) || sourceNode;
    const persistedSourceUrl = persistedSourceNode.resultUrl;
    if (!persistedSourceUrl) throw new Error('参考视频保存后不可用，请重新生成或导入');

    const referenceEntries: Array<{ url: string; label: string }> = [];
    const addReferenceNodes = (ids: string[] | undefined, label: string) => {
      (ids || []).forEach(id => {
        const node = persistedNodes.find(item => item.id === id);
        const url = node?.resultUrl || node?.editorBackgroundUrl;
        if (!url) return;
        referenceEntries.push({
          url,
          label: node?.displayName || node?.title || label,
        });
      });
    };
    addReferenceNodes(inputRefs.productNodeIds, '产品参考图');
    addReferenceNodes(inputRefs.characterNodeIds, '人物参考图');
    addReferenceNodes(inputRefs.sceneNodeIds, '场景参考图');

    const analyzingState = createVideoAnalysisNodeData({
      inputRefs: {
        videoNodeId: persistedSourceNode.id,
        productNodeIds: inputRefs.productNodeIds || [],
        characterNodeIds: inputRefs.characterNodeIds || [],
        sceneNodeIds: inputRefs.sceneNodeIds || [],
      },
      status: 'analyzing',
    });
    setNodes(current => current.map(node => {
      if (node.id === scriptNodeId) return { ...node, status: NodeStatus.LOADING };
      if (node.id !== directorNodeId) return node;
      return {
        ...node,
        director: {
          ...(node.director || { ...normalizeStickmanSettings({}), provider: 'auto' as const, status: 'idle' as const }),
          sourceType: 'reference_video',
          analysis: analyzingState,
          error: undefined,
        },
      };
    }));

    try {
      const payload = await analyzeVideoAnalysisNode({
        workflowId,
        nodeId: directorNodeId,
        sourceUrl: persistedSourceUrl,
        title: persistedSourceNode.title || '参考视频',
        referenceImages: referenceEntries,
      });
      const completedState = createVideoAnalysisNodeData({
        ...analyzingState,
        status: 'completed',
        result: payload.result,
      });
      const currentDirector = nodesRef.current.find(node => node.id === directorNodeId);
      const scriptInput = createStickmanScriptFromAnalysis(payload.result, {
        settings: currentDirector?.director || { ...normalizeStickmanSettings({}), provider: 'auto' as const, status: 'idle' as const },
        title: persistedSourceNode.title || '参考视频分析剧本',
      });
      setNodes(current => current.map(node => {
        if (node.id === scriptNodeId) {
          return {
            ...node,
            title: node.title || '视频分析剧本',
            prompt: scriptInput.content,
            status: NodeStatus.SUCCESS,
            scriptInput: pickStickmanScriptInput(scriptInput, node.title || '视频分析剧本'),
          };
        }
        if (node.id !== directorNodeId) return node;
        return {
          ...node,
          director: {
            ...(node.director || { ...normalizeStickmanSettings({}), provider: 'auto' as const, status: 'idle' as const }),
            sourceType: 'script',
            analysis: completedState,
            scriptInput,
            error: undefined,
          },
        };
      }));
      return { result: payload.result, scriptInput, analysis: completedState };
    } catch (error) {
      const message = error instanceof Error ? error.message : '参考视频分析失败';
      setNodes(current => current.map(node => {
        if (node.id === scriptNodeId) return { ...node, status: NodeStatus.ERROR, errorMessage: message };
        if (node.id !== directorNodeId) return node;
        return {
          ...node,
          director: {
            ...(node.director || { ...normalizeStickmanSettings({}), provider: 'auto' as const, status: 'idle' as const }),
            sourceType: 'reference_video',
            analysis: createVideoAnalysisNodeData({ ...analyzingState, status: 'error', errorMessage: message }),
            error: message,
          },
        };
      }));
      throw error;
    }
  }, [handleSaveWithTracking, setNodes, workflowId]);

  const handleAnalyzeStickmanScript = React.useCallback(async (scriptNodeId: string) => {
    if (!canvasEditLock.guard()) return;
    if (!workflowId) {
      showToast('请先新建或打开项目', { tone: 'error' });
      return;
    }
    const current = nodesRef.current;
    const scriptNode = current.find(node => node.id === scriptNodeId && node.type === NodeType.SCRIPT_INPUT);
    const directorNode = current.find(node => node.type === NodeType.STICKMAN_DIRECTOR && node.parentIds?.includes(scriptNodeId));
    const sourceNode = scriptNode?.parentIds
      ?.map(id => current.find(node => node.id === id))
      .find((node): node is NodeData => Boolean(node && (node.type === NodeType.VIDEO || node.type === NodeType.REFERENCE_VIDEO)));
    if (!scriptNode || !directorNode) {
      showToast('请将视频分析剧本节点连接到火柴人视频导演', { tone: 'error' });
      return;
    }
    if (!sourceNode?.resultUrl) {
      showToast('请先在参考视频节点准备好可用的视频', { tone: 'error' });
      return;
    }
    try {
      await analyzeStickmanReferenceVideo(
        directorNode.id,
        sourceNode,
        directorNode.director?.analysis?.inputRefs || {},
        scriptNode.id,
      );
      showToast('已根据参考视频生成剧本，请检查内容后执行火柴人导演 Skill');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '参考视频分析失败', { tone: 'error', duration: TOAST_PERSIST });
    }
  }, [analyzeStickmanReferenceVideo, canvasEditLock, showToast, workflowId]);

  const handleGenerateVideoAnalysisAssets = React.useCallback((analysisNodeId: string) => {
    if (!canvasEditLock.guard()) return;
    const currentNodes = nodesRef.current;
    const analysisNode = currentNodes.find(node => (
      node.id === analysisNodeId && node.type === NodeType.VIDEO_ANALYSIS
    ));
    const result = analysisNode?.videoAnalysis?.result;
    if (!analysisNode || !result) {
      showToast('请先完成视频分析，再选择资产提示词图', { tone: 'error' });
      return;
    }
    try {
      const built = buildVideoRemixGraph({
        analysisNode,
        result,
        existingNodes: currentNodes,
        existingGroups: groups,
      });
      const assetCount = built.generatedNodeIds.filter(nodeId => (
        built.nodes.find(node => node.id === nodeId)?.origin?.role === 'asset'
      )).length;
      setNodes(built.nodes);
      setGroups(current => [...current.filter(group => group.id !== built.group.id), built.group]);
      setSelectedNodeIds([analysisNodeId]);
      showToast(assetCount > 0 ? `已创建 ${assetCount} 个资产提示词参考节点` : '当前选择没有可创建的资产参考节点');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '资产参考节点创建失败', { tone: 'error' });
    }
  }, [canvasEditLock, groups, setGroups, setNodes, setSelectedNodeIds, showToast]);

  const ensureStickmanPipeline = React.useCallback((directorNodeId: string, output: StickmanDirectorOutput, referenceDerived = false) => {
    const current = nodesRef.current;
    const director = current.find(node => node.id === directorNodeId);
    if (!director) throw new Error('找不到火柴人导演节点');
    // The backend intentionally normalizes reference-video runs to
    // sourceType === 'script' (analysis is only script material), so the
    // comparison view must be driven by the caller's topology flag, not by
    // output.sourceType, or the "对照组" branch is unreachable.
    const storyboardType = referenceDerived ? NodeType.STORYBOARD_COMPARE : NodeType.STORYBOARD;
    const storyboard = current.find(node => node.parentIds?.includes(directorNodeId)
      && [NodeType.STORYBOARD, NodeType.STORYBOARD_COMPARE].includes(node.type));
    const storyboardId = storyboard?.id || crypto.randomUUID();
    const batch = current.find(node => node.parentIds?.includes(storyboardId) && node.type === NodeType.FLOW_BATCH_VIDEO);
    const batchId = batch?.id || crypto.randomUUID();
    const merge = current.find(node => node.parentIds?.includes(batchId) && node.type === NodeType.VIDEO_MERGE);
    const mergeId = merge?.id || crypto.randomUUID();
    const defaultModel = listVideoGenerationProviders()[0]?.id;
    const defaultResolution = listVideoGenerationProviders()[0]?.resolutions?.[0] || 'Auto';
    const existingStoryboard = storyboard?.storyboard || { shots: [], expanded: false, status: 'idle' as const };
    // Carry over already-generated (already-paid-for) videos for shots whose
    // id and prompt are unchanged; reset the rest so re-planning never attaches
    // a stale video to changed content.
    const plannedShots = mergeStickmanShotsPreservingGeneration(existingStoryboard.shots, output.shots);
    const existingBatch = batch?.flowBatch || {
      modelId: defaultModel, resolution: defaultResolution, concurrency: 2 as const,
      aspectRatio: output.global.aspectRatio, width: output.global.width, height: output.global.height,
      duration: output.shots[0]?.duration || 8, nativeAudio: output.global.audioEnabled,
      autoRetry: true, maxRetries: 1, continueOnFailure: true, autoMerge: false,
      status: 'idle' as const, tasks: [],
    };
    const tasks = plannedShots.map(shot => ({
      shotId: shot.id,
      taskId: shot.generation.taskId || crypto.randomUUID(),
      status: shot.generation.status === 'completed' ? 'success' as const : 'waiting' as const,
      retryCount: shot.generation.retryCount || 0,
      ...(shot.generation.videoUrl ? { resultUrl: shot.generation.videoUrl } : {}),
    }));
    const additions: NodeData[] = [];
    if (!storyboard) additions.push({
      id: storyboardId,
      type: storyboardType,
      title: referenceDerived ? '分镜对照组' : '分镜列表',
      x: director.x + 520,
      y: director.y,
      prompt: '', status: NodeStatus.IDLE, model: 'stickman-director',
      aspectRatio: output.global.aspectRatio, resolution: 'Auto', parentIds: [directorNodeId],
      storyboard: { shots: plannedShots, expanded: false, compareMode: referenceDerived, status: 'ready' },
    });
    if (!batch) additions.push({
      id: batchId,
      type: NodeType.FLOW_BATCH_VIDEO,
      title: 'Flow 视频生成', x: (storyboard?.x || director.x + 520) + 520, y: storyboard?.y || director.y,
      prompt: '', status: NodeStatus.IDLE, model: defaultModel || 'flow', aspectRatio: output.global.aspectRatio,
      resolution: 'Auto', parentIds: [storyboardId],
      flowBatch: {
        modelId: defaultModel, resolution: defaultResolution, concurrency: 2, aspectRatio: output.global.aspectRatio,
        width: output.global.width, height: output.global.height, duration: output.shots[0]?.duration || 8,
        nativeAudio: output.global.audioEnabled, autoRetry: true, maxRetries: 1,
        continueOnFailure: true, autoMerge: false, status: 'idle', tasks,
      },
    });
    if (!merge) additions.push({
      id: mergeId,
      type: NodeType.VIDEO_MERGE,
      title: '视频拼接', x: (batch?.x || (storyboard?.x || director.x + 520) + 520) + 520, y: batch?.y || storyboard?.y || director.y,
      prompt: '', status: NodeStatus.IDLE, model: 'remotion', aspectRatio: output.global.aspectRatio,
      resolution: 'Auto', parentIds: [batchId],
      videoMerge: { status: 'idle', outputFormat: 'mp4', fps: 30, skipFailed: true },
    });

    setNodes(previous => {
      const next = previous.map(node => {
        if (node.id === storyboardId) {
          return {
            ...node,
            type: storyboardType,
            title: referenceDerived ? '分镜对照组' : (node.title || '分镜列表'),
            storyboard: { ...existingStoryboard, shots: plannedShots, compareMode: referenceDerived, status: 'ready' as const, error: undefined },
          };
        }
        if (node.id === batchId) {
          return {
            ...node,
            flowBatch: {
              ...existingBatch,
              aspectRatio: output.global.aspectRatio,
              width: output.global.width,
              height: output.global.height,
              duration: output.shots[0]?.duration || existingBatch.duration,
              tasks,
              error: undefined,
            },
          };
        }
        if (node.id === mergeId && !node.videoMerge) {
          return { ...node, videoMerge: { status: 'idle' as const, outputFormat: 'mp4' as const, fps: 30, skipFailed: true } };
        }
        return node;
      });
      return [...next, ...additions.filter(node => !next.some(item => item.id === node.id))];
    });
    return { storyboardId, batchId, mergeId };
  }, [setNodes]);

  const ensureCinematicPipeline = React.useCallback((directorNodeId: string, output: CinematicDirectorOutput) => {
    const current = nodesRef.current;
    const director = current.find(node => node.id === directorNodeId && node.type === NodeType.CINEMATIC_DIRECTOR);
    if (!director) throw new Error('找不到电影短片导演节点');
    const storyboard = current.find(node => node.type === NodeType.CINEMATIC_STORYBOARD && node.parentIds?.includes(directorNodeId));
    const storyboardId = storyboard?.id || crypto.randomUUID();
    const merge = current.find(node => node.type === NodeType.CINEMATIC_VIDEO_MERGE && node.parentIds?.includes(storyboardId));
    const mergeId = merge?.id || crypto.randomUUID();
    const previous = storyboard?.cinematicStoryboard || { shots: [], cast: [], expanded: false, concurrency: 2 as const, status: 'idle' as const };
    const plannedShots = mergeCinematicShotsPreservingGeneration(previous.shots, output.shots);
    const cast = normalizeCinematicCast(output.cast);
    const additions: NodeData[] = [];
    if (!storyboard) additions.push({
      id: storyboardId,
      type: NodeType.CINEMATIC_STORYBOARD,
      title: '电影分镜',
      x: director.x + 520,
      y: director.y,
      prompt: '',
      status: NodeStatus.IDLE,
      model: output.global.videoModel,
      aspectRatio: output.global.aspectRatio,
      resolution: 'Auto',
      parentIds: [directorNodeId],
      cinematicStoryboard: { shots: plannedShots, cast, expanded: false, concurrency: 2, status: 'ready' },
    });
    if (!merge) additions.push({
      id: mergeId,
      type: NodeType.CINEMATIC_VIDEO_MERGE,
      title: '电影成片拼接',
      x: (storyboard?.x || director.x + 520) + 520,
      y: storyboard?.y || director.y,
      prompt: '',
      status: NodeStatus.IDLE,
      model: 'remotion',
      aspectRatio: output.global.aspectRatio,
      resolution: 'Auto',
      parentIds: [storyboardId],
      cinematicVideoMerge: { status: 'idle', outputFormat: 'mp4', fps: 30, skipFailed: true },
    });
    setNodes(previousNodes => {
      const next = previousNodes.map(node => {
        if (node.id === storyboardId) {
          return {
            ...node,
            cinematicStoryboard: {
              ...previous,
              shots: plannedShots,
              cast,
              status: 'ready' as const,
              error: undefined,
            },
          };
        }
        if (node.id === mergeId && !node.cinematicVideoMerge) {
          return { ...node, cinematicVideoMerge: { status: 'idle' as const, outputFormat: 'mp4' as const, fps: 30, skipFailed: true } };
        }
        return node;
      });
      return [...next, ...additions.filter(node => !next.some(item => item.id === node.id))];
    });
    return { storyboardId, mergeId };
  }, [setNodes]);

  const handleRunCinematicDirector = React.useCallback(async (directorNodeId: string) => {
    if (!canvasEditLock.guard()) return;
    if (!workflowId) {
      showToast('请先新建或打开项目', { tone: 'error' });
      return;
    }
    const current = nodesRef.current;
    const directorNode = current.find(node => node.id === directorNodeId && node.type === NodeType.CINEMATIC_DIRECTOR);
    if (!directorNode) return;
    const parents = (directorNode.parentIds || []).map(id => current.find(node => node.id === id)).filter((node): node is NodeData => Boolean(node));
    const scriptNode = parents.find(node => node.type === NodeType.SCRIPT_INPUT);
    const castNode = parents.find(node => node.type === NodeType.CINEMATIC_CAST);
    const script = scriptNode?.scriptInput || { title: scriptNode?.title || '电影短片剧本', content: scriptNode?.prompt || '', notes: '' };
    const cast = normalizeCinematicCast(castNode?.cinematicCast?.characters || []);
    const settings = normalizeCinematicSettings(directorNode.cinematicDirector || {});
    const videoModel = listVideoGenerationProviders().find(model => model.id === settings.videoModel);
    if (!String(script.content || '').trim()) {
      showToast('请先填写电影剧本正文', { tone: 'error' });
      return;
    }
    if (videoModel && !videoModel.supportedAspectRatios.includes(settings.aspectRatio)) {
      showToast(`${videoModel.name} 不支持 ${settings.aspectRatio} 画幅，请调整导演设置`, { tone: 'error' });
      return;
    }
    if (!cast.length || cast.some(character => character.referenceImages.length === 0)) {
      showToast('请为每个角色准备至少一张参考图；可用 AI 默认生成正面照和设定板', { tone: 'error' });
      return;
    }
    const budget = validateCinematicReferenceBudget(cast, settings.videoModel);
    if (!budget.valid) {
      showToast(budget.errors[0], { tone: 'error' });
      return;
    }
    const directorState = {
      ...settings,
      provider: directorNode.cinematicDirector?.provider || 'auto',
      modelId: directorNode.cinematicDirector?.modelId,
      status: 'running' as const,
      output: directorNode.cinematicDirector?.output,
      error: undefined,
    };
    setNodes(previous => previous.map(node => node.id === directorNodeId
      ? { ...node, status: NodeStatus.LOADING, cinematicDirector: directorState }
      : node));
    try {
      const result = await runCinematicDirector({
        input: { title: script.title, content: script.content, notes: script.notes || '' },
        cast,
        settings: directorState,
        provider: directorState.provider,
        allowFallback: true,
      });
      const output = normalizeCinematicDirectorOutput(result.output, { settings: directorState, model: result.model, cast });
      setNodes(previous => previous.map(node => node.id === directorNodeId
        ? { ...node, status: NodeStatus.SUCCESS, prompt: JSON.stringify(output), cinematicDirector: { ...directorState, status: 'completed' as const, output, repaired: result.repaired, error: undefined } }
        : node));
      const pipeline = ensureCinematicPipeline(directorNodeId, output);
      setSelectedNodeIds([pipeline.storyboardId]);
      showToast(`已生成 ${output.shots.length} 个电影分镜`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '电影导演执行失败';
      setNodes(previous => previous.map(node => node.id === directorNodeId
        ? { ...node, status: NodeStatus.ERROR, cinematicDirector: { ...directorState, status: 'failed' as const, error: message } }
        : node));
      showToast(message, { tone: 'error', duration: TOAST_PERSIST });
    }
  }, [canvasEditLock, ensureCinematicPipeline, setNodes, setSelectedNodeIds, showToast, workflowId]);

  const generateCinematicShots = React.useCallback(async (storyboardId: string, shotIds?: string[]) => {
    if (!canvasEditLock.guard()) return;
    if (!workflowId) {
      showToast('请先新建或打开项目', { tone: 'error' });
      return;
    }
    const current = nodesRef.current;
    const storyboardNode = current.find(node => node.id === storyboardId && node.type === NodeType.CINEMATIC_STORYBOARD);
    const directorNode = storyboardNode?.parentIds?.map(id => current.find(node => node.id === id)).find(node => node?.type === NodeType.CINEMATIC_DIRECTOR);
    const castNode = directorNode?.parentIds?.map(id => current.find(node => node.id === id)).find(node => node?.type === NodeType.CINEMATIC_CAST);
    const state = storyboardNode?.cinematicStoryboard;
    const settings = normalizeCinematicSettings(directorNode?.cinematicDirector || {});
    const cast = normalizeCinematicCast(castNode?.cinematicCast?.characters || state?.cast || []);
    if (!storyboardNode || !state?.shots.length || !directorNode) {
      showToast('当前没有可生成的电影分镜', { tone: 'error' });
      return;
    }
    const videoModel = listVideoGenerationProviders().find(model => model.id === settings.videoModel);
    if (videoModel && !videoModel.supportedAspectRatios.includes(settings.aspectRatio)) {
      showToast(`${videoModel.name} 不支持 ${settings.aspectRatio} 画幅，请调整导演设置`, { tone: 'error' });
      return;
    }
    const runKey = specialRunKey('cinematic', storyboardId);
    if (specialRunControlsRef.current.has(runKey)) {
      showToast('这个电影分镜批次正在运行中，可先暂停队列', { tone: 'info' });
      return;
    }
    const requested = shotIds ? new Set(shotIds) : undefined;
    const targets = state.shots.filter(shot => requested ? requested.has(shot.id) : shot.generation.status !== 'completed');
    const blocked = targets.filter(shot => shot.generation.status === 'submission_unknown');
    const isExplicitSingleShotRetry = Boolean(shotIds?.length);
    if (blocked.length && !isExplicitSingleShotRetry) {
      showToast(`有 ${blocked.length} 个镜头提交状态未知，请先从 Provider 历史确认结果后再重试`, { tone: 'error' });
      return;
    }
    if (blocked.length && isExplicitSingleShotRetry) {
      showToast('已确认 Provider 历史无可用结果，开始重试此镜头；若平台已有结果，仍可能产生重复计费', { tone: 'info' });
    }
    if (!targets.length) {
      showToast('没有待生成镜头；已完成镜头不会自动重复扣费');
      return;
    }
    const control: SpecialRunControl = { kind: 'cinematic', storyboardId, paused: false };
    specialRunControlsRef.current.set(runKey, control);
    const working = new Map(state.shots.map(shot => [shot.id, shot]));
    const applyShot = (id: string, generation: Partial<CinematicShot['generation']>) => {
      const prior = working.get(id);
      if (!prior) return;
      const next = { ...prior, generation: { ...prior.generation, ...generation } };
      working.set(id, next);
      setNodes(previous => previous.map(node => node.id === storyboardId && node.cinematicStoryboard
        ? { ...node, cinematicStoryboard: { ...node.cinematicStoryboard, shots: node.cinematicStoryboard.shots.map(shot => shot.id === id ? next : shot) } }
        : node));
    };
    targets.forEach(shot => {
      cancelledSpecialShotsRef.current.delete(specialShotKey('cinematic', storyboardId, shot.id));
      applyShot(shot.id, {
        status: 'queued',
        progress: 0,
        error: undefined,
        queuedAt: Date.now(),
        startedAt: undefined,
        finishedAt: undefined,
        elapsedMs: undefined,
      });
    });
    setNodes(previous => previous.map(node => node.id === storyboardId && node.cinematicStoryboard
      ? { ...node, cinematicStoryboard: { ...node.cinematicStoryboard, status: 'generating', error: undefined } }
      : node));
    let cursor = 0;
    const results: Array<'success' | 'failed' | 'unknown' | 'cancelled'> = [];
    const timing = (shot: CinematicShot, finishedAt: number) => {
      const startedAt = shot.generation.startedAt || shot.generation.queuedAt;
      return {
        finishedAt,
        ...(startedAt ? { elapsedMs: Math.max(0, finishedAt - startedAt) } : {}),
      };
    };
    const process = async (shot: CinematicShot) => {
      const shotKey = specialShotKey('cinematic', storyboardId, shot.id);
      if (cancelledSpecialShotsRef.current.has(shotKey)) {
        const finishedAt = Date.now();
        const currentShot = working.get(shot.id) || shot;
        applyShot(shot.id, { status: 'cancelled', progress: 0, error: '已手动取消', ...timing(currentShot, finishedAt) });
        results.push('cancelled');
        return;
      }
      const retryCount = (shot.generation.retryCount || 0) + (shot.generation.status === 'failed' ? 1 : 0);
      const controller = new AbortController();
      const nodeId = `cinematic-${storyboardId}-${shot.id}`;
      specialShotControllersRef.current.set(shotKey, { kind: 'cinematic', storyboardId, shotId: shot.id, nodeId, controller });
      applyShot(shot.id, { status: 'generating', progress: 0, retryCount, error: undefined, startedAt: Date.now() });
      try {
        const resultUrl = await generateCinematicShotVideo({ workflowId, shot, cast, settings, nodeId, signal: controller.signal });
        const url = `${resultUrl}${resultUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
        const currentShot = working.get(shot.id) || shot;
        if (cancelledSpecialShotsRef.current.has(shotKey)) {
          applyShot(shot.id, { status: 'cancelled', progress: 1, videoUrl: url, error: '已停止等待；结果已返回', ...timing(currentShot, Date.now()) });
          results.push('cancelled');
        } else {
          applyShot(shot.id, { status: 'completed', progress: 1, videoUrl: url, error: undefined, ...timing(currentShot, Date.now()) });
          results.push('success');
        }
      } catch (error) {
        const manuallyCancelled = cancelledSpecialShotsRef.current.has(shotKey) || controller.signal.aborted;
        const submitted = Boolean((error as { submitted?: boolean })?.submitted);
        const message = error instanceof Error ? error.message : '镜头生成失败';
        const currentShot = working.get(shot.id) || shot;
        if (manuallyCancelled) {
          applyShot(shot.id, { status: 'cancelled', error: submitted ? '已停止等待；请求可能已提交并计费，请到 Provider 历史确认' : '已手动取消', ...timing(currentShot, Date.now()) });
          results.push('cancelled');
        } else {
          applyShot(shot.id, submitted ? { status: 'submission_unknown', error: `${message}；任务可能已提交，请先确认 Provider 历史`, ...timing(currentShot, Date.now()) } : { status: 'failed', error: message, ...timing(currentShot, Date.now()) });
          results.push(submitted ? 'unknown' : 'failed');
        }
      } finally {
        specialShotControllersRef.current.delete(shotKey);
      }
    };
    const worker = async () => {
      while (true) {
        if (control.paused) return;
        const index = cursor++;
        if (index >= targets.length) return;
        await process(targets[index]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(state.concurrency || 2, targets.length) }, () => worker()));
    const pausedWithPending = control.paused && cursor < targets.length;
    specialRunControlsRef.current.delete(runKey);
    const finalShots = state.shots.map(shot => working.get(shot.id) || shot);
    const rollup = rollupCinematicGenerationStatus(finalShots);
    setNodes(previous => previous.map(node => node.id === storyboardId && node.cinematicStoryboard
      ? { ...node, cinematicStoryboard: { ...node.cinematicStoryboard, shots: finalShots, status: pausedWithPending ? 'paused' : rollup.storyboardStatus as NonNullable<NodeData['cinematicStoryboard']>['status'] } }
      : node));
    const failures = results.filter(result => result !== 'success').length;
    if (pausedWithPending) {
      showToast(`已暂停队列；${results.filter(result => result === 'success').length} 个镜头已完成，剩余镜头等待恢复`, { tone: 'info' });
    } else {
      showToast(rollup.batchStatus === 'completed' ? `已完成全部 ${rollup.total} 个电影镜头` : `本轮成功 ${results.filter(result => result === 'success').length} 个${failures ? `，失败或待恢复 ${failures} 个` : ''}（共 ${rollup.total}）`, { tone: failures ? 'error' : 'info' });
    }
  }, [canvasEditLock, setNodes, showToast, workflowId]);

  const cancelCinematicShot = React.useCallback(async (storyboardId: string, shotId: string) => {
    const key = specialShotKey('cinematic', storyboardId, shotId);
    const entry = specialShotControllersRef.current.get(key);
    const nodeId = entry?.nodeId || `cinematic-${storyboardId}-${shotId}`;
    let submitted = false;
    try {
      const result = await requestCancelGeneration(nodeId, workflowId);
      submitted = result.submitted;
    } catch (error) {
      showToast(error instanceof Error ? error.message : '取消电影镜头失败', { tone: 'error' });
      return;
    }
    cancelledSpecialShotsRef.current.add(key);
    entry?.controller.abort();
    const shot = nodesRef.current.find(node => node.id === storyboardId)?.cinematicStoryboard?.shots.find(item => item.id === shotId);
    const finishedAt = Date.now();
    const startedAt = shot?.generation.startedAt || shot?.generation.queuedAt;
    setNodes(previous => previous.map(node => node.id === storyboardId && node.cinematicStoryboard
      ? {
        ...node,
        cinematicStoryboard: {
          ...node.cinematicStoryboard,
          shots: node.cinematicStoryboard.shots.map(item => item.id === shotId
            ? {
              ...item,
              generation: {
                ...item.generation,
                status: 'cancelled',
                error: submitted ? '已停止等待；请求可能已提交并计费，请到 Provider 历史确认' : '已手动取消',
                finishedAt,
                ...(startedAt ? { elapsedMs: Math.max(0, finishedAt - startedAt) } : {}),
              },
            }
            : item),
        },
      }
      : node));
  }, [setNodes, showToast, workflowId]);

  const pauseCinematicBatch = React.useCallback((storyboardId: string) => {
    const control = specialRunControlsRef.current.get(specialRunKey('cinematic', storyboardId));
    if (control) control.paused = true;
    setNodes(previous => previous.map(node => node.id === storyboardId && node.cinematicStoryboard
      ? { ...node, cinematicStoryboard: { ...node.cinematicStoryboard, status: 'paused' } }
      : node));
  }, [setNodes]);

  const resumeCinematicBatch = React.useCallback((storyboardId: string) => {
    const control = specialRunControlsRef.current.get(specialRunKey('cinematic', storyboardId));
    if (control) {
      control.paused = false;
      setNodes(previous => previous.map(node => node.id === storyboardId && node.cinematicStoryboard
        ? { ...node, cinematicStoryboard: { ...node.cinematicStoryboard, status: 'generating', error: undefined } }
        : node));
      return;
    }
    void generateCinematicShots(storyboardId);
  }, [generateCinematicShots, setNodes]);

  const handleGenerateCinematicShot = React.useCallback((storyboardId: string, shotId: string) => {
    void generateCinematicShots(storyboardId, [shotId]);
  }, [generateCinematicShots]);

  const handleBatchGenerateCinematic = React.useCallback((nodeId: string) => {
    const node = nodesRef.current.find(item => item.id === nodeId);
    if (node?.type === NodeType.CINEMATIC_STORYBOARD) void generateCinematicShots(nodeId);
  }, [generateCinematicShots]);

  const handleRetryCinematicFailed = React.useCallback((nodeId: string) => {
    const node = nodesRef.current.find(item => item.id === nodeId);
    const failed = node?.cinematicStoryboard?.shots.filter(shot => shot.generation.status === 'failed').map(shot => shot.id) || [];
    if (node?.type === NodeType.CINEMATIC_STORYBOARD && failed.length) void generateCinematicShots(nodeId, failed);
  }, [generateCinematicShots]);

  const handleMergeCinematicVideos = React.useCallback(async (mergeNodeId: string) => {
    if (!canvasEditLock.guard()) return;
    if (!workflowId) {
      showToast('请先新建或打开项目', { tone: 'error' });
      return;
    }
    const current = nodesRef.current;
    const mergeNode = current.find(node => node.id === mergeNodeId && node.type === NodeType.CINEMATIC_VIDEO_MERGE);
    const storyboardNode = mergeNode?.parentIds?.map(id => current.find(node => node.id === id)).find(node => node?.type === NodeType.CINEMATIC_STORYBOARD);
    const directorNode = storyboardNode?.parentIds?.map(id => current.find(node => node.id === id)).find(node => node?.type === NodeType.CINEMATIC_DIRECTOR);
    const shots = storyboardNode?.cinematicStoryboard?.shots || [];
    const mergeState = mergeNode?.cinematicVideoMerge || { status: 'idle' as const, outputFormat: 'mp4' as const, fps: 30, skipFailed: true };
    if (!mergeNode || !storyboardNode || !shots.some(shot => shot.generation.status === 'completed' && shot.generation.videoUrl)) {
      showToast('请先完成至少一个电影镜头生成', { tone: 'error' });
      return;
    }
    const settings = normalizeCinematicSettings(directorNode?.cinematicDirector || {});
    setNodes(previous => previous.map(node => node.id === mergeNodeId && node.cinematicVideoMerge ? { ...node, cinematicVideoMerge: { ...mergeState, status: 'queued', error: undefined } } : node));
    try {
      const job = await submitCinematicMerge({
        workflowId,
        title: directorNode?.title || '电影短片成片',
        shots: shots.map(shot => ({ id: shot.id, order: shot.order, title: shot.title, duration: shot.duration, videoUrl: shot.generation.videoUrl, status: shot.generation.status, transition: shot.camera.transition })),
        settings,
        fps: mergeState.fps,
        skipFailed: mergeState.skipFailed,
      });
      setNodes(previous => previous.map(node => node.id === mergeNodeId && node.cinematicVideoMerge ? { ...node, cinematicVideoMerge: { ...mergeState, status: job.status === 'success' ? 'success' : 'rendering', jobId: job.jobId, outputUrl: job.output || undefined } } : node));
      let status = job;
      while (['queued', 'rendering'].includes(status.status)) {
        await new Promise(resolve => window.setTimeout(resolve, 1500));
        status = await getCinematicMergeJob(job.jobId);
        setNodes(previous => previous.map(node => node.id === mergeNodeId && node.cinematicVideoMerge ? { ...node, cinematicVideoMerge: { ...mergeState, status: status.status === 'success' ? 'success' : status.status === 'failed' ? 'failed' : status.status === 'cancelled' ? 'cancelled' : 'rendering', jobId: job.jobId, outputUrl: status.output || undefined, error: status.error || undefined } } : node));
      }
      if (status.status !== 'success') throw new Error(status.error || '电影成片拼接失败');
      showToast('电影最终视频已拼接完成');
    } catch (error) {
      const message = error instanceof Error ? error.message : '电影成片拼接失败';
      setNodes(previous => previous.map(node => node.id === mergeNodeId && node.cinematicVideoMerge ? { ...node, cinematicVideoMerge: { ...mergeState, status: 'failed', error: message } } : node));
      showToast(message, { tone: 'error', duration: TOAST_PERSIST });
    }
  }, [canvasEditLock, setNodes, showToast, workflowId]);

  const handleRunStickmanDirector = React.useCallback(async (directorNodeId: string) => {
    if (!canvasEditLock.guard()) return;
    if (!workflowId) {
      showToast('请先新建或打开项目', { tone: 'error' });
      return;
    }
    const current = nodesRef.current;
    const directorNode = current.find(node => node.id === directorNodeId && node.type === NodeType.STICKMAN_DIRECTOR);
    if (!directorNode) return;
    const parents = (directorNode.parentIds || [])
      .map(id => current.find(node => node.id === id))
      .filter((node): node is NodeData => Boolean(node));
    const analysisNode = parents.find(node => node.type === NodeType.VIDEO_ANALYSIS);
    const scriptNode = parents.find(node => node.type === NodeType.SCRIPT_INPUT);
    const parentOf = (node: NodeData | undefined, types: NodeType[]) => (node?.parentIds || [])
      .map(id => current.find(item => item.id === id))
      .find(item => item && types.includes(item.type));
    const analysisInputRefs: Partial<VideoAnalysisNodeData['inputRefs']> = analysisNode?.videoAnalysis?.inputRefs || {};
    const sourceNode = parents.find(node => node.type === NodeType.VIDEO || node.type === NodeType.REFERENCE_VIDEO)
      || parentOf(scriptNode, [NodeType.VIDEO, NodeType.REFERENCE_VIDEO])
      || (analysisInputRefs.videoNodeId ? current.find(node => node.id === analysisInputRefs.videoNodeId) : undefined)
      || parentOf(analysisNode, [NodeType.VIDEO, NodeType.REFERENCE_VIDEO]);

    const directorDefaults = normalizeStickmanSettings(directorNode.director || {});
    let scriptInput = scriptNode?.scriptInput?.content || scriptNode?.prompt
      ? pickStickmanScriptInput({
        ...(scriptNode.scriptInput || {}),
        content: scriptNode.scriptInput?.content || scriptNode.prompt || '',
      }, scriptNode.scriptInput?.title || scriptNode.title || '未命名剧本', directorDefaults.platform)
      : directorNode.director?.scriptInput?.content
        ? pickStickmanScriptInput(directorNode.director.scriptInput, '未命名剧本', directorDefaults.platform)
        : undefined;
    let analysisState = directorNode.director?.analysis;
    if (!scriptInput?.content && analysisNode?.videoAnalysis?.result) {
      scriptInput = createStickmanScriptFromAnalysis(analysisNode.videoAnalysis.result, {
        settings: directorNode.director || { ...normalizeStickmanSettings({}), provider: 'auto' as const, status: 'idle' as const },
        title: sourceNode?.title || '参考视频分析剧本',
      });
      analysisState = analysisNode.videoAnalysis;
    }
    if (!scriptInput?.content && (scriptNode?.scriptInput?.content || scriptNode?.prompt)) {
      scriptInput = pickStickmanScriptInput({
        ...(scriptNode.scriptInput || {}),
        content: scriptNode.scriptInput?.content || scriptNode.prompt || '',
      }, scriptNode.scriptInput?.title || scriptNode.title || '未命名剧本', directorDefaults.platform);
    }
    if (!scriptInput?.content && sourceNode?.resultUrl) {
      try {
        const analyzed = await analyzeStickmanReferenceVideo(
          directorNodeId,
          sourceNode,
          analysisInputRefs,
          scriptNode?.id,
        );
        scriptInput = analyzed.scriptInput;
        analysisState = analyzed.analysis;
      } catch (error) {
        const message = error instanceof Error ? error.message : '参考视频分析失败';
        showToast(message, { tone: 'error', duration: TOAST_PERSIST });
        return;
      }
    }
    if (!scriptInput?.content) {
      showToast('请填写剧本，或准备参考视频供视频分析生成剧本', { tone: 'error' });
      return;
    }

    const refreshedDirector = nodesRef.current.find(node => node.id === directorNodeId);
    const baseDirectorState = refreshedDirector?.director || directorNode.director || { ...normalizeStickmanSettings({}), provider: 'auto' as const, status: 'idle' as const };
    // The Director node owns all storyboard settings. Keep the script's target
    // platform as a backwards-compatible hint only when the director still has
    // its untouched default; dimensions and timing never come from the script.
    const defaultPlatform = normalizeStickmanSettings({}).platform;
    const directorState = !baseDirectorState.output
      && scriptInput.platform
      && baseDirectorState.platform === defaultPlatform
      ? { ...baseDirectorState, platform: scriptInput.platform }
      : baseDirectorState;
    const sourceType = 'script' as const;
    const input = {
      title: scriptInput.title,
      content: scriptInput.content,
      notes: scriptInput.notes || '',
    };
    setNodes(previous => previous.map(node => node.id === directorNodeId
      ? { ...node, status: NodeStatus.LOADING, director: { ...directorState, sourceType, scriptInput, analysis: analysisState, status: 'running', error: undefined } }
      : node));
    try {
      const result = await runStickmanDirector({
        sourceType,
        input,
        settings: directorState,
        provider: directorState.provider,
        allowFallback: true,
      });
      setNodes(previous => previous.map(node => node.id === directorNodeId
        ? { ...node, status: NodeStatus.SUCCESS, prompt: JSON.stringify(result.output), director: { ...directorState, sourceType, scriptInput, analysis: analysisState, status: 'completed', output: result.output, repaired: result.repaired, fallback: result.fallback, error: undefined } }
        : node));
      // Reference-derived runs come from a connected video / analysis node even
      // though the backend reports sourceType 'script'; this drives the 对照组 view.
      const referenceDerived = Boolean(analysisNode || sourceNode || analysisState);
      const pipeline = ensureStickmanPipeline(directorNodeId, result.output, referenceDerived);
      setSelectedNodeIds([pipeline.storyboardId]);
      showToast(`已生成 ${result.output.shots.length} 个火柴人分镜`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '火柴人导演执行失败';
      setNodes(previous => previous.map(node => node.id === directorNodeId
        ? { ...node, status: NodeStatus.ERROR, director: { ...directorState, sourceType, scriptInput, analysis: analysisState, status: 'failed', error: message } }
        : node));
      showToast(message, { tone: 'error', duration: TOAST_PERSIST });
    }
  }, [analyzeStickmanReferenceVideo, canvasEditLock, ensureStickmanPipeline, setNodes, setSelectedNodeIds, showToast, workflowId]);

  const ensureStickmanBatchNode = React.useCallback((storyboardId: string) => {
    const current = nodesRef.current;
    const storyboard = current.find(node => node.id === storyboardId);
    if (!storyboard) return null;
    const existing = current.find(node => node.type === NodeType.FLOW_BATCH_VIDEO && node.parentIds?.includes(storyboardId));
    if (existing) return existing;
    const id = crypto.randomUUID();
    const modelId = listVideoGenerationProviders()[0]?.id;
    const resolution = listVideoGenerationProviders()[0]?.resolutions?.[0] || 'Auto';
    const shots = storyboard.storyboard?.shots || [];
    const node: NodeData = {
      id, type: NodeType.FLOW_BATCH_VIDEO, title: 'Flow 视频生成', x: storyboard.x + 520, y: storyboard.y,
      prompt: '', status: NodeStatus.IDLE, model: modelId || 'flow', aspectRatio: shots[0]?.aspectRatio || '9:16', resolution: 'Auto', parentIds: [storyboardId],
      flowBatch: { modelId, resolution, concurrency: 2, aspectRatio: shots[0]?.aspectRatio || '9:16', width: shots[0]?.width || 1080, height: shots[0]?.height || 1920, duration: shots[0]?.duration || 8, nativeAudio: true, autoRetry: true, maxRetries: 1, continueOnFailure: true, autoMerge: false, status: 'idle', tasks: [] },
    };
    setNodes(previous => [...previous, node]);
    return node;
  }, [setNodes]);

  const generateStickmanShots = React.useCallback(async (storyboardId: string, shotIds?: string[]) => {
    if (!canvasEditLock.guard()) return;
    if (!workflowId) {
      showToast('请先新建或打开项目', { tone: 'error' });
      return;
    }
    const current = nodesRef.current;
    const storyboardNode = current.find(node => node.id === storyboardId && [NodeType.STORYBOARD, NodeType.STORYBOARD_COMPARE].includes(node.type));
    if (!storyboardNode?.storyboard?.shots.length) {
      showToast('当前没有可生成的分镜', { tone: 'error' });
      return;
    }
    const batchNode = ensureStickmanBatchNode(storyboardId) || nodesRef.current.find(node => node.type === NodeType.FLOW_BATCH_VIDEO && node.parentIds?.includes(storyboardId));
    if (!batchNode) return;
    const batchState = batchNode.flowBatch || {
      modelId: listVideoGenerationProviders()[0]?.id,
      concurrency: 2, aspectRatio: storyboardNode.storyboard.shots[0].aspectRatio,
      width: storyboardNode.storyboard.shots[0].width, height: storyboardNode.storyboard.shots[0].height,
      duration: storyboardNode.storyboard.shots[0].duration, nativeAudio: true, autoRetry: true, maxRetries: 1,
      continueOnFailure: true, autoMerge: false, status: 'idle' as const, tasks: [],
    };
    const shotIdSet = shotIds ? new Set(shotIds) : null;
    const targets = storyboardNode.storyboard.shots.filter(shot => shotIdSet
      ? shotIdSet.has(shot.id)
      : shot.generation.status !== 'completed');
    const runKey = specialRunKey('stickman', storyboardId);
    if (specialRunControlsRef.current.has(runKey)) {
      showToast('这个火柴人分镜批次正在运行中，可先暂停队列', { tone: 'info' });
      return;
    }
    if (!targets.length) {
      showToast('没有待生成镜头；已完成镜头不会自动重复扣费');
      return;
    }
    const control: SpecialRunControl = { kind: 'stickman', storyboardId, paused: false };
    specialRunControlsRef.current.set(runKey, control);
    const taskSeed = targets.map(shot => {
      const existing = batchState.tasks?.find(task => task.shotId === shot.id);
      return { shotId: shot.id, taskId: existing?.taskId || crypto.randomUUID(), status: 'waiting' as const, retryCount: existing?.retryCount || 0 };
    });
    setNodes(previous => previous.map(node => {
      if (node.id === batchNode.id) return { ...node, flowBatch: { ...batchState, status: 'running', error: undefined, tasks: [...(batchState.tasks || []).filter(task => !targets.some(shot => shot.id === task.shotId)), ...taskSeed] } };
      if (node.id === storyboardId && node.storyboard) return { ...node, storyboard: { ...node.storyboard, status: 'generating', error: undefined, shots: node.storyboard.shots.map(shot => {
        if (!targets.some(item => item.id === shot.id)) return shot;
        cancelledSpecialShotsRef.current.delete(specialShotKey('stickman', storyboardId, shot.id));
        return { ...shot, generation: { ...shot.generation, status: 'queued', error: undefined, queuedAt: Date.now(), startedAt: undefined, finishedAt: undefined, elapsedMs: undefined } };
      }) } };
      return node;
    }));

    let cursor = 0;
    const results: Array<'success' | 'failed' | 'cancelled'> = [];
    const outcomes = new Map<string, StickmanShot['generation']['status']>();
    const updateProgress = (shotId: string, generation: Partial<StickmanShot['generation']>, taskPatch: Partial<NonNullable<typeof batchState.tasks>[number]>) => {
      setNodes(previous => previous.map(node => {
        if (node.id === batchNode.id && node.flowBatch) {
          return { ...node, flowBatch: { ...node.flowBatch, tasks: node.flowBatch.tasks.map(task => task.shotId === shotId ? { ...task, ...taskPatch } : task) } };
        }
        if (node.id === storyboardId && node.storyboard) {
          return { ...node, storyboard: { ...node.storyboard, shots: node.storyboard.shots.map(shot => shot.id === shotId ? { ...shot, generation: { ...shot.generation, ...generation } } : shot) } };
        }
        return node;
      }));
    };
    const process = async (shot: StickmanShot) => {
      const seed = taskSeed.find(task => task.shotId === shot.id)!;
      const shotKey = specialShotKey('stickman', storyboardId, shot.id);
      if (cancelledSpecialShotsRef.current.has(shotKey)) {
        const finishedAt = Date.now();
        updateProgress(shot.id, { status: 'cancelled', error: '已手动取消', finishedAt }, { status: 'cancelled', retryCount: seed.retryCount, error: '已手动取消' });
        results.push('cancelled');
        outcomes.set(shot.id, 'cancelled');
        return;
      }
      let retryCount = seed.retryCount;
      while (true) {
        if (cancelledSpecialShotsRef.current.has(shotKey)) {
          const finishedAt = Date.now();
          updateProgress(shot.id, { status: 'cancelled', error: '已手动取消', finishedAt }, { status: 'cancelled', retryCount, error: '已手动取消' });
          results.push('cancelled');
          outcomes.set(shot.id, 'cancelled');
          return;
        }
        const controller = new AbortController();
        const startedAt = Date.now();
        specialShotControllersRef.current.set(shotKey, { kind: 'stickman', storyboardId, shotId: shot.id, nodeId: seed.taskId, controller });
        updateProgress(shot.id, { status: 'generating', progress: 0, retryCount, error: undefined, startedAt, finishedAt: undefined, elapsedMs: undefined }, { status: 'generating', retryCount, progress: 0 });
        try {
          const resultUrl = await generateStickmanShotVideo({
            workflowId,
            shot,
            modelId: batchState.modelId || listVideoGenerationProviders()[0]?.id || 'google-flow-omni-flash',
            nodeId: seed.taskId,
            nativeAudio: batchState.nativeAudio,
            resolution: batchState.resolution,
            signal: controller.signal,
          });
          const finishedAt = Date.now();
          const url = `${resultUrl}${resultUrl.includes('?') ? '&' : '?'}t=${finishedAt}`;
          if (cancelledSpecialShotsRef.current.has(shotKey)) {
            updateProgress(shot.id, { status: 'cancelled', progress: 1, videoUrl: url, taskId: seed.taskId, error: '已停止等待；结果已返回', finishedAt, elapsedMs: Math.max(0, finishedAt - startedAt) }, { status: 'cancelled', retryCount, progress: 1, resultUrl: url, error: '已停止等待；结果已返回' });
            results.push('cancelled');
            outcomes.set(shot.id, 'cancelled');
          } else {
            updateProgress(shot.id, { status: 'completed', progress: 1, videoUrl: url, taskId: seed.taskId, error: undefined, finishedAt, elapsedMs: Math.max(0, finishedAt - startedAt) }, { status: 'success', retryCount, progress: 1, resultUrl: url, error: undefined });
            results.push('success');
            outcomes.set(shot.id, 'completed');
          }
          return;
        } catch (error) {
          const manuallyCancelled = cancelledSpecialShotsRef.current.has(shotKey) || controller.signal.aborted;
          const submitted = Boolean((error as { submitted?: boolean })?.submitted);
          const finishedAt = Date.now();
          if (batchState.autoRetry && !submitted && retryCount < batchState.maxRetries) {
            if (manuallyCancelled) {
              updateProgress(shot.id, { status: 'cancelled', error: '已手动取消', finishedAt, elapsedMs: Math.max(0, finishedAt - startedAt) }, { status: 'cancelled', retryCount, error: '已手动取消' });
              results.push('cancelled');
              outcomes.set(shot.id, 'cancelled');
              return;
            }
            retryCount += 1;
            specialShotControllersRef.current.delete(shotKey);
            continue;
          }
          const message = error instanceof Error ? error.message : '镜头生成失败';
          if (manuallyCancelled) {
            const cancelMessage = submitted ? '已停止等待；请求可能已提交并计费，请到 Provider 历史确认' : '已手动取消';
            updateProgress(shot.id, { status: 'cancelled', error: cancelMessage, retryCount, finishedAt, elapsedMs: Math.max(0, finishedAt - startedAt) }, { status: 'cancelled', retryCount, error: cancelMessage });
            results.push('cancelled');
            outcomes.set(shot.id, 'cancelled');
          } else {
            updateProgress(shot.id, { status: 'failed', error: message, retryCount, finishedAt, elapsedMs: Math.max(0, finishedAt - startedAt) }, { status: 'failed', retryCount, error: message });
            results.push('failed');
            outcomes.set(shot.id, 'failed');
          }
          return;
        } finally {
          specialShotControllersRef.current.delete(shotKey);
        }
      }
    };
    const worker = async () => {
      while (true) {
        if (control.paused) return;
        const index = cursor++;
        if (index >= targets.length) return;
        await process(targets[index]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(batchState.concurrency || 2, targets.length) }, () => worker()));
    const pausedWithPending = control.paused && cursor < targets.length;
    specialRunControlsRef.current.delete(runKey);
    // Roll up from the full shot list (this round's outcomes layered over the
    // shots that were already generated / still pending) so a partial run never
    // reports "全部完成" while other shots remain unfinished.
    const finalShots = (storyboardNode.storyboard?.shots || []).map(shot => {
      const outcome = outcomes.get(shot.id);
      return outcome ? { ...shot, generation: { ...shot.generation, status: outcome } } : shot;
    });
    const rollup = rollupStickmanGenerationStatus(finalShots);
    setNodes(previous => previous.map(node => {
      if (node.id === batchNode.id && node.flowBatch) return { ...node, flowBatch: { ...node.flowBatch, status: pausedWithPending ? 'paused' : rollup.batchStatus === 'ready' ? 'idle' : rollup.batchStatus, tasks: node.flowBatch.tasks } };
      if (node.id === storyboardId && node.storyboard) return { ...node, storyboard: { ...node.storyboard, status: pausedWithPending ? 'paused' : rollup.storyboardStatus } };
      return node;
    }));
    const roundFailures = results.filter(result => result === 'failed').length;
    showToast(
      pausedWithPending
        ? `已暂停队列；${results.filter(result => result === 'success').length} 个镜头已完成，剩余镜头等待恢复`
        : rollup.batchStatus === 'completed'
          ? `已完成全部 ${rollup.total} 个镜头`
          : `本轮完成，成功 ${results.filter(result => result === 'success').length} 个${roundFailures ? `，失败 ${roundFailures} 个` : ''}（共 ${rollup.total}，已生成 ${rollup.completed}）`,
      { tone: pausedWithPending ? 'info' : roundFailures ? 'error' : 'info' },
    );
  }, [canvasEditLock, ensureStickmanBatchNode, setNodes, showToast, workflowId]);

  const resolveStickmanStoryboardId = React.useCallback((nodeId: string) => {
    const node = nodesRef.current.find(item => item.id === nodeId);
    if (node?.type === NodeType.FLOW_BATCH_VIDEO) {
      return node.parentIds?.find(parentId => nodesRef.current.some(parent => parent.id === parentId && [NodeType.STORYBOARD, NodeType.STORYBOARD_COMPARE].includes(parent.type)));
    }
    return node?.type === NodeType.STORYBOARD || node?.type === NodeType.STORYBOARD_COMPARE ? nodeId : undefined;
  }, []);

  const cancelStickmanShot = React.useCallback(async (storyboardId: string, shotId: string) => {
    const key = specialShotKey('stickman', storyboardId, shotId);
    const entry = specialShotControllersRef.current.get(key);
    const batchNode = nodesRef.current.find(node => node.type === NodeType.FLOW_BATCH_VIDEO && node.parentIds?.includes(storyboardId));
    const taskId = entry?.nodeId || batchNode?.flowBatch?.tasks.find(task => task.shotId === shotId)?.taskId || `stickman-${storyboardId}-${shotId}`;
    let submitted = false;
    try {
      const result = await requestCancelGeneration(taskId, workflowId);
      submitted = result.submitted;
    } catch (error) {
      showToast(error instanceof Error ? error.message : '取消火柴人镜头失败', { tone: 'error' });
      return;
    }
    cancelledSpecialShotsRef.current.add(key);
    entry?.controller.abort();
    const shot = nodesRef.current.find(node => node.id === storyboardId)?.storyboard?.shots.find(item => item.id === shotId);
    const finishedAt = Date.now();
    const startedAt = shot?.generation.startedAt || shot?.generation.queuedAt;
    const errorMessage = submitted ? '已停止等待；请求可能已提交并计费，请到 Provider 历史确认' : '已手动取消';
    setNodes(previous => previous.map(node => {
      if (node.id === storyboardId && node.storyboard) {
        return {
          ...node,
          storyboard: {
            ...node.storyboard,
            shots: node.storyboard.shots.map(item => item.id === shotId
              ? { ...item, generation: { ...item.generation, status: 'cancelled', error: errorMessage, finishedAt, ...(startedAt ? { elapsedMs: Math.max(0, finishedAt - startedAt) } : {}) } }
              : item),
          },
        };
      }
      if (node.id === batchNode?.id && node.flowBatch) {
        return { ...node, flowBatch: { ...node.flowBatch, tasks: node.flowBatch.tasks.map(task => task.shotId === shotId ? { ...task, status: 'cancelled', error: errorMessage } : task) } };
      }
      return node;
    }));
  }, [setNodes, showToast, workflowId]);

  const pauseStickmanBatch = React.useCallback((nodeId: string) => {
    const storyboardId = resolveStickmanStoryboardId(nodeId);
    if (!storyboardId) return;
    const control = specialRunControlsRef.current.get(specialRunKey('stickman', storyboardId));
    if (control) control.paused = true;
    setNodes(previous => previous.map(node => {
      if (node.id === storyboardId && node.storyboard) return { ...node, storyboard: { ...node.storyboard, status: 'paused' } };
      if (node.id === nodeId && node.flowBatch) return { ...node, flowBatch: { ...node.flowBatch, status: 'paused' } };
      return node;
    }));
  }, [resolveStickmanStoryboardId, setNodes]);

  const resumeStickmanBatch = React.useCallback((nodeId: string) => {
    const storyboardId = resolveStickmanStoryboardId(nodeId);
    if (!storyboardId) return;
    const control = specialRunControlsRef.current.get(specialRunKey('stickman', storyboardId));
    if (control) {
      control.paused = false;
      setNodes(previous => previous.map(node => {
        if (node.id === storyboardId && node.storyboard) return { ...node, storyboard: { ...node.storyboard, status: 'generating' } };
        if (node.id === nodeId && node.flowBatch) return { ...node, flowBatch: { ...node.flowBatch, status: 'running' } };
        return node;
      }));
      return;
    }
    void generateStickmanShots(storyboardId);
  }, [generateStickmanShots, resolveStickmanStoryboardId, setNodes]);

  const handleGenerateStickmanShot = React.useCallback((storyboardId: string, shotId: string) => {
    void generateStickmanShots(storyboardId, [shotId]);
  }, [generateStickmanShots]);

  const handleBatchGenerateStickman = React.useCallback((nodeId: string) => {
    const current = nodesRef.current.find(node => node.id === nodeId);
    const storyboardId = current?.type === NodeType.FLOW_BATCH_VIDEO
      ? current.parentIds?.find(parentId => nodesRef.current.some(node => node.id === parentId && [NodeType.STORYBOARD, NodeType.STORYBOARD_COMPARE].includes(node.type)))
      : current?.type === NodeType.STORYBOARD || current?.type === NodeType.STORYBOARD_COMPARE ? nodeId : undefined;
    if (storyboardId) void generateStickmanShots(storyboardId);
  }, [generateStickmanShots]);

  const handleRetryStickmanFailed = React.useCallback((nodeId: string) => {
    const current = nodesRef.current.find(node => node.id === nodeId);
    const storyboardId = current?.type === NodeType.FLOW_BATCH_VIDEO
      ? current.parentIds?.find(parentId => nodesRef.current.some(node => node.id === parentId && [NodeType.STORYBOARD, NodeType.STORYBOARD_COMPARE].includes(node.type)))
      : current?.type === NodeType.STORYBOARD || current?.type === NodeType.STORYBOARD_COMPARE ? nodeId : undefined;
    const storyboard = storyboardId ? nodesRef.current.find(node => node.id === storyboardId) : undefined;
    const failed = storyboard?.storyboard?.shots.filter(shot => shot.generation.status === 'failed').map(shot => shot.id) || [];
    if (storyboardId && failed.length) void generateStickmanShots(storyboardId, failed);
  }, [generateStickmanShots]);

  const handleMergeStickmanVideos = React.useCallback(async (mergeNodeId: string) => {
    if (!canvasEditLock.guard()) return;
    if (!workflowId) {
      showToast('请先新建或打开项目', { tone: 'error' });
      return;
    }
    const current = nodesRef.current;
    const mergeNode = current.find(node => node.id === mergeNodeId && node.type === NodeType.VIDEO_MERGE);
    const batchNode = mergeNode?.parentIds?.map(id => current.find(node => node.id === id)).find(node => node?.type === NodeType.FLOW_BATCH_VIDEO);
    const storyboardNode = batchNode?.parentIds?.map(id => current.find(node => node.id === id)).find(node => node && [NodeType.STORYBOARD, NodeType.STORYBOARD_COMPARE].includes(node.type));
    const shots = storyboardNode?.storyboard?.shots || [];
    const directorNode = storyboardNode?.parentIds?.map(id => current.find(node => node.id === id)).find(node => node?.type === NodeType.STICKMAN_DIRECTOR);
    if (!mergeNode || !batchNode || !storyboardNode || !shots.some(shot => shot.generation.status === 'completed' && shot.generation.videoUrl)) {
      showToast('请先完成至少一个镜头生成', { tone: 'error' });
      return;
    }
    const mergeState = mergeNode.videoMerge || { status: 'idle' as const, outputFormat: 'mp4' as const, fps: 30, skipFailed: true };
    const output = directorNode?.director?.output;
    setNodes(previous => previous.map(node => node.id === mergeNodeId ? { ...node, videoMerge: { ...mergeState, status: 'queued', error: undefined } } : node));
    try {
      const job = await submitStickmanMerge({
        workflowId,
        title: directorNode?.title || '火柴人视频成片',
        shots: shots.map(shot => ({ id: shot.id, order: shot.order, title: shot.title, duration: shot.duration, videoUrl: shot.generation.videoUrl, status: shot.generation.status, transition: shot.visual.transition })),
        width: output?.global.width || shots[0].width,
        height: output?.global.height || shots[0].height,
        fps: mergeState.fps,
        skipFailed: mergeState.skipFailed,
      });
      setNodes(previous => previous.map(node => node.id === mergeNodeId ? { ...node, videoMerge: { ...mergeState, status: job.status === 'success' ? 'success' : 'rendering', jobId: job.jobId } } : node));
      let status = job;
      while (['queued', 'rendering'].includes(status.status)) {
        await new Promise(resolve => window.setTimeout(resolve, 1500));
        status = await getStickmanMergeJob(job.jobId);
        setNodes(previous => previous.map(node => node.id === mergeNodeId ? { ...node, videoMerge: { ...mergeState, status: status.status === 'success' ? 'success' : status.status === 'failed' ? 'failed' : status.status === 'cancelled' ? 'cancelled' : 'rendering', jobId: job.jobId, outputUrl: status.output || undefined, error: status.error || undefined } } : node));
      }
      if (status.status !== 'success') throw new Error(status.error || '视频拼接失败');
      showToast('最终视频已拼接完成');
    } catch (error) {
      const message = error instanceof Error ? error.message : '视频拼接失败';
      setNodes(previous => previous.map(node => node.id === mergeNodeId ? { ...node, videoMerge: { ...mergeState, status: 'failed', error: message } } : node));
      showToast(message, { tone: 'error', duration: TOAST_PERSIST });
    }
  }, [canvasEditLock, setNodes, showToast, workflowId]);

  const handleLockVideoAnalysisAssetMain = React.useCallback((nodeId: string) => {
    if (!canvasEditLock.guard()) return;
    const current = nodesRef.current.find(node => node.id === nodeId);
    if (!current || current.videoAnalysisAssetRole !== 'main') return;
    if (!current.resultUrl) {
      showToast('请先生成主图，再锁定主图', { tone: 'error' });
      return;
    }
    const nextLocked = !current.videoAnalysisAssetMainLocked;
    setNodes(previous => previous.map(node => node.id === nodeId
      ? { ...node, videoAnalysisAssetMainLocked: nextLocked }
      : node));
    showToast(nextLocked ? '主图已锁定，其他角度将以此图为参考' : '已解除主图锁定');
  }, [canvasEditLock, setNodes, showToast]);

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
    currentNodes: NodeData[] = nodes,
    targetPortId?: string,
  ): Partial<NodeData> => {
    const parentNode = currentNodes.find(n => n.id === parentId);
    const childNode = currentNodes.find(n => n.id === childId);
    if (!parentNode || !childNode) return {};

    const updates: Partial<NodeData> = {};
    if (childNode.type === NodeType.VIDEO_ANALYSIS) {
      const mapped = assignVideoAnalysisInputPort(childNode, parentNode, targetPortId);
      return {
        parentIds: Object.keys(mapped.inputPortByParentId || {}),
        inputPortByParentId: mapped.inputPortByParentId,
        videoAnalysis: mapped.videoAnalysis,
      };
    }
    if (childNode.type === NodeType.DETAIL_PAGE_REMIX) {
      const mapped = assignDetailRemixInputPort(childNode, parentNode, targetPortId);
      return {
        parentIds: Object.keys(mapped.inputPortByParentId || {}),
        inputPortByParentId: mapped.inputPortByParentId,
        detailRemix: mapped.detailRemix,
      };
    }
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

  /**
   * 指针被系统收走时的兜底（触控板手势、掌托误触、窗口失焦都会触发）。
   *
   * 没有这条路径的话，被打断的那一次拖拽会让节点一直持有指针捕获，之后所有
   * 指针事件都被转发给它，整块画布看起来就完全没反应了。
   */
  const handleGlobalPointerCancel = () => {
    abortPointerInteractions();
    resetConnectionDrag();
  };

  // Context menu handlers provided by useContextMenuHandlers hook
  // handleDoubleClick, handleGlobalContextMenu, handleAddNext, handleNodeContextMenu,
  // handleContextMenuCreateAsset and handleContextMenuSelect are used below.

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
      const referenceParentIds = [...new Set([
        ...(node.parentIds || []),
        ...Object.values(node.inheritedReferences || {}).flat(),
      ])];
      const deps: unknown[] = [referenceParentIds.join('\u0000')];
      for (const parentId of referenceParentIds) deps.push(byId.get(parentId));

      const cached = previous.get(node.id);
      const reusable = Boolean(cached)
        && cached!.deps.length === deps.length
        && cached!.deps.every((dep, index) => dep === deps[index]);

      const value = reusable ? cached!.value : collectNodeReferences(referenceParentIds, nodes);
      nextCache.set(node.id, { deps, value });
      result.set(node.id, value);
    }

    referenceCacheRef.current = nextCache;
    return result;
  }, [nodes]);

  // 视口剔除：只渲染可视区（外扩一屏）内的节点。
  //
  // 画布原本无差别渲染全部节点，NodeControls 一千七百行的子树对屏幕外几千像素的
  // 节点照样挂着。节点上百之后这是最大的一块开销。
  //
  // keepIds 里的两类节点永不剔除，否则会制造比性能更糟的 bug：正在拖的节点
  // （靠 setPointerCapture，卸载会让拖拽断在半路）和连线拖拽的起点节点。
  // 详见 utils/viewportCulling.js。
  const renderedNodes = React.useMemo(() => {
    const keepIds = [...selectedNodeIds];
    if (connectionStart?.nodeId) keepIds.push(connectionStart.nodeId);
    const visible = visibleNodeIds({
      nodes,
      viewport,
      rect: getCanvasRect(),
      keepIds,
    });
    // 全部可见时直接复用原数组，避免每帧产生新引用。
    return visible.size === nodes.length ? nodes : nodes.filter(node => visible.has(node.id));
  }, [nodes, viewport, selectedNodeIds, connectionStart]);

  // 这十几个回调来自不同的 hook，稳定性无法逐个保证。用 ref 转发：
  // 传给 CanvasNode 的引用永远不变，内部始终调用最新实现。
  const latestNodeCallbacks = {
    updateNodeWithSync,
    handleGenerate,
    handleCancelGeneration,
    handleAnalyzeVideoNode,
    handleGenerateVideoAnalysisAssets,
    handleLockVideoAnalysisAssetMain,
    handleAnalyzeStickmanScript,
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
    handleRunStickmanDirector,
    handleGenerateStickmanShot,
    handleBatchGenerateStickman,
    handleRetryStickmanFailed,
    cancelStickmanShot,
    pauseStickmanBatch,
    resumeStickmanBatch,
    handleMergeStickmanVideos,
    handleRunCinematicDirector,
    handleGenerateCinematicShot,
    handleBatchGenerateCinematic,
    handleRetryCinematicFailed,
    cancelCinematicShot,
    pauseCinematicBatch,
    resumeCinematicBatch,
    handleMergeCinematicVideos,
    importDetailRemixFolder,
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
    onCancelGeneration: (id: string) => { void nodeCallbacksRef.current.handleCancelGeneration(id); },
    onContextMenu: (e: React.MouseEvent, id: string) =>
      nodeCallbacksRef.current.handleNodeContextMenu(e, id),
    onConnectorDown: (e: React.PointerEvent, id: string, side: 'left' | 'right', portId?: string) => {
      // 连线拖拽全程读缓存的画布偏移，开始时兜底刷新一次（每次手势一次，不是每帧）。
      refreshCanvasOffset();
      nodeCallbacksRef.current.handleConnectorPointerDown(e, id, side, portId);
    },
    onAnalyzeVideo: (id: string) => nodeCallbacksRef.current.handleAnalyzeVideoNode(id),
    onGenerateVideoAnalysisAssets: (id: string) => nodeCallbacksRef.current.handleGenerateVideoAnalysisAssets(id),
    onLockVideoAnalysisAssetMain: (id: string) => nodeCallbacksRef.current.handleLockVideoAnalysisAssetMain(id),
    onAnalyzeStickmanScript: (id: string) => nodeCallbacksRef.current.handleAnalyzeStickmanScript(id),
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
    onRunStickmanDirector: (id: string) => nodeCallbacksRef.current.handleRunStickmanDirector(id),
    onGenerateStickmanShot: (storyboardId: string, shotId: string) => nodeCallbacksRef.current.handleGenerateStickmanShot(storyboardId, shotId),
    onBatchGenerateStickman: (id: string) => nodeCallbacksRef.current.handleBatchGenerateStickman(id),
    onRetryStickmanFailed: (id: string) => nodeCallbacksRef.current.handleRetryStickmanFailed(id),
    onCancelStickmanShot: (storyboardId: string, shotId: string) => { void nodeCallbacksRef.current.cancelStickmanShot(storyboardId, shotId); },
    onPauseStickmanBatch: (id: string) => nodeCallbacksRef.current.pauseStickmanBatch(id),
    onResumeStickmanBatch: (id: string) => nodeCallbacksRef.current.resumeStickmanBatch(id),
    onMergeStickmanVideos: (id: string) => nodeCallbacksRef.current.handleMergeStickmanVideos(id),
    onRunCinematicDirector: (id: string) => nodeCallbacksRef.current.handleRunCinematicDirector(id),
    onGenerateCinematicShot: (storyboardId: string, shotId: string) => nodeCallbacksRef.current.handleGenerateCinematicShot(storyboardId, shotId),
    onBatchGenerateCinematic: (id: string) => nodeCallbacksRef.current.handleBatchGenerateCinematic(id),
    onRetryCinematicFailed: (id: string) => nodeCallbacksRef.current.handleRetryCinematicFailed(id),
    onCancelCinematicShot: (storyboardId: string, shotId: string) => { void nodeCallbacksRef.current.cancelCinematicShot(storyboardId, shotId); },
    onPauseCinematicBatch: (id: string) => nodeCallbacksRef.current.pauseCinematicBatch(id),
    onResumeCinematicBatch: (id: string) => nodeCallbacksRef.current.resumeCinematicBatch(id),
    onMergeCinematicVideos: (id: string) => nodeCallbacksRef.current.handleMergeCinematicVideos(id),
    onImportDetailRemixFolder: (
      controller: Pick<NodeData, 'id' | 'x' | 'y'>,
      role: 'competitor' | 'own',
      files: File[],
    ) => nodeCallbacksRef.current.importDetailRemixFolder(controller, role, files),
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
      {!isTikTokModalOpen && (
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
        onImportLocalProject={handleImportLocalProject}
        isImportingLocalProject={isImportingLocalProject}
        onRenameWorkflow={(id, title, renamedNodes, renamedVideoRemixes) => {
          if (id !== workflowId) return;
          ignoreNextChange.current = true;
          setCanvasTitle(title);
          setEditingTitleValue(title);
          if (renamedNodes.length > 0) setNodes(renamedNodes);
          setVideoRemixes(normalizeVideoRemixProjects(renamedVideoRemixes));
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

      {/* Top Bar */}
      {/* Top Bar */}
      {!isTikTokModalOpen && (
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
          onOpenExistingProject={handleOpenExistingProject}
          onUndo={handleCanvasUndo}
          onRedo={handleCanvasRedo}
          canUndo={canUndo || Boolean(activeCanvasHistoryTransactionId)}
          canRedo={canRedo && !activeCanvasHistoryTransactionId}
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
          showBrand={true}
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
            <p className="text-sm font-medium text-neutral-100">请先新建项目或打开已有项目</p>
            <p className="mt-1 text-[11px] text-neutral-400">点击顶部「打开项目」加载已有画布，或点击「+ 新建」创建项目</p>
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
        onPointerCancel={handleGlobalPointerCancel}
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
            {renderedNodes.map(node => (
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
                onCancelGeneration={stableNodeHandlers.onCancelGeneration}
                selected={selectedNodeIds.includes(node.id)}
                showControls={selectedNodeIds.length === 1 && selectedNodeIds.includes(node.id)}
                onNodePointerDown={stableNodeHandlers.onNodePointerDown}
                onContextMenu={stableNodeHandlers.onContextMenu}
                onSelect={stableNodeHandlers.onSelect}
                onConnectorDown={stableNodeHandlers.onConnectorDown}
                onAnalyzeVideo={stableNodeHandlers.onAnalyzeVideo}
                onGenerateVideoAnalysisAssets={stableNodeHandlers.onGenerateVideoAnalysisAssets}
                onLockVideoAnalysisAssetMain={stableNodeHandlers.onLockVideoAnalysisAssetMain}
                onAnalyzeStickmanScript={stableNodeHandlers.onAnalyzeStickmanScript}
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
                onRunStickmanDirector={stableNodeHandlers.onRunStickmanDirector}
                onGenerateStickmanShot={stableNodeHandlers.onGenerateStickmanShot}
                onBatchGenerateStickman={stableNodeHandlers.onBatchGenerateStickman}
                onRetryStickmanFailed={stableNodeHandlers.onRetryStickmanFailed}
                onCancelStickmanShot={stableNodeHandlers.onCancelStickmanShot}
                onPauseStickmanBatch={stableNodeHandlers.onPauseStickmanBatch}
                onResumeStickmanBatch={stableNodeHandlers.onResumeStickmanBatch}
                onMergeStickmanVideos={stableNodeHandlers.onMergeStickmanVideos}
                onRunCinematicDirector={stableNodeHandlers.onRunCinematicDirector}
                onGenerateCinematicShot={stableNodeHandlers.onGenerateCinematicShot}
                onBatchGenerateCinematic={stableNodeHandlers.onBatchGenerateCinematic}
                onRetryCinematicFailed={stableNodeHandlers.onRetryCinematicFailed}
                onCancelCinematicShot={stableNodeHandlers.onCancelCinematicShot}
                onPauseCinematicBatch={stableNodeHandlers.onPauseCinematicBatch}
                onResumeCinematicBatch={stableNodeHandlers.onResumeCinematicBatch}
                onMergeCinematicVideos={stableNodeHandlers.onMergeCinematicVideos}
                onImportDetailRemixFolder={stableNodeHandlers.onImportDetailRemixFolder}
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
        onUndo={handleCanvasUndo}
        onRedo={handleCanvasRedo}
        onPaste={canvasEditLock.withGuard(handlePaste)}
        onCopy={handleCopy}
        onDuplicate={handleDuplicate}
        onCreateAsset={handleContextMenuCreateAsset}
        onUseAsReferenceVideo={() => void handleUseCanvasVideoAsReference()}
        canUseAsReferenceVideo={nodes.some(node =>
          node.id === contextMenu.sourceNodeId
          && (node.type === NodeType.VIDEO || node.type === NodeType.REFERENCE_VIDEO)
          && Boolean(node.resultUrl)
        )}
        onCreateStickmanWorkflow={handleCreateStickmanWorkflow}
        onCreateCinematicWorkflow={handleCreateCinematicWorkflow}
        onCreateDetailRemixWorkflow={handleCreateDetailRemixWorkflow}
        onAddAssets={handleContextMenuAddAssets}
        onOpenHistory={handleContextMenuOpenHistory}
        canUndo={canUndo || Boolean(activeCanvasHistoryTransactionId)}
        canRedo={canRedo && !activeCanvasHistoryTransactionId}
        canvasTheme={canvasTheme}
      />

      {/* Canvas navigation controls */}
      {!isTikTokModalOpen && (
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

      {/* Fullscreen Media Preview Modal */}
      <ExpandedMediaModal
        mediaUrl={expandedImageUrl}
        onClose={handleCloseExpand}
      />

      {/* 应用内提示（替代会冻住渲染进程的 window.alert） */}
      <ToastStack toasts={toasts} onDismiss={dismissToast} canvasTheme={canvasTheme} />
      <ShortcutHelpModal
        isOpen={isShortcutHelpOpen}
        onClose={() => setIsShortcutHelpOpen(false)}
        canvasTheme={canvasTheme}
      />
    </div >
  );
}
