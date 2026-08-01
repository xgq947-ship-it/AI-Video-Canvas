import React from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Film,
  FolderOpen,
  Loader2,
  Music,
  RotateCcw,
  Scissors,
  Sparkles,
  Subtitles,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  XCircle,
} from 'lucide-react';

import {
  beginVideoRemixRender,
  buildVideoRemixManifest,
  completeVideoRemixRender,
  createVideoRemixState,
  moveVideoRemixTimelineShot,
  prepareVideoRemixTimeline,
  removeVideoRemixTimelineShot,
  replaceVideoRemixTimelineShot,
  restoreVideoRemixTimelineShot,
  setVideoRemixBgm,
  setVideoRemixRenderError,
  setVideoRemixSubtitles,
  updateVideoRemixRenderJob,
  updateVideoRemixTimelineShot,
  videoRemixOutputNodeId,
} from '../../../shared/videoRemix.js';
import { NodeData } from '../../types';
import {
  cancelVideoRemixRender,
  getVideoRemixRenderJob,
  listVideoRemixProjectAssets,
  revealVideoRemixRender,
  startVideoRemixRender,
  uploadVideoRemixBgm,
  validateVideoRemixManifest,
  type VideoRemixProjectAsset,
} from './videoRemixService';

type VideoRemixState = ReturnType<typeof createVideoRemixState>;

const activeRenderStatus = (status?: string) => (
  status === 'queued' || status === 'rendering'
);

const formatDuration = (seconds: number) => {
  const total = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(total / 60);
  const remainder = total - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(2).padStart(5, '0')}`;
};

const probeVideoDuration = (url: string): Promise<number> => new Promise(
  (resolve, reject) => {
    const video = document.createElement('video');
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('读取替换视频时长超时'));
    }, 15_000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeAttribute('src');
      video.load();
    };
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = Number(video.duration);
      cleanup();
      if (duration > 0 && Number.isFinite(duration)) resolve(duration);
      else reject(new Error('替换视频时长无效'));
    };
    video.onerror = () => {
      cleanup();
      reject(new Error('无法读取替换视频'));
    };
    video.src = url;
  }
);

export const VideoRemixFinalWorkspace: React.FC<{
  node: NodeData;
  state: VideoRemixState;
  workflowId?: string;
  onUpdateNode: (nodeId: string, updates: Partial<NodeData>) => void;
  onSelectVideos: () => void;
  onFinalOutput: (output: {
    nodeId: string;
    url: string;
    duration: number;
    width: number;
    height: number;
    fps: number;
    aspectRatio: string;
  }) => void;
  dark: boolean;
}> = ({
  node,
  state,
  workflowId,
  onUpdateNode,
  onSelectVideos,
  onFinalOutput,
  dark,
}) => {
  const [projectAssets, setProjectAssets] = React.useState<VideoRemixProjectAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = React.useState(false);
  const [uploadingBgm, setUploadingBgm] = React.useState(false);
  const [localError, setLocalError] = React.useState('');
  const [renderMissingCount, setRenderMissingCount] = React.useState(0);
  const bgmInputRef = React.useRef<HTMLInputElement>(null);
  const workingRef = React.useRef(state);

  const persist = React.useCallback((next: VideoRemixState) => {
    workingRef.current = next;
    onUpdateNode(node.id, { videoRemix: next });
  }, [node.id, onUpdateNode]);

  const finishRender = React.useCallback(({
    jobId,
    inputHash,
    url,
  }: {
    jobId: string;
    inputHash: string;
    url: string;
  }) => {
    const manifest = buildVideoRemixManifest(workingRef.current, {
      projectId: workflowId,
      title: node.title || 'Video Remix 成片',
    });
    const outputNodeId = videoRemixOutputNodeId(node.id);
    const completed = completeVideoRemixRender(
      workingRef.current,
      {
        jobId,
        inputHash,
        url,
        duration: manifest.durationSec,
        nodeId: outputNodeId,
      }
    );
    if (!completed.output) return;
    persist(completed);
    const ratio = manifest.composition.width === manifest.composition.height
      ? '1:1'
      : manifest.composition.width < manifest.composition.height
        ? '9:16'
        : '16:9';
    onFinalOutput({
      nodeId: outputNodeId,
      url: completed.output.url,
      duration: manifest.durationSec,
      width: manifest.composition.width,
      height: manifest.composition.height,
      fps: manifest.composition.fps,
      aspectRatio: ratio,
    });
  }, [node.id, node.title, onFinalOutput, persist, workflowId]);

  React.useEffect(() => {
    workingRef.current = state;
  }, [state]);

  React.useEffect(() => {
    if (!state.videoReview?.confirmed) return;
    const prepared = prepareVideoRemixTimeline(state);
    if (prepared !== state) persist(prepared);
  }, [persist, state]);

  React.useEffect(() => {
    if (!workflowId || !state.videoReview?.confirmed) return;
    let cancelled = false;
    setAssetsLoading(true);
    void listVideoRemixProjectAssets(workflowId)
      .then(assets => {
        if (!cancelled) setProjectAssets(assets);
      })
      .catch(error => {
        if (!cancelled) setLocalError(error?.message || '项目素材读取失败');
      })
      .finally(() => {
        if (!cancelled) setAssetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [state.videoReview?.confirmed, workflowId]);

  React.useEffect(() => {
    const job = state.renderJob;
    if (!job?.jobId || !activeRenderStatus(job.status)) return;
    let cancelled = false;
    let misses = 0;
    const tick = async () => {
      try {
        const latest = await getVideoRemixRenderJob(job.jobId);
        if (cancelled) return;
        if (!latest) {
          misses += 1;
          setRenderMissingCount(misses);
          if (misses >= 3) {
            if (workflowId) {
              const manifest = buildVideoRemixManifest(workingRef.current, {
                projectId: workflowId,
                title: node.title || 'Video Remix 成片',
              });
              const assets = await listVideoRemixProjectAssets(workflowId);
              const recovered = assets.find(asset => (
                asset.type === 'video'
                && asset.filename === manifest.output?.fileName
                && asset.url
              ));
              if (recovered?.url) {
                finishRender({
                  jobId: job.jobId,
                  inputHash: job.inputHash,
                  url: recovered.url,
                });
                return;
              }
            }
            persist(setVideoRemixRenderError(
              workingRef.current,
              '渲染服务重启后找不到上次任务，可安全重新渲染',
              {
                jobId: job.jobId,
                code: 'RENDER_JOB_LOST',
              }
            ));
          }
          return;
        }
        misses = 0;
        setRenderMissingCount(0);
        if (latest.inputHash && latest.inputHash !== job.inputHash) {
          persist(setVideoRemixRenderError(
            workingRef.current,
            '发现同项目的旧渲染任务，已拒绝把旧成片写入当前 Timeline',
            {
              jobId: job.jobId,
              code: 'STALE_RENDER_JOB',
            }
          ));
          return;
        }
        if (latest.status === 'success' && latest.output) {
          finishRender({
            jobId: latest.jobId,
            inputHash: job.inputHash,
            url: latest.output,
          });
          return;
        }
        if (latest.status === 'failed' || latest.status === 'cancelled') {
          persist(setVideoRemixRenderError(
            workingRef.current,
            latest.error || (
              latest.status === 'cancelled' ? '成片渲染已取消' : '成片渲染失败'
            ),
            {
              jobId: latest.jobId,
              status: latest.status,
              missing: latest.missing,
            }
          ));
          return;
        }
        persist(updateVideoRemixRenderJob(
          workingRef.current,
          latest
        ));
      } catch (error) {
        if (!cancelled) {
          setLocalError(error instanceof Error ? error.message : '渲染状态读取失败');
        }
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 1200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    finishRender,
    node.title,
    persist,
    state.renderJob,
    workflowId,
  ]);

  if (!state.videoReview?.confirmed) {
    return (
      <div className={`mt-7 flex min-h-[360px] items-center justify-center rounded-[26px] border ${
        dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
      }`}>
        <div className="max-w-md text-center">
          <Film size={28} className="mx-auto text-cyan-400" />
          <div className="mt-4 text-sm font-medium">先确认全部镜头视频</div>
          <p className={`mt-2 text-xs leading-5 ${
            dark ? 'text-neutral-500' : 'text-neutral-400'
          }`}>
            成片只使用已完成时长校准并由用户确认的 Shot 视频。
          </p>
          <button
            type="button"
            onClick={onSelectVideos}
            className={`mt-5 rounded-xl px-5 py-2.5 text-xs font-medium ${
              dark ? 'bg-white text-neutral-950' : 'bg-neutral-900 text-white'
            }`}
          >
            前往视频页
          </button>
        </div>
      </div>
    );
  }

  const timeline = [...state.timeline].sort((left, right) => left.order - right.order);
  const renderBusy = activeRenderStatus(state.renderJob?.status);
  const duration = timeline.reduce((sum, item) => (
    sum + Math.max(0, Number(item.end) - Number(item.start))
  ), 0);
  const videoAssets = projectAssets.filter(asset => asset.type === 'video');
  const continuity = state.continuityReport;
  const renderProgress = Math.round((state.renderJob?.progress || 0) * 100);

  const startRender = async () => {
    if (!workflowId || renderBusy) {
      if (!workflowId) setLocalError('请先把当前画布保存为项目');
      return;
    }
    setLocalError('');
    try {
      const prepared = prepareVideoRemixTimeline(workingRef.current);
      persist(prepared);
      const manifest = buildVideoRemixManifest(prepared, {
        projectId: workflowId,
        title: node.title || 'Video Remix 成片',
      });
      const validation = await validateVideoRemixManifest(manifest);
      if (!validation.valid) {
        const details = [
          ...validation.errors,
          ...validation.missing.map(item => `${item.kind}: ${item.raw}`),
        ];
        throw new Error(details.join('；') || '成片清单校验失败');
      }
      const job = await startVideoRemixRender({ workflowId, manifest });
      if (job.inputHash && job.inputHash !== manifest.inputHash) {
        throw new Error('该项目已有不同 Timeline 的渲染任务，请等待或取消后重试');
      }
      persist(beginVideoRemixRender(prepared, {
        ...job,
        inputHash: manifest.inputHash,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法开始成片渲染';
      setLocalError(message);
      persist(setVideoRemixRenderError(
        workingRef.current,
        message,
        {
          code: (error as { code?: string })?.code,
          missing: (error as { missing?: Array<{ kind: string; raw: string; reason: string }> })?.missing,
        }
      ));
    }
  };

  const cancelRender = async () => {
    const jobId = state.renderJob?.jobId;
    if (!jobId) return;
    try {
      await cancelVideoRemixRender(jobId);
      persist(setVideoRemixRenderError(
        workingRef.current,
        '成片渲染已取消',
        { jobId, status: 'cancelled' }
      ));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '无法取消渲染');
    }
  };

  const uploadBgm = async (file?: File) => {
    if (!file || !workflowId || uploadingBgm) return;
    setUploadingBgm(true);
    setLocalError('');
    try {
      const result = await uploadVideoRemixBgm({ workflowId, file });
      persist(setVideoRemixBgm(workingRef.current, {
        mode: 'upload',
        url: result.url,
        name: file.name || result.filename,
      }));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'BGM 上传失败');
    } finally {
      setUploadingBgm(false);
      if (bgmInputRef.current) bgmInputRef.current.value = '';
    }
  };

  const replaceTimelineVideo = async (shotId: string, value: string) => {
    if (value === '__generated__') {
      persist(restoreVideoRemixTimelineShot(workingRef.current, shotId));
      return;
    }
    if (!value) return;
    setLocalError('');
    try {
      const sourceDuration = await probeVideoDuration(value);
      persist(replaceVideoRemixTimelineShot(
        workingRef.current,
        shotId,
        { videoUrl: value, sourceDuration }
      ));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '替换视频读取失败');
    }
  };

  return (
    <div className="mt-7 space-y-5">
      <section className={`rounded-[26px] border p-5 ${
        dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
      }`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <Scissors size={16} className="text-cyan-400" />
              轻量 Timeline
            </div>
            <p className={`mt-2 text-[11px] leading-5 ${
              dark ? 'text-neutral-500' : 'text-neutral-500'
            }`}>
              默认严格复用原片 Shot 顺序。可替换、删除、微调切点和选择硬切 / 淡变，
              不会展开成复杂 NLE。
            </p>
          </div>
          <div className={`rounded-xl px-3 py-2 text-[11px] ${
            dark ? 'bg-white/6 text-neutral-300' : 'bg-neutral-100 text-neutral-600'
          }`}>
            {timeline.length} Shot · {formatDuration(duration)}
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {timeline.map((item, index) => {
            const shot = state.shots.find(candidate => candidate.shotId === item.shotId);
            const generated = state.generatedVideos.find(candidate => candidate.shotId === item.shotId);
            return (
              <article
                key={item.shotId}
                className={`grid gap-4 rounded-2xl border p-4 lg:grid-cols-[190px_1fr_auto] ${
                  dark ? 'border-white/8 bg-black/20' : 'border-neutral-200 bg-neutral-50'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-semibold ${
                      dark ? 'bg-white/8 text-neutral-300' : 'bg-white text-neutral-600'
                    }`}>
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <div className="text-xs font-medium">{item.shotId}</div>
                      <div className={`mt-0.5 text-[9px] ${
                        dark ? 'text-neutral-600' : 'text-neutral-400'
                      }`}>
                        {item.source === 'replacement' ? '项目视频替换' : '已确认生成视频'}
                      </div>
                    </div>
                  </div>
                  {item.videoUrl && (
                    <video
                      src={item.videoUrl}
                      controls
                      preload="metadata"
                      className="mt-3 aspect-video w-full rounded-xl bg-black object-cover"
                    />
                  )}
                </div>

                <div className="grid content-start gap-3 sm:grid-cols-2">
                  <label className="sm:col-span-2">
                    <span className={labelClass(dark)}>Shot 替换</span>
                    <select
                      value={item.source === 'replacement' ? item.videoUrl : '__generated__'}
                      disabled={renderBusy || assetsLoading}
                      onChange={event => void replaceTimelineVideo(
                        item.shotId,
                        event.target.value
                      )}
                      className={fieldClass(dark)}
                    >
                      <option value="__generated__">
                        当前确认视频 · {generated?.targetDuration || shot?.duration || 0}s
                      </option>
                      {videoAssets
                        .filter(asset => asset.url !== generated?.url)
                        .map(asset => (
                          <option key={asset.url} value={asset.url}>
                            {asset.name || asset.filename || asset.url}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    <span className={labelClass(dark)}>切入点（秒）</span>
                    <input
                      type="number"
                      min={0}
                      max={Math.max(0, Number(item.sourceDuration || 0) - 0.08)}
                      step={0.04}
                      value={item.start}
                      disabled={renderBusy}
                      onChange={event => persist(updateVideoRemixTimelineShot(
                        workingRef.current,
                        item.shotId,
                        { start: Number(event.target.value) }
                      ))}
                      className={fieldClass(dark)}
                    />
                  </label>
                  <label>
                    <span className={labelClass(dark)}>切出点（秒）</span>
                    <input
                      type="number"
                      min={Number(item.start) + 0.08}
                      max={item.sourceDuration}
                      step={0.04}
                      value={item.end}
                      disabled={renderBusy}
                      onChange={event => persist(updateVideoRemixTimelineShot(
                        workingRef.current,
                        item.shotId,
                        { end: Number(event.target.value) }
                      ))}
                      className={fieldClass(dark)}
                    />
                  </label>
                  <label className="sm:col-span-2">
                    <span className={labelClass(dark)}>转场到下一 Shot</span>
                    <select
                      value={item.transition}
                      disabled={renderBusy || index === timeline.length - 1}
                      onChange={event => persist(updateVideoRemixTimelineShot(
                        workingRef.current,
                        item.shotId,
                        {
                          transition: event.target.value === 'fade'
                            ? 'fade'
                            : 'hard_cut',
                        }
                      ))}
                      className={fieldClass(dark)}
                    >
                      <option value="hard_cut">Hard Cut · 硬切</option>
                      <option value="fade">Fade · 淡出 / 淡入</option>
                    </select>
                  </label>
                </div>

                <div className="flex gap-1 lg:flex-col">
                  <IconButton
                    label="上移 Shot"
                    disabled={renderBusy || index === 0}
                    dark={dark}
                    onClick={() => persist(moveVideoRemixTimelineShot(
                      workingRef.current,
                      item.shotId,
                      -1
                    ))}
                  >
                    <ArrowUp size={13} />
                  </IconButton>
                  <IconButton
                    label="下移 Shot"
                    disabled={renderBusy || index === timeline.length - 1}
                    dark={dark}
                    onClick={() => persist(moveVideoRemixTimelineShot(
                      workingRef.current,
                      item.shotId,
                      1
                    ))}
                  >
                    <ArrowDown size={13} />
                  </IconButton>
                  <IconButton
                    label="恢复当前生成视频"
                    disabled={renderBusy || item.source !== 'replacement'}
                    dark={dark}
                    onClick={() => persist(restoreVideoRemixTimelineShot(
                      workingRef.current,
                      item.shotId
                    ))}
                  >
                    <RotateCcw size={13} />
                  </IconButton>
                  <IconButton
                    label="删除 Shot"
                    disabled={renderBusy || timeline.length <= 1}
                    dark={dark}
                    danger
                    onClick={() => persist(removeVideoRemixTimelineShot(
                      workingRef.current,
                      item.shotId
                    ))}
                  >
                    <Trash2 size={13} />
                  </IconButton>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className={sectionClass(dark)}>
          <div className="flex items-center gap-2 text-sm font-medium">
            <Music size={16} className="text-violet-400" />
            BGM
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <ChoiceButton
              active={state.bgm.mode === 'none'}
              dark={dark}
              disabled={renderBusy}
              onClick={() => persist(setVideoRemixBgm(
                workingRef.current,
                { mode: 'none' }
              ))}
              icon={<VolumeX size={14} />}
              label="无"
            />
            <ChoiceButton
              active={state.bgm.mode === 'original'}
              dark={dark}
              disabled={renderBusy || state.source?.hasAudio === false}
              onClick={() => persist(setVideoRemixBgm(
                workingRef.current,
                { mode: 'original' }
              ))}
              icon={<Volume2 size={14} />}
              label="原视频音轨"
            />
            <ChoiceButton
              active={state.bgm.mode === 'upload'}
              dark={dark}
              disabled={renderBusy || uploadingBgm}
              onClick={() => bgmInputRef.current?.click()}
              icon={uploadingBgm
                ? <Loader2 size={14} className="animate-spin" />
                : <Upload size={14} />}
              label="上传音乐"
            />
          </div>
          <input
            ref={bgmInputRef}
            type="file"
            accept="audio/mpeg,audio/wav,audio/aac,audio/ogg,audio/mp4,.mp3,.wav,.aac,.ogg,.m4a"
            className="hidden"
            onChange={event => void uploadBgm(event.target.files?.[0])}
          />
          {state.bgm.mode !== 'none' && (
            <div className={`mt-4 rounded-xl px-3 py-3 ${
              dark ? 'bg-white/5' : 'bg-neutral-50'
            }`}>
              <div className="flex items-center justify-between gap-3 text-[10px]">
                <span className={dark ? 'text-neutral-400' : 'text-neutral-600'}>
                  {state.bgm.name || (
                    state.bgm.mode === 'original' ? '原视频音轨' : '已上传音乐'
                  )}
                </span>
                <span>{Math.round((state.bgm.volume || 0) * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={state.bgm.volume ?? (
                  state.bgm.mode === 'original' ? 1 : 0.15
                )}
                disabled={renderBusy}
                onChange={event => persist(setVideoRemixBgm(
                  workingRef.current,
                  {
                    ...workingRef.current.bgm,
                    mode: workingRef.current.bgm.mode,
                    volume: Number(event.target.value),
                  }
                ))}
                className="mt-3 w-full accent-cyan-400"
              />
              <p className={`mt-2 text-[9px] leading-4 ${
                dark ? 'text-neutral-600' : 'text-neutral-400'
              }`}>
                原视频模式使用完整原音轨并静音生成 Shot，避免对白叠音；上传模式保留
                Shot 原生对白 / 环境声并以低音量循环 BGM。
              </p>
            </div>
          )}
        </section>

        <section className={sectionClass(dark)}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Subtitles size={16} className="text-amber-400" />
              字幕
            </div>
            <button
              type="button"
              disabled={renderBusy}
              onClick={() => persist(setVideoRemixSubtitles(
                workingRef.current,
                { enabled: !state.subtitles.enabled }
              ))}
              className={`rounded-full px-3 py-1 text-[10px] ${
                state.subtitles.enabled
                  ? dark ? 'bg-amber-400/12 text-amber-300' : 'bg-amber-50 text-amber-700'
                  : dark ? 'bg-white/6 text-neutral-500' : 'bg-neutral-100 text-neutral-500'
              }`}
            >
              {state.subtitles.enabled ? '自动字幕已开启' : '字幕已关闭'}
            </button>
          </div>
          <p className={`mt-3 text-[10px] leading-5 ${
            dark ? 'text-neutral-500' : 'text-neutral-500'
          }`}>
            自动字幕来自原视频分析形成的 Dialogue Blueprint，并随 Timeline 排序和切点
            自动重算；不会复用旧视频里的烧录字幕。
          </p>
          {state.subtitles.enabled && (
            <>
              <label className="mt-3 block">
                <span className={labelClass(dark)}>字幕样式</span>
                <select
                  value={state.subtitles.style}
                  disabled={renderBusy}
                  onChange={event => persist(setVideoRemixSubtitles(
                    workingRef.current,
                    {
                      style: event.target.value === 'short-video'
                        ? 'short-video'
                        : 'default',
                    }
                  ))}
                  className={fieldClass(dark)}
                >
                  <option value="default">默认中文描边</option>
                  <option value="short-video">短视频大字</option>
                </select>
              </label>
              <div className={`mt-3 max-h-36 space-y-1.5 overflow-y-auto rounded-xl p-3 ${
                dark ? 'bg-black/20' : 'bg-neutral-50'
              }`}>
                {state.subtitles.items.length > 0 ? state.subtitles.items.map(item => (
                  <div
                    key={item.id}
                    className={`flex gap-3 text-[9px] leading-4 ${
                      dark ? 'text-neutral-400' : 'text-neutral-600'
                    }`}
                  >
                    <span className="shrink-0 font-mono text-cyan-500">
                      {item.start.toFixed(2)}–{item.end.toFixed(2)}
                    </span>
                    <span>{item.text}</span>
                  </div>
                )) : (
                  <div className="text-[10px] text-neutral-500">
                    Dialogue Blueprint 中没有可用对白。
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <section className={sectionClass(dark)}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 size={16} className="text-emerald-400" />
              连续性检查
            </div>
            <p className={`mt-2 text-[10px] leading-5 ${
              dark ? 'text-neutral-500' : 'text-neutral-500'
            }`}>
              比较相邻 Shot 的 End State / Start State：人物位置、朝向、情绪、手持道具、
              服装、场景、光线和时间。
            </p>
          </div>
          <div className={`rounded-xl px-3 py-2 text-xs font-semibold ${
            (continuity?.score || 0) >= 0.9
              ? dark ? 'bg-emerald-400/10 text-emerald-300' : 'bg-emerald-50 text-emerald-700'
              : dark ? 'bg-amber-400/10 text-amber-300' : 'bg-amber-50 text-amber-700'
          }`}>
            {Math.round((continuity?.score ?? 1) * 100)}%
          </div>
        </div>
        {continuity?.warnings.length ? (
          <div className="mt-4 space-y-2">
            {continuity.warnings.map((warning, index) => (
              <div
                key={`${warning}-${index}`}
                className={`flex items-start gap-2 rounded-xl px-3 py-2 text-[10px] leading-4 ${
                  dark ? 'bg-amber-400/8 text-amber-200' : 'bg-amber-50 text-amber-800'
                }`}
              >
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                {warning}
              </div>
            ))}
          </div>
        ) : (
          <div className={`mt-4 rounded-xl px-3 py-2 text-[10px] ${
            dark ? 'bg-emerald-400/8 text-emerald-300' : 'bg-emerald-50 text-emerald-700'
          }`}>
            未发现结构化连续性冲突。
          </div>
        )}
      </section>

      <section className={sectionClass(dark)}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <Sparkles size={16} className="text-cyan-400" />
              Remotion 最终输出
            </div>
            <p className={`mt-2 text-[10px] leading-5 ${
              dark ? 'text-neutral-500' : 'text-neutral-500'
            }`}>
              复用现有 Manifest / Remotion Renderer，输出 H.264 + AAC MP4 并做响度母带。
              渲染不会调用任何 AI Provider。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {renderBusy ? (
              <button
                type="button"
                onClick={() => void cancelRender()}
                className={secondaryButtonClass(dark)}
              >
                <XCircle size={13} />
                取消渲染
              </button>
            ) : (
              <button
                type="button"
                disabled={timeline.length === 0}
                onClick={() => void startRender()}
                className={primaryButtonClass(dark)}
              >
                <Sparkles size={13} />
                {state.output?.url ? '重新生成最终视频' : '生成最终视频'}
              </button>
            )}
            {state.output?.url && state.renderJob?.jobId && (
              <button
                type="button"
                onClick={() => void revealVideoRemixRender(
                  state.renderJob!.jobId,
                  workflowId
                ).catch(error => setLocalError(error.message))}
                className={secondaryButtonClass(dark)}
              >
                <FolderOpen size={13} />
                在文件夹中显示
              </button>
            )}
          </div>
        </div>

        {renderBusy && (
          <div className={`mt-5 rounded-2xl p-4 ${
            dark ? 'bg-black/20' : 'bg-neutral-50'
          }`}>
            <div className="flex items-center justify-between text-[10px]">
              <span className="flex items-center gap-2">
                <Loader2 size={12} className="animate-spin text-cyan-400" />
                {state.renderJob?.stage || 'rendering'}
              </span>
              <span>{renderProgress}%</span>
            </div>
            <div className={`mt-3 h-1.5 overflow-hidden rounded-full ${
              dark ? 'bg-white/8' : 'bg-neutral-200'
            }`}>
              <div
                className="h-full rounded-full bg-cyan-400 transition-all"
                style={{ width: `${Math.max(2, renderProgress)}%` }}
              />
            </div>
            {renderMissingCount > 0 && (
              <div className="mt-2 text-[9px] text-amber-400">
                正在重新连接渲染任务（{renderMissingCount}/3）…
              </div>
            )}
          </div>
        )}

        {state.output?.url && (
          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,520px)_1fr]">
            <video
              src={state.output.url}
              controls
              preload="metadata"
              className="aspect-video w-full rounded-2xl bg-black object-contain"
            />
            <div className={`rounded-2xl p-4 text-[10px] leading-5 ${
              dark ? 'bg-emerald-400/8 text-emerald-200' : 'bg-emerald-50 text-emerald-800'
            }`}>
              <div className="flex items-center gap-2 text-xs font-medium">
                <CheckCircle2 size={14} />
                成片已输出
              </div>
              <div className="mt-2">时长：{formatDuration(state.output.duration)}</div>
              <div className="break-all">文件：{state.output.url}</div>
              <div className="mt-2">画布只新增一个 Final Video Node，不会展开内部 Shot。</div>
            </div>
          </div>
        )}

        {(localError || state.renderJob?.error) && (
          <div className={`mt-4 flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs ${
            dark ? 'bg-red-500/8 text-red-300' : 'bg-red-50 text-red-700'
          }`}>
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{localError || state.renderJob?.error}</span>
          </div>
        )}
      </section>
    </div>
  );
};

const ChoiceButton: React.FC<{
  active: boolean;
  dark: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}> = ({ active, dark, disabled, onClick, icon, label }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className={`flex h-11 items-center justify-center gap-2 rounded-xl text-[10px] disabled:opacity-40 ${
      active
        ? dark ? 'bg-cyan-400/12 text-cyan-300' : 'bg-cyan-50 text-cyan-700'
        : dark ? 'bg-white/5 text-neutral-400' : 'bg-neutral-50 text-neutral-600'
    }`}
  >
    {icon}
    {label}
  </button>
);

const IconButton: React.FC<{
  label: string;
  disabled?: boolean;
  dark: boolean;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ label, disabled, dark, danger, onClick, children }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={onClick}
    className={`flex h-8 w-8 items-center justify-center rounded-lg disabled:opacity-25 ${
      danger
        ? dark ? 'bg-red-500/8 text-red-300' : 'bg-red-50 text-red-700'
        : dark ? 'bg-white/6 text-neutral-400' : 'bg-white text-neutral-600'
    }`}
  >
    {children}
  </button>
);

const sectionClass = (dark: boolean) => `rounded-[26px] border p-5 ${
  dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
}`;

const labelClass = (dark: boolean) => `text-[9px] font-medium uppercase tracking-[0.12em] ${
  dark ? 'text-neutral-600' : 'text-neutral-400'
}`;

const fieldClass = (dark: boolean) => `mt-2 h-9 w-full rounded-xl border px-3 text-[10px] outline-none disabled:opacity-50 ${
  dark
    ? 'border-white/8 bg-[#0c0d0e] text-neutral-300'
    : 'border-neutral-200 bg-white text-neutral-700'
}`;

const primaryButtonClass = (dark: boolean) => `inline-flex h-9 items-center justify-center gap-2 rounded-xl px-4 text-[11px] font-medium disabled:opacity-40 ${
  dark ? 'bg-white text-neutral-950' : 'bg-neutral-900 text-white'
}`;

const secondaryButtonClass = (dark: boolean) => `inline-flex h-9 items-center justify-center gap-2 rounded-xl px-4 text-[11px] font-medium ${
  dark ? 'bg-white/7 text-neutral-300' : 'bg-neutral-100 text-neutral-700'
}`;
