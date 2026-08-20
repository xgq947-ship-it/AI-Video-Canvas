/**
 * CanvasNode.tsx
 * 
 * Main canvas node component.
 * Orchestrates NodeContent, NodeControls, and NodeConnectors sub-components.
 */

import React from 'react';
import { LockKeyhole, UnlockKeyhole } from 'lucide-react';
import { NodeData, NodeStatus, NodeType } from '../../types';
import { NodeConnectors } from './NodeConnectors';
import { NodeContent } from './NodeContent';
import { MangaNode } from './MangaNode';
import { isMangaNode } from '../../types';
import { NodeControls } from './NodeControls';
import { ChangeAnglePanel } from './ChangeAnglePanel';
import { NodeHoverToolbar, NodeHoverToolbarAction } from './NodeHoverToolbar';
import type { NodeReference } from '../../utils/nodeReferences.js';
import { ProductSceneReplaceNode } from './ProductSceneReplaceNode';
import { DetailRemixNode } from '../../features/detail-remix/DetailRemixNode';
import { VideoRemixNode } from '../../features/video-remix/VideoRemixNode';
import { VideoAnalysisNode } from '../../features/video-analysis/VideoAnalysisNode';
import {
  FlowBatchVideoNode,
  ReferenceVideoNode,
  ScriptInputNode,
  StickmanDirectorNode,
  StoryboardNode,
  VideoMergeNode,
} from '../../features/stickman-director/StickmanWorkflowNodes';
import {
  CinematicCastNode,
  CinematicDirectorNode,
  CinematicStoryboardNode,
  CinematicVideoMergeNode,
} from '../../features/cinematic-director/CinematicWorkflowNodes';

interface CanvasNodeProps {
  workflowId?: string;
  data: NodeData;
  allNodes?: NodeData[]; // 全部节点（漫剧成片节点用于组装 manifest）
  inputUrl?: string;
  connectedReferences?: NodeReference[];
  onUpdate: (id: string, updates: Partial<NodeData>) => void;
  onGenerate: (id: string) => void;
  onCancelGeneration?: (id: string) => void;
  selected: boolean;
  showControls?: boolean; // Only show controls when single node is selected (not in group selection)
  onSelect: (id: string) => void;
  onNodePointerDown: (e: React.PointerEvent, id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  onConnectorDown: (e: React.PointerEvent, id: string, side: 'left' | 'right', portId?: string) => void;
  onOpenEditor?: (nodeId: string) => void;
  onUpload?: (nodeId: string, imageDataUrl: string) => void;
  onExpand?: (imageUrl: string) => void;
  // Text node callbacks
  onWriteContent?: (nodeId: string) => void;
  onTextToVideo?: (nodeId: string) => void;
  onTextToImage?: (nodeId: string) => void;
  // Image node callbacks
  onImageToImage?: (nodeId: string) => void;
  onImageToVideo?: (nodeId: string) => void;
  onChangeAngleGenerate?: (nodeId: string) => void;
  onExtractLastFrame?: (nodeId: string) => void;
  onOpenVideoRemix?: (nodeId: string) => void;
  onAnalyzeVideo?: (nodeId: string) => void;
  onGenerateVideoAnalysisAssets?: (nodeId: string) => void;
  onLockVideoAnalysisAssetMain?: (nodeId: string) => void;
  onAnalyzeStickmanScript?: (nodeId: string) => void;
  onRunStickmanDirector?: (nodeId: string) => void;
  onGenerateStickmanShot?: (storyboardId: string, shotId: string) => void;
  onBatchGenerateStickman?: (nodeId: string) => void;
  onRetryStickmanFailed?: (nodeId: string) => void;
  onCancelStickmanShot?: (storyboardId: string, shotId: string) => void;
  onPauseStickmanBatch?: (nodeId: string) => void;
  onResumeStickmanBatch?: (nodeId: string) => void;
  onMergeStickmanVideos?: (nodeId: string) => void;
  onRunCinematicDirector?: (nodeId: string) => void;
  onGenerateCinematicShot?: (storyboardId: string, shotId: string) => void;
  onBatchGenerateCinematic?: (nodeId: string) => void;
  onRetryCinematicFailed?: (nodeId: string) => void;
  onCancelCinematicShot?: (storyboardId: string, shotId: string) => void;
  onPauseCinematicBatch?: (nodeId: string) => void;
  onResumeCinematicBatch?: (nodeId: string) => void;
  onMergeCinematicVideos?: (nodeId: string) => void;
  onImportDetailRemixFolder?: (
    controller: Pick<NodeData, 'id' | 'x' | 'y'>,
    role: 'competitor' | 'own',
    files: File[],
  ) => Promise<unknown>;
  onOpenDetailStitch?: (nodeId: string) => void;
  onRestoreDetailStitch?: (nodeId: string) => void;
  zoom: number;
  // 悬停回调带上 nodeId，调用方才能传稳定的引用（否则每次 render 都是新箭头函数，
  // React.memo 会全部失效）。
  onMouseEnter?: (id: string) => void;
  onMouseLeave?: (id: string) => void;
  // Theme
  canvasTheme?: 'dark' | 'light';
}

const NODE_TYPE_LABELS: Record<NodeType, string> = {
  [NodeType.TEXT]: '文本',
  [NodeType.IMAGE]: '图片',
  [NodeType.VIDEO]: '视频',
  [NodeType.AUDIO]: '配音',
  [NodeType.IMAGE_EDITOR]: '图片编辑器',
  [NodeType.CAMERA_ANGLE]: '镜头角度',
  [NodeType.PRODUCT_SCENE_REPLACE]: '产品短视频生成',
  [NodeType.DETAIL_PAGE_REMIX]: '商品详情复刻',
  [NodeType.VIDEO_ANALYSIS]: '视频分析',
  [NodeType.VIDEO_REMIX]: '视频复刻',
  [NodeType.REFERENCE_VIDEO]: '参考视频',
  [NodeType.SCRIPT_INPUT]: '剧本输入',
  [NodeType.STICKMAN_DIRECTOR]: '火柴人视频导演',
  [NodeType.STORYBOARD]: '分镜列表',
  [NodeType.STORYBOARD_COMPARE]: '分镜对照组',
  [NodeType.FLOW_BATCH_VIDEO]: 'Flow 视频生成',
  [NodeType.VIDEO_MERGE]: '视频拼接',
  [NodeType.CINEMATIC_CAST]: '角色设定',
  [NodeType.CINEMATIC_DIRECTOR]: '电影短片导演',
  [NodeType.CINEMATIC_STORYBOARD]: '电影分镜',
  [NodeType.CINEMATIC_VIDEO_MERGE]: '电影成片拼接',
  [NodeType.SFX]: '音效',
  [NodeType.BGM]: '背景音乐',
  [NodeType.RENDER]: '成片',
};

const CanvasNodeComponent: React.FC<CanvasNodeProps> = ({
  workflowId,
  data,
  allNodes,
  inputUrl,
  connectedReferences,
  onUpdate,
  onGenerate,
  onCancelGeneration,
  selected,
  showControls = true, // Default to true for backward compatibility
  onSelect,
  onNodePointerDown,
  onContextMenu,
  onConnectorDown,
  onOpenEditor,
  onUpload,
  onExpand,
  onWriteContent,
  onTextToVideo,
  onTextToImage,
  onImageToImage,
  onImageToVideo,
  onChangeAngleGenerate,
  onExtractLastFrame,
  onOpenVideoRemix,
  onAnalyzeVideo,
  onGenerateVideoAnalysisAssets,
  onLockVideoAnalysisAssetMain,
  onAnalyzeStickmanScript,
  onRunStickmanDirector,
  onGenerateStickmanShot,
  onBatchGenerateStickman,
  onRetryStickmanFailed,
  onCancelStickmanShot,
  onPauseStickmanBatch,
  onResumeStickmanBatch,
  onMergeStickmanVideos,
  onRunCinematicDirector,
  onGenerateCinematicShot,
  onBatchGenerateCinematic,
  onRetryCinematicFailed,
  onCancelCinematicShot,
  onPauseCinematicBatch,
  onResumeCinematicBatch,
  onMergeCinematicVideos,
  onImportDetailRemixFolder,
  onOpenDetailStitch,
  onRestoreDetailStitch,
  zoom,
  onMouseEnter,
  onMouseLeave,
  canvasTheme = 'dark',
}) => {
  // ============================================================================
  // STATE
  // ============================================================================

  const [isEditingTitle, setIsEditingTitle] = React.useState(false);
  const [editedTitle, setEditedTitle] = React.useState(data.title || data.type);
  const titleInputRef = React.useRef<HTMLInputElement>(null);

  const isLoading = data.status === NodeStatus.LOADING;
  const isSuccess = data.status === NodeStatus.SUCCESS;

  // Theme helper
  const isDark = canvasTheme === 'dark';

  // 工具栏始终保持固定屏幕尺寸，不跟随画布缩放。
  const localScale = 1 / Math.max(zoom, 0.01);

  // 三种可达渲染分支共用一套工具栏，仅通过动作配置保留原有差异与顺序。
  const cameraToolbarActions: NodeHoverToolbarAction[] = [
    'changeAngle',
    'separator',
    'expand',
    'download',
  ];
  const imageToolbarActions: NodeHoverToolbarAction[] = [
    'changeAngle',
    'separator',
    'upload',
    'expand',
    'download',
  ];
  const videoToolbarActions: NodeHoverToolbarAction[] = [
    ...(onExtractLastFrame ? ['lastFrame' as const, 'separator' as const] : []),
    'expand',
    'download',
  ];

  // ============================================================================
  // EFFECTS
  // ============================================================================

  // Focus input when entering edit mode
  React.useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  // Update local state when data.title changes
  React.useEffect(() => {
    setEditedTitle(data.title || data.type);
  }, [data.title, data.type]);

  // Auto-detect aspect ratio for legacy images/videos that don't have resultAspectRatio
  React.useEffect(() => {
    // Only detect if we have a result but no stored aspect ratio
    if (!isSuccess || !data.resultUrl || data.resultAspectRatio) return;

    if (data.type === NodeType.VIDEO) {
      // Detect video dimensions
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        if (video.videoWidth && video.videoHeight) {
          onUpdate(data.id, { resultAspectRatio: `${video.videoWidth}/${video.videoHeight}` });
        }
      };
      video.src = data.resultUrl;
      return () => {
        video.onloadedmetadata = null;
        video.removeAttribute('src');
        video.load();
      };
    } else {
      // Detect image dimensions
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth && img.naturalHeight) {
          onUpdate(data.id, { resultAspectRatio: `${img.naturalWidth}/${img.naturalHeight}` });
        }
      };
      img.src = data.resultUrl;
      return () => {
        img.onload = null;
        img.src = '';
      };
    }
  }, [isSuccess, data.resultUrl, data.resultAspectRatio, data.type, data.id, onUpdate]);

  // ============================================================================
  // HELPERS
  // ============================================================================

  const getAspectRatioStyle = () => {
    // When there's a successful result, ALWAYS use the result's aspect ratio (lock the node size)
    // This prevents the node from resizing when user selects a different ratio for regeneration
    if (isSuccess && data.resultUrl) {
      // Use stored result aspect ratio if available
      if (data.resultAspectRatio) {
        return { aspectRatio: data.resultAspectRatio };
      }
      // If no stored ratio, use default (shouldn't happen for new content, but handles legacy)
      if (data.type === NodeType.VIDEO) {
        return { aspectRatio: '16/9' };
      }
      // Keep current shape for images without stored ratio (legacy)
      return { aspectRatio: '1/1' };
    }

    // Video nodes without result - use default 16:9
    if (data.type === NodeType.VIDEO) {
      return { aspectRatio: '16/9' };
    }

    // Image nodes without result - use the selected aspect ratio for preview
    const ratio = data.aspectRatio || 'Auto';
    // Auto defaults to 16:9 for video-ready format
    if (ratio === 'Auto') return { aspectRatio: '16/9' };

    const [w, h] = ratio.split(':');
    return { aspectRatio: `${w}/${h}` };
  };

  const handleTitleSave = () => {
    setIsEditingTitle(false);
    const trimmed = editedTitle.trim();
    if (trimmed && trimmed !== data.type) {
      onUpdate(data.id, { title: trimmed });
    } else if (!trimmed) {
      setEditedTitle(data.title || data.type);
    }
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  // 产品场景替换使用独立的双图角色与尺寸参数界面。
  if (data.type === NodeType.VIDEO_ANALYSIS) {
    return (
      <VideoAnalysisNode
        data={data}
        allNodes={allNodes || []}
        selected={selected}
        canvasTheme={canvasTheme}
        onUpdate={onUpdate}
        onAnalyze={onAnalyzeVideo || (() => undefined)}
        onGenerateAssets={onGenerateVideoAnalysisAssets}
        onNodePointerDown={onNodePointerDown}
        onContextMenu={onContextMenu}
        onConnectorDown={onConnectorDown}
      />
    );
  }

  if (data.type === NodeType.SCRIPT_INPUT) {
    return <ScriptInputNode {...({ data, allNodes: allNodes || [], selected, canvasTheme, onUpdate, onGenerate, onAnalyzeReference: onAnalyzeStickmanScript, onNodePointerDown, onContextMenu, onConnectorDown } as any)} />;
  }

  if (data.type === NodeType.REFERENCE_VIDEO) {
    return <ReferenceVideoNode {...({ data, allNodes: allNodes || [], selected, canvasTheme, onUpdate, onGenerate, onNodePointerDown, onContextMenu, onConnectorDown, workflowId } as any)} />;
  }

  if (data.type === NodeType.STICKMAN_DIRECTOR) {
    return <StickmanDirectorNode {...({ data, allNodes: allNodes || [], selected, canvasTheme, onUpdate, onGenerate, onNodePointerDown, onContextMenu, onConnectorDown, onRun: onRunStickmanDirector || (() => undefined) } as any)} />;
  }

  if (data.type === NodeType.CINEMATIC_CAST) {
    return <CinematicCastNode {...({ data, allNodes: allNodes || [], selected, canvasTheme, onUpdate, onNodePointerDown, onContextMenu, onConnectorDown, workflowId } as any)} />;
  }

  if (data.type === NodeType.CINEMATIC_DIRECTOR) {
    return <CinematicDirectorNode {...({ data, allNodes: allNodes || [], selected, canvasTheme, onUpdate, onNodePointerDown, onContextMenu, onConnectorDown, workflowId, onRun: onRunCinematicDirector || (() => undefined) } as any)} />;
  }

  if (data.type === NodeType.CINEMATIC_STORYBOARD) {
    return <CinematicStoryboardNode {...({ data, allNodes: allNodes || [], selected, canvasTheme, onUpdate, onNodePointerDown, onContextMenu, onConnectorDown, workflowId, onGenerateShot: onGenerateCinematicShot || (() => undefined), onBatchGenerate: onBatchGenerateCinematic || (() => undefined), onRetryFailed: onRetryCinematicFailed || (() => undefined), onCancelShot: onCancelCinematicShot || (() => undefined), onPauseBatch: onPauseCinematicBatch || (() => undefined), onResumeBatch: onResumeCinematicBatch || (() => undefined) } as any)} />;
  }

  if (data.type === NodeType.CINEMATIC_VIDEO_MERGE) {
    return <CinematicVideoMergeNode {...({ data, allNodes: allNodes || [], selected, canvasTheme, onUpdate, onNodePointerDown, onContextMenu, onConnectorDown, workflowId, onMerge: onMergeCinematicVideos || (() => undefined) } as any)} />;
  }

  if (data.type === NodeType.STORYBOARD || data.type === NodeType.STORYBOARD_COMPARE) {
    return <StoryboardNode {...({ data, allNodes: allNodes || [], selected, canvasTheme, onUpdate, onGenerate, onNodePointerDown, onContextMenu, onConnectorDown, onGenerateShot: onGenerateStickmanShot || (() => undefined), onCancelShot: onCancelStickmanShot || (() => undefined) } as any)} />;
  }

  if (data.type === NodeType.FLOW_BATCH_VIDEO) {
    return <FlowBatchVideoNode {...({ data, allNodes: allNodes || [], selected, canvasTheme, onUpdate, onGenerate, onNodePointerDown, onContextMenu, onConnectorDown, onBatchGenerate: onBatchGenerateStickman || (() => undefined), onRetryFailed: onRetryStickmanFailed || (() => undefined), onGenerateShot: onGenerateStickmanShot || (() => undefined), onCancelShot: onCancelStickmanShot || (() => undefined), onPauseBatch: onPauseStickmanBatch || (() => undefined), onResumeBatch: onResumeStickmanBatch || (() => undefined) } as any)} />;
  }

  if (data.type === NodeType.VIDEO_MERGE) {
    return <VideoMergeNode {...({ data, allNodes: allNodes || [], selected, canvasTheme, onUpdate, onGenerate, onNodePointerDown, onContextMenu, onConnectorDown, onMerge: onMergeStickmanVideos || (() => undefined) } as any)} />;
  }

  // 产品场景替换使用独立的双图角色与尺寸参数界面。
  if (data.type === NodeType.VIDEO_REMIX) {
    return (
      <VideoRemixNode
        data={data}
        selected={selected}
        canvasTheme={canvasTheme}
        onNodePointerDown={onNodePointerDown}
        onContextMenu={onContextMenu}
        onConnectorDown={onConnectorDown}
        onOpenWorkspace={onOpenVideoRemix}
      />
    );
  }

  // 产品场景替换使用独立的双图角色与尺寸参数界面。
  if (data.type === NodeType.PRODUCT_SCENE_REPLACE) {
    return (
      <ProductSceneReplaceNode
        workflowId={workflowId}
        data={data}
        allNodes={allNodes || []}
        selected={selected}
        canvasTheme={canvasTheme}
        onUpdate={onUpdate}
        onGenerate={onGenerate}
        onNodePointerDown={onNodePointerDown}
        onContextMenu={onContextMenu}
        onConnectorDown={onConnectorDown}
      />
    );
  }

  if (data.type === NodeType.DETAIL_PAGE_REMIX) {
    return (
      <DetailRemixNode
        workflowId={workflowId}
        data={data}
        allNodes={allNodes || []}
        selected={selected}
        canvasTheme={canvasTheme}
        onUpdate={onUpdate}
        onNodePointerDown={onNodePointerDown}
        onContextMenu={onContextMenu}
        onConnectorDown={onConnectorDown}
        onImportFolder={onImportDetailRemixFolder}
        onOpenDetailStitch={onOpenDetailStitch}
        onRestoreDetailStitch={onRestoreDetailStitch}
      />
    );
  }

  // Special rendering for Image Editor node
  if (data.type === NodeType.IMAGE_EDITOR) {
    return (
      <div
        data-node-id={data.id}
        className={`absolute flex items-center group/node touch-none pointer-events-auto`}
        style={{
          transform: `translate(${data.x}px, ${data.y}px)`,
          transition: 'box-shadow 0.2s',
          zIndex: selected ? 50 : 10
        }}
        onPointerDown={(e) => onNodePointerDown(e, data.id)}
        onContextMenu={(e) => onContextMenu(e, data.id)}
      >
        <NodeConnectors nodeId={data.id} onConnectorDown={onConnectorDown} canvasTheme={canvasTheme} />

        {/* Image Editor Node Card */}
        <div
          className={`relative rounded-2xl transition-all duration-200 flex flex-col ${inputUrl ? '' : isDark ? 'bg-[#0f0f0f] border border-neutral-700 shadow-2xl' : 'bg-white border border-neutral-200 shadow-lg'} ${selected ? 'ring-1 ring-blue-500/30' : ''}`}
          style={{
            width: inputUrl ? 'auto' : '340px',
            maxWidth: inputUrl ? '500px' : 'none'
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (onOpenEditor) {
              onOpenEditor(data.id);
            }
          }}
        >
          {/* Header */}
          <div className="absolute -top-8 left-0 text-sm px-2 py-0.5 rounded font-medium text-neutral-600">
            图片编辑器
          </div>

          {/* Content Area */}
          <div
            className={`flex flex-col items-center justify-center ${inputUrl || data.resultUrl ? 'p-0' : 'p-6'}`}
            style={{ minHeight: inputUrl || data.resultUrl ? 'auto' : '380px' }}
          >
            {inputUrl || data.resultUrl ? (
              <img
                src={data.resultUrl || inputUrl}
                alt="Content"
                className={`rounded-xl w-full h-full object-cover ${selected ? 'ring-2 ring-blue-500 shadow-2xl' : ''}`}
                style={{ maxHeight: '500px' }}
                draggable={false}
              />
            ) : (
              <div className="text-neutral-500 text-center text-sm">
                双击打开编辑器
              </div>
            )}
          </div>


        </div>
      </div>
    );
  }

  // Special rendering for Camera Angle node (result view)
  if (data.type === NodeType.CAMERA_ANGLE) {
    return (
      <div
        data-node-id={data.id}
        className={`absolute flex items-center group/node touch-none pointer-events-auto`}
        style={{
          transform: `translate(${data.x}px, ${data.y}px)`,
          transition: 'box-shadow 0.2s',
          zIndex: selected ? 50 : 10
        }}
        onPointerDown={(e) => onNodePointerDown(e, data.id)}
        onContextMenu={(e) => onContextMenu(e, data.id)}
      >
        <NodeConnectors nodeId={data.id} onConnectorDown={onConnectorDown} canvasTheme={canvasTheme} />

        {/* Relative wrapper for the Card */}
        <div className="relative group/nodecard">
          {data.resultUrl && (
            <NodeHoverToolbar
              data={data}
              visible={selected && showControls}
              localScale={localScale}
              topClassName="-top-20"
              mediaType="image"
              actions={cameraToolbarActions}
              onUpdate={onUpdate}
              onExpand={onExpand}
            />
          )}

          {/* Node Card */}
          <div
            className={`relative rounded-2xl transition-all duration-200 flex flex-col ${isDark ? 'bg-[#0f0f0f] border border-neutral-700 shadow-2xl' : 'bg-white border border-neutral-200 shadow-lg'} ${selected ? 'ring-1 ring-blue-500/30' : ''}`}
            style={{
              width: '340px',
            }}
          >
            {/* Header */}
            <div className="absolute -top-8 left-0 text-sm px-2 py-0.5 rounded font-medium text-blue-400">
              Camera Angle
            </div>

            {/* Content Area */}
            <div
              className={`flex flex-col items-center justify-center ${data.resultUrl ? 'p-0' : 'p-6'}`}
              style={{ minHeight: data.resultUrl ? 'auto' : '340px' }}
            >
              {data.resultUrl ? (
                <img
                  src={data.resultUrl}
                  alt="Content"
                  className={`rounded-xl w-full h-auto object-cover ${selected ? 'ring-2 ring-blue-500 shadow-2xl' : ''}`}
                  draggable={false}
                />
              ) : (
                <div className="flex flex-col items-center gap-3 text-neutral-500">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                  <span className="text-sm">正在生成新角度...</span>
                </div>
              )}
            </div>
          </div>

          {/* Control Panel (Only for re-adjusting angle if needed) */}
          {selected && showControls && data.angleMode && data.resultUrl && (
            <div className="absolute top-[calc(100%+12px)] left-1/2 -translate-x-1/2 flex justify-center z-[100]">
              <div
                style={{
                  transform: `scale(${localScale})`,
                  transformOrigin: 'top center',
                  transition: 'transform 0.1s ease-out'
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <ChangeAnglePanel
                  imageUrl={data.resultUrl}
                  settings={data.angleSettings || { rotation: 0, tilt: 0, scale: 0 }}
                  onSettingsChange={(settings) => onUpdate(data.id, { angleSettings: settings })}
                  onClose={() => onUpdate(data.id, { angleMode: false })}
                  onGenerate={onChangeAngleGenerate ? () => onChangeAngleGenerate(data.id) : () => { }}
                  isLoading={isLoading}
                  canvasTheme={canvasTheme}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // AI 漫剧生产节点（配音/音效/BGM/成片）—— 自包含渲染
  if (isMangaNode(data.type)) {
    return (
      <MangaNode
        workflowId={workflowId}
        data={data}
        allNodes={allNodes || []}
        selected={selected}
        canvasTheme={canvasTheme}
        onUpdate={onUpdate}
        onNodePointerDown={onNodePointerDown}
        onContextMenu={onContextMenu}
        onConnectorDown={onConnectorDown}
        onExpand={onExpand}
      />
    );
  }

  return (
    <div
      data-node-id={data.id}
      className={`absolute group/node touch-none pointer-events-auto`}
      style={{
        transform: `translate(${data.x}px, ${data.y}px)`,
        transition: 'box-shadow 0.2s',
        zIndex: selected ? 50 : 10,
        transformOrigin: 'top left'
      }}
      onPointerDown={(e) => onNodePointerDown(e, data.id)}
      onContextMenu={(e) => onContextMenu(e, data.id)}
      onMouseEnter={() => onMouseEnter?.(data.id)}
      onMouseLeave={() => onMouseLeave?.(data.id)}
    >
      <NodeConnectors nodeId={data.id} onConnectorDown={onConnectorDown} canvasTheme={canvasTheme} />

      {/* Relative wrapper for the Image Card to allow absolute positioning of controls below it */}
      <div className="relative group/nodecard">
        {data.type === NodeType.IMAGE && isSuccess && data.resultUrl && (
          <NodeHoverToolbar
            data={data}
            visible={selected && showControls}
            localScale={localScale}
            topClassName="-top-12"
            mediaType="image"
            actions={imageToolbarActions}
            onUpdate={onUpdate}
            onUpload={onUpload}
            onExpand={onExpand}
          />
        )}

        {data.videoAnalysisAssetRole === 'main' && (
          <button
            type="button"
            disabled={!data.resultUrl}
            onPointerDown={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation();
              onLockVideoAnalysisAssetMain?.(data.id);
            }}
            className={`absolute right-2 top-2 z-20 flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium backdrop-blur transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              data.videoAnalysisAssetMainLocked
                ? isDark ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-200' : 'border-emerald-300 bg-emerald-50 text-emerald-700'
                : isDark ? 'border-white/15 bg-black/55 text-neutral-200 hover:border-cyan-300/50' : 'border-neutral-300 bg-white/85 text-neutral-700 hover:border-cyan-400'
            }`}
            title={data.videoAnalysisAssetMainLocked ? '解除主图锁定' : '锁定主图，允许生成其他角度'}
          >
            {data.videoAnalysisAssetMainLocked ? <LockKeyhole size={11} /> : <UnlockKeyhole size={11} />}
            {data.videoAnalysisAssetMainLocked ? '主图已锁定' : '锁定主图'}
          </button>
        )}

        {data.type === NodeType.VIDEO && isSuccess && data.resultUrl && (
          <NodeHoverToolbar
            data={data}
            visible={selected && showControls}
            localScale={localScale}
            topClassName="-top-11"
            mediaType="video"
            actions={videoToolbarActions}
            onUpdate={onUpdate}
            onExpand={onExpand}
            onExtractLastFrame={onExtractLastFrame}
          />
        )}

        {/* Main Node Card - Video nodes are wider to fit more controls */}
        <div
          className={`relative ${data.type === NodeType.VIDEO ? 'w-[385px]' : 'w-[365px]'} rounded-2xl border transition-all duration-300 flex flex-col shadow-2xl ${isDark ? 'bg-[#0f0f0f]' : 'bg-white'} ${selected ? 'border-blue-500/50 ring-1 ring-blue-500/30' : isDark ? 'border-neutral-800' : 'border-neutral-200'}`}
        >
          {/* Header (Editable Title) - Positioned horizontally on top-left side */}
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              type="text"
              value={editedTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleTitleSave();
                } else if (e.key === 'Escape') {
                  setEditedTitle(data.title || data.type);
                  setIsEditingTitle(false);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute top-2 text-sm px-2 py-0.5 rounded font-medium bg-blue-500/20 text-blue-200 outline-none border border-blue-400 whitespace-nowrap"
              style={{ right: 'calc(100% + 8px)', minWidth: '60px' }}
            />
          ) : (
            <div
              className={`absolute top-2 text-sm px-2 py-0.5 rounded font-medium transition-colors cursor-text whitespace-nowrap ${selected ? 'bg-blue-500/20 text-blue-200' : 'text-neutral-600'}`}
              style={{ right: 'calc(100% + 8px)' }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setIsEditingTitle(true);
              }}
              title="双击编辑"
            >
              {data.title || NODE_TYPE_LABELS[data.type]}
            </div>
          )}

          {/* Content Area */}
          <NodeContent
            data={data}
            inputUrl={inputUrl}
            selected={selected}
            isLoading={isLoading}
            isSuccess={isSuccess}
            getAspectRatioStyle={getAspectRatioStyle}
            onUpload={onUpload}
            onWriteContent={onWriteContent}
            onTextToVideo={onTextToVideo}
            onTextToImage={onTextToImage}
            onImageToImage={onImageToImage}
            onImageToVideo={onImageToVideo}
            onGenerate={onGenerate}
            onCancelGeneration={onCancelGeneration}
            onUpdate={onUpdate}
          />
        </div>

        {/* Control Panel - Only show when single node is selected (not in group selection) */}
        {selected && showControls && data.type !== NodeType.TEXT && (
          <div className="absolute top-[calc(100%+12px)] left-1/2 -translate-x-1/2 w-[600px] flex justify-center z-[100]">
            <NodeControls
              workflowId={workflowId}
              data={data}
              inputUrl={inputUrl}
              isLoading={isLoading}
              isSuccess={isSuccess}
              connectedReferences={connectedReferences}
              onUpdate={onUpdate}
              onGenerate={onGenerate}
              onChangeAngleGenerate={onChangeAngleGenerate}
              onSelect={onSelect}
              zoom={zoom}
              canvasTheme={canvasTheme}
            />
          </div>
        )}
      </div>
    </div >
  );
};

/**
 * 拖动一个节点时，App 每个 pointermove 都会 setNodes，整个画布随之 render。
 * 没有 memo 时 60 个节点 = 每帧 60 次子树重建。
 *
 * 注意：memo 只有在调用方同时传稳定引用（useCallback + useMemo）时才有效，
 * 单独加 memo 而 props 里还是内联箭头函数，效果为零。见 App.tsx 的节点渲染块。
 */
export const CanvasNode = React.memo(CanvasNodeComponent);
