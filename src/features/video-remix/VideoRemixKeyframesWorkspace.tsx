import React from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

import {
  applyVideoRemixKeyframeResult,
  beginVideoRemixKeyframeGeneration,
  confirmVideoRemixKeyframe,
  confirmVideoRemixKeyframes,
  createVideoRemixState,
  finalizeVideoRemixKeyframeBatch,
  getVideoRemixKeyframeReadiness,
  prepareVideoRemixKeyframes,
  recoverStaleVideoRemixKeyframes,
  setVideoRemixKeyframeError,
  updateVideoRemixKeyframePrompt,
  VIDEO_REMIX_MOTION_LABELS,
  type KeyframeResult,
} from '../../../shared/videoRemix.js';
import {
  listImageGenerationProviders,
  type ImageGenerationProvider,
} from '../../../shared/generationProviders.js';
import { NodeData } from '../../types';
import { generateVideoRemixKeyframe } from './videoRemixService';

type VideoRemixState = ReturnType<typeof createVideoRemixState>;

const IMAGE_MODELS = listImageGenerationProviders().filter(
  model => model.id !== 'codex-imagegen' && model.supportsImageToImage
);
const DEFAULT_IMAGE_MODEL = IMAGE_MODELS.find(
  model => model.id === 'google-flow-nano-banana-pro'
) || IMAGE_MODELS[0];
const KEYFRAME_CONCURRENCY = 2;

const POSITION_LABELS: Record<KeyframeResult['position'], string> = {
  start: '起始',
  middle: '中间',
  end: '结束',
};

const STATUS_LABELS: Record<KeyframeResult['status'], string> = {
  pending: '待生成',
  generating: '生成中',
  ready: '待确认',
  confirmed: '已确认',
  failed: '可重试',
};

function desiredAspectRatio(state: VideoRemixState) {
  if (state.source?.orientation === 'portrait') return '9:16';
  if (state.source?.orientation === 'square') return '1:1';
  return '16:9';
}

function modelAspectRatio(model: ImageGenerationProvider, preferred: string) {
  return model.supportedAspectRatios.includes(preferred)
    ? preferred
    : model.supportedAspectRatios.includes('1:1')
      ? '1:1'
      : model.supportedAspectRatios[0] || preferred;
}

function modelResolution(model: ImageGenerationProvider) {
  return model.defaultResolution || model.resolutions[0] || '自动';
}

function failureDetails(caught: unknown) {
  const error = caught as {
    message?: string;
    code?: string;
    retryable?: boolean;
    submitted?: boolean;
  };
  return {
    message: error?.message || '关键帧生成失败',
    code: error?.code,
    retryable: error?.retryable ?? true,
    submitted: error?.submitted ?? false,
  };
}

export const VideoRemixKeyframesWorkspace: React.FC<{
  node: NodeData;
  state: VideoRemixState;
  workflowId?: string;
  onUpdateNode: (nodeId: string, updates: Partial<NodeData>) => void;
  onSelectShots: () => void;
  simpleMode?: boolean;
  onConfirmed?: () => void;
  dark: boolean;
}> = ({
  node,
  state,
  workflowId,
  onUpdateNode,
  onSelectShots,
  simpleMode = false,
  onConfirmed,
  dark,
}) => {
  const [batchBusy, setBatchBusy] = React.useState(false);
  const [activeIds, setActiveIds] = React.useState<string[]>([]);
  const [editingId, setEditingId] = React.useState('');
  const [localError, setLocalError] = React.useState('');
  const runningRef = React.useRef(false);
  const workingRef = React.useRef(state);

  const persist = React.useCallback((next: VideoRemixState) => {
    workingRef.current = next;
    onUpdateNode(node.id, { videoRemix: next });
  }, [node.id, onUpdateNode]);

  React.useEffect(() => {
    if (!runningRef.current) workingRef.current = state;
  }, [state]);

  const selectedModel = IMAGE_MODELS.find(model => (
    model.id === state.keyframeReview?.imageModel
  )) || DEFAULT_IMAGE_MODEL;
  const preferredRatio = desiredAspectRatio(state);
  const aspectRatio = selectedModel
    ? (
      selectedModel.supportedAspectRatios.includes(
        state.keyframeReview?.aspectRatio || ''
      )
        ? state.keyframeReview!.aspectRatio!
        : modelAspectRatio(selectedModel, preferredRatio)
    )
    : preferredRatio;
  const resolution = selectedModel?.resolutions.includes(
    state.keyframeReview?.resolution || ''
  )
    ? state.keyframeReview!.resolution!
    : selectedModel
      ? modelResolution(selectedModel)
      : '自动';
  const readiness = getVideoRemixKeyframeReadiness(state);
  const running = batchBusy || activeIds.length > 0;

  const prepare = React.useCallback((
    current: VideoRemixState,
    model = selectedModel,
    ratio = aspectRatio,
    quality = resolution
  ) => {
    if (!model) return current;
    return prepareVideoRemixKeyframes(current, {
      imageModel: model.id,
      aspectRatio: ratio,
      resolution: quality,
      strategy: simpleMode ? 'single' : 'adaptive',
    });
  }, [aspectRatio, resolution, selectedModel, simpleMode]);

  React.useEffect(() => {
    if (!state.promptReview?.confirmed || !selectedModel || runningRef.current) {
      return;
    }
    const recovered = recoverStaleVideoRemixKeyframes(state);
    const prepared = prepare(recovered);
    if (prepared !== state) persist(prepared);
  }, [persist, prepare, selectedModel, state]);

  const generateOne = React.useCallback(async (
    keyframeId: string,
    force = false
  ) => {
    let working = prepare(workingRef.current);
    let keyframe = working.keyframes.find(item => item.id === keyframeId);
    if (!keyframe || (!force && ['ready', 'confirmed'].includes(keyframe.status))) {
      return;
    }
    working = beginVideoRemixKeyframeGeneration(working, keyframeId);
    persist(working);
    keyframe = working.keyframes.find(item => item.id === keyframeId);
    if (!keyframe) return;
    setActiveIds(current => [...new Set([...current, keyframeId])]);
    setLocalError('');
    try {
      if (!workflowId) throw new Error('请先创建或打开项目');
      const provider = IMAGE_MODELS.find(model => model.id === keyframe!.imageModel);
      const maxReferences = provider?.maxReferenceImages || 1;
      const url = await generateVideoRemixKeyframe({
        workflowId,
        nodeId: `${node.id}_${keyframe.id}_${keyframe.attempt}`,
        prompt: keyframe.prompt,
        referenceImages: keyframe.referenceImages.slice(0, maxReferences),
        imageModel: keyframe.imageModel,
        aspectRatio: keyframe.aspectRatio,
        resolution: keyframe.resolution,
      });
      persist(applyVideoRemixKeyframeResult(
        workingRef.current,
        keyframeId,
        { url, inputHash: keyframe.inputHash }
      ));
    } catch (caught) {
      const failure = failureDetails(caught);
      setLocalError(failure.message);
      persist(setVideoRemixKeyframeError(
        workingRef.current,
        keyframeId,
        failure.message,
        {
          code: failure.code,
          retryable: failure.retryable,
          submitted: failure.submitted,
          inputHash: keyframe.inputHash,
        }
      ));
    } finally {
      setActiveIds(current => current.filter(id => id !== keyframeId));
    }
  }, [node.id, persist, prepare, workflowId]);

  const runBatch = async (mode: 'missing' | 'failed') => {
    if (runningRef.current) return;
    runningRef.current = true;
    setBatchBusy(true);
    setLocalError('');
    let working = prepare(workingRef.current);
    persist(working);
    const targets = working.keyframes.filter(keyframe => (
      mode === 'failed'
        ? keyframe.status === 'failed'
          && keyframe.retryable !== false
          && !keyframe.retryBlocked
        : !['ready', 'confirmed', 'generating'].includes(keyframe.status)
          && keyframe.retryable !== false
          && !keyframe.retryBlocked
    )).map(keyframe => keyframe.id);
    let cursor = 0;
    const worker = async () => {
      while (cursor < targets.length) {
        const keyframeId = targets[cursor];
        cursor += 1;
        await generateOne(keyframeId);
      }
    };
    try {
      await Promise.all(
        Array.from(
          { length: Math.min(KEYFRAME_CONCURRENCY, targets.length) },
          worker
        )
      );
    } finally {
      working = finalizeVideoRemixKeyframeBatch(workingRef.current);
      persist(working);
      runningRef.current = false;
      setBatchBusy(false);
    }
  };

  const updateConfig = (
    model: ImageGenerationProvider,
    ratio: string,
    quality: string
  ) => {
    if (running) return;
    const next = prepareVideoRemixKeyframes(workingRef.current, {
      imageModel: model.id,
      aspectRatio: ratio,
      resolution: quality,
      strategy: simpleMode ? 'single' : 'adaptive',
    });
    persist(next);
    setLocalError('');
  };

  if (!state.promptReview?.confirmed) {
    return (
      <GateCard
        dark={dark}
        title="先确认全部提示词"
        description="关键帧会消费图片生成额度。请先确认视频提示词与独立关键帧提示词，避免错误资产继续传递。"
        action="前往镜头页"
        onAction={onSelectShots}
      />
    );
  }

  if (!selectedModel) {
    return (
      <GateCard
        dark={dark}
        title="没有可用的图片生成模型"
        description="当前模型列表中没有支持参考图生成的服务。"
        action="返回镜头页"
        onAction={onSelectShots}
      />
    );
  }

  const failedRetryable = state.keyframes.filter(
    item => (
      item.status === 'failed'
      && item.retryable !== false
      && !item.retryBlocked
    )
  ).length;
  const missingGenerateable = state.keyframes.filter(item => (
    item.status === 'pending'
    || (
      item.status === 'failed'
      && item.retryable !== false
      && !item.retryBlocked
    )
  )).length;
  const blockedFailures = state.keyframes.filter(
    item => item.status === 'failed' && item.retryBlocked
  ).length;

  const confirmAll = () => {
    const next = confirmVideoRemixKeyframes(workingRef.current);
    persist(next);
    if (next.keyframeReview?.confirmed) onConfirmed?.();
  };

  return (
    <div className="mt-7 space-y-5">
      <section className={`rounded-[26px] border p-5 ${
        dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
      }`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <ImageIcon size={16} className="text-cyan-400" />
              关键帧生成队列
            </div>
            <p className={`mt-2 max-w-2xl text-[11px] leading-5 ${
              dark ? 'text-neutral-500' : 'text-neutral-500'
            }`}>
              {simpleMode
                ? `每个镜头只生成一张起始关键帧，统一检查一次人物、场景和道具是否正确。队列并发上限 ${KEYFRAME_CONCURRENCY}。`
                : `简单镜头生成起始帧；中等镜头生成起始帧和结束帧；复杂镜头生成起始帧、中间帧和结束帧。队列并发上限 ${KEYFRAME_CONCURRENCY}，单帧失败不影响其他任务。`}
            </p>
          </div>
          <div className={`rounded-xl px-3 py-2 text-[11px] ${
            readiness.confirmed === readiness.total && readiness.total > 0
              ? dark ? 'bg-emerald-400/10 text-emerald-300' : 'bg-emerald-50 text-emerald-700'
              : dark ? 'bg-white/6 text-neutral-400' : 'bg-neutral-100 text-neutral-500'
          }`}>
            已确认 {readiness.confirmed}/{readiness.total}
          </div>
        </div>

        {simpleMode ? (
          <details className={`mt-4 rounded-2xl border px-4 py-3 text-[10px] ${
            dark ? 'border-white/8 bg-black/20 text-neutral-400' : 'border-neutral-200 bg-neutral-50 text-neutral-600'
          }`}>
            <summary className="cursor-pointer">生成设置（已自动选择：{selectedModel.name} · {aspectRatio} · {resolution}）</summary>
            <div className="mt-3 grid gap-3 xl:grid-cols-3">
              <KeyframeModelSettings
                dark={dark}
                running={running}
                selectedModel={selectedModel}
                preferredRatio={preferredRatio}
                aspectRatio={aspectRatio}
                resolution={resolution}
                onUpdate={updateConfig}
              />
            </div>
          </details>
        ) : (
        <div className={`mt-5 grid gap-3 rounded-2xl border p-4 xl:grid-cols-3 ${
          dark ? 'border-white/8 bg-black/20' : 'border-neutral-200 bg-neutral-50'
        }`}>
          <label className="block">
            <span className={`text-[10px] font-medium ${
              dark ? 'text-neutral-500' : 'text-neutral-400'
            }`}>
              图片模型
            </span>
            <select
              value={selectedModel.id}
              disabled={running}
              onChange={event => {
                const model = IMAGE_MODELS.find(item => item.id === event.target.value);
                if (!model) return;
                updateConfig(
                  model,
                  modelAspectRatio(model, preferredRatio),
                  modelResolution(model)
                );
              }}
              className={selectClass(dark)}
            >
              {IMAGE_MODELS.map(model => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={`text-[10px] font-medium ${
              dark ? 'text-neutral-500' : 'text-neutral-400'
            }`}>
              画幅
            </span>
            <select
              value={aspectRatio}
              disabled={running}
              onChange={event => updateConfig(
                selectedModel,
                event.target.value,
                resolution
              )}
              className={selectClass(dark)}
            >
              {selectedModel.supportedAspectRatios.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={`text-[10px] font-medium ${
              dark ? 'text-neutral-500' : 'text-neutral-400'
            }`}>
              分辨率
            </span>
            <select
              value={resolution}
              disabled={running}
              onChange={event => updateConfig(
                selectedModel,
                aspectRatio,
                event.target.value
              )}
              className={selectClass(dark)}
            >
              {selectedModel.resolutions.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
        </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={running || missingGenerateable === 0}
            onClick={() => void runBatch('missing')}
            className={primaryButtonClass(dark)}
          >
            {batchBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {batchBusy ? '队列运行中…' : '生成全部未完成关键帧'}
          </button>
          <button
            type="button"
            disabled={running || failedRetryable === 0}
            onClick={() => void runBatch('failed')}
            className={secondaryButtonClass(dark)}
          >
            <RefreshCw size={13} />
            只重试失败项 {failedRetryable > 0 ? `(${failedRetryable})` : ''}
          </button>
          <button
            type="button"
            disabled={running || readiness.total === 0 || readiness.ready !== readiness.total}
            onClick={confirmAll}
            className={secondaryButtonClass(dark, state.keyframeReview?.confirmed)}
          >
            <ShieldCheck size={13} />
            {state.keyframeReview?.confirmed ? '关键帧已全部确认' : '确认全部关键帧'}
          </button>
        </div>

        {(localError || blockedFailures > 0) && (
          <div className={`mt-4 flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs ${
            dark ? 'bg-amber-400/8 text-amber-200' : 'bg-amber-50 text-amber-800'
          }`}>
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>
              {localError}
              {blockedFailures > 0
                ? `${localError ? '；' : ''}${blockedFailures} 个任务提交状态不确定，请先核对平台历史，再单独点击重试。`
                : ''}
            </span>
          </div>
        )}
      </section>

      <div className="space-y-4">
        {state.shots.map((shot, shotIndex) => {
          const frames = state.keyframes.filter(item => item.shotId === shot.shotId);
          return (
            <section
              key={shot.shotId}
              className={`rounded-[26px] border p-5 ${
                dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">
                    镜头 {String(shotIndex + 1).padStart(2, '0')}
                  </div>
                  <div className={`mt-1 text-[10px] ${
                    dark ? 'text-neutral-500' : 'text-neutral-400'
                  }`}>
                    {shot.shotId} · {VIDEO_REMIX_MOTION_LABELS[shot.motionComplexity]} · {Number(shot.duration).toFixed(2)} 秒
                  </div>
                </div>
                <span className={`rounded-full px-3 py-1 text-[10px] ${
                  dark ? 'bg-white/6 text-neutral-400' : 'bg-neutral-100 text-neutral-500'
                }`}>
                  {frames.filter(item => item.status === 'confirmed').length}/{frames.length} 已确认
                </span>
              </div>

              <div className={`mt-4 grid gap-4 ${
                frames.length >= 3 ? 'xl:grid-cols-3' : frames.length === 2 ? 'lg:grid-cols-2' : ''
              }`}>
                {frames.map(frame => (
                  <KeyframeCard
                    key={frame.id}
                    frame={frame}
                    provider={selectedModel}
                    active={activeIds.includes(frame.id)}
                    editing={editingId === frame.id}
                    running={running}
                    dark={dark}
                    onToggleEdit={() => setEditingId(current => (
                      current === frame.id ? '' : frame.id
                    ))}
                    onSavePrompt={value => {
                      persist(updateVideoRemixKeyframePrompt(
                        workingRef.current,
                        frame.id,
                        value
                      ));
                      setEditingId('');
                    }}
                    onGenerate={() => void generateOne(
                      frame.id,
                      ['ready', 'confirmed', 'failed'].includes(frame.status)
                    )}
                    onConfirm={() => persist(confirmVideoRemixKeyframe(
                      workingRef.current,
                      frame.id
                    ))}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};

const KeyframeCard: React.FC<{
  frame: KeyframeResult;
  provider: ImageGenerationProvider;
  active: boolean;
  editing: boolean;
  running: boolean;
  dark: boolean;
  onToggleEdit: () => void;
  onSavePrompt: (value: string) => void;
  onGenerate: () => void;
  onConfirm: () => void;
}> = ({
  frame,
  provider,
  active,
  editing,
  running,
  dark,
  onToggleEdit,
  onSavePrompt,
  onGenerate,
  onConfirm,
}) => {
  const [draft, setDraft] = React.useState(frame.prompt);
  React.useEffect(() => setDraft(frame.prompt), [frame.prompt]);
  const referenceCount = Math.min(
    frame.referenceImages.length,
    provider.maxReferenceImages
  );
  return (
    <article className={`overflow-hidden rounded-2xl border ${
      dark ? 'border-white/8 bg-black/20' : 'border-neutral-200 bg-neutral-50'
    }`}>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <div className="text-xs font-medium">
            {POSITION_LABELS[frame.position]}帧
          </div>
          <div className={`mt-1 text-[9px] ${
            dark ? 'text-neutral-600' : 'text-neutral-400'
          }`}>
            {referenceCount}/{frame.referenceImages.length} 张参考 · 尝试 {frame.attempt || 0}
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[9px] ${
          frame.status === 'confirmed'
            ? dark ? 'bg-emerald-400/10 text-emerald-300' : 'bg-emerald-50 text-emerald-700'
            : frame.status === 'failed'
              ? dark ? 'bg-red-400/10 text-red-300' : 'bg-red-50 text-red-700'
              : dark ? 'bg-white/6 text-neutral-400' : 'bg-white text-neutral-500'
        }`}>
          {active
            ? '生成中'
            : frame.status === 'failed' && frame.retryable === false
              ? '需处理'
              : STATUS_LABELS[frame.status]}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-px bg-black/20">
        <FrameFigure
          label="原参考"
          url={frame.sourceFrameUrl}
          dark={dark}
        />
        <FrameFigure
          label={frame.status === 'failed' && frame.url ? '上次结果' : '新关键帧'}
          url={frame.url}
          loading={active}
          dark={dark}
        />
      </div>

      {frame.error && (
        <div className={`mx-3 mt-3 rounded-xl px-3 py-2 text-[10px] leading-4 ${
          dark ? 'bg-red-500/8 text-red-300' : 'bg-red-50 text-red-700'
        }`}>
          {frame.error}
          {frame.retryBlocked ? '；提交状态不确定，请核对平台历史。' : ''}
        </div>
      )}

      <div className="p-3">
        <button
          type="button"
          onClick={onToggleEdit}
          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-[10px] ${
            dark ? 'bg-white/5 text-neutral-400' : 'bg-white text-neutral-500'
          }`}
        >
          <span>关键帧提示词 · {frame.promptSource === 'user' ? '已手动编辑' : '自动生成'}</span>
          {editing ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        {editing && (
          <div className="mt-2">
            <textarea
              value={draft}
              onChange={event => setDraft(event.target.value)}
              rows={8}
              className={`w-full resize-y rounded-xl border px-3 py-2.5 font-mono text-[10px] leading-5 outline-none ${
                dark
                  ? 'border-white/8 bg-[#0c0d0e] text-neutral-300'
                  : 'border-neutral-200 bg-white text-neutral-700'
              }`}
            />
            <button
              type="button"
              disabled={running || draft.trim() === frame.prompt.trim()}
              onClick={() => onSavePrompt(draft)}
              className={`mt-2 flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] disabled:opacity-40 ${
                dark ? 'bg-white/7 text-neutral-300' : 'bg-white text-neutral-600 shadow-sm'
              }`}
            >
              <Save size={11} />
              保存并标记待重新生成
            </button>
          </div>
        )}

        {frame.referenceImages.length > provider.maxReferenceImages && (
          <div className={`mt-2 text-[9px] leading-4 ${
            dark ? 'text-amber-300/70' : 'text-amber-700'
          }`}>
            当前模型最多接收 {provider.maxReferenceImages} 张参考图；队列会按替换资产、原参考帧、其他资产的优先级截取。
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={running}
            onClick={onGenerate}
            className={secondaryButtonClass(dark)}
          >
            {active ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {frame.status === 'pending'
              ? '生成'
              : frame.retryBlocked
                ? '核对后重试'
                : '重新生成'}
          </button>
          <button
            type="button"
            disabled={running || !frame.url || !['ready', 'confirmed'].includes(frame.status)}
            onClick={onConfirm}
            className={secondaryButtonClass(dark, frame.status === 'confirmed')}
          >
            <Check size={12} />
            {frame.status === 'confirmed' ? '已确认' : '确认'}
          </button>
        </div>
      </div>
    </article>
  );
};

const FrameFigure: React.FC<{
  label: string;
  url?: string;
  loading?: boolean;
  dark: boolean;
}> = ({ label, url, loading, dark }) => (
  <figure className={`relative aspect-video overflow-hidden ${
    dark ? 'bg-[#090a0b]' : 'bg-neutral-100'
  }`}>
    {url ? (
      <img src={url} alt={label} className="h-full w-full object-cover" />
    ) : (
      <div className={`flex h-full items-center justify-center ${
        dark ? 'text-neutral-700' : 'text-neutral-300'
      }`}>
        <ImageIcon size={22} />
      </div>
    )}
    {loading && (
      <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-white">
        <Loader2 size={20} className="animate-spin" />
      </div>
    )}
    <figcaption className="absolute bottom-2 left-2 rounded-md bg-black/65 px-2 py-1 text-[9px] text-white">
      {label}
    </figcaption>
  </figure>
);

const KeyframeModelSettings: React.FC<{
  dark: boolean;
  running: boolean;
  selectedModel: ImageGenerationProvider;
  preferredRatio: string;
  aspectRatio: string;
  resolution: string;
  onUpdate: (model: ImageGenerationProvider, ratio: string, resolution: string) => void;
}> = ({
  dark,
  running,
  selectedModel,
  preferredRatio,
  aspectRatio,
  resolution,
  onUpdate,
}) => (
  <>
    <label className="block">
      <span className={`text-[10px] font-medium ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>图片模型</span>
      <select
        value={selectedModel.id}
        disabled={running}
        onChange={event => {
          const model = IMAGE_MODELS.find(item => item.id === event.target.value);
          if (model) onUpdate(
            model,
            modelAspectRatio(model, preferredRatio),
            modelResolution(model)
          );
        }}
        className={selectClass(dark)}
      >
        {IMAGE_MODELS.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
      </select>
    </label>
    <label className="block">
      <span className={`text-[10px] font-medium ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>画幅</span>
      <select
        value={aspectRatio}
        disabled={running}
        onChange={event => onUpdate(selectedModel, event.target.value, resolution)}
        className={selectClass(dark)}
      >
        {selectedModel.supportedAspectRatios.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
    <label className="block">
      <span className={`text-[10px] font-medium ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>分辨率</span>
      <select
        value={resolution}
        disabled={running}
        onChange={event => onUpdate(selectedModel, aspectRatio, event.target.value)}
        className={selectClass(dark)}
      >
        {selectedModel.resolutions.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  </>
);

const GateCard: React.FC<{
  dark: boolean;
  title: string;
  description: string;
  action: string;
  onAction: () => void;
}> = ({ dark, title, description, action, onAction }) => (
  <div className={`mt-7 flex min-h-[360px] items-center justify-center rounded-[26px] border ${
    dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
  }`}>
    <div className="max-w-md text-center">
      <ImageIcon size={28} className="mx-auto text-cyan-400" />
      <div className="mt-4 text-sm font-medium">{title}</div>
      <p className={`mt-2 text-xs leading-5 ${
        dark ? 'text-neutral-500' : 'text-neutral-400'
      }`}>
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

function selectClass(dark: boolean) {
  return `mt-2 w-full rounded-xl border px-3 py-2.5 text-xs outline-none ${
    dark
      ? 'border-white/8 bg-[#171819] text-neutral-200'
      : 'border-neutral-200 bg-white text-neutral-700'
  }`;
}

function primaryButtonClass(dark: boolean) {
  return `flex h-10 items-center gap-2 rounded-xl px-4 text-xs font-medium disabled:opacity-40 ${
    dark ? 'bg-cyan-400 text-neutral-950' : 'bg-cyan-600 text-white'
  }`;
}

function secondaryButtonClass(dark: boolean, active = false) {
  return `flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-xs disabled:opacity-40 ${
    active
      ? dark ? 'bg-emerald-400/12 text-emerald-300' : 'bg-emerald-50 text-emerald-700'
      : dark ? 'bg-white/6 text-neutral-300' : 'bg-white text-neutral-600 shadow-sm'
  }`;
}
