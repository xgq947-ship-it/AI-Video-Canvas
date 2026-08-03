import React from 'react';
import {
  AlertCircle,
  Check,
  ChevronRight,
  FileText,
  Image,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
} from 'lucide-react';

import {
  applyVideoRemixPromptOptimization,
  beginVideoRemixPromptOptimization,
  buildAllVideoRemixPrompts,
  buildVideoRemixShotPrompts,
  confirmVideoRemixPrompts,
  createVideoRemixState,
  getVideoRemixPromptReadiness,
  setVideoRemixPromptOptimizationError,
  updateVideoRemixPromptLayer,
  VIDEO_REMIX_MOTION_LABELS,
  type ShotPromptState,
} from '../../../shared/videoRemix.js';
import {
  resolveVideoModelForAspectRatio,
  videoModelsForAspectRatio,
} from '../../../shared/generationProviders.js';
import {
  resolveVideoRemixPromptProfileForModel,
} from '../../../shared/promptOptimizationProfiles.js';
import { NodeData } from '../../types';
import {
  VideoRemixRequestError,
  optimizeVideoRemixPrompt,
} from './videoRemixService';

type VideoRemixState = ReturnType<typeof createVideoRemixState>;
type EditablePromptLayer = 'rawPrompt' | 'optimizedPrompt' | 'imagePrompt';

const STATUS_LABEL: Record<ShotPromptState['optimizationStatus'], string> = {
  draft: '待优化',
  optimizing: '优化中',
  ready: '已就绪',
  failed: '可重试',
};

function aspectRatioForState(state: VideoRemixState) {
  if (state.source?.orientation === 'portrait') return '9:16';
  if (state.source?.orientation === 'square') return '1:1';
  return '16:9';
}

function editableValue(field: unknown) {
  if (field && typeof field === 'object' && 'value' in field) {
    return String((field as { value?: string }).value || '');
  }
  return String(field || '');
}

export const VideoRemixPromptsWorkspace: React.FC<{
  node: NodeData;
  state: VideoRemixState;
  onUpdateNode: (nodeId: string, updates: Partial<NodeData>) => void;
  onSelectAssets: () => void;
  dark: boolean;
}> = ({
  node,
  state,
  onUpdateNode,
  onSelectAssets,
  dark,
}) => {
  const [selectedShotId, setSelectedShotId] = React.useState(
    state.shots[0]?.shotId || ''
  );
  const [busyShotId, setBusyShotId] = React.useState('');
  const [batchBusy, setBatchBusy] = React.useState(false);
  const [localError, setLocalError] = React.useState('');

  React.useEffect(() => {
    if (!state.shots.some(shot => shot.shotId === selectedShotId)) {
      setSelectedShotId(state.shots[0]?.shotId || '');
    }
  }, [selectedShotId, state.shots]);

  const persist = React.useCallback((next: VideoRemixState) => {
    onUpdateNode(node.id, { videoRemix: next });
  }, [node.id, onUpdateNode]);

  const aspectRatio = aspectRatioForState(state);
  const videoModels = videoModelsForAspectRatio(aspectRatio);
  const storedTargetModel = state.promptReview?.targetModel
    || Object.values(state.prompts || {})[0]?.targetModel
    || '';
  const targetModel = resolveVideoModelForAspectRatio(
    aspectRatio,
    storedTargetModel
  )?.modelId || '';
  const readiness = getVideoRemixPromptReadiness(state);
  const selectedShot = state.shots.find(shot => shot.shotId === selectedShotId);
  const selectedPrompt = state.prompts?.[selectedShotId];
  const running = Boolean(busyShotId) || batchBusy;

  const buildDrafts = (model = targetModel, options = {}) => {
    const next = buildAllVideoRemixPrompts(state, model, options);
    persist(next);
    setLocalError('');
    return next;
  };

  const optimizeOne = async (
    initial: VideoRemixState,
    shotId: string,
    force = false
  ) => {
    const model = initial.promptReview?.targetModel || targetModel;
    let working = buildVideoRemixShotPrompts(
      initial,
      shotId,
      model,
      force
        ? { resetVideoOptimization: true, resetImageOptimization: true }
        : {}
    );
    let prompt = working.prompts?.[shotId];
    const shot = working.shots.find(item => item.shotId === shotId);
    if (!prompt || !shot) return working;
    if (!force && prompt.optimizationStatus === 'ready') return working;

    working = beginVideoRemixPromptOptimization(working, shotId);
    persist(working);
    setBusyShotId(shotId);
    setLocalError('');
    try {
      prompt = working.prompts[shotId];
      if (
        force
        || !['optimizer', 'user'].includes(prompt.optimizedSource || '')
        || !prompt.optimizedPrompt
      ) {
        const videoProfile = resolveVideoRemixPromptProfileForModel(
          prompt.targetModel
        );
        const optimizedTemplate = await optimizeVideoRemixPrompt({
          prompt: prompt.rawPrompt,
          profileId: videoProfile.id,
          targetModel: prompt.targetModel,
          aspectRatio,
          duration: shot.duration,
        });
        working = applyVideoRemixPromptOptimization(working, shotId, {
          optimizedTemplate,
          videoProfileId: videoProfile.id,
        });
        persist(working);
      }

      prompt = working.prompts[shotId];
      if (
        force
        || !['optimizer', 'user'].includes(prompt.imagePromptSource)
        || !prompt.imagePrompt
      ) {
        const imagePromptTemplate = await optimizeVideoRemixPrompt({
          prompt: prompt.rawImagePrompt,
          profileId: 'image-remix-keyframe',
          targetModel: 'generic-image',
          aspectRatio,
          duration: shot.duration,
        });
        working = applyVideoRemixPromptOptimization(working, shotId, {
          imagePromptTemplate,
          imageProfileId: 'image-remix-keyframe',
        });
        persist(working);
      }
      return working;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '提示词优化失败';
      setLocalError(message);
      working = setVideoRemixPromptOptimizationError(
        working,
        shotId,
        message,
        caught instanceof VideoRemixRequestError ? caught.retryable : true
      );
      persist(working);
      return working;
    } finally {
      setBusyShotId('');
    }
  };

  const optimizeCurrent = async (force = false) => {
    if (running || !selectedShotId) return;
    await optimizeOne(state, selectedShotId, force);
  };

  const optimizeAll = async () => {
    if (running) return;
    setBatchBusy(true);
    setLocalError('');
    let working = buildAllVideoRemixPrompts(state, targetModel);
    persist(working);
    try {
      for (const shot of working.shots) {
        if (working.prompts?.[shot.shotId]?.optimizationStatus === 'ready') continue;
        working = await optimizeOne(working, shot.shotId);
      }
    } finally {
      setBusyShotId('');
      setBatchBusy(false);
    }
  };

  const saveLayer = (layer: EditablePromptLayer, value: string) => {
    if (!selectedShotId || running) return;
    persist(updateVideoRemixPromptLayer(state, selectedShotId, layer, value));
    setLocalError('');
  };

  if (!state.assetReview?.confirmed) {
    return (
      <section className={`rounded-[26px] border p-7 ${
        dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
      }`}>
        <div className="mx-auto max-w-md py-8 text-center">
          <FileText size={28} className="mx-auto text-cyan-400" />
          <div className="mt-4 text-sm font-medium">确认资产后生成提示词</div>
          <p className={`mt-2 text-xs leading-5 ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
            原始提示词使用稳定的资产占位符；确认人物、场景和道具后再解析，可避免把错误资产传入后续生成。
          </p>
          <button
            type="button"
            onClick={onSelectAssets}
            className={`mt-5 rounded-xl px-5 py-2.5 text-xs font-medium ${
              dark ? 'bg-white text-neutral-950' : 'bg-neutral-900 text-white'
            }`}
          >
            前往资产页
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={`rounded-[26px] border p-5 ${
      dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
    }`}>
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileText size={16} className="text-cyan-400" />
            四层提示词流程
          </div>
          <p className={`mt-2 max-w-2xl text-[11px] leading-5 ${
            dark ? 'text-neutral-500' : 'text-neutral-500'
          }`}>
            分析蓝图 → 原始占位符模板 → 当前资产解析 → 模型优化成品。
            优化模板保留资产占位符，后续换资产可在本地自动刷新，不会重复调用优化模型。
          </p>
        </div>
        <div className={`rounded-xl px-3 py-2 text-[11px] ${
          readiness.ready === readiness.total && readiness.total > 0
            ? dark ? 'bg-emerald-400/10 text-emerald-300' : 'bg-emerald-50 text-emerald-700'
            : dark ? 'bg-white/6 text-neutral-400' : 'bg-neutral-100 text-neutral-500'
        }`}>
          已就绪 {readiness.ready}/{readiness.total}
        </div>
      </div>

      <div className={`mt-5 grid gap-3 rounded-2xl border p-4 lg:grid-cols-[1fr_auto] ${
        dark ? 'border-white/8 bg-black/20' : 'border-neutral-200 bg-neutral-50'
      }`}>
        <label className="block">
          <span className={`text-[10px] font-medium ${
            dark ? 'text-neutral-500' : 'text-neutral-400'
          }`}>
            目标视频模型
          </span>
          <select
            value={targetModel}
            disabled={running}
            onChange={event => {
              const next = buildAllVideoRemixPrompts(
                state,
                event.target.value,
                { resetVideoOptimization: true }
              );
              persist(next);
              setLocalError('');
            }}
            className={`mt-2 w-full rounded-xl border px-3 py-2.5 text-xs outline-none ${
              dark
                ? 'border-white/8 bg-[#171819] text-neutral-200'
                : 'border-neutral-200 bg-white text-neutral-700'
            }`}
          >
            {videoModels.map(model => (
              <option key={model.id} value={model.id}>{model.name}</option>
            ))}
          </select>
          <span className={`mt-1.5 block text-[9px] ${
            dark ? 'text-neutral-600' : 'text-neutral-400'
          }`}>
            {aspectRatio} · 优化会使用“设置”中的提示词后端；不会自动开始视频生成
          </span>
        </label>

        <div className="flex flex-wrap items-end gap-2">
          <button
            type="button"
            disabled={running || !targetModel}
            onClick={() => buildDrafts()}
            className={`flex h-10 items-center gap-2 rounded-xl px-4 text-xs disabled:opacity-40 ${
              dark ? 'bg-white/6 text-neutral-300' : 'bg-white text-neutral-600 shadow-sm'
            }`}
          >
            <RefreshCw size={13} />
            构建 / 刷新
          </button>
          <button
            type="button"
            disabled={running || !targetModel}
            onClick={() => void optimizeAll()}
            className={`flex h-10 items-center gap-2 rounded-xl px-4 text-xs font-medium disabled:opacity-40 ${
              dark ? 'bg-cyan-400 text-neutral-950' : 'bg-cyan-600 text-white'
            }`}
          >
            {batchBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {batchBusy ? '批量优化中…' : '批量优化未完成镜头'}
          </button>
          <button
            type="button"
            disabled={running || readiness.total === 0 || readiness.ready !== readiness.total}
            onClick={() => persist(confirmVideoRemixPrompts(state))}
            className={`flex h-10 items-center gap-2 rounded-xl px-4 text-xs font-medium disabled:opacity-40 ${
              state.promptReview?.confirmed
                ? dark ? 'bg-emerald-400/12 text-emerald-300' : 'bg-emerald-50 text-emerald-700'
                : dark ? 'bg-white text-neutral-950' : 'bg-neutral-900 text-white'
            }`}
          >
            <Check size={13} />
            {state.promptReview?.confirmed ? '提示词已确认' : '确认全部提示词'}
          </button>
        </div>
      </div>

      {(localError || selectedPrompt?.optimizationError) && (
        <div className={`mt-4 flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs ${
          dark ? 'bg-red-500/8 text-red-300' : 'bg-red-50 text-red-700'
        }`}>
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          {localError || selectedPrompt?.optimizationError}
        </div>
      )}

      <div className="mt-5 grid gap-4 xl:grid-cols-[230px_1fr]">
        <div className={`max-h-[720px] space-y-2 overflow-y-auto rounded-2xl border p-2 ${
          dark ? 'border-white/8 bg-black/20' : 'border-neutral-200 bg-neutral-50'
        }`}>
          {state.shots.map((shot, index) => {
            const prompt = state.prompts?.[shot.shotId];
            const status = prompt?.optimizationStatus || 'draft';
            return (
              <button
                key={shot.shotId}
                type="button"
                onClick={() => setSelectedShotId(shot.shotId)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left ${
                  selectedShotId === shot.shotId
                    ? dark ? 'bg-white/10' : 'bg-white shadow-sm'
                    : dark ? 'hover:bg-white/5' : 'hover:bg-white/70'
                }`}
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-medium ${
                  status === 'ready'
                    ? dark ? 'bg-emerald-400/12 text-emerald-300' : 'bg-emerald-50 text-emerald-700'
                    : status === 'failed'
                      ? dark ? 'bg-red-400/10 text-red-300' : 'bg-red-50 text-red-700'
                      : dark ? 'bg-white/6 text-neutral-400' : 'bg-neutral-100 text-neutral-500'
                }`}>
                  {busyShotId === shot.shotId
                    ? <Loader2 size={13} className="animate-spin" />
                    : String(index + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{shot.shotId}</span>
                  <span className={`mt-1 block text-[9px] ${
                    dark ? 'text-neutral-600' : 'text-neutral-400'
                  }`}>
                    {Number(shot.duration).toFixed(2)}s · {STATUS_LABEL[status]}
                  </span>
                </span>
                <ChevronRight size={13} className={dark ? 'text-neutral-600' : 'text-neutral-400'} />
              </button>
            );
          })}
        </div>

        <div className="min-w-0">
          {!selectedShot || !selectedPrompt ? (
            <div className={`flex min-h-[360px] items-center justify-center rounded-2xl border border-dashed ${
              dark ? 'border-white/8 text-neutral-600' : 'border-neutral-200 text-neutral-400'
            }`}>
              <div className="text-center">
                <FileText size={23} className="mx-auto" />
                <div className="mt-3 text-xs">点击“构建 / 刷新”创建四层提示词</div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{selectedShot.shotId}</div>
                  <div className={`mt-1 text-[10px] ${
                    dark ? 'text-neutral-500' : 'text-neutral-400'
                  }`}>
                    {Number(selectedShot.duration).toFixed(2)}s · {
                      VIDEO_REMIX_MOTION_LABELS[selectedShot.motionComplexity]
                        || selectedShot.motionComplexity
                    }
                    {selectedPrompt.optimizedSource === 'optimizer' && selectedPrompt.videoProfileId
                      ? ` · ${selectedPrompt.videoProfileId}`
                      : ''}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={running}
                  onClick={() => void optimizeCurrent(
                    selectedPrompt.optimizationStatus === 'ready'
                  )}
                  className={`flex h-9 items-center gap-2 rounded-xl px-4 text-xs disabled:opacity-40 ${
                    dark ? 'bg-cyan-400 text-neutral-950' : 'bg-cyan-600 text-white'
                  }`}
                >
                  {busyShotId === selectedShotId
                    ? <Loader2 size={13} className="animate-spin" />
                    : <Sparkles size={13} />}
                  {selectedPrompt.optimizationStatus === 'ready' ? '重新优化当前' : '优化当前'}
                </button>
              </div>

              <AnalysisLayer
                shot={selectedShot}
                dark={dark}
              />
              <PromptLayerEditor
                key={`${selectedShotId}:raw:${selectedPrompt.promptHash}`}
                layer="第 2 层 · 原始提示词模板"
                hint="保存稳定资产占位符；编辑后会重新解析并使视频优化结果失效"
                value={selectedPrompt.rawPrompt}
                editable
                disabled={running}
                dark={dark}
                onSave={value => saveLayer('rawPrompt', value)}
              />
              <PromptLayerEditor
                key={`${selectedShotId}:resolved:${selectedPrompt.promptHash}`}
                layer="第 3 层 · 当前资产解析提示词"
                hint="由原始模板与当前资产自动解析；素材替换时本地刷新"
                value={selectedPrompt.resolvedPrompt}
                editable={false}
                disabled
                dark={dark}
              />
              <PromptLayerEditor
                key={`${selectedShotId}:optimized:${selectedPrompt.promptHash}`}
                layer="第 4 层 · 视频优化提示词"
                hint={selectedPrompt.optimizedSource === 'optimizer'
                  ? '来自现有视频提示词优化 Skill；可手动微调'
                  : '尚未通过优化后端，可手动填写后与关键帧提示词一起确认'}
                value={selectedPrompt.optimizedPrompt}
                editable
                disabled={running}
                dark={dark}
                onSave={value => saveLayer('optimizedPrompt', value)}
              />
              <PromptLayerEditor
                key={`${selectedShotId}:image:${selectedPrompt.promptHash}`}
                layer="关键帧 · 图片提示词"
                hint={selectedPrompt.imagePromptSource === 'optimizer'
                  ? '独立静态关键帧优化结果，不复用完整视频动作路径'
                  : '当前为本地静态草稿；优化或手动确认后才算就绪'}
                value={selectedPrompt.imagePrompt}
                editable
                disabled={running}
                dark={dark}
                icon="image"
                onSave={value => saveLayer('imagePrompt', value)}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

const AnalysisLayer: React.FC<{
  shot: VideoRemixState['shots'][number];
  dark: boolean;
}> = ({ shot, dark }) => (
  <div className={`rounded-2xl border p-4 ${
    dark ? 'border-white/8 bg-black/20' : 'border-neutral-200 bg-neutral-50'
  }`}>
    <div className="flex items-center justify-between gap-3">
      <div className="text-xs font-medium">第 1 层 · 分析蓝图</div>
      <span className={`rounded-full px-2.5 py-1 text-[9px] ${
        dark ? 'bg-white/6 text-neutral-500' : 'bg-white text-neutral-500'
      }`}>
        结构化蓝图
      </span>
    </div>
    <div className={`mt-3 grid gap-3 text-[10px] leading-5 sm:grid-cols-2 ${
      dark ? 'text-neutral-400' : 'text-neutral-600'
    }`}>
      <div>
        <span className={dark ? 'text-neutral-600' : 'text-neutral-400'}>剧情</span>
        <p>{editableValue(shot.storyBeat) || '未填写'}</p>
      </div>
      <div>
        <span className={dark ? 'text-neutral-600' : 'text-neutral-400'}>构图 / 运镜</span>
        <p>
          {editableValue(shot.frameBlueprint.shotSize) || '未填写'} ·
          {' '}{editableValue(shot.cameraBlueprint.angle) || editableValue(shot.frameBlueprint.cameraAngle) || '未填写'}
        </p>
      </div>
      <div>
        <span className={dark ? 'text-neutral-600' : 'text-neutral-400'}>资产引用</span>
        <p>{shot.characters.length} 人 · {shot.scene.sceneId ? '1 场景' : '无场景'} · {shot.props.length} 道具</p>
      </div>
      <div>
        <span className={dark ? 'text-neutral-600' : 'text-neutral-400'}>声音</span>
        <p>{shot.audioBlueprint.dialogue.length} 句对白 · {shot.audioBlueprint.soundEvents.length} 个声音事件</p>
      </div>
    </div>
  </div>
);

const PromptLayerEditor: React.FC<{
  layer: string;
  hint: string;
  value: string;
  editable: boolean;
  disabled: boolean;
  dark: boolean;
  icon?: 'image';
  onSave?: (value: string) => void;
}> = ({
  layer,
  hint,
  value,
  editable,
  disabled,
  dark,
  icon,
  onSave,
}) => {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);
  const dirty = draft !== value;
  return (
    <div className={`rounded-2xl border p-4 ${
      dark ? 'border-white/8 bg-black/20' : 'border-neutral-200 bg-neutral-50'
    }`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium">
            {icon === 'image' ? <Image size={13} className="text-cyan-400" /> : <FileText size={13} className="text-cyan-400" />}
            {layer}
          </div>
          <div className={`mt-1 text-[9px] ${
            dark ? 'text-neutral-600' : 'text-neutral-400'
          }`}>
            {hint}
          </div>
        </div>
        {editable && (
          <button
            type="button"
            disabled={disabled || !dirty}
            onClick={() => onSave?.(draft)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] disabled:opacity-35 ${
              dark ? 'bg-white/6 text-neutral-300' : 'bg-white text-neutral-600 shadow-sm'
            }`}
          >
            <Save size={11} />
            保存本层
          </button>
        )}
      </div>
      <textarea
        value={draft}
        readOnly={!editable}
        disabled={disabled && editable}
        onChange={event => setDraft(event.target.value)}
        rows={Math.min(14, Math.max(5, draft.split('\n').length + 1))}
        className={`mt-3 w-full resize-y rounded-xl border px-3 py-3 font-mono text-[10px] leading-5 outline-none ${
          dark
            ? 'border-white/8 bg-[#0c0d0e] text-neutral-300'
            : 'border-neutral-200 bg-white text-neutral-700'
        } ${!editable ? 'cursor-default opacity-80' : ''}`}
      />
    </div>
  );
};
