import React from 'react';
import { AlertCircle, Loader2, Settings2, Sparkles } from 'lucide-react';

import {
  confirmVideoRemixAssets,
  createVideoRemixState,
  getVideoRemixMinimumAssetReadiness,
  prepareVideoRemixSimplePrompts,
  type VideoRemixWorkspaceTab,
} from '../../../shared/videoRemix.js';
import { listVideoGenerationProviders } from '../../../shared/generationProviders.js';
import { NodeData } from '../../types';
import { VideoRemixFinalWorkspace } from './VideoRemixFinalWorkspace';
import { VideoRemixVideosWorkspace } from './VideoRemixVideosWorkspace';

type VideoRemixState = ReturnType<typeof createVideoRemixState>;

function sourceAspectRatio(state: VideoRemixState) {
  if (state.source?.orientation === 'portrait') return '9:16';
  if (state.source?.orientation === 'square') return '1:1';
  return '16:9';
}

function automaticVideoModel(state: VideoRemixState) {
  const ratio = sourceAspectRatio(state);
  const providers = listVideoGenerationProviders().filter(provider => (
    provider.supportedAspectRatios.includes(ratio)
  ));
  const saved = providers.find(provider => (
    provider.id === state.videoReview?.videoModel
    || provider.id === state.promptReview?.targetModel
  ));
  return saved?.id
    || providers.find(provider => provider.id === 'google-flow-omni-flash')?.id
    || providers[0]?.id
    || '';
}

export const VideoRemixSimpleGenerationWorkspace: React.FC<{
  node: NodeData;
  state: VideoRemixState;
  workflowId?: string;
  onUpdateNode: (nodeId: string, updates: Partial<NodeData>) => void;
  onFinalOutput: (output: {
    nodeId: string;
    url: string;
    duration: number;
    width: number;
    height: number;
    fps: number;
    aspectRatio: string;
  }) => void;
  onSendFinalToCanvas?: (output: {
    nodeId: string;
    url: string;
    duration: number;
    width: number;
    height: number;
    fps: number;
    aspectRatio: string;
  }) => void;
  onSelectAssets: () => void;
  onOpenAdvanced: (tab: VideoRemixWorkspaceTab) => void;
  dark: boolean;
}> = ({
  node,
  state,
  workflowId,
  onUpdateNode,
  onFinalOutput,
  onSendFinalToCanvas,
  onSelectAssets,
  onOpenAdvanced,
  dark,
}) => {
  const confirmingAssetsRef = React.useRef(false);
  const preparingRef = React.useRef(false);
  const videoModel = automaticVideoModel(state);
  const minimumAssets = getVideoRemixMinimumAssetReadiness(state);

  React.useEffect(() => {
    if (
      confirmingAssetsRef.current
      || state.assetReview?.confirmed
      || !minimumAssets.ready
    ) return;
    confirmingAssetsRef.current = true;
    onUpdateNode(node.id, {
      videoRemix: confirmVideoRemixAssets(state),
    });
  }, [minimumAssets.ready, node.id, onUpdateNode, state]);

  React.useEffect(() => {
    if (
      preparingRef.current
      || !state.assetReview?.confirmed
      || state.promptReview?.confirmed
      || !videoModel
    ) return;
    preparingRef.current = true;
    const next = prepareVideoRemixSimplePrompts(state, videoModel);
    onUpdateNode(node.id, { videoRemix: next });
  }, [node.id, onUpdateNode, state, videoModel]);

  if (!state.assetReview?.confirmed) {
    if (minimumAssets.ready) {
      return (
        <div className={`mt-7 rounded-[26px] border p-8 text-center ${
          dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
        }`}>
          <Loader2 size={24} className="mx-auto animate-spin text-cyan-400" />
          <div className="mt-4 text-sm font-medium">正在确认最小资产方案</div>
          <p className={`mx-auto mt-2 max-w-md text-xs leading-5 ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
            {minimumAssets.requiredCharacters > 0
              ? '已有人物主参考图，场景和道具将按提示词直接生成。'
              : '当前镜头不需要人物参考图，将按结构化提示词直接生成。'}
          </p>
        </div>
      );
    }
    return (
      <SimpleGate
        dark={dark}
        title="请先准备一个人物主参考图"
        description="原片有人物时，最少生成或上传一张人物主参考图即可；其他资产图片均可选。"
        action="返回资产步骤"
        onAction={onSelectAssets}
      />
    );
  }

  if (!videoModel) {
    return (
      <SimpleGate
        dark={dark}
        title="没有支持当前画幅的视频模型"
        description="请在高级模式中检查视频模型注册与画幅设置。"
        action="打开高级设置"
        onAction={() => onOpenAdvanced('shots')}
      />
    );
  }

  if (!state.promptReview?.confirmed) {
    return (
      <div className={`mt-7 rounded-[26px] border p-8 text-center ${
        dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
      }`}>
        <Loader2 size={24} className="mx-auto animate-spin text-cyan-400" />
        <div className="mt-4 text-sm font-medium">正在自动准备中文生成提示词</div>
        <p className={`mx-auto mt-2 max-w-md text-xs leading-5 ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
          已自动隐藏原始、解析和优化层级；当前使用 {videoModel}。
        </p>
      </div>
    );
  }

  const phase = state.output
    ? '成片已完成'
    : state.videoReview?.confirmed
      ? '合成最终视频'
      : '生成镜头视频';

  return (
    <div>
      <div className={`mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${
        dark ? 'border-cyan-400/15 bg-cyan-400/[0.035]' : 'border-cyan-100 bg-cyan-50/60'
      }`}>
        <div className="flex items-center gap-2 text-xs">
          <Sparkles size={14} className="text-cyan-400" />
          当前：{phase}
        </div>
        <button
          type="button"
          onClick={() => onOpenAdvanced(
            state.videoReview?.confirmed ? 'final' : 'videos'
          )}
          className={`flex items-center gap-1.5 text-[10px] ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}
        >
          <Settings2 size={12} />
          打开高级设置
        </button>
      </div>

      {!state.videoReview?.confirmed ? (
        <VideoRemixVideosWorkspace
          node={node}
          state={state}
          workflowId={workflowId}
          onUpdateNode={onUpdateNode}
          onSelectKeyframes={() => onOpenAdvanced('keyframes')}
          onSelectShots={() => onOpenAdvanced('shots')}
          simpleMode
          dark={dark}
        />
      ) : (
        <VideoRemixFinalWorkspace
          node={node}
          state={state}
          workflowId={workflowId}
          onUpdateNode={onUpdateNode}
          onSelectVideos={() => onOpenAdvanced('videos')}
          onFinalOutput={onFinalOutput}
          onSendFinalToCanvas={onSendFinalToCanvas}
          simpleMode
          dark={dark}
        />
      )}
    </div>
  );
};

const SimpleGate: React.FC<{
  dark: boolean;
  title: string;
  description: string;
  action: string;
  onAction: () => void;
}> = ({ dark, title, description, action, onAction }) => (
  <div className={`mt-7 flex min-h-[320px] items-center justify-center rounded-[26px] border ${
    dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
  }`}>
    <div className="max-w-sm text-center">
      <AlertCircle size={26} className="mx-auto text-amber-400" />
      <div className="mt-4 text-sm font-medium">{title}</div>
      <p className={`mt-2 text-xs leading-5 ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
        {description}
      </p>
      <button
        type="button"
        onClick={onAction}
        className={`mt-5 rounded-xl px-5 py-2.5 text-xs font-medium ${
          dark ? 'bg-white text-neutral-950' : 'bg-neutral-900 text-white'
        }`}
      >
        {action}
      </button>
    </div>
  </div>
);
