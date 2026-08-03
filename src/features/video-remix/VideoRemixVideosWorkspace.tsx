import React from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Film,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';

import {
  applyVideoRemixRawVideoResult,
  applyVideoRemixVideoResult,
  beginVideoRemixVideoCalibration,
  beginVideoRemixVideoGeneration,
  confirmVideoRemixVideo,
  confirmVideoRemixVideos,
  createVideoRemixState,
  finalizeVideoRemixVideoBatch,
  getVideoRemixVideoReadiness,
  prepareVideoRemixVideos,
  prepareVideoRemixSimplePrompts,
  recoverStaleVideoRemixVideos,
  setVideoRemixVideoError,
  updateVideoRemixVideoPrompt,
  VIDEO_REMIX_VIDEO_OUTPUT_COUNTS,
  type GeneratedShotVideo,
} from '../../../shared/videoRemix.js';
import {
  getVideoGenerationProvider,
  getVideoProviderCapabilities,
  listVideoGenerationProviders,
} from '../../../shared/generationProviders.js';
import { useGenerationModelRegistry } from '../../hooks/useGenerationModelRegistry';
import { NodeData } from '../../types';
import {
  calibrateVideoRemixGeneratedShot,
  findVideoRemixGeneratedVideo,
  generateVideoRemixShot,
} from './videoRemixService';

type VideoRemixState = ReturnType<typeof createVideoRemixState>;

const VIDEO_CONCURRENCY = 2;
const CALIBRATION_REQUIRES_REGENERATION = new Set([
  'SHOT_VIDEO_TOO_SHORT',
  'SHOT_VIDEO_NOT_FOUND',
  'INVALID_SHOT_VIDEO',
  'UNSAFE_SHOT_VIDEO_PATH',
]);

const STATUS_LABELS: Record<GeneratedShotVideo['status'], string> = {
  pending: '待生成',
  generating: '生成中',
  calibrating: '校准时长',
  completed: '待确认',
  confirmed: '已选用',
  failed: '可重试',
};

function desiredAspectRatio(state: VideoRemixState) {
  if (state.source?.orientation === 'portrait') return '9:16';
  if (state.source?.orientation === 'square') return '1:1';
  return '16:9';
}

function failureDetails(caught: unknown) {
  const error = caught as {
    message?: string;
    code?: string;
    retryable?: boolean;
    submitted?: boolean;
  };
  return {
    message: error?.message || '镜头视频生成失败',
    code: error?.code,
    retryable: error?.retryable ?? true,
    submitted: error?.submitted ?? false,
  };
}

export const VideoRemixVideosWorkspace: React.FC<{
  node: NodeData;
  state: VideoRemixState;
  workflowId?: string;
  onUpdateNode: (nodeId: string, updates: Partial<NodeData>) => void;
  onSelectKeyframes: () => void;
  onSelectShots: () => void;
  simpleMode?: boolean;
  onConfirmed?: () => void;
  dark: boolean;
}> = ({
  node,
  state,
  workflowId,
  onUpdateNode,
  onSelectKeyframes,
  onSelectShots,
  simpleMode = false,
  onConfirmed,
  dark,
}) => {
  const [batchBusy, setBatchBusy] = React.useState(false);
  const [activeIds, setActiveIds] = React.useState<string[]>([]);
  const [editingId, setEditingId] = React.useState('');
  const [localError, setLocalError] = React.useState('');
  const [recoveryClock, setRecoveryClock] = React.useState(0);
  const runningRef = React.useRef(false);
  const workingRef = React.useRef(state);
  const recoveryInFlightRef = React.useRef(new Set<string>());
  const { revision: modelRegistryRevision } = useGenerationModelRegistry();

  const persist = React.useCallback((next: VideoRemixState) => {
    workingRef.current = next;
    onUpdateNode(node.id, { videoRemix: next });
  }, [node.id, onUpdateNode]);

  React.useEffect(() => {
    if (!runningRef.current) workingRef.current = state;
  }, [state]);

  const videoModel = state.promptReview?.targetModel || '';
  const provider = getVideoGenerationProvider(videoModel);
  const capabilities = getVideoProviderCapabilities(videoModel);
  const availableModels = React.useMemo(
    () => listVideoGenerationProviders().filter(model => (
      model.supportsTextToVideo || model.supportsImageToVideo
    )),
    [modelRegistryRevision]
  );
  const preferredAspectRatio = state.videoReview?.aspectRatio || '';
  const sourceAspectRatio = desiredAspectRatio(state);
  const aspectRatio = provider?.supportedAspectRatios.includes(preferredAspectRatio)
    ? preferredAspectRatio
    : provider?.supportedAspectRatios.includes(sourceAspectRatio)
      ? sourceAspectRatio
      : provider?.supportedAspectRatios[0] || sourceAspectRatio;
  const resolution = provider?.resolutions.includes(
    state.videoReview?.resolution || ''
  )
    ? state.videoReview!.resolution!
    : provider?.defaultResolution || provider?.resolutions[0] || '自动';
  const generateAudio = Boolean(
    capabilities?.audioGeneration
    && state.videoReview?.generateAudio !== false
  );
  const outputCount = VIDEO_REMIX_VIDEO_OUTPUT_COUNTS.includes(
    Number(state.videoReview?.outputCount) as 1 | 2 | 3 | 4
  )
    ? Number(state.videoReview?.outputCount)
    : 1;
  const readiness = getVideoRemixVideoReadiness(state);
  const running = batchBusy || activeIds.length > 0;

  React.useEffect(() => {
    if (!state.generatedVideos.some(video => (
      video.status === 'generating' || video.status === 'calibrating'
    ))) {
      return;
    }
    const timer = window.setInterval(
      () => setRecoveryClock(value => value + 1),
      15_000
    );
    return () => window.clearInterval(timer);
  }, [state.generatedVideos]);

  const prepare = React.useCallback((current: VideoRemixState) => (
    prepareVideoRemixVideos(current, {
      videoModel,
      aspectRatio,
      resolution,
      generateAudio,
      outputCount,
    })
  ), [aspectRatio, generateAudio, outputCount, resolution, videoModel]);

  const updateVideoSettings = React.useCallback((updates: {
    aspectRatio?: string;
    resolution?: string;
    generateAudio?: boolean;
    outputCount?: number;
  }) => {
    const current = workingRef.current;
    persist(prepareVideoRemixVideos(current, {
      videoModel,
      aspectRatio: updates.aspectRatio ?? aspectRatio,
      resolution: updates.resolution ?? resolution,
      generateAudio: updates.generateAudio ?? generateAudio,
      outputCount: updates.outputCount ?? outputCount,
    }));
    setLocalError('');
  }, [aspectRatio, generateAudio, outputCount, persist, resolution, videoModel]);

  const selectSimpleVideoModel = React.useCallback((nextModel: string) => {
    if (!simpleMode || !nextModel || nextModel === videoModel) return;
    const nextProvider = getVideoGenerationProvider(nextModel);
    const nextCapabilities = getVideoProviderCapabilities(nextModel);
    if (!nextProvider || !nextCapabilities) return;
    const current = workingRef.current;
    const storedRatio = current.videoReview?.aspectRatio || '';
    const originalRatio = desiredAspectRatio(current);
    const nextRatio = nextProvider.supportedAspectRatios.includes(storedRatio)
      ? storedRatio
      : nextProvider.supportedAspectRatios.includes(originalRatio)
        ? originalRatio
        : nextProvider.supportedAspectRatios[0] || originalRatio;
    const storedResolution = current.videoReview?.resolution || '';
    const nextResolution = nextProvider.resolutions.includes(storedResolution)
      ? storedResolution
      : nextProvider.defaultResolution || nextProvider.resolutions[0] || '自动';
    const nextOutputCount = Number(current.videoReview?.outputCount || 1);
    let next = prepareVideoRemixSimplePrompts(current, nextModel);
    next = prepareVideoRemixVideos(next, {
      videoModel: nextModel,
      aspectRatio: nextRatio,
      resolution: nextResolution,
      generateAudio: nextCapabilities.audioGeneration
        && current.videoReview?.generateAudio !== false,
      outputCount: nextOutputCount,
    });
    persist(next);
    setLocalError('');
  }, [persist, simpleMode, videoModel]);

  React.useEffect(() => {
    if (
      !state.promptReview?.confirmed
      || !provider
      || !provider.supportedAspectRatios.includes(aspectRatio)
      || runningRef.current
    ) {
      return;
    }
    const recovered = recoverStaleVideoRemixVideos(state);
    const prepared = prepare(recovered);
    if (prepared !== state) persist(prepared);
  }, [aspectRatio, persist, prepare, provider, recoveryClock, state]);

  const calibrateOne = React.useCallback(async (
    videoId: string,
    initial?: VideoRemixState
  ) => {
    let working = initial || workingRef.current;
    let video = working.generatedVideos.find(item => item.id === videoId);
    if (!video?.rawUrl) return;
    working = beginVideoRemixVideoCalibration(working, videoId);
    persist(working);
    video = working.generatedVideos.find(item => item.id === videoId);
    if (!video?.rawUrl) return;
    try {
      if (!workflowId) throw new Error('请先创建或打开项目');
      const result = await calibrateVideoRemixGeneratedShot({
        workflowId,
        remixId: working.remixId,
        shotId: video.shotId,
        sourceUrl: video.rawUrl,
        targetDuration: video.targetDuration || 0,
        trimStart: video.trimStart,
      });
      persist(applyVideoRemixVideoResult(
        workingRef.current,
        videoId,
        {
          ...result,
          rawUrl: video.rawUrl,
          inputHash: video.inputHash,
        }
      ));
    } catch (caught) {
      const failure = failureDetails(caught);
      const requiresRegeneration = Boolean(
        failure.code
        && CALIBRATION_REQUIRES_REGENERATION.has(failure.code)
      );
      setLocalError(failure.message);
      persist(setVideoRemixVideoError(
        workingRef.current,
        videoId,
        failure.message,
        {
          code: failure.code,
          retryable: failure.retryable,
          submitted: false,
          inputHash: video.inputHash,
          errorStage: requiresRegeneration ? 'generation' : 'calibration',
        }
      ));
    }
  }, [persist, workflowId]);

  React.useEffect(() => {
    if (!workflowId || runningRef.current) return;
    const recovering = state.generatedVideos.filter(video => (
      video.status === 'generating'
      && video.generationNodeId
      && !recoveryInFlightRef.current.has(video.generationNodeId)
    ));
    if (recovering.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const video of recovering) {
        recoveryInFlightRef.current.add(video.generationNodeId!);
        try {
          const rawUrl = await findVideoRemixGeneratedVideo(
            workflowId,
            video.generationNodeId!
          );
          if (!rawUrl || cancelled) continue;
          const recovered = applyVideoRemixRawVideoResult(
            workingRef.current,
            video.id,
            { rawUrl, inputHash: video.inputHash }
          );
          persist(recovered);
          await calibrateOne(video.id, recovered);
        } catch {
          // Asset lookup is best effort. The persisted generating task remains
          // untouched until the stale-task policy can classify it safely.
        } finally {
          recoveryInFlightRef.current.delete(video.generationNodeId!);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    calibrateOne,
    persist,
    recoveryClock,
    state.generatedVideos,
    workflowId,
  ]);

  const executeOne = React.useCallback(async (
    videoId: string,
    forceGeneration = false
  ) => {
    let working = prepare(workingRef.current);
    let video = working.generatedVideos.find(item => item.id === videoId);
    if (!video) return;
    if (
      !forceGeneration
      && video.rawUrl
      && (
        video.status === 'calibrating'
        || (
          video.status === 'failed'
          && video.errorStage === 'calibration'
        )
      )
    ) {
      setActiveIds(current => [...new Set([...current, videoId])]);
      try {
        await calibrateOne(videoId, working);
      } finally {
        setActiveIds(current => current.filter(id => id !== videoId));
      }
      return;
    }
    if (!forceGeneration && ['completed', 'confirmed'].includes(video.status)) {
      return;
    }
    if (video.planError) {
      setLocalError(video.planError);
      return;
    }
    const nextAttempt = Number(video.attempt || 0) + 1;
    const generationNodeId = `${node.id}_${video.id}_${video.inputHash}_${nextAttempt}`;
    working = beginVideoRemixVideoGeneration(working, videoId, {
      generationNodeId,
    });
    persist(working);
    video = working.generatedVideos.find(item => item.id === videoId);
    if (!video) return;
    setActiveIds(current => [...new Set([...current, videoId])]);
    setLocalError('');
    try {
      if (!workflowId) throw new Error('请先创建或打开项目');
      const rawUrl = await generateVideoRemixShot({
        workflowId,
        nodeId: generationNodeId,
        prompt: video.prompt,
        imageBase64: video.imageBase64,
        lastFrameBase64: video.lastFrameBase64,
        referenceImages: video.referenceImages,
        referenceImageLabels: video.referenceImageLabels,
        videoModel: video.videoModel,
        aspectRatio: video.aspectRatio,
        resolution: video.resolution,
        duration: video.requestDuration || video.targetDuration || 0,
        generateAudio: video.generateAudio,
      });
      const generated = applyVideoRemixRawVideoResult(
        workingRef.current,
        videoId,
        { rawUrl, inputHash: video.inputHash }
      );
      persist(generated);
      await calibrateOne(videoId, generated);
    } catch (caught) {
      const failure = failureDetails(caught);
      setLocalError(failure.message);
      persist(setVideoRemixVideoError(
        workingRef.current,
        videoId,
        failure.message,
        {
          code: failure.code,
          retryable: failure.retryable,
          submitted: failure.submitted,
          inputHash: video.inputHash,
          errorStage: 'generation',
        }
      ));
    } finally {
      setActiveIds(current => current.filter(id => id !== videoId));
    }
  }, [calibrateOne, node.id, persist, prepare, workflowId]);

  const runSingle = async (videoId: string, forceGeneration = false) => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      await executeOne(videoId, forceGeneration);
      persist(finalizeVideoRemixVideoBatch(workingRef.current));
    } finally {
      runningRef.current = false;
    }
  };

  const runBatch = async (mode: 'missing' | 'failed') => {
    if (runningRef.current) return;
    runningRef.current = true;
    setBatchBusy(true);
    setLocalError('');
    let working = prepare(workingRef.current);
    persist(working);
    const targets = working.generatedVideos.filter(video => {
      if (video.planError) return false;
      if (mode === 'failed') {
        return video.status === 'failed'
          && video.retryable !== false
          && !video.retryBlocked;
      }
      return (
        video.status === 'pending'
        || (
          video.status === 'failed'
          && video.retryable !== false
          && !video.retryBlocked
        )
      );
    }).map(video => video.id);
    let cursor = 0;
    const worker = async () => {
      while (cursor < targets.length) {
        const videoId = targets[cursor];
        cursor += 1;
        await executeOne(videoId);
      }
    };
    try {
      await Promise.all(Array.from(
        { length: Math.min(VIDEO_CONCURRENCY, targets.length) },
        worker
      ));
    } finally {
      working = finalizeVideoRemixVideoBatch(workingRef.current);
      if (simpleMode && outputCount === 1) {
        working = confirmVideoRemixVideos(working);
      }
      persist(working);
      if (working.videoReview?.confirmed) onConfirmed?.();
      runningRef.current = false;
      setBatchBusy(false);
    }
  };

  if (!state.promptReview?.confirmed) {
    return (
      <GateCard
        dark={dark}
        title="先准备全部视频提示词"
        description="视频生成会使用已经整理好的动作、运镜、节奏、对白与环境声提示词。"
        action="前往镜头页"
        onAction={onSelectShots}
      />
    );
  }

  if (
    !provider
    || !capabilities
    || !provider.supportedAspectRatios.includes(aspectRatio)
  ) {
    return (
      <GateCard
        dark={dark}
        title="当前视频模型不支持原片画幅"
        description={`原片画幅为 ${aspectRatio}。请回到镜头页选择支持该画幅的目标视频模型并重新确认提示词。`}
        action="前往镜头页"
        onAction={onSelectShots}
      />
    );
  }

  const failedRetryable = state.generatedVideos.filter(video => (
    video.status === 'failed'
    && video.retryable !== false
    && !video.retryBlocked
  )).length;
  const generateable = state.generatedVideos.filter(video => (
    !video.planError
    && (
      video.status === 'pending'
      || (
        video.status === 'failed'
        && video.retryable !== false
        && !video.retryBlocked
      )
    )
  )).length;
  const blockedFailures = state.generatedVideos.filter(
    video => video.status === 'failed' && video.retryBlocked
  ).length;

  return (
    <div className="mt-7 space-y-5">
      <section className={`rounded-[26px] border p-5 ${
        dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
      }`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <Film size={16} className="text-cyan-400" />
              镜头视频生成队列
            </div>
            <p className={`mt-2 max-w-3xl text-[11px] leading-5 ${
              dark ? 'text-neutral-500' : 'text-neutral-500'
            }`}>
              {provider.name} · {aspectRatio} · 并发上限 {VIDEO_CONCURRENCY}。
              场景和道具没有参考图时会直接使用中文提示词；关键帧也是可选项。生成后会自动校准回原镜头时长。
              {simpleMode && outputCount === 1
                ? '全部成功后自动进入成片合成。'
                : '每个镜头需要选定一个候选方案后再合成。'}
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

        <div className={`mt-5 rounded-2xl border p-4 ${
          dark ? 'border-white/8 bg-black/20' : 'border-neutral-200 bg-neutral-50'
        }`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-xs font-medium">生成参数</div>
              <p className={`mt-1 text-[10px] ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                每个镜头 {outputCount} 个候选，共 {state.shots.length * outputCount} 个视频生成任务；平台会按实际任务分别计费。
              </p>
            </div>
            <span className={`rounded-lg px-2.5 py-1 text-[9px] ${
              dark ? 'bg-white/6 text-neutral-400' : 'bg-white text-neutral-500'
            }`}>
              原片画幅 {sourceAspectRatio}
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <label className="block sm:col-span-2 xl:col-span-1">
            <span className={labelClass(dark)}>视频模型</span>
            <select
              aria-label="视频模型"
              value={videoModel}
              disabled={running || !simpleMode}
              onChange={event => selectSimpleVideoModel(event.target.value)}
              className={selectClass(dark)}
            >
              {availableModels.map(model => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelClass(dark)}>画幅</span>
            <select
              aria-label="视频画幅"
              value={aspectRatio}
              disabled={running}
              onChange={event => updateVideoSettings({ aspectRatio: event.target.value })}
              className={selectClass(dark)}
            >
              {provider.supportedAspectRatios.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelClass(dark)}>分辨率</span>
            <select
              aria-label="视频分辨率"
              value={resolution}
              disabled={running}
              onChange={event => updateVideoSettings({ resolution: event.target.value })}
              className={selectClass(dark)}
            >
              {provider.resolutions.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelClass(dark)}>每个镜头生成数量</span>
            <select
              aria-label="每个镜头生成数量"
              value={outputCount}
              disabled={running}
              onChange={event => updateVideoSettings({ outputCount: Number(event.target.value) })}
              className={selectClass(dark)}
            >
              {VIDEO_REMIX_VIDEO_OUTPUT_COUNTS.map(option => (
                <option key={option} value={option}>{option} 个候选</option>
              ))}
            </select>
          </label>
          <div>
            <span className={labelClass(dark)}>声音</span>
            <button
              type="button"
              disabled={running || !capabilities.audioGeneration}
              onClick={() => updateVideoSettings({ generateAudio: !generateAudio })}
              className={`mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-xl text-xs disabled:opacity-40 ${
                generateAudio
                  ? dark ? 'bg-cyan-400/12 text-cyan-300' : 'bg-cyan-50 text-cyan-700'
                  : dark ? 'bg-white/6 text-neutral-400' : 'bg-white text-neutral-500'
              }`}
            >
              {generateAudio ? <Volume2 size={14} /> : <VolumeX size={14} />}
              {capabilities.audioGeneration
                ? generateAudio ? '生成对白 / 环境声' : '关闭模型声音'
                : '该模型不生成声音'}
            </button>
          </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <CapabilityTag dark={dark} active={capabilities.startFrame} label="首帧" />
            <CapabilityTag dark={dark} active={capabilities.endFrame} label="尾帧" />
            <CapabilityTag dark={dark} active={capabilities.multiReference} label="多参考" />
            <CapabilityTag dark={dark} active={capabilities.characterReference} label="人物参考" />
            <CapabilityTag dark={dark} active={capabilities.audioGeneration} label="原生声音" />
            <CapabilityTag dark={dark} active label={`最长 ${capabilities.maxDuration}s`} />
            {!simpleMode && (
              <button
                type="button"
                disabled={running}
                onClick={onSelectShots}
                className={`ml-2 text-[10px] underline-offset-2 hover:underline ${
                  dark ? 'text-cyan-300' : 'text-cyan-700'
                }`}
              >
                在镜头页更换目标模型
              </button>
            )}
            <button
              type="button"
              disabled={running}
              onClick={onSelectKeyframes}
              className={`ml-2 text-[10px] underline-offset-2 hover:underline ${
                dark ? 'text-neutral-500' : 'text-neutral-500'
              }`}
            >
              可选：生成首帧 / 尾帧增强构图控制
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={running || generateable === 0}
            onClick={() => void runBatch('missing')}
            className={primaryButtonClass(dark)}
          >
            {batchBusy
              ? <Loader2 size={13} className="animate-spin" />
              : <Sparkles size={13} />}
            {batchBusy
              ? '队列运行中…'
              : `生成全部未完成视频${generateable > 0 ? ` (${generateable})` : ''}`}
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
            disabled={running || readiness.total === 0 || readiness.completed !== readiness.total}
            onClick={() => {
              const next = confirmVideoRemixVideos(workingRef.current);
              persist(next);
              if (next.videoReview?.confirmed) onConfirmed?.();
            }}
            className={secondaryButtonClass(dark, state.videoReview?.confirmed)}
          >
            <ShieldCheck size={13} />
            {state.videoReview?.confirmed
              ? '每个镜头均已选定'
              : outputCount > 1
                ? '自动选择每镜头首个可用候选'
                : '确认全部镜头视频'}
          </button>
        </div>

        {(localError || blockedFailures > 0 || readiness.unsupported > 0) && (
          <div className={`mt-4 flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs ${
            dark ? 'bg-amber-400/8 text-amber-200' : 'bg-amber-50 text-amber-800'
          }`}>
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>
              {localError}
              {blockedFailures > 0
                ? `${localError ? '；' : ''}${blockedFailures} 个生成任务提交状态不确定，请先核对平台历史或项目素材。`
                : ''}
              {readiness.unsupported > 0
                ? `${localError || blockedFailures > 0 ? '；' : ''}${readiness.unsupported} 个镜头超出该模型可安全恢复的时长。`
                : ''}
            </span>
          </div>
        )}
      </section>

      <div className="space-y-4">
        {state.shots.map((shot, index) => {
          const candidates = state.generatedVideos.filter(
            item => item.shotId === shot.shotId
          ).sort((left, right) => (
            Number(left.variantIndex || 1) - Number(right.variantIndex || 1)
          ));
          if (candidates.length === 0) return null;
          return (
            <section key={shot.shotId} className="space-y-3">
              {candidates.length > 1 && (
                <div className="flex items-center justify-between px-1">
                  <div className="text-xs font-medium">
                    镜头 {String(index + 1).padStart(2, '0')} · {candidates.length} 个候选
                  </div>
                  <span className={`text-[10px] ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                    生成完成后选用其中一个
                  </span>
                </div>
              )}
              {candidates.map(video => (
                <VideoCard
                  key={video.id}
                  index={index}
                  candidateCount={candidates.length}
                  shot={shot}
                  video={video}
                  active={activeIds.includes(video.id)}
                  editing={editingId === video.id}
                  running={running}
                  dark={dark}
                  rawPrompt={state.prompts[shot.shotId]?.rawPrompt || ''}
                  resolvedPrompt={state.prompts[shot.shotId]?.resolvedPrompt || ''}
                  optimizedPrompt={state.prompts[shot.shotId]?.optimizedPrompt || ''}
                  onToggleEdit={() => setEditingId(current => (
                    current === video.id ? '' : video.id
                  ))}
                  onSavePrompt={value => {
                    persist(updateVideoRemixVideoPrompt(
                      workingRef.current,
                      video.id,
                      value
                    ));
                    setEditingId('');
                  }}
                  onGenerate={force => void runSingle(video.id, force)}
                  onConfirm={() => persist(confirmVideoRemixVideo(
                    workingRef.current,
                    video.id
                  ))}
                />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
};

const VideoCard: React.FC<{
  index: number;
  candidateCount: number;
  shot: VideoRemixState['shots'][number];
  video: GeneratedShotVideo;
  active: boolean;
  editing: boolean;
  running: boolean;
  dark: boolean;
  rawPrompt: string;
  resolvedPrompt: string;
  optimizedPrompt: string;
  onToggleEdit: () => void;
  onSavePrompt: (value: string) => void;
  onGenerate: (forceGeneration: boolean) => void;
  onConfirm: () => void;
}> = ({
  index,
  candidateCount,
  shot,
  video,
  active,
  editing,
  running,
  dark,
  rawPrompt,
  resolvedPrompt,
  optimizedPrompt,
  onToggleEdit,
  onSavePrompt,
  onGenerate,
  onConfirm,
}) => {
  const [draft, setDraft] = React.useState(video.prompt);
  React.useEffect(() => setDraft(video.prompt), [video.prompt]);
  const calibrationRetry = Boolean(
    video.rawUrl
    && video.status === 'failed'
    && video.errorStage === 'calibration'
  );
  return (
    <article className={`rounded-[26px] border p-5 ${
      dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
    }`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">
            镜头 {String(index + 1).padStart(2, '0')}
            {candidateCount > 1
              ? ` · 候选 ${video.variantIndex || 1}/${candidateCount}`
              : ''}
          </div>
          <div className={`mt-1 text-[10px] ${
            dark ? 'text-neutral-500' : 'text-neutral-400'
          }`}>
            {shot.shotId} · 原时长 {Number(shot.duration).toFixed(2)}s · 请求 {Number(video.requestDuration || 0).toFixed(2)}s
          </div>
        </div>
        <span className={`rounded-full px-3 py-1 text-[10px] ${
          video.status === 'confirmed'
            ? dark ? 'bg-emerald-400/10 text-emerald-300' : 'bg-emerald-50 text-emerald-700'
            : video.status === 'failed'
              ? dark ? 'bg-red-400/10 text-red-300' : 'bg-red-50 text-red-700'
              : dark ? 'bg-white/6 text-neutral-400' : 'bg-neutral-100 text-neutral-500'
        }`}>
          {active
            ? video.status === 'calibrating' ? '校准时长' : '生成中'
            : video.status === 'failed' && video.retryable === false
              ? '需处理'
              : STATUS_LABELS[video.status]}
        </span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
          <MediaFigure
            label={video.startFrameUrl
              ? '可选起始关键帧'
              : (video.referenceImages?.length || 0) > 0
                ? '首张资产参考图'
                : '纯提示词生成'}
            type="image"
            url={video.startFrameUrl || video.referenceImages?.[0]}
            dark={dark}
          />
          <MediaFigure
            label={video.status === 'failed' && video.url ? '上次视频' : '校准后视频'}
            type="video"
            url={video.url}
            loading={active}
            dark={dark}
          />
        </div>

        <div className="min-w-0">
          <div className={`grid gap-2 text-[10px] sm:grid-cols-3 ${
            dark ? 'text-neutral-400' : 'text-neutral-600'
          }`}>
            <InfoBlock
              dark={dark}
              label="输入"
              value={(video.referenceImages?.length || 0) > 0
                ? `${video.referenceImages!.length} 张资产 / 关键帧参考`
                : video.lastFrameBase64
                  ? '起始帧 + 结束帧'
                  : video.imageBase64
                    ? '单张起始帧'
                    : '纯提示词（无首尾帧）'}
            />
            <InfoBlock
              dark={dark}
              label="时长校准"
              value={video.planError
                || (
                  video.calibration === 'speed'
                    ? `${Number(video.speed || 1).toFixed(3)}x 轻微变速`
                    : video.calibration === 'trim'
                      ? `裁剪到 ${Number(video.targetDuration || 0).toFixed(2)}s`
                      : '无需调整'
                )}
            />
            <InfoBlock
              dark={dark}
              label="声音"
              value={video.generateAudio ? '模型原生对白 / 环境声' : '关闭'}
            />
          </div>

          {video.error && (
            <div className={`mt-3 rounded-xl px-3 py-2 text-[10px] leading-4 ${
              dark ? 'bg-red-500/8 text-red-300' : 'bg-red-50 text-red-700'
            }`}>
              {video.error}
              {video.retryBlocked ? '；提交状态不确定，请核对平台历史。' : ''}
              {video.errorStage === 'calibration' ? '；可直接重试本地校准，不会再次调用生成平台。' : ''}
            </div>
          )}

          <button
            type="button"
            onClick={onToggleEdit}
            className={`mt-3 flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-[10px] ${
              dark ? 'bg-white/5 text-neutral-400' : 'bg-neutral-50 text-neutral-500'
            }`}
          >
            <span>查看提示词 · 原始模板 / 已解析 / 已优化 / 提交版本</span>
            {editing ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>

          {editing && (
            <div className="mt-3 space-y-2">
              <PromptDebug label="原始模板" value={rawPrompt} dark={dark} />
              <PromptDebug label="已解析提示词" value={resolvedPrompt} dark={dark} />
              <PromptDebug label="已优化提示词" value={optimizedPrompt} dark={dark} />
              <label className="block">
                <span className={labelClass(dark)}>
                  实际提交提示词 · {video.promptSource === 'user' ? '已手动编辑' : '自动生成'}
                </span>
                <textarea
                  value={draft}
                  onChange={event => setDraft(event.target.value)}
                  rows={9}
                  className={`mt-2 w-full resize-y rounded-xl border px-3 py-2.5 font-mono text-[10px] leading-5 outline-none ${
                    dark
                      ? 'border-white/8 bg-[#0c0d0e] text-neutral-300'
                      : 'border-neutral-200 bg-white text-neutral-700'
                  }`}
                />
              </label>
              <button
                type="button"
                disabled={running || draft.trim() === video.prompt.trim()}
                onClick={() => onSavePrompt(draft)}
                className={secondaryButtonClass(dark)}
              >
                <Save size={11} />
                保存并标记待重新生成
              </button>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={running || Boolean(video.planError)}
              onClick={() => onGenerate(
                ['completed', 'confirmed'].includes(video.status)
              )}
              className={primaryButtonClass(dark)}
            >
              {active
                ? <Loader2 size={12} className="animate-spin" />
                : calibrationRetry ? <Clock3 size={12} /> : <RefreshCw size={12} />}
              {calibrationRetry
                ? '重试本地校准'
                : video.status === 'pending'
                  ? '生成视频'
                  : video.retryBlocked
                    ? '核对后重新生成'
                    : '重新生成'}
            </button>
            <button
              type="button"
              disabled={running || !video.url || !['completed', 'confirmed'].includes(video.status)}
              onClick={onConfirm}
              className={secondaryButtonClass(dark, video.status === 'confirmed')}
            >
              <Check size={12} />
              {video.status === 'confirmed' ? '已选用' : '选用这个候选'}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
};

const MediaFigure: React.FC<{
  label: string;
  type: 'image' | 'video';
  url?: string;
  loading?: boolean;
  dark: boolean;
}> = ({ label, type, url, loading, dark }) => (
  <figure className={`relative aspect-video overflow-hidden rounded-2xl ${
    dark ? 'bg-[#090a0b]' : 'bg-neutral-100'
  }`}>
    {url && type === 'image' ? (
      <img src={url} alt={label} className="h-full w-full object-cover" />
    ) : url ? (
      <video
        src={url}
        aria-label={label}
        controls
        preload="metadata"
        className="h-full w-full object-cover"
      />
    ) : (
      <div className={`flex h-full items-center justify-center ${
        dark ? 'text-neutral-700' : 'text-neutral-300'
      }`}>
        <Film size={23} />
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

const InfoBlock: React.FC<{
  label: string;
  value: string;
  dark: boolean;
}> = ({ label, value, dark }) => (
  <div className={`rounded-xl px-3 py-2.5 ${
    dark ? 'bg-white/5' : 'bg-neutral-50'
  }`}>
    <div className={labelClass(dark)}>{label}</div>
    <div className="mt-1.5 leading-4">{value}</div>
  </div>
);

const PromptDebug: React.FC<{
  label: string;
  value: string;
  dark: boolean;
}> = ({ label, value, dark }) => (
  <details className={`rounded-xl border px-3 py-2 ${
    dark ? 'border-white/8 bg-black/20' : 'border-neutral-200 bg-neutral-50'
  }`}>
    <summary className="cursor-pointer text-[10px] font-medium">{label}</summary>
    <pre className={`mt-2 max-h-52 overflow-auto whitespace-pre-wrap font-mono text-[9px] leading-4 ${
      dark ? 'text-neutral-400' : 'text-neutral-600'
    }`}>
      {value || '未填写'}
    </pre>
  </details>
);

const CapabilityTag: React.FC<{
  dark: boolean;
  active: boolean;
  label: string;
}> = ({ dark, active, label }) => (
  <span className={`rounded-full px-2.5 py-1 text-[9px] ${
    active
      ? dark ? 'bg-cyan-400/10 text-cyan-300' : 'bg-cyan-50 text-cyan-700'
      : dark ? 'bg-white/5 text-neutral-600' : 'bg-white text-neutral-400'
  }`}>
    {label}
  </span>
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
      <Film size={28} className="mx-auto text-cyan-400" />
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

function labelClass(dark: boolean) {
  return `text-[10px] font-medium ${
    dark ? 'text-neutral-500' : 'text-neutral-400'
  }`;
}

function selectClass(dark: boolean) {
  return `mt-2 w-full rounded-xl border px-3 py-2.5 text-xs outline-none ${
    dark
      ? 'border-white/8 bg-[#171819] text-neutral-200'
      : 'border-neutral-200 bg-white text-neutral-700'
  }`;
}

function primaryButtonClass(dark: boolean) {
  return `flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-xs font-medium disabled:opacity-40 ${
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
