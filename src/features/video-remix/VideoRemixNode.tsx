import React from 'react';
import { Check, Film, FolderOpen, Images, Loader2, Package, Users } from 'lucide-react';
import { createVideoRemixState, summarizeVideoRemixState } from '../../../shared/videoRemix.js';
import { NodeData } from '../../types';
import { NodeConnectors } from '../../components/canvas/NodeConnectors';

interface VideoRemixNodeProps {
  data: NodeData;
  selected: boolean;
  canvasTheme?: 'dark' | 'light';
  onNodePointerDown: (event: React.PointerEvent, id: string) => void;
  onContextMenu: (event: React.MouseEvent, id: string) => void;
  onConnectorDown: (event: React.PointerEvent, id: string, side: 'left' | 'right') => void;
  onOpenWorkspace?: (nodeId: string) => void;
}

const STAGE_LABELS: Record<string, string> = {
  source: '等待导入',
  preprocessing: '正在自动拆镜',
  shots_ready: '镜头待确认',
  analyzing: '正在分析',
  analysis_partial: '部分分析待重试',
  analysis_ready: '分析待确认',
  assets_ready: '资产已确认',
  keyframes_generating: '生成关键帧',
  keyframes_ready: '关键帧待确认',
  videos_generating: '生成镜头视频',
  videos_ready: '镜头视频待确认',
  rendering: '正在生成成片',
  completed: '已完成',
  error: '需要处理',
};

const formatDuration = (seconds: number) => {
  const value = Math.max(0, Number(seconds) || 0);
  const totalTenths = Math.round(value * 10);
  const minutes = Math.floor(totalTenths / 600);
  const remainder = (totalTenths % 600) / 10;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`;
};

export const VIDEO_REMIX_NODE_WIDTH = 420;
export const VIDEO_REMIX_NODE_HEIGHT = 306;

export const VideoRemixNode: React.FC<VideoRemixNodeProps> = ({
  data,
  selected,
  canvasTheme = 'dark',
  onNodePointerDown,
  onContextMenu,
  onConnectorDown,
  onOpenWorkspace,
}) => {
  const state = createVideoRemixState(
    data.videoRemix || { remixId: data.id }
  );
  const summary = summarizeVideoRemixState(state);
  const isDark = canvasTheme === 'dark';
  const previewUrl = state.source?.previewUrl || state.source?.localUrl;
  const isBusy = [
    'preprocessing',
    'analyzing',
    'keyframes_generating',
    'videos_generating',
    'rendering',
  ].includes(state.stage);
  const stageLabel = state.stage === 'keyframes_ready' && state.keyframeReview.confirmed
    ? '关键帧已确认'
    : state.stage === 'videos_ready' && state.videoReview.confirmed
      ? '镜头视频已确认'
      : STAGE_LABELS[state.stage] || state.stage;

  return (
    <div
      data-node-id={data.id}
      className="absolute touch-none pointer-events-auto"
      style={{
        transform: `translate(${data.x}px, ${data.y}px)`,
        zIndex: selected ? 50 : 10,
      }}
      onPointerDown={(event) => onNodePointerDown(event, data.id)}
      onContextMenu={(event) => onContextMenu(event, data.id)}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onOpenWorkspace?.(data.id);
      }}
    >
      <NodeConnectors
        nodeId={data.id}
        onConnectorDown={onConnectorDown}
        canvasTheme={canvasTheme}
      />

      <div
        className={`w-[420px] overflow-hidden rounded-[22px] border shadow-2xl transition-all duration-200 ${
          isDark ? 'border-neutral-700 bg-[#101112]' : 'border-neutral-200 bg-white'
        } ${selected ? 'border-cyan-400 ring-1 ring-cyan-400/30' : ''}`}
        style={{ height: VIDEO_REMIX_NODE_HEIGHT }}
      >
        <div className={`flex items-center justify-between border-b px-5 py-4 ${
          isDark ? 'border-white/8' : 'border-neutral-100'
        }`}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400/25 to-blue-500/15 text-cyan-300">
              <Film size={20} />
            </div>
            <div>
              <div className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-neutral-900'}`}>
                {data.title || '视频复刻'}
              </div>
              <div className={`mt-0.5 text-[11px] ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                {state.workspaceMode === 'advanced' ? '高级模式 · 完整控制' : '简单模式 · 三步生成'}
              </div>
            </div>
          </div>
          <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
            state.stage === 'completed'
              ? 'bg-emerald-500/15 text-emerald-300'
              : isDark ? 'bg-white/6 text-neutral-300' : 'bg-neutral-100 text-neutral-600'
          }`}>
            {isBusy ? <Loader2 size={11} className="animate-spin" /> : state.stage === 'completed' ? <Check size={11} /> : null}
            {stageLabel}
          </div>
        </div>

        <div className="flex gap-4 px-5 py-4">
          <div className={`relative flex h-[104px] w-[150px] shrink-0 items-center justify-center overflow-hidden rounded-2xl ${
            isDark ? 'bg-black/60' : 'bg-neutral-100'
          }`}>
            {previewUrl ? (
              <>
                <video src={previewUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                {state.source && (
                  <span className="absolute bottom-2 left-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {formatDuration(state.source.duration)}
                  </span>
                )}
              </>
            ) : (
              <div className={`flex flex-col items-center gap-2 text-xs ${isDark ? 'text-neutral-600' : 'text-neutral-400'}`}>
                <FolderOpen size={24} />
                尚未导入视频
              </div>
            )}
          </div>

          <div className="grid flex-1 grid-cols-2 gap-2">
            <Metric icon={<Film size={13} />} label="镜头" value={summary.shots} dark={isDark} />
            <Metric icon={<Users size={13} />} label="人物" value={summary.characters} dark={isDark} />
            <Metric icon={<Images size={13} />} label="场景" value={summary.scenes} dark={isDark} />
            <Metric icon={<Package size={13} />} label="道具" value={summary.props} dark={isDark} />
          </div>
        </div>

        <div className="px-5">
          <div className={`mb-2 flex items-center justify-between text-[11px] ${
            isDark ? 'text-neutral-500' : 'text-neutral-400'
          }`}>
            <span>关键帧 {summary.confirmedKeyframes}/{summary.requiredKeyframes || 0}</span>
            <span>视频 {summary.completedVideos}/{summary.shots || 0}</span>
          </div>
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onOpenWorkspace?.(data.id);
            }}
            className={`flex h-10 w-full items-center justify-center rounded-xl text-sm font-medium transition-colors ${
              isDark
                ? 'bg-white text-neutral-950 hover:bg-neutral-200'
                : 'bg-neutral-900 text-white hover:bg-neutral-800'
            }`}
          >
            打开工作台
          </button>
        </div>
      </div>
    </div>
  );
};

const Metric: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: number;
  dark: boolean;
}> = ({ icon, label, value, dark }) => (
  <div className={`rounded-xl px-3 py-2 ${dark ? 'bg-white/[0.045]' : 'bg-neutral-50'}`}>
    <div className={`flex items-center gap-1.5 text-[10px] ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
      {icon}
      {label}
    </div>
    <div className={`mt-1 text-lg font-semibold ${dark ? 'text-neutral-100' : 'text-neutral-800'}`}>{value}</div>
  </div>
);
