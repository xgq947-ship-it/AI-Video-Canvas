import React from 'react';
import {
  AlertCircle,
  Check,
  Film,
  Images,
  Loader2,
  Package,
  ScanSearch,
  Sparkles,
  Users,
} from 'lucide-react';
import { NodeConnectors } from '../../components/canvas/NodeConnectors';
import { NodeData, NodeStatus } from '../../types';
import {
  VIDEO_ANALYSIS_INPUT_PORTS,
  VIDEO_ANALYSIS_PORT_LABELS,
  createVideoAnalysisNodeData,
  type VideoAnalysisInputPort,
} from '../../../shared/videoAnalysis.js';

export const VIDEO_ANALYSIS_NODE_HEIGHT = 560;

type AssetKind = 'characters' | 'scenes' | 'props';

const assetRows: Array<{ kind: AssetKind; label: string; icon: React.ReactNode }> = [
  { kind: 'characters', label: '人物三张资产参考图', icon: <Users size={12} /> },
  { kind: 'scenes', label: '场景广角参考图', icon: <Images size={12} /> },
  { kind: 'props', label: '道具结构参考图', icon: <Package size={12} /> },
];

interface VideoAnalysisNodeProps {
  data: NodeData;
  allNodes: NodeData[];
  selected: boolean;
  canvasTheme?: 'dark' | 'light';
  onUpdate: (id: string, updates: Partial<NodeData>) => void;
  onAnalyze: (id: string) => void;
  onGenerateAssets?: (id: string) => void;
  onNodePointerDown: (event: React.PointerEvent, id: string) => void;
  onContextMenu: (event: React.MouseEvent, id: string) => void;
  onConnectorDown: (event: React.PointerEvent, id: string, side: 'left' | 'right', portId?: string) => void;
}

const inputPortRows: Array<{ id: VideoAnalysisInputPort; label: string }> = VIDEO_ANALYSIS_INPUT_PORTS.map(id => ({
  id,
  label: VIDEO_ANALYSIS_PORT_LABELS[id],
}));

const portNodes = (data: NodeData, allNodes: NodeData[], port: VideoAnalysisInputPort) => {
  const mapping = data.inputPortByParentId || {};
  return (data.parentIds || [])
    .filter(parentId => mapping[parentId] === port)
    .map(parentId => allNodes.find(node => node.id === parentId))
    .filter((node): node is NodeData => Boolean(node));
};

export const VideoAnalysisNode: React.FC<VideoAnalysisNodeProps> = ({
  data,
  allNodes,
  selected,
  canvasTheme = 'dark',
  onUpdate,
  onAnalyze,
  onGenerateAssets,
  onNodePointerDown,
  onContextMenu,
  onConnectorDown,
}) => {
  const dark = canvasTheme === 'dark';
  const state = createVideoAnalysisNodeData(data.videoAnalysis || {});
  const sourceNode = state.inputRefs.videoNodeId
    ? allNodes.find(node => node.id === state.inputRefs.videoNodeId)
    : undefined;
  const canAnalyze = Boolean(sourceNode?.resultUrl) && state.status !== 'analyzing';
  const isBusy = state.status === 'analyzing' || data.status === NodeStatus.LOADING;
  const assetPromptCounts = state.result?.global.assetPrompts || {
    characters: [],
    scenes: [],
    props: [],
  };
  const hasSelectedAssetGeneration = assetRows.some(({ kind }) => {
    const connected = portNodes(
      data,
      allNodes,
      kind === 'characters' ? 'character-reference' : kind === 'scenes' ? 'scene-reference' : 'product-reference',
    );
    return state.assetGeneration[kind].enabled && connected.length === 0 && assetPromptCounts[kind].length > 0;
  });
  const updateAssetGeneration = (kind: AssetKind, enabled: boolean) => {
    onUpdate(data.id, {
      videoAnalysis: createVideoAnalysisNodeData({
        ...data.videoAnalysis,
        assetGeneration: {
          ...state.assetGeneration,
          [kind]: {
            ...state.assetGeneration[kind],
            enabled,
          },
        },
      }),
    });
  };
  const statusLabel = isBusy
    ? '分析中'
    : state.status === 'completed'
      ? '分析完成'
      : state.status === 'outdated'
        ? '参考素材已变化'
        : state.status === 'error'
          ? '分析失败'
          : sourceNode?.resultUrl ? '可分析' : '未准备';

  return (
    <div
      data-node-id={data.id}
      className="group/node absolute touch-none pointer-events-auto"
      style={{ transform: `translate(${data.x}px, ${data.y}px)`, zIndex: selected ? 50 : 10 }}
      onPointerDown={event => onNodePointerDown(event, data.id)}
      onContextMenu={event => onContextMenu(event, data.id)}
    >
      <NodeConnectors
        nodeId={data.id}
        hideLeft
        inputPorts={inputPortRows}
        onConnectorDown={onConnectorDown}
        canvasTheme={canvasTheme}
      />
      <div
        className={`w-[420px] overflow-visible rounded-[22px] border shadow-2xl transition-all ${
          dark ? 'border-neutral-700 bg-[#101112]' : 'border-neutral-200 bg-white'
        } ${selected ? 'border-cyan-400 ring-1 ring-cyan-400/30' : ''}`}
        style={{ minHeight: VIDEO_ANALYSIS_NODE_HEIGHT }}
      >
        <div className={`flex items-center justify-between border-b px-5 py-4 ${dark ? 'border-white/8' : 'border-neutral-100'}`}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-400/15 text-cyan-300">
              <ScanSearch size={20} />
            </div>
            <div>
              <div className={`text-sm font-semibold ${dark ? 'text-white' : 'text-neutral-900'}`}>{data.title || '视频分析'}</div>
              <div className={`mt-0.5 text-[11px] ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>一次分析完整参考视频</div>
            </div>
          </div>
          <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
            state.status === 'completed'
              ? 'bg-emerald-500/15 text-emerald-300'
              : state.status === 'error'
                ? 'bg-red-500/15 text-red-300'
                : dark ? 'bg-white/6 text-neutral-300' : 'bg-neutral-100 text-neutral-600'
          }`}>
            {isBusy ? <Loader2 size={11} className="animate-spin" /> : state.status === 'completed' ? <Check size={11} /> : null}
            {statusLabel}
          </div>
        </div>

        <div className="space-y-1.5 px-5 py-3">
          {inputPortRows.map(port => {
            const connected = portNodes(data, allNodes, port.id);
            return (
              <div key={port.id} className={`flex min-h-7 items-center justify-between rounded-lg px-2.5 text-[11px] ${dark ? 'bg-white/[0.045]' : 'bg-neutral-50'}`}>
                <span className={dark ? 'text-neutral-400' : 'text-neutral-500'}>{port.label}</span>
                <span className={`max-w-[235px] truncate ${connected.length > 0 ? 'text-emerald-400' : dark ? 'text-neutral-600' : 'text-neutral-400'}`}>
                  {connected.length > 0 ? `${connected.length} 张/个 ✓` : '未提供'}
                </span>
              </div>
            );
          })}
        </div>

        <div className={`mx-5 rounded-xl border px-3 py-2.5 ${dark ? 'border-white/8 bg-white/[0.025]' : 'border-neutral-200 bg-neutral-50'}`}>
          <div className={`flex items-center gap-2 text-[11px] font-medium ${dark ? 'text-neutral-200' : 'text-neutral-700'}`}>
            <Package size={12} className="text-cyan-300" />
            稳定性资产参考图
            <span className={`font-normal ${dark ? 'text-neutral-600' : 'text-neutral-400'}`}>可选，不自动扣生成额度</span>
          </div>
          <div className={`mt-1 text-[10px] leading-4 ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>
            人物每个实体保留 3 张（正面身份、面部多角度、全身综合设定板）；场景和道具每个实体 1 张。关键帧默认只引用人物全身综合设定板。
          </div>
          <div className="mt-2 space-y-1.5">
            {assetRows.map(({ kind, label, icon }) => {
              const referencePort: VideoAnalysisInputPort = kind === 'characters'
                ? 'character-reference'
                : kind === 'scenes'
                  ? 'scene-reference'
                  : 'product-reference';
              const connected = portNodes(data, allNodes, referencePort);
              const hasConnectedReference = connected.length > 0;
              const option = state.assetGeneration[kind];
              const promptCount = assetPromptCounts[kind].length;
              return (
                <label
                  key={kind}
                  className={`flex min-h-8 items-center justify-between gap-2 rounded-lg px-2.5 text-[10px] ${
                    hasConnectedReference
                      ? dark ? 'bg-white/[0.02] text-neutral-600' : 'bg-neutral-100 text-neutral-400'
                      : dark ? 'bg-white/[0.045] text-neutral-300' : 'bg-white text-neutral-600'
                  }`}
                  title={hasConnectedReference ? '已有接入参考图，优先使用接入内容' : undefined}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={hasConnectedReference ? false : option.enabled}
                      disabled={hasConnectedReference}
                      onChange={event => updateAssetGeneration(kind, event.target.checked)}
                      onPointerDown={event => event.stopPropagation()}
                      className="accent-cyan-400"
                    />
                    <span className="flex items-center gap-1.5 truncate">{icon}{label}</span>
                  </span>
                  <span className={`shrink-0 ${hasConnectedReference ? 'text-neutral-600' : dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                    {hasConnectedReference
                      ? `已接入 ${connected.length} 张，已锁定`
                      : promptCount > 0
                        ? `${promptCount} 个实体 · 每个 ${option.count} 张`
                        : '分析后可选'}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {state.result && (
          <div className={`mx-5 rounded-xl border px-3 py-2.5 ${dark ? 'border-white/8 bg-white/[0.025]' : 'border-neutral-200 bg-neutral-50'}`}>
            <div className="flex items-center gap-2 text-[11px] font-medium text-cyan-300">
              <Sparkles size={12} />
              识别到 {state.result.shots.length} 个镜头
            </div>
            <div className={`mt-1 line-clamp-2 text-[10px] leading-4 ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>
              {state.result.global.story || '已生成全局一致性提示词'}
            </div>
            <div className={`mt-2 flex gap-3 text-[10px] ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
              <span className="flex items-center gap-1"><Film size={11} /> {state.result.shots.length} 镜头</span>
              <span className="flex items-center gap-1"><Users size={11} /> {assetPromptCounts.characters.length} 人物</span>
              <span className="flex items-center gap-1"><Images size={11} /> {assetPromptCounts.scenes.length + assetPromptCounts.props.length} 场景/道具</span>
            </div>
          </div>
        )}

        {state.errorMessage && (
          <div className="mx-5 mt-2 flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-[10px] leading-4 text-red-300">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span>{state.errorMessage}</span>
          </div>
        )}

        <div className="px-5 pb-4 pt-3">
          {state.result && (
            <button
              type="button"
              disabled={!hasSelectedAssetGeneration || isBusy}
              onPointerDown={event => event.stopPropagation()}
              onClick={event => {
                event.stopPropagation();
                onGenerateAssets?.(data.id);
              }}
              className={`mb-2 flex h-9 w-full items-center justify-center gap-2 rounded-xl border text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                dark ? 'border-cyan-400/30 bg-cyan-400/8 text-cyan-200 hover:bg-cyan-400/15' : 'border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100'
              }`}
            >
              <Images size={14} />
              {hasSelectedAssetGeneration ? '生成选中的资产参考节点' : '勾选资产类型后生成参考节点'}
            </button>
          )}
          <button
            type="button"
            disabled={!canAnalyze}
            onPointerDown={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation();
              onAnalyze(data.id);
            }}
            className={`flex h-10 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
              dark ? 'bg-white text-neutral-950 hover:bg-neutral-200' : 'bg-neutral-900 text-white hover:bg-neutral-800'
            }`}
          >
            {isBusy ? <Loader2 size={15} className="animate-spin" /> : <ScanSearch size={15} />}
            {state.status === 'completed' || state.status === 'outdated' ? '重新分析并更新工作流' : '分析并生成工作流'}
          </button>
          <div className={`mt-2 text-center text-[10px] ${dark ? 'text-neutral-600' : 'text-neutral-400'}`}>
            已接入同类参考图时只置灰对应开关并优先使用接入图；人物三张资产节点都会保留，但关键帧只自动接入选定参考图。
          </div>
        </div>
      </div>
    </div>
  );
};
