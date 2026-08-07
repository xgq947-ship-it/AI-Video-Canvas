import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Clipboard,
  Copy,
  Film,
  FileText,
  GripVertical,
  Link2,
  Loader2,
  Merge,
  Maximize2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ScanSearch,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { NodeConnectors } from '../../components/canvas/NodeConnectors';
import { LazyVideo } from '../../components/LazyVideo';
import { GenerationCancelButton } from '../../components/canvas/GenerationCancelButton';
import { GenerationElapsed } from '../../components/canvas/GenerationElapsed';
import { LockedNodeOverlay } from '../../components/LockedNodeOverlay';
import { useNodeLocked } from '../../hooks/useNodeLocked';
import { NodeData, NodeStatus, NodeType } from '../../types';
import type { StickmanDirectorOutput, StickmanShot } from '../../../shared/stickmanDirector.js';
import {
  STICKMAN_ASPECT_RATIOS,
  STICKMAN_PACES,
  STICKMAN_PLATFORMS,
  STICKMAN_RESOLUTION_PRESETS,
  STICKMAN_VISUAL_THEMES,
  compileFlowPrompt,
  normalizeStickmanSettings,
  resolveStickmanResolution,
} from '../../../shared/stickmanDirector.js';
import { getVideoGenerationProvider, listVideoGenerationProviders } from '../../../shared/generationProviders.js';
import { useGenerationModelRegistry } from '../../hooks/useGenerationModelRegistry';
import { useStickmanDirectorModels } from './modelOptions';

export const STICKMAN_NODE_WIDTH = 430;
export const STICKMAN_NODE_HEIGHT = 520;
export const SCRIPT_INPUT_NODE_HEIGHT = 420;
export const SCRIPT_INPUT_REFERENCE_NODE_HEIGHT = 560;
export const STICKMAN_STORYBOARD_COLLAPSED_HEIGHT = 310;
export const STICKMAN_STORYBOARD_MAX_LIST_HEIGHT = 620;
export const FLOW_BATCH_BASE_HEIGHT = 580;
export const FLOW_BATCH_RESULT_LIST_MAX_HEIGHT = 408;

/**
 * The storyboard list grows with its real content until the list itself needs
 * scrolling. Keep this estimate in one place so connectors, minimap and
 * selection bounds agree with the rendered node instead of using a per-shot
 * formula that leaves a large empty tail below the cards.
 */
export const getStickmanStoryboardNodeHeight = (storyboard?: NodeData['storyboard']): number => {
  if (!storyboard?.expanded) return STICKMAN_STORYBOARD_COLLAPSED_HEIGHT;
  const shotCount = storyboard.shots?.length || 0;
  const listHeight = shotCount
    ? Math.min(STICKMAN_STORYBOARD_MAX_LIST_HEIGHT, Math.max(120, shotCount * 136))
    : 120;
  return Math.max(430, 234 + listHeight);
};

export const getFlowBatchVideoNodeHeight = (storyboard?: NodeData['storyboard']): number => {
  const shots = storyboard?.shots || [];
  const resultCount = shots.filter(shot => Boolean(shot.generation.videoUrl)).length;
  if (!resultCount) return FLOW_BATCH_BASE_HEIGHT;
  const resultRows = Math.ceil(resultCount / 2);
  const hasOutstandingTasks = shots.some(shot => shot.generation.status !== 'completed');
  // 完成态不再重复展示整块任务队列，因此要扣除队列占用；进行中或失败态仍保留队列。
  const baseHeight = hasOutstandingTasks ? FLOW_BATCH_BASE_HEIGHT : 430;
  return baseHeight + 28 + Math.min(FLOW_BATCH_RESULT_LIST_MAX_HEIGHT, resultRows * 160);
};

type Theme = 'dark' | 'light';

interface BaseProps {
  data: NodeData;
  allNodes: NodeData[];
  selected: boolean;
  canvasTheme?: Theme;
  onUpdate: (id: string, updates: Partial<NodeData>) => void;
  onNodePointerDown: (event: React.PointerEvent, id: string) => void;
  onContextMenu: (event: React.MouseEvent, id: string) => void;
  onConnectorDown: (event: React.PointerEvent, id: string, side: 'left' | 'right', portId?: string) => void;
}

const defaults = normalizeStickmanSettings({});

const surface = (dark: boolean) => dark
  ? 'border-neutral-700 bg-[#101112] text-white'
  : 'border-neutral-200 bg-white text-neutral-900';
const muted = (dark: boolean) => dark ? 'text-neutral-500' : 'text-neutral-500';
const field = (dark: boolean) => dark
  ? 'border-white/10 bg-white/[0.05] text-neutral-100 placeholder:text-neutral-600'
  : 'border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-400';
const stop = (event: React.SyntheticEvent) => event.stopPropagation();

const Shell: React.FC<BaseProps & { icon: React.ReactNode; label: string; subtitle: string; children: React.ReactNode; minHeight?: number }> = ({
  data, selected, canvasTheme = 'dark', icon, label, subtitle, children, onNodePointerDown, onContextMenu, onConnectorDown, minHeight = 0,
}) => {
  const dark = canvasTheme === 'dark';
  return (
    <div
      data-node-id={data.id}
      className="group/node absolute touch-none pointer-events-auto"
      style={{ transform: `translate(${data.x}px, ${data.y}px)`, zIndex: selected ? 50 : 10 }}
      onPointerDown={event => onNodePointerDown(event, data.id)}
      onContextMenu={event => onContextMenu(event, data.id)}
    >
      <NodeConnectors nodeId={data.id} onConnectorDown={onConnectorDown} canvasTheme={canvasTheme} />
      <div className={`overflow-hidden rounded-[22px] border shadow-2xl ${surface(dark)} ${selected ? 'border-cyan-400 ring-1 ring-cyan-400/30' : ''}`} style={{ width: STICKMAN_NODE_WIDTH, ...(minHeight ? { minHeight } : {}) }}>
        <div className={`flex items-center gap-3 border-b px-5 py-4 ${dark ? 'border-white/8' : 'border-neutral-100'}`}>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-cyan-400/15 text-cyan-300">{icon}</div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{label}</div>
            <div className={`mt-0.5 truncate text-[11px] ${muted(dark)}`}>{subtitle}</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
};

const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { dark: boolean; tone?: 'primary' | 'quiet' | 'danger' }> = ({ dark, tone = 'quiet', className = '', children, ...props }) => (
  <button
    type="button"
    {...props}
    className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
      tone === 'primary'
        ? 'border-cyan-400/40 bg-cyan-400/15 text-cyan-200 hover:bg-cyan-400/25'
        : tone === 'danger'
          ? 'border-red-400/30 bg-red-500/10 text-red-300 hover:bg-red-500/20'
          : dark ? 'border-white/10 bg-white/[0.04] text-neutral-300 hover:bg-white/[0.09]' : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
    } ${className}`}
  >{children}</button>
);

const Field: React.FC<{ dark: boolean; label: string; children: React.ReactNode; className?: string }> = ({ dark, label, children, className = '' }) => (
  <label className={`block ${className}`}>
    <span className={`mb-1 block text-[10px] ${muted(dark)}`}>{label}</span>
    {children}
  </label>
);

const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { dark: boolean }> = ({ dark, className = '', ...props }) => (
  <input {...props} className={`h-8 w-full rounded-lg border px-2.5 text-[11px] outline-none focus:border-cyan-400/60 ${field(dark)} ${className}`} />
);

const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement> & { dark: boolean }> = ({ dark, className = '', children, ...props }) => (
  <select {...props} className={`h-8 w-full rounded-lg border px-2.5 text-[11px] outline-none focus:border-cyan-400/60 ${field(dark)} ${className}`}>{children}</select>
);

const TextArea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement> & { dark: boolean }> = ({ dark, className = '', ...props }) => (
  <textarea {...props} className={`w-full resize-y rounded-lg border px-2.5 py-2 text-[11px] leading-5 outline-none focus:border-cyan-400/60 ${field(dark)} ${className}`} />
);

const statusLabel = (status?: string) => ({
  pending: '等待', queued: '排队', generating: '生成中', paused: '已暂停', completed: '已完成', failed: '失败', cancelled: '已取消',
}[status || 'pending'] || status || '等待');

export const ScriptInputNode: React.FC<BaseProps & { onAnalyzeReference?: (id: string) => void }> = props => {
  const { data, onUpdate, onAnalyzeReference, allNodes } = props;
  const dark = (props.canvasTheme || 'dark') === 'dark';
  const stored = data.scriptInput;
  const value = {
    title: stored?.title || data.title || '未命名剧本',
    content: stored?.content || data.prompt || '',
    notes: stored?.notes || '',
    platform: stored?.platform || '抖音',
  };
  const sourceNode = allNodes.find(node => data.parentIds?.includes(node.id) && (node.type === NodeType.VIDEO || node.type === NodeType.REFERENCE_VIDEO));
  const directorNode = allNodes.find(node => node.type === NodeType.STICKMAN_DIRECTOR && node.parentIds?.includes(data.id));
  const cinematicDirectorNode = allNodes.find(node => node.type === NodeType.CINEMATIC_DIRECTOR && node.parentIds?.includes(data.id));
  const analysis = directorNode?.director?.analysis;
  const isReferenceScript = Boolean(sourceNode);
  const analysisStatus = analysis?.status || (data.status === NodeStatus.LOADING ? 'analyzing' : data.status === NodeStatus.ERROR ? 'error' : 'idle');
  const analysisRunning = analysisStatus === 'analyzing' || data.status === NodeStatus.LOADING;
  const analysisReady = analysisStatus === 'completed' && Boolean(value.content.trim());
  const analysisError = analysis?.errorMessage || directorNode?.director?.error || data.errorMessage;
  const canAnalyze = Boolean(sourceNode?.resultUrl) && !analysisRunning && Boolean(onAnalyzeReference);
  const update = (patch: Partial<typeof value>) => onUpdate(data.id, {
    title: patch.title || data.title || '剧本输入',
    prompt: patch.content ?? value.content,
    scriptInput: { ...value, ...patch },
  });
  return (
    <Shell {...props} icon={<FileText size={20} />} label={data.title || '剧本输入'} subtitle={cinematicDirectorNode ? '剧本 → 电影短片导演' : isReferenceScript ? '参考视频 → 剧本 → 火柴人导演' : '剧本 → 火柴人导演'} minHeight={isReferenceScript ? SCRIPT_INPUT_REFERENCE_NODE_HEIGHT : SCRIPT_INPUT_NODE_HEIGHT}>
      <div className="space-y-3 px-5 py-4">
        {isReferenceScript && (
          <div className={`rounded-2xl border p-3 ${dark ? 'border-cyan-400/25 bg-cyan-400/[0.07]' : 'border-cyan-200 bg-cyan-50'}`}>
            <div className="flex items-start gap-2.5">
              <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${dark ? 'bg-cyan-400/15 text-cyan-300' : 'bg-white text-cyan-600'}`}><ScanSearch size={16} /></div>
              <div className="min-w-0 flex-1">
                <div className={`text-xs font-semibold ${dark ? 'text-cyan-100' : 'text-cyan-800'}`}>从参考视频反推剧本</div>
                <div className={`mt-1 text-[10px] leading-4 ${dark ? 'text-neutral-400' : 'text-cyan-700/80'}`}>先提取剧情、动作、对白和声音，再由火柴人导演 Skill 独立推导最终分镜。</div>
              </div>
              {analysisReady && <Check size={16} className="mt-1 shrink-0 text-emerald-400" />}
            </div>
            <Button
              dark={dark}
              tone="primary"
              className="mt-3 w-full"
              disabled={!canAnalyze}
              onClick={() => onAnalyzeReference?.(data.id)}
              onPointerDown={stop}
            >
              {analysisRunning ? <Loader2 size={13} className="animate-spin" /> : <ScanSearch size={13} />}
              {analysisRunning ? '正在分析参考视频…' : analysisReady ? '重新分析并生成剧本' : '分析参考视频并生成剧本'}
            </Button>
            <div className={`mt-2 flex items-center justify-between gap-2 text-[10px] ${dark ? 'text-neutral-500' : 'text-cyan-700/70'}`}>
              <span className="truncate">{sourceNode?.title || '参考视频'}</span>
              <span className="shrink-0">{sourceNode?.videoDuration ? `${Number(sourceNode.videoDuration).toFixed(1)} 秒` : sourceNode?.resultUrl ? '视频已就绪' : '请先准备参考视频'}</span>
            </div>
            {analysisError && <div className="mt-2 rounded-lg bg-red-500/10 px-2.5 py-2 text-[10px] leading-4 text-red-300">{analysisError}</div>}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Field dark={dark} label="标题"><Input dark={dark} value={value.title} onChange={e => update({ title: e.target.value })} onPointerDown={stop} /></Field>
          <Field dark={dark} label="目标平台"><Select dark={dark} value={value.platform} onChange={e => update({ platform: e.target.value })} onPointerDown={stop}>{STICKMAN_PLATFORMS.map(item => <option key={item} value={item}>{item}</option>)}</Select></Field>
        </div>
        <Field dark={dark} label={isReferenceScript ? '分析得到的剧本正文' : '剧本正文'}><TextArea dark={dark} rows={isReferenceScript ? 9 : 7} value={value.content} placeholder={isReferenceScript ? '点击“分析参考视频并生成剧本”，这里会填入可编辑的剧情、动作、对白和声音…' : '输入故事、动作、对白或旁白…'} onChange={e => update({ content: e.target.value })} onPointerDown={stop} /></Field>
        <Field dark={dark} label="补充说明"><Input dark={dark} value={value.notes || ''} placeholder="节奏、禁用元素、角色说明…" onChange={e => update({ notes: e.target.value })} onPointerDown={stop} /></Field>
        <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[10px] ${dark ? 'bg-white/[0.04] text-neutral-400' : 'bg-neutral-50 text-neutral-500'}`}>
          <Link2 size={12} className="text-cyan-300" />{cinematicDirectorNode ? '连接到“电影短片导演”后执行角色一致性分镜规划' : isReferenceScript ? (analysisReady ? '剧本已生成，可连接导演节点执行分镜规划' : '先完成视频分析，再连接导演节点执行分镜规划') : '连接到“火柴人视频导演”后执行分镜规划'}
        </div>
      </div>
    </Shell>
  );
};

export const ReferenceVideoNode: React.FC<BaseProps & { workflowId?: string }> = props => {
  const { data, onUpdate, workflowId, allNodes } = props;
  const dark = (props.canvasTheme || 'dark') === 'dark';
  const value = data.referenceVideo || {};
  const [url, setUrl] = useState(value.url || data.resultUrl || '');
  const [uploading, setUploading] = useState(false);
  const [libraryVideos, setLibraryVideos] = useState<Array<{ id: string; url: string; name?: string; filename?: string }>>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const existingVideos = allNodes.filter(node => node.type === NodeType.VIDEO && node.resultUrl);

  useEffect(() => { setUrl(value.url || data.resultUrl || ''); }, [value.url, data.resultUrl]);
  useEffect(() => {
    if (!workflowId) {
      setLibraryVideos([]);
      return;
    }
    let alive = true;
    void fetch(`/api/assets/videos?workflowId=${encodeURIComponent(workflowId)}`, { cache: 'no-store' })
      .then(response => response.ok ? response.json() : [])
      .then(payload => {
        const items = Array.isArray(payload) ? payload : payload?.assets;
        if (alive && Array.isArray(items)) setLibraryVideos(items.filter(item => item?.url).map(item => ({
          id: String(item.id || item.url),
          url: String(item.url),
          name: item.name,
          filename: item.filename,
        })));
      })
      .catch(() => { if (alive) setLibraryVideos([]); });
    return () => { alive = false; };
  }, [workflowId]);

  const applyUrl = (source = url, sourceType: 'url' | 'canvas' | 'library' = 'url') => {
    const next = source.trim();
    if (!next) return;
    onUpdate(data.id, {
      resultUrl: next,
      status: NodeStatus.SUCCESS,
      videoSourceType: sourceType,
      videoSourceUrl: next,
      referenceVideo: { ...value, url: next, sourceType },
    });
    inspectVideo(next);
  };

  const inspectVideo = (source: string) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const aspectRatio = video.videoWidth && video.videoHeight
        ? (video.videoWidth >= video.videoHeight ? '16:9' : '9:16')
        : value.aspectRatio || '16:9';
      onUpdate(data.id, {
        referenceVideo: { ...value, url: source, duration: video.duration, width: video.videoWidth, height: video.videoHeight, aspectRatio },
        videoDuration: Number.isFinite(video.duration) ? video.duration : data.videoDuration,
        aspectRatio,
        resultAspectRatio: video.videoWidth && video.videoHeight ? `${video.videoWidth}/${video.videoHeight}` : data.resultAspectRatio,
      });
      video.removeAttribute('src');
      video.load();
    };
    video.src = source;
  };

  const upload = async (file: File) => {
    if (!workflowId) return;
    setUploading(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('读取视频失败'));
        reader.readAsDataURL(file);
      });
      const response = await fetch('/api/assets/videos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: base64, prompt: file.name, originalFilename: file.name, mimeType: file.type, workflowId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || '参考视频上传失败');
      const next = String(result.url || '');
      setUrl(next);
      onUpdate(data.id, {
        title: file.name,
        resultUrl: next,
        status: NodeStatus.SUCCESS,
        videoSourceType: 'upload',
        videoSourceUrl: next,
        referenceVideo: { ...value, url: next, title: file.name, sizeBytes: file.size, sourceType: 'upload' },
      });
      inspectVideo(next);
    } catch (error) {
      onUpdate(data.id, { status: NodeStatus.ERROR, errorMessage: error instanceof Error ? error.message : '参考视频上传失败' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Shell {...props} icon={<Video size={20} />} label={data.title || '参考视频'} subtitle="本地上传、URL 或已有素材" minHeight={300}>
      <div className="space-y-3 px-5 py-4">
        {data.resultUrl ? <LazyVideo src={data.resultUrl} loop={false} containerClassName="w-full" className="max-h-44 w-full rounded-xl bg-black object-contain" placeholderClassName="h-44 w-full rounded-xl bg-black" onPointerDown={stop} /> : <div className={`flex h-32 items-center justify-center rounded-xl border border-dashed text-xs ${dark ? 'border-white/10 text-neutral-600' : 'border-neutral-200 text-neutral-400'}`}><Film size={18} className="mr-2" />等待视频</div>}
        <div className="flex gap-2">
          <Input dark={dark} value={url} placeholder="https://… 或 /library/…" onChange={e => setUrl(e.target.value)} onPointerDown={stop} />
          <Button dark={dark} tone="primary" onClick={() => applyUrl()} onPointerDown={stop}>应用</Button>
        </div>
        {existingVideos.length > 0 && <Field dark={dark} label="选择已有画布视频"><Select dark={dark} value={existingVideos.some(node => node.resultUrl === url) ? url : ''} onChange={event => { const next = event.target.value; setUrl(next); if (next) { applyUrl(next, 'canvas'); inspectVideo(next); } }} onPointerDown={stop}><option value="">选择已有视频…</option>{existingVideos.map(node => <option key={node.id} value={node.resultUrl}>{node.title || node.id}</option>)}</Select></Field>}
        {libraryVideos.length > 0 && <Field dark={dark} label="选择项目素材库视频"><Select dark={dark} value={libraryVideos.some(item => item.url === url) ? url : ''} onChange={event => { const next = event.target.value; setUrl(next); if (next) { applyUrl(next, 'library'); inspectVideo(next); } }} onPointerDown={stop}><option value="">选择项目视频素材…</option>{libraryVideos.map(item => <option key={item.id} value={item.url}>{item.name || item.filename || item.id}</option>)}</Select></Field>}
        <div className="flex gap-2">
          <input ref={inputRef} type="file" accept="video/*" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} />
          <Button dark={dark} disabled={uploading} onClick={() => inputRef.current?.click()} onPointerDown={stop}>{uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} 上传本地视频</Button>
          <span className={`self-center text-[10px] ${muted(dark)}`}>{value.duration ? `${Number(value.duration).toFixed(1)} 秒` : '支持连接已有视频素材节点'}</span>
        </div>
        {data.errorMessage && <div className="flex items-start gap-1.5 rounded-lg bg-red-500/10 px-2.5 py-2 text-[10px] text-red-300"><AlertCircle size={12} />{data.errorMessage}</div>}
      </div>
    </Shell>
  );
};

export const StickmanDirectorNode: React.FC<BaseProps & { onRun: (id: string) => void }> = props => {
  const { data, onUpdate, onRun, allNodes } = props;
  const dark = (props.canvasTheme || 'dark') === 'dark';
  const locked = useNodeLocked(data.type);
  const state = { provider: 'auto' as const, status: 'idle' as const, ...defaults, ...(data.director || {}) };
  const { models, loading: modelsLoading } = useStickmanDirectorModels();
  const sourceType = state.sourceType || (allNodes.some(node => data.parentIds?.includes(node.id) && (node.type === NodeType.VIDEO_ANALYSIS || node.type === NodeType.REFERENCE_VIDEO)) ? 'reference_video' : 'script');
  const resolution = resolveStickmanResolution(state.aspectRatio, state.width, state.height);
  const analysisScriptReady = state.analysis?.status === 'completed' && Boolean(state.scriptInput?.content);
  const update = (patch: Partial<typeof state>) => {
    const next = { ...state, ...patch };
    onUpdate(data.id, {
      director: next,
      aspectRatio: next.aspectRatio,
      resolution: `${next.width}x${next.height}`,
      prompt: data.prompt,
    });
  };
  const providerModels = models.filter(model => ['deepseek', 'gemini', 'codex'].includes(model.id));
  const setAspect = (aspectRatio: string) => {
    const preset = STICKMAN_RESOLUTION_PRESETS[aspectRatio]?.[1] || STICKMAN_RESOLUTION_PRESETS[aspectRatio]?.[0];
    update({ aspectRatio, width: preset?.width || state.width, height: preset?.height || state.height });
  };
  const setPreset = (value: string) => {
    const [width, height] = value.split('x').map(Number);
    if (width > 0 && height > 0) update({ width, height, aspectRatio: state.aspectRatio });
  };
  const toggle = (key: keyof typeof state) => update({ [key]: !Boolean(state[key]) } as Partial<typeof state>);
  const output = state.output;
  return (
    <Shell {...props} icon={<Sparkles size={20} />} label={data.title || '火柴人视频导演'} subtitle="内部 Skill · 结构化分镜 + Flow Prompt" minHeight={STICKMAN_NODE_HEIGHT}>
      <div className="space-y-3 px-5 py-4">
        <div className="grid grid-cols-2 gap-2">
          <Field dark={dark} label="执行模型">
            <Select dark={dark} value={state.provider} onChange={event => {
              const provider = event.target.value as 'auto' | 'deepseek' | 'gemini' | 'codex';
              const model = providerModels.find(item => item.id === provider);
              update({ provider, modelId: model?.modelId || state.modelId });
            }} onPointerDown={stop}>
              <option value="auto">自动（参考视频优先 Gemini）</option><option value="deepseek">DeepSeek</option><option value="gemini">Gemini</option><option value="codex">Codex</option>
            </Select>
          </Field>
          <Field dark={dark} label="模型 ID">
            <Input dark={dark} list={`${data.id}-director-models`} value={state.modelId || ''} placeholder={modelsLoading ? '读取模型目录…' : '使用 Provider 默认'} onChange={event => update({ modelId: event.target.value })} onPointerDown={stop} />
            <datalist id={`${data.id}-director-models`}>{providerModels.map(item => <option key={item.modelId} value={item.modelId}>{item.name}</option>)}</datalist>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field dark={dark} label="提示词语言"><Select dark={dark} value={state.promptLanguage} onChange={event => update({ promptLanguage: event.target.value })} onPointerDown={stop}><option value="zh-CN">中文</option><option value="en-US">English</option></Select></Field>
          <Field dark={dark} label="对白语言"><Input dark={dark} value={state.dialogueLanguage} onChange={event => update({ dialogueLanguage: event.target.value })} onPointerDown={stop} /></Field>
          <Field dark={dark} label="声音性别"><Select dark={dark} value={state.voiceGender} onChange={event => update({ voiceGender: event.target.value })} onPointerDown={stop}><option value="不指定">不指定</option><option value="女声">女声</option><option value="男声">男声</option></Select></Field>
          <Field dark={dark} label="声音风格"><Input dark={dark} value={state.voiceStyle} onChange={event => update({ voiceStyle: event.target.value })} onPointerDown={stop} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field dark={dark} label="主题"><Select dark={dark} value={state.visualTheme} onChange={event => update({ visualTheme: event.target.value })} onPointerDown={stop}>{STICKMAN_VISUAL_THEMES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></Field>
          <Field dark={dark} label="比例"><Select dark={dark} value={state.aspectRatio} onChange={event => setAspect(event.target.value)} onPointerDown={stop}>{STICKMAN_ASPECT_RATIOS.map(item => <option key={item} value={item}>{item}</option>)}</Select></Field>
          <Field dark={dark} label="尺寸"><Select dark={dark} value={`${resolution.width}x${resolution.height}`} onChange={event => setPreset(event.target.value)} onPointerDown={stop}>{(STICKMAN_RESOLUTION_PRESETS[state.aspectRatio] || []).map(item => <option key={`${item.width}x${item.height}`} value={`${item.width}x${item.height}`}>{item.label}</option>)}</Select></Field>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field dark={dark} label="总时长(s)"><Input dark={dark} type="number" min={1} value={state.totalDuration} onChange={event => update({ totalDuration: Number(event.target.value) })} onPointerDown={stop} /></Field>
          <Field dark={dark} label="镜头数量"><Input dark={dark} type="number" min={1} max={30} value={state.shotCount} onChange={event => update({ shotCount: Number(event.target.value) })} onPointerDown={stop} /></Field>
          <Field dark={dark} label="单镜头(s)"><Input dark={dark} type="number" min={1} value={state.durationPerShot} onChange={event => update({ durationPerShot: Number(event.target.value) })} onPointerDown={stop} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field dark={dark} label="平台"><Select dark={dark} value={state.platform} onChange={event => update({ platform: event.target.value })} onPointerDown={stop}>{STICKMAN_PLATFORMS.map(item => <option key={item} value={item}>{item}</option>)}</Select></Field>
          <Field dark={dark} label="节奏"><Select dark={dark} value={state.pace} onChange={event => update({ pace: event.target.value })} onPointerDown={stop}>{STICKMAN_PACES.map(item => <option key={item} value={item}>{item}</option>)}</Select></Field>
        </div>
        <div className={`grid grid-cols-3 gap-1 rounded-xl p-2 text-[10px] ${dark ? 'bg-white/[0.035] text-neutral-400' : 'bg-neutral-50 text-neutral-500'}`}>
          {([
            ['includeDialogue', '对白'], ['includeVoiceover', '旁白'], ['includeAmbience', '环境音'],
            ['includeSfx', '动作音效'], ['includeMusic', '背景音乐'], ['nativeAudio', '原生音频'],
            ['preserveReferenceStructure', '保持参考结构'], ['allowDirectorOptimization', '允许导演优化'],
          ] as const).map(([key, label]) => <label key={key} className="flex items-center gap-1.5"><input type="checkbox" checked={Boolean(state[key])} onChange={() => toggle(key)} onPointerDown={stop} className="accent-cyan-400" />{label}</label>)}
        </div>
        {output && <div className={`flex items-center justify-between rounded-xl border px-3 py-2 text-[10px] ${dark ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}><span className="flex items-center gap-1.5"><Check size={12} />已规划 {output.shots.length} 个镜头</span><span>{output.global.aspectRatio} · {output.global.width}×{output.global.height}</span></div>}
        {state.error && <div className="flex items-start gap-1.5 rounded-xl bg-red-500/10 px-3 py-2 text-[10px] leading-4 text-red-300"><AlertCircle size={12} className="mt-0.5 shrink-0" />{state.error}</div>}
        {sourceType === 'reference_video' && !analysisScriptReady && <div className={`rounded-xl px-3 py-2 text-[10px] leading-4 ${dark ? 'bg-cyan-400/10 text-cyan-200' : 'bg-cyan-50 text-cyan-700'}`}>执行时先分析参考视频并生成剧本，再由火柴人导演 Skill 重新推导镜头。</div>}
        {analysisScriptReady && <div className={`rounded-xl px-3 py-2 text-[10px] leading-4 ${dark ? 'bg-emerald-400/10 text-emerald-200' : 'bg-emerald-50 text-emerald-700'}`}>已生成视频分析剧本；最终分镜仍由火柴人导演 Skill 决定。</div>}
        {locked ? <LockedNodeOverlay dark={dark} /> : <Button dark={dark} tone="primary" className="w-full" disabled={state.status === 'running'} onClick={() => onRun(data.id)} onPointerDown={stop}>{state.status === 'running' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {state.status === 'running' ? '正在规划…' : output ? '重新规划分镜' : '执行火柴人导演 Skill'}</Button>}
        <div className={`flex items-center gap-1.5 text-[10px] ${muted(dark)}`}><ScanSearch size={12} />输入来源：{sourceType === 'reference_video' ? '参考视频（先生成剧本）' : analysisScriptReady ? '视频分析剧本 → 导演 Skill' : '剧本输入'}</div>
      </div>
    </Shell>
  );
};

const ShotCard: React.FC<{
  shot: StickmanShot;
  dark: boolean;
  compareMode: boolean;
  onChange: (patch: Partial<StickmanShot>) => void;
  onPreview: () => void;
  onGenerate: () => void;
  onCancel: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onRecompile: () => void;
  onDragStart: () => void;
  onDrop: () => void;
}> = ({ shot, dark, compareMode, onChange, onPreview, onGenerate, onCancel, onCopy, onDelete, onRecompile, onDragStart, onDrop }) => {
  const [editing, setEditing] = useState(false);
  const hasResult = Boolean(shot.generation.videoUrl);
  const generating = shot.generation.status === 'queued' || shot.generation.status === 'generating';
  const actionLabel = generating
    ? '生成中'
    : hasResult && shot.generation.status === 'completed'
      ? '重新生成'
      : shot.generation.status === 'failed' || shot.generation.status === 'cancelled'
        ? '重试生成'
        : '生成';
  return (
    <div draggable onDragStart={event => { event.stopPropagation(); onDragStart(); }} onDragOver={event => event.preventDefault()} onDrop={event => { event.stopPropagation(); onDrop(); }} className={`rounded-xl border p-3 ${dark ? 'border-white/8 bg-white/[0.025]' : 'border-neutral-200 bg-neutral-50'}`}>
      <div className="flex items-start gap-2">
        <GripVertical size={14} className={`mt-1 shrink-0 cursor-grab ${muted(dark)}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="truncate text-[11px] font-semibold">{String(shot.order).padStart(2, '0')} · {shot.title}</div>
            <span className="flex shrink-0 items-center gap-1.5 text-[10px]"><span className={`${shot.generation.status === 'completed' ? 'text-emerald-400' : shot.generation.status === 'failed' ? 'text-red-400' : muted(dark)}`}>{statusLabel(shot.generation.status)}</span><GenerationElapsed {...shot.generation} className={muted(dark)} /></span>
          </div>
          <div className={`mt-1 line-clamp-2 text-[10px] leading-4 ${muted(dark)}`}>{shot.visual.action || shot.visual.scene}</div>
        </div>
      </div>
      {compareMode && shot.sourceKeyframeUrl && <div className="mt-2 flex items-center gap-2"><img src={shot.sourceKeyframeUrl} className="h-12 w-20 rounded-lg object-cover" alt="原视频关键帧" /><span className={`text-[9px] ${muted(dark)}`}>原视频关键帧 · 预览时可对照结果</span></div>}
      {editing && <div className="mt-2 space-y-2">
        <Field dark={dark} label="镜头标题"><Input dark={dark} value={shot.title} onChange={event => onChange({ title: event.target.value })} onPointerDown={stop} /></Field>
        <Field dark={dark} label="画面描述"><TextArea dark={dark} rows={2} value={shot.visual.scene} onChange={event => onChange({ visual: { ...shot.visual, scene: event.target.value } })} onPointerDown={stop} /></Field>
        <Field dark={dark} label="人物动作"><TextArea dark={dark} rows={2} value={shot.visual.action} onChange={event => onChange({ visual: { ...shot.visual, action: event.target.value } })} onPointerDown={stop} /></Field>
        <Field dark={dark} label="完整 Flow Prompt"><TextArea dark={dark} rows={5} value={shot.prompt} onChange={event => onChange({ prompt: event.target.value })} onPointerDown={stop} /></Field>
      </div>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button dark={dark} onClick={() => setEditing(value => !value)} onPointerDown={stop}>{editing ? <ChevronDown size={12} /> : <Settings2 size={12} />} {editing ? '收起' : '编辑'}</Button>
        <Button dark={dark} onClick={onRecompile} onPointerDown={stop}><RefreshCw size={12} />编译</Button>
        <Button dark={dark} onClick={onCopy} onPointerDown={stop}><Copy size={12} />复制</Button>
        {hasResult && <Button dark={dark} onClick={onPreview} onPointerDown={stop}><Maximize2 size={12} />预览</Button>}
        {generating && <GenerationCancelButton dark={dark} onCancel={onCancel} />}
        <Button dark={dark} tone="primary" disabled={generating} onClick={onGenerate} onPointerDown={stop}>{generating ? <Loader2 size={12} className="animate-spin" /> : hasResult ? <RefreshCw size={12} /> : <Play size={12} />}{actionLabel}</Button>
        <Button dark={dark} tone="danger" onClick={onDelete} onPointerDown={stop}><Trash2 size={12} /></Button>
      </div>
    </div>
  );
};

const ShotPreviewModal: React.FC<{
  shot: StickmanShot;
  dark: boolean;
  compareMode: boolean;
  index: number;
  total: number;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onRegenerate: () => void;
  onCancel: () => void;
}> = ({ shot, dark, compareMode, index, total, onClose, onPrevious, onNext, onRegenerate, onCancel }) => {
  if (!shot.generation.videoUrl || typeof document === 'undefined') return null;
  const generating = shot.generation.status === 'queued' || shot.generation.status === 'generating';
  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="presentation"
      onPointerDown={onClose}
    >
      <div
        className={`w-[min(900px,calc(100vw-32px))] max-h-[92vh] overflow-hidden rounded-3xl border shadow-2xl ${surface(dark)}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="stickman-shot-preview-title"
        onPointerDown={event => event.stopPropagation()}
      >
        <div className={`flex items-center justify-between border-b px-5 py-4 ${dark ? 'border-white/8' : 'border-neutral-200'}`}>
          <div className="min-w-0">
            <div id="stickman-shot-preview-title" className="truncate text-sm font-semibold">{String(shot.order).padStart(2, '0')} · {shot.title}</div>
            <div className={`mt-1 flex items-center gap-2 text-[10px] ${muted(dark)}`}>{index + 1}/{total} · {shot.duration}s · {shot.width}×{shot.height}<GenerationElapsed {...shot.generation} /></div>
          </div>
          <button type="button" aria-label="关闭预览" onClick={onClose} onPointerDown={stop} className={`rounded-xl p-2 ${dark ? 'text-neutral-400 hover:bg-white/10 hover:text-white' : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900'}`}><X size={17} /></button>
        </div>
        <div className="grid max-h-[calc(92vh-154px)] gap-3 overflow-y-auto p-5 md:grid-cols-2">
          {compareMode && shot.sourceKeyframeUrl && <div className={`rounded-2xl border p-3 ${dark ? 'border-white/8 bg-white/[0.025]' : 'border-neutral-200 bg-neutral-50'}`}><div className={`mb-2 text-[10px] ${muted(dark)}`}>原视频关键帧</div><img src={shot.sourceKeyframeUrl} className="max-h-[58vh] w-full rounded-xl bg-black object-contain" alt="原视频关键帧" /></div>}
          <div className={`${compareMode && shot.sourceKeyframeUrl ? '' : 'md:col-span-2'} relative rounded-2xl border p-3 ${dark ? 'border-cyan-400/25 bg-black/30' : 'border-cyan-200 bg-neutral-50'}`}>
            <div className={`mb-2 text-[10px] ${dark ? 'text-cyan-200' : 'text-cyan-700'}`}>当前生成结果</div>
            <video key={shot.generation.videoUrl} src={shot.generation.videoUrl} controls playsInline className="max-h-[58vh] w-full rounded-xl bg-black object-contain" onPointerDown={stop} />
            {generating && <div className="absolute inset-x-3 bottom-3 rounded-xl bg-black/75 px-3 py-2 text-center text-[10px] text-amber-200">正在重新生成，当前仍保留上一版结果</div>}
            {shot.generation.error && <div className="mt-2 rounded-xl bg-red-500/10 px-3 py-2 text-[10px] leading-4 text-red-300">{shot.generation.error}</div>}
          </div>
        </div>
        <div className={`flex flex-wrap items-center justify-between gap-2 border-t px-5 py-4 ${dark ? 'border-white/8' : 'border-neutral-200'}`}>
          <div className="flex items-center gap-1.5">
            <Button dark={dark} disabled={index <= 0} onClick={onPrevious} onPointerDown={stop}><ChevronLeft size={12} />上一个</Button>
            <Button dark={dark} disabled={index >= total - 1} onClick={onNext} onPointerDown={stop}>下一个<ChevronRight size={12} /></Button>
          </div>
          <div className="flex flex-wrap gap-1.5">{generating && <GenerationCancelButton dark={dark} onCancel={onCancel} />}<Button dark={dark} tone="primary" disabled={generating} onClick={onRegenerate} onPointerDown={stop}>{generating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} {generating ? '重新生成中' : '重新生成此镜头'}</Button></div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export const StoryboardNode: React.FC<BaseProps & {
  onGenerateShot: (storyboardId: string, shotId: string) => void;
  onCancelShot?: (storyboardId: string, shotId: string) => void;
}> = props => {
  const { data, onUpdate, allNodes, onGenerateShot, onCancelShot } = props;
  const dark = (props.canvasTheme || 'dark') === 'dark';
  const state = data.storyboard || { shots: [], expanded: false, status: 'idle' as const };
  const [dragId, setDragId] = useState<string | null>(null);
  const [previewShotId, setPreviewShotId] = useState<string | null>(null);
  const director = allNodes.find(node => data.parentIds?.includes(node.id) && node.type === NodeType.STICKMAN_DIRECTOR)?.director;
  const settings = normalizeStickmanSettings(director || {});
  const updateShots = (shots: StickmanShot[]) => onUpdate(data.id, { storyboard: { ...state, shots, status: shots.length ? 'ready' : state.status } });
  const updateShot = (shotId: string, patch: Partial<StickmanShot>) => updateShots(state.shots.map(shot => shot.id === shotId ? { ...shot, ...patch } : shot));
  const reorder = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const list = [...state.shots];
    const from = list.findIndex(shot => shot.id === dragId);
    const to = list.findIndex(shot => shot.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    updateShots(list.map((shot, index) => ({ ...shot, order: index + 1 })));
    setDragId(null);
  };
  const addShot = () => {
    const index = state.shots.length;
    const shot: StickmanShot = {
      id: `shot_${String(index + 1).padStart(2, '0')}`,
      order: index + 1,
      title: `新增镜头 ${index + 1}`,
      duration: settings.durationPerShot,
      aspectRatio: settings.aspectRatio,
      width: settings.width,
      height: settings.height,
      visual: { scene: '简洁极简场景', action: '角色完成清晰连续的动作' },
      audio: { ambience: [], sfx: [] },
      prompt: compileFlowPrompt({ visual: { scene: '简洁极简场景', action: '角色完成清晰连续的动作' }, audio: { ambience: [], sfx: [] }, duration: settings.durationPerShot }, settings),
      generation: { provider: 'flow', status: 'pending', retryCount: 0 },
    };
    updateShots([...state.shots, shot]);
  };
  const completed = state.shots.filter(shot => shot.generation.status === 'completed').length;
  const previewableShots = state.shots.filter(shot => Boolean(shot.generation.videoUrl));
  const previewShot = previewableShots.find(shot => shot.id === previewShotId);
  const previewIndex = previewShot ? previewableShots.findIndex(shot => shot.id === previewShot.id) : -1;
  const movePreview = (offset: number) => {
    if (previewIndex < 0) return;
    const next = previewableShots[previewIndex + offset];
    if (next) setPreviewShotId(next.id);
  };
  useEffect(() => {
    if (!previewShotId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewShotId(null);
      if (event.key === 'ArrowLeft') movePreview(-1);
      if (event.key === 'ArrowRight') movePreview(1);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [previewShotId, state.shots]);
  return (
    <>
      <Shell {...props} icon={<Film size={20} />} label={data.title || (state.compareMode ? '分镜对照组' : '分镜列表')} subtitle={`${state.shots.length} 个镜头 · ${completed} 已生成`} minHeight={state.expanded ? undefined : STICKMAN_STORYBOARD_COLLAPSED_HEIGHT}>
        <div className="space-y-3 px-5 py-4">
          <div className="flex items-center justify-between"><div className="flex items-center gap-1.5 text-[10px] text-cyan-300"><span className="flex gap-1">{state.shots.map(shot => <span key={shot.id} className={`h-2.5 w-2.5 rounded-full ${shot.generation.status === 'completed' ? 'bg-emerald-400' : shot.generation.status === 'failed' ? 'bg-red-400' : shot.generation.status === 'generating' ? 'bg-amber-300' : dark ? 'bg-neutral-700' : 'bg-neutral-300'}`} />)}</span>{completed}/{state.shots.length}</div><Button dark={dark} onClick={() => onUpdate(data.id, { storyboard: { ...state, expanded: !state.expanded } })} onPointerDown={stop}>{state.expanded ? '收起' : '展开'}</Button></div>
          {!state.expanded && <div className={`rounded-xl border px-3 py-3 text-[11px] ${dark ? 'border-white/8 bg-white/[0.025] text-neutral-300' : 'border-neutral-200 bg-neutral-50 text-neutral-600'}`}>{state.shots.length ? state.shots.slice(0, 6).map(shot => <div key={shot.id} className="flex items-center justify-between py-1"><span className="truncate pr-2">{String(shot.order).padStart(2, '0')} · {shot.title}</span><span className={`text-[10px] ${muted(dark)}`}>{statusLabel(shot.generation.status)}</span></div>) : '等待导演节点生成分镜'}</div>}
          {state.expanded && <div className="space-y-2 overflow-y-auto pr-1" style={{ maxHeight: STICKMAN_STORYBOARD_MAX_LIST_HEIGHT }}>{state.shots.map(shot => <ShotCard key={shot.id} shot={shot} dark={dark} compareMode={Boolean(state.compareMode)} onDragStart={() => setDragId(shot.id)} onDrop={() => reorder(shot.id)} onChange={patch => updateShot(shot.id, patch)} onPreview={() => setPreviewShotId(shot.id)} onGenerate={() => onGenerateShot(data.id, shot.id)} onCancel={() => onCancelShot?.(data.id, shot.id)} onCopy={() => void navigator.clipboard?.writeText(shot.prompt)} onRecompile={() => updateShot(shot.id, { prompt: compileFlowPrompt(shot, settings) })} onDelete={() => updateShots(state.shots.filter(item => item.id !== shot.id).map((item, index) => ({ ...item, order: index + 1 })))} />)}</div>}
          <div className="flex flex-wrap gap-1.5"><Button dark={dark} onClick={addShot} onPointerDown={stop}><Plus size={12} />新增</Button><Button dark={dark} onClick={() => void navigator.clipboard?.writeText(state.shots.map(shot => shot.prompt).join('\n\n'))} onPointerDown={stop}><Clipboard size={12} />复制全部</Button><Button dark={dark} onClick={() => void navigator.clipboard?.writeText(JSON.stringify(state.shots, null, 2))} onPointerDown={stop}><Save size={12} />导出 JSON</Button></div>
        </div>
      </Shell>
      {previewShot && <ShotPreviewModal shot={previewShot} dark={dark} compareMode={Boolean(state.compareMode)} index={previewIndex} total={previewableShots.length} onClose={() => setPreviewShotId(null)} onPrevious={() => movePreview(-1)} onNext={() => movePreview(1)} onRegenerate={() => onGenerateShot(data.id, previewShot.id)} onCancel={() => onCancelShot?.(data.id, previewShot.id)} />}
    </>
  );
};

export const FlowBatchVideoNode: React.FC<BaseProps & { onBatchGenerate: (id: string) => void; onRetryFailed: (id: string) => void; onGenerateShot: (storyboardId: string, shotId: string) => void; onCancelShot?: (storyboardId: string, shotId: string) => void; onPauseBatch?: (id: string) => void; onResumeBatch?: (id: string) => void }> = props => {
  const { data, onUpdate, allNodes, onBatchGenerate, onRetryFailed, onGenerateShot, onCancelShot, onPauseBatch, onResumeBatch } = props;
  const dark = (props.canvasTheme || 'dark') === 'dark';
  const [previewShotId, setPreviewShotId] = useState<string | null>(null);
  useGenerationModelRegistry();
  const models = listVideoGenerationProviders();
  const storyboardNode = allNodes.find(node => data.parentIds?.includes(node.id) && (node.type === NodeType.STORYBOARD || node.type === NodeType.STORYBOARD_COMPARE));
  const storyboard = storyboardNode?.storyboard;
  const director = storyboardNode && allNodes.find(node => storyboardNode.parentIds?.includes(node.id) && node.type === NodeType.STICKMAN_DIRECTOR)?.director;
  const state = data.flowBatch || {
    modelId: models[0]?.id,
    concurrency: 2 as const,
    aspectRatio: storyboard?.shots[0]?.aspectRatio || '9:16',
    width: storyboard?.shots[0]?.width || 1080,
    height: storyboard?.shots[0]?.height || 1920,
    duration: storyboard?.shots[0]?.duration || 8,
    resolution: getVideoGenerationProvider(models[0]?.id)?.resolutions?.[0] || 'Auto',
    nativeAudio: true,
    autoRetry: true,
    maxRetries: 1,
    continueOnFailure: true,
    autoMerge: false,
    status: 'idle' as const,
    tasks: [],
  };
  const selectedModel = models.find(model => model.id === state.modelId) || models[0];
  const update = (patch: Partial<typeof state>) => onUpdate(data.id, { flowBatch: { ...state, ...patch } });
  const tasks = state.tasks || [];
  const success = tasks.filter(task => task.status === 'success').length;
  const failed = tasks.filter(task => task.status === 'failed').length;
  const running = tasks.filter(task => task.status === 'generating').length;
  const firstShot = storyboard?.shots[0];
  const directorOutput = director?.output?.global;
  const inheritedAspectRatio = firstShot?.aspectRatio || directorOutput?.aspectRatio || state.aspectRatio;
  const inheritedWidth = firstShot?.width || directorOutput?.width || state.width;
  const inheritedHeight = firstShot?.height || directorOutput?.height || state.height;
  const durations = Array.from(new Set((storyboard?.shots || []).map(shot => shot.duration).filter(value => Number.isFinite(value))));
  const inheritedDuration = durations.length === 1 ? `${durations[0]} 秒/镜头` : durations.length > 1 ? '按分镜设置' : `${state.duration || 8} 秒/镜头`;
  const waiting = (storyboard?.shots || []).filter(shot => shot.generation.status !== 'completed').length;
  const batchButtonLabel = state.status === 'running' ? '生成中…' : state.status === 'paused' ? '队列已暂停' : waiting > 0 ? `生成待处理镜头（${waiting}）` : '全部镜头已生成';
  const generatedShots = (storyboard?.shots || []).filter(shot => Boolean(shot.generation.videoUrl));
  const previewShot = generatedShots.find(shot => shot.id === previewShotId);
  const previewIndex = previewShot ? generatedShots.findIndex(shot => shot.id === previewShot.id) : -1;
  const movePreview = (offset: number) => {
    if (previewIndex < 0) return;
    const next = generatedShots[previewIndex + offset];
    if (next) setPreviewShotId(next.id);
  };
  useEffect(() => {
    if (!previewShotId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewShotId(null);
      if (event.key === 'ArrowLeft') movePreview(-1);
      if (event.key === 'ArrowRight') movePreview(1);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [previewShotId, generatedShots]);
  const showTaskQueue = generatedShots.length === 0 || running > 0 || failed > 0 || waiting > 0;
  return (
    <>
      <Shell {...props} icon={<Play size={20} />} label={data.title || 'Flow 视频生成'} subtitle={`${generatedShots.length || success}/${storyboard?.shots.length || tasks.length || 0} 已完成 · 并发 ${state.concurrency}`} minHeight={FLOW_BATCH_BASE_HEIGHT}>
        <div className="space-y-3 px-5 py-4">
        <div className="grid grid-cols-3 gap-2"><Field dark={dark} label="Flow 视频模型"><Select dark={dark} value={state.modelId || ''} onChange={event => { const modelId = event.target.value; update({ modelId, resolution: getVideoGenerationProvider(modelId)?.resolutions?.[0] || 'Auto' }); }} onPointerDown={stop}>{models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</Select></Field><Field dark={dark} label="模型档位"><Select dark={dark} value={state.resolution || selectedModel?.resolutions?.[0] || 'Auto'} onChange={event => update({ resolution: event.target.value })} onPointerDown={stop}>{(selectedModel?.resolutions || ['Auto']).map(value => <option key={value} value={value}>{value}</option>)}</Select></Field><Field dark={dark} label="并发数量"><Select dark={dark} value={String(state.concurrency)} onChange={event => update({ concurrency: Number(event.target.value) as 1 | 2 | 3 | 4 })} onPointerDown={stop}>{[1, 2, 3, 4].map(value => <option key={value} value={value}>并发 {value}</option>)}</Select></Field></div>
        <div className={`rounded-xl border px-3 py-2.5 ${dark ? 'border-cyan-400/20 bg-cyan-400/[0.06]' : 'border-cyan-200 bg-cyan-50'}`}><div className={`mb-2 flex items-center gap-1.5 text-[10px] ${dark ? 'text-cyan-200' : 'text-cyan-700'}`}><Settings2 size={12} />继承自火柴人导演的生成规格</div><div className="grid grid-cols-3 gap-2 text-[10px]"><div><div className={muted(dark)}>比例</div><div className="mt-1 font-medium">{inheritedAspectRatio}</div></div><div><div className={muted(dark)}>尺寸</div><div className="mt-1 font-medium">{inheritedWidth} × {inheritedHeight}</div></div><div><div className={muted(dark)}>时长</div><div className="mt-1 font-medium">{inheritedDuration}</div></div></div><div className={`mt-2 text-[9px] ${muted(dark)}`}>这里不再修改画幅和时长；修改请回到火柴人导演节点后重新规划分镜。</div></div>
        <div className={`text-[10px] ${muted(dark)}`}>模型能力：{selectedModel?.supportedAspectRatios?.join(' / ') || '比例自动'} · {selectedModel?.resolutions?.join(' / ') || '档位自动'} · {selectedModel?.supportsNativeAudio ? '支持原生音频' : '无原生音频'}</div>
        <div className={`grid grid-cols-3 gap-1 rounded-xl p-2 text-[10px] ${dark ? 'bg-white/[0.035] text-neutral-400' : 'bg-neutral-50 text-neutral-500'}`}><label className="flex items-center gap-1.5"><input type="checkbox" checked={state.nativeAudio} onChange={event => update({ nativeAudio: event.target.checked })} onPointerDown={stop} className="accent-cyan-400" />原生音频</label><label className="flex items-center gap-1.5"><input type="checkbox" checked={state.autoRetry} onChange={event => update({ autoRetry: event.target.checked })} onPointerDown={stop} className="accent-cyan-400" />自动重试</label><label className="flex items-center gap-1.5"><input type="checkbox" checked={state.continueOnFailure} onChange={event => update({ continueOnFailure: event.target.checked })} onPointerDown={stop} className="accent-cyan-400" />失败后继续</label></div>
        {generatedShots.length > 0 && <div className={`rounded-xl border p-3 ${dark ? 'border-emerald-400/20 bg-emerald-400/[0.045]' : 'border-emerald-200 bg-emerald-50'}`}>
          <div className="mb-2 flex items-center justify-between"><span className={`flex items-center gap-1.5 text-[10px] font-medium ${dark ? 'text-emerald-300' : 'text-emerald-700'}`}><Video size={12} />生成结果</span><span className={`text-[10px] ${muted(dark)}`}>{generatedShots.length}/{storyboard?.shots.length || generatedShots.length}</span></div>
          <div className="grid grid-cols-2 gap-2 overflow-y-auto pr-1" style={{ maxHeight: FLOW_BATCH_RESULT_LIST_MAX_HEIGHT }}>
            {generatedShots.map(shot => {
              const generating = shot.generation.status === 'queued' || shot.generation.status === 'generating';
              return <div key={shot.id} className={`overflow-hidden rounded-xl border ${dark ? 'border-white/10 bg-black/25' : 'border-neutral-200 bg-white'}`}>
                <button type="button" className="relative block h-24 w-full overflow-hidden bg-black" onClick={() => setPreviewShotId(shot.id)} onPointerDown={stop} aria-label={`预览 ${shot.title}`}>
                  <LazyVideo src={shot.generation.videoUrl} muted playsInline controls={false} loop={false} className="h-full w-full object-cover" placeholderClassName="h-full w-full bg-black" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity hover:opacity-100"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white"><Play size={14} /></span></span>
                  {generating && <span className="absolute inset-x-1.5 bottom-1.5 rounded-md bg-amber-500/85 px-1.5 py-1 text-[9px] text-black">正在重新生成</span>}
                </button>
                <div className="p-2"><div className="flex items-center justify-between gap-2"><div className="truncate text-[10px] font-medium">{String(shot.order).padStart(2, '0')} · {shot.title}</div><GenerationElapsed {...shot.generation} className={`text-[9px] ${muted(dark)}`} /></div><div className="mt-2 flex flex-wrap gap-1">{generating && <GenerationCancelButton dark={dark} className="flex-1" onCancel={() => storyboardNode && onCancelShot?.(storyboardNode.id, shot.id)} />}<Button dark={dark} className="flex-1 justify-center" onClick={() => setPreviewShotId(shot.id)} onPointerDown={stop}><Maximize2 size={11} />预览</Button><Button dark={dark} className="flex-1 justify-center" disabled={generating} onClick={() => storyboardNode && onGenerateShot(storyboardNode.id, shot.id)} onPointerDown={stop}>{generating ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}重生成</Button></div></div>
              </div>;
            })}
          </div>
        </div>}
        {showTaskQueue && <div className={`rounded-xl border px-3 py-2 text-[10px] ${dark ? 'border-white/8 bg-white/[0.025]' : 'border-neutral-200 bg-neutral-50'}`}><div className="mb-1 flex items-center justify-between"><span className={muted(dark)}>任务队列</span><span className={running ? 'text-amber-300' : failed ? 'text-red-300' : state.status === 'paused' ? 'text-cyan-300' : 'text-emerald-300'}>{running ? `生成中 ${running}` : failed ? `失败 ${failed}` : state.status === 'paused' ? '队列已暂停' : state.status === 'completed' ? '全部完成' : '待执行'}</span></div>{(tasks.length ? tasks : (storyboard?.shots || []).map(shot => ({ shotId: shot.id, taskId: '', status: 'waiting' as const, retryCount: 0 }))).slice(0, 10).map(task => { const shot = storyboard?.shots.find(item => item.id === task.shotId); const generating = task.status === 'generating' || shot?.generation.status === 'generating' || shot?.generation.status === 'queued'; return <div key={task.shotId} className="flex items-center justify-between gap-2 py-1"><span className="truncate pr-2">{String(shot?.order || '')} · {shot?.title || task.shotId}</span><span className="flex shrink-0 items-center gap-1.5"><GenerationElapsed {...(shot?.generation || {})} className={`text-[9px] ${muted(dark)}`} />{generating && storyboardNode && <GenerationCancelButton dark={dark} className="px-2 py-1 text-[9px]" onCancel={() => onCancelShot?.(storyboardNode.id, task.shotId)} />}{task.status === 'success' ? <span className="text-emerald-400">✓</span> : <span className={task.status === 'failed' ? 'text-red-400' : task.status === 'cancelled' ? 'text-neutral-400' : muted(dark)}>{statusLabel(task.status)}</span>}</span></div>; })}</div>}
        {state.error && <div className="flex items-start gap-1.5 rounded-xl bg-red-500/10 px-3 py-2 text-[10px] text-red-300"><AlertCircle size={12} />{state.error}</div>}
        <div className="flex flex-wrap gap-1.5">{state.status === 'running' && <Button dark={dark} onClick={() => onPauseBatch?.(data.id)} onPointerDown={stop}><Pause size={12} />暂停队列</Button>}{state.status === 'paused' && <Button dark={dark} onClick={() => onResumeBatch?.(data.id)} onPointerDown={stop}><Play size={12} />继续队列</Button>}<Button dark={dark} tone="primary" disabled={!storyboard?.shots.length || state.status === 'running' || state.status === 'paused' || waiting === 0} onClick={() => onBatchGenerate(data.id)} onPointerDown={stop}>{state.status === 'running' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}{batchButtonLabel}</Button>{failed > 0 && <Button dark={dark} onClick={() => onRetryFailed(data.id)} onPointerDown={stop}><RotateCcw size={12} />只重试失败项（{failed}）</Button>}</div>
        </div>
      </Shell>
      {previewShot && <ShotPreviewModal shot={previewShot} dark={dark} compareMode={Boolean(storyboard?.compareMode)} index={previewIndex} total={generatedShots.length} onClose={() => setPreviewShotId(null)} onPrevious={() => movePreview(-1)} onNext={() => movePreview(1)} onRegenerate={() => storyboardNode && onGenerateShot(storyboardNode.id, previewShot.id)} onCancel={() => storyboardNode && onCancelShot?.(storyboardNode.id, previewShot.id)} />}
    </>
  );
};

export const VideoMergeNode: React.FC<BaseProps & { onMerge: (id: string) => void }> = props => {
  const { data, onUpdate, allNodes, onMerge } = props;
  const dark = (props.canvasTheme || 'dark') === 'dark';
  const batch = allNodes.find(node => data.parentIds?.includes(node.id) && node.type === NodeType.FLOW_BATCH_VIDEO);
  const storyboard = batch ? allNodes.find(node => batch.parentIds?.includes(node.id) && (node.type === NodeType.STORYBOARD || node.type === NodeType.STORYBOARD_COMPARE))?.storyboard : undefined;
  const state = data.videoMerge || { status: 'idle' as const, outputFormat: 'mp4' as const, fps: 30, skipFailed: true };
  const update = (patch: Partial<typeof state>) => onUpdate(data.id, { videoMerge: { ...state, ...patch } });
  const completed = storyboard?.shots.filter(shot => shot.generation.status === 'completed' && shot.generation.videoUrl).length || 0;
  return (
    <Shell {...props} icon={<Merge size={20} />} label={data.title || '视频拼接'} subtitle={`${completed} 个已完成镜头 · Remotion / FFmpeg`} minHeight={300}>
      <div className="space-y-3 px-5 py-4"><div className="grid grid-cols-2 gap-2"><Field dark={dark} label="输出格式"><Select dark={dark} value={state.outputFormat} onChange={event => update({ outputFormat: event.target.value as 'mp4' | 'mov' | 'webm' })} onPointerDown={stop}><option value="mp4">MP4 · H.264 + AAC</option><option value="mov">MOV</option><option value="webm">WebM</option></Select></Field><Field dark={dark} label="帧率"><Select dark={dark} value={String(state.fps)} onChange={event => update({ fps: Number(event.target.value) })} onPointerDown={stop}><option value="24">24 fps</option><option value="30">30 fps</option><option value="60">60 fps</option></Select></Field></div><label className={`flex items-center gap-2 text-[10px] ${muted(dark)}`}><input type="checkbox" checked={state.skipFailed} onChange={event => update({ skipFailed: event.target.checked })} onPointerDown={stop} className="accent-cyan-400" />跳过失败镜头继续拼接</label>{state.outputUrl && <LazyVideo src={state.outputUrl} loop={false} containerClassName="w-full" className="max-h-48 w-full rounded-xl bg-black object-contain" placeholderClassName="h-48 w-full rounded-xl bg-black" onPointerDown={stop} />}{state.error && <div className="flex items-start gap-1.5 rounded-xl bg-red-500/10 px-3 py-2 text-[10px] text-red-300"><AlertCircle size={12} />{state.error}</div>}<Button dark={dark} tone="primary" className="w-full" disabled={completed === 0 || state.status === 'queued' || state.status === 'rendering'} onClick={() => onMerge(data.id)} onPointerDown={stop}>{state.status === 'queued' || state.status === 'rendering' ? <Loader2 size={13} className="animate-spin" /> : <Merge size={13} />} {state.status === 'success' ? '重新拼接' : '拼接最终视频'}</Button><div className={`text-[10px] ${muted(dark)}`}>{state.status === 'success' ? '成片已保存到当前项目' : state.status === 'failed' ? '拼接失败，可修复镜头后重试' : '按分镜顺序统一输出尺寸、帧率与音频'}</div></div>
    </Shell>
  );
};
