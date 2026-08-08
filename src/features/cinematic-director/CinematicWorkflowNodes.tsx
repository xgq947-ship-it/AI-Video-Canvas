import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Film,
  FileImage,
  Loader2,
  Merge,
  Maximize2,
  Play,
  Pause,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Upload,
  Users,
  Video,
  X,
} from 'lucide-react';
import { NodeConnectors } from '../../components/canvas/NodeConnectors';
import { LazyVideo } from '../../components/LazyVideo';
import { GenerationCancelButton } from '../../components/canvas/GenerationCancelButton';
import { LockedNodeOverlay } from '../../components/LockedNodeOverlay';
import { useNodeLocked } from '../../hooks/useNodeLocked';
import { GenerationElapsed } from '../../components/canvas/GenerationElapsed';
import { NodeData, NodeType } from '../../types';
import type {
  CinematicCastMember,
  CinematicDirectorSettings,
  CinematicShot,
} from '../../../shared/cinematicDirector.js';
import {
  CINEMATIC_ASPECT_RATIOS,
  CINEMATIC_FOVS,
  CINEMATIC_PACES,
  CINEMATIC_PLATFORMS,
  CINEMATIC_RESOLUTION_PRESETS,
  CINEMATIC_SHOT_TYPES,
  CINEMATIC_VISUAL_STYLES,
  getCinematicVideoModel,
  normalizeCinematicSettings,
  validateCinematicReferenceBudget,
} from '../../../shared/cinematicDirector.js';
import { listImageGenerationProviders, listVideoGenerationProviders } from '../../../shared/generationProviders.js';
import { generateCinematicIdentityImages, optimizeCinematicPrompt, recompileCinematicShotPrompt } from './cinematicDirectorService';
import { useCinematicDirectorModels } from './modelOptions';

export const CINEMATIC_NODE_WIDTH = 430;
export const CINEMATIC_CAST_NODE_HEIGHT = 620;
export const CINEMATIC_DIRECTOR_NODE_HEIGHT = 620;
export const CINEMATIC_STORYBOARD_COLLAPSED_HEIGHT = 330;
export const CINEMATIC_STORYBOARD_MAX_LIST_HEIGHT = 680;
export const CINEMATIC_VIDEO_MERGE_NODE_HEIGHT = 300;

export const getCinematicStoryboardNodeHeight = (state?: NodeData['cinematicStoryboard']): number => {
  if (!state?.expanded) return CINEMATIC_STORYBOARD_COLLAPSED_HEIGHT;
  const count = state.shots?.length || 0;
  const listHeight = count ? Math.min(CINEMATIC_STORYBOARD_MAX_LIST_HEIGHT, Math.max(180, count * 260)) : 180;
  return Math.max(480, 260 + listHeight);
};

type Theme = 'dark' | 'light';

interface BaseProps {
  data: NodeData;
  allNodes: NodeData[];
  selected: boolean;
  workflowId?: string;
  canvasTheme?: Theme;
  onUpdate: (id: string, updates: Partial<NodeData>) => void;
  onNodePointerDown: (event: React.PointerEvent, id: string) => void;
  onContextMenu: (event: React.MouseEvent, id: string) => void;
  onConnectorDown: (event: React.PointerEvent, id: string, side: 'left' | 'right', portId?: string) => void;
}

const stop = (event: React.SyntheticEvent) => event.stopPropagation();
const surface = (dark: boolean) => dark ? 'border-neutral-700 bg-[#101112] text-white' : 'border-neutral-200 bg-white text-neutral-900';
const muted = (dark: boolean) => dark ? 'text-neutral-500' : 'text-neutral-500';
const field = (dark: boolean) => dark
  ? 'border-white/10 bg-white/[0.05] text-neutral-100 placeholder:text-neutral-600'
  : 'border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-400';

const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { dark: boolean; tone?: 'primary' | 'quiet' | 'danger' }> = ({ dark, tone = 'quiet', className = '', children, ...props }) => (
  <button
    type="button"
    {...props}
    className={`inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-2 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
      tone === 'primary' ? 'border-cyan-400/40 bg-cyan-400/15 text-cyan-200 hover:bg-cyan-400/25' : tone === 'danger' ? 'border-red-400/30 bg-red-500/10 text-red-300 hover:bg-red-500/20' : dark ? 'border-white/10 bg-white/[0.04] text-neutral-300 hover:bg-white/[0.09]' : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
    } ${className}`}
  >{children}</button>
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
const Field: React.FC<{ dark: boolean; label: string; children: React.ReactNode; className?: string }> = ({ dark, label, children, className = '' }) => (
  <label className={`block ${className}`}><span className={`mb-1 block text-[10px] ${muted(dark)}`}>{label}</span>{children}</label>
);

const Shell: React.FC<BaseProps & { icon: React.ReactNode; label: string; subtitle: string; children: React.ReactNode; minHeight?: number }> = ({
  data, selected, canvasTheme = 'dark', icon, label, subtitle, children, onNodePointerDown, onContextMenu, onConnectorDown, minHeight = 0,
}) => {
  const dark = canvasTheme === 'dark';
  return (
    <div data-node-id={data.id} className="group/node absolute touch-none pointer-events-auto" style={{ transform: `translate(${data.x}px, ${data.y}px)`, zIndex: selected ? 50 : 10 }} onPointerDown={event => onNodePointerDown(event, data.id)} onContextMenu={event => onContextMenu(event, data.id)}>
      <NodeConnectors nodeId={data.id} onConnectorDown={onConnectorDown} canvasTheme={canvasTheme} />
      <div className={`overflow-hidden rounded-[22px] border shadow-2xl ${surface(dark)} ${selected ? 'border-cyan-400 ring-1 ring-cyan-400/30' : ''}`} style={{ width: CINEMATIC_NODE_WIDTH, ...(minHeight ? { minHeight } : {}) }}>
        <div className={`flex items-center gap-3 border-b px-5 py-4 ${dark ? 'border-white/8' : 'border-neutral-100'}`}>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-cyan-400/15 text-cyan-300">{icon}</div>
          <div className="min-w-0"><div className="truncate text-sm font-semibold">{label}</div><div className={`mt-0.5 truncate text-[11px] ${muted(dark)}`}>{subtitle}</div></div>
        </div>
        {children}
      </div>
    </div>
  );
};

const statusLabel = (status?: string) => ({ pending: '等待', queued: '排队', generating: '生成中', paused: '已暂停', completed: '已完成', failed: '失败', cancelled: '已取消', submission_unknown: '待恢复' }[status || 'pending'] || status || '等待');

const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
  reader.readAsDataURL(file);
});

const castDefaults = (data: NodeData): NonNullable<NodeData['cinematicCast']> => data.cinematicCast || {
  characters: [{ id: 'CAST_01', name: '主角', role: 'protagonist', description: '', referenceImages: [] }],
  videoModel: 'google-flow-omni-flash',
};

export const CinematicCastNode: React.FC<BaseProps> = props => {
  const { data, allNodes, workflowId, onUpdate } = props;
  const dark = (props.canvasTheme || 'dark') === 'dark';
  const state = castDefaults(data);
  const [selectedId, setSelectedId] = useState(state.characters[0]?.id || '');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [library, setLibrary] = useState<Array<{ id: string; name?: string; url: string; type?: string }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(state.error || '');
  const uploadRef = useRef<HTMLInputElement>(null);
  const selected = state.characters.find(character => character.id === selectedId) || state.characters[0];
  const director = allNodes.find(node => node.type === NodeType.CINEMATIC_DIRECTOR && node.parentIds?.includes(data.id));
  const videoModel = director?.cinematicDirector?.videoModel || state.videoModel || 'google-flow-omni-flash';
  const budget = validateCinematicReferenceBudget(state.characters, videoModel);
  const imageModels = listImageGenerationProviders().filter(model => model.supportsImageToImage);

  const update = (patch: Partial<typeof state>) => onUpdate(data.id, { cinematicCast: { ...state, ...patch, error: undefined } });
  const updateCharacter = (id: string, patch: Partial<CinematicCastMember>) => update({ characters: state.characters.map(character => character.id === id ? { ...character, ...patch } : character) });
  const addCharacter = () => {
    const id = `CAST_${String(state.characters.length + 1).padStart(2, '0')}`;
    const character: CinematicCastMember = { id, name: `配角 ${state.characters.length}`, role: 'supporting', description: '', referenceImages: [] };
    update({ characters: [...state.characters, character] });
    setSelectedId(id);
  };
  const removeCharacter = (id: string) => {
    if (state.characters.length <= 1) return;
    const next = state.characters.filter(character => character.id !== id);
    update({ characters: next });
    setSelectedId(next[0]?.id || '');
  };
  const addReference = (url: string, source: 'upload' | 'library', label: string) => {
    if (!selected || !url) return;
    if (selected.referenceImages.length >= 3) { setError(`${selected.name} 最多保留 3 张角色参考图`); return; }
    const reference = { id: `${selected.id}-ref-${crypto.randomUUID()}`, url, source, label };
    updateCharacter(selected.id, { referenceImages: [...selected.referenceImages, reference] });
  };
  const upload = async (file: File) => {
    if (!selected || !workflowId) { setError('请先打开项目后上传角色参考图'); return; }
    setBusy('upload'); setError('');
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const response = await fetch('/api/assets/images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: dataUrl, prompt: `${selected.name} 角色参考图`, originalFilename: file.name, mimeType: file.type, workflowId }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.url) throw new Error(result.error || '角色参考图上传失败');
      addReference(String(result.url), 'upload', file.name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '角色参考图上传失败');
    } finally { setBusy(null); }
  };
  const openLibrary = async () => {
    setLibraryOpen(value => !value);
    if (library.length) return;
    try {
      const response = await fetch('/api/library', { cache: 'no-store' });
      const result = await response.json().catch(() => []);
      const items = Array.isArray(result) ? result : result.assets;
      setLibrary(Array.isArray(items) ? items.filter(item => item?.url && (!item.type || item.type === 'image')) : []);
    } catch { setError('素材库读取失败'); }
  };
  const generateIdentity = async () => {
    if (!selected || !workflowId) { setError('请先打开项目后生成角色设定图'); return; }
    setBusy(selected.id); setError('');
    try {
      const refs = await generateCinematicIdentityImages({ workflowId, nodeId: data.id, character: selected, imageModel: state.imageProvider || 'google-flow-nano-banana-pro' });
      updateCharacter(selected.id, { referenceImages: [...selected.referenceImages.filter(reference => reference.source !== 'ai'), ...refs].slice(0, 3) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI 角色设定图生成失败');
    } finally { setBusy(null); }
  };
  return (
    <Shell {...props} icon={<Users size={20} />} label={data.title || '角色设定'} subtitle={`${state.characters.length} 个角色 · ${budget.count}/${budget.maxReferenceImages} 张视频参考图`} minHeight={CINEMATIC_CAST_NODE_HEIGHT}>
      <div className="space-y-3 px-5 py-4">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {state.characters.map(character => <button key={character.id} type="button" onClick={() => setSelectedId(character.id)} onPointerDown={stop} className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[10px] ${selected?.id === character.id ? 'border-cyan-400/50 bg-cyan-400/15 text-cyan-200' : dark ? 'border-white/10 text-neutral-400' : 'border-neutral-200 text-neutral-500'}`}>{character.name}</button>)}
          <Button dark={dark} className="shrink-0 px-2" onClick={addCharacter} onPointerDown={stop}><Plus size={12} />角色</Button>
        </div>
        {selected && <>
          <div className="grid grid-cols-[1fr_112px] gap-2"><Field dark={dark} label="角色名"><Input dark={dark} value={selected.name} onChange={event => updateCharacter(selected.id, { name: event.target.value })} onPointerDown={stop} /></Field><Field dark={dark} label="身份"><Select dark={dark} value={selected.role} onChange={event => updateCharacter(selected.id, { role: event.target.value as CinematicCastMember['role'] })} onPointerDown={stop}><option value="protagonist">主角</option><option value="supporting">配角</option></Select></Field></div>
          <Field dark={dark} label="外观描述"><TextArea dark={dark} rows={3} value={selected.description} placeholder="年龄、脸型、发型、服装、固定配件…" onChange={event => updateCharacter(selected.id, { description: event.target.value })} onPointerDown={stop} /></Field>
          <div className="flex flex-wrap gap-1.5">
            <Button dark={dark} tone="primary" disabled={Boolean(busy)} onClick={generateIdentity} onPointerDown={stop}>{busy === selected.id ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}AI 生成正面照 + 设定板</Button>
            <Button dark={dark} disabled={busy === 'upload'} onClick={() => uploadRef.current?.click()} onPointerDown={stop}><Upload size={12} />上传</Button>
            <Button dark={dark} onClick={openLibrary} onPointerDown={stop}><FileImage size={12} />素材库</Button>
            {state.characters.length > 1 && <Button dark={dark} tone="danger" onClick={() => removeCharacter(selected.id)} onPointerDown={stop}><Trash2 size={12} />移除</Button>}
            <input ref={uploadRef} type="file" accept="image/*" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} />
          </div>
          <Field dark={dark} label="AI 设定图模型"><Select dark={dark} value={state.imageProvider || 'google-flow-nano-banana-pro'} onChange={event => update({ imageProvider: event.target.value })} onPointerDown={stop}>{imageModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</Select></Field>
          {libraryOpen && <div className={`grid max-h-36 grid-cols-4 gap-1.5 overflow-y-auto rounded-xl border p-2 ${dark ? 'border-white/10 bg-white/[0.03]' : 'border-neutral-200 bg-neutral-50'}`}>{library.length ? library.map(asset => <button key={asset.id || asset.url} type="button" title={asset.name} onClick={() => addReference(asset.url, 'library', asset.name || '素材库参考图')} onPointerDown={stop}><img src={asset.url} alt={asset.name || '素材'} className="h-16 w-full rounded-lg object-cover" /></button>) : <span className={`col-span-4 p-2 text-[10px] ${muted(dark)}`}>素材库暂无图片</span>}</div>}
          <div className="grid grid-cols-3 gap-2">
            {selected.referenceImages.map(reference => <div key={reference.id} className={`group relative overflow-hidden rounded-xl border ${dark ? 'border-white/10 bg-black/20' : 'border-neutral-200 bg-neutral-50'}`}><img src={reference.url} alt={reference.label} className="h-20 w-full object-cover" /><span className={`block truncate px-1.5 py-1 text-[9px] ${muted(dark)}`}>{reference.source === 'ai' ? 'AI' : reference.source === 'library' ? '素材库' : '上传'} · {reference.label}</span><button type="button" onClick={() => updateCharacter(selected.id, { referenceImages: selected.referenceImages.filter(item => item.id !== reference.id) })} onPointerDown={stop} className="absolute right-1 top-1 rounded-md bg-black/70 p-1 text-white opacity-0 group-hover:opacity-100"><Trash2 size={10} /></button></div>)}
            {!selected.referenceImages.length && <div className={`col-span-3 rounded-xl border border-dashed p-4 text-center text-[10px] ${dark ? 'border-white/10 text-neutral-600' : 'border-neutral-200 text-neutral-400'}`}>至少准备一张身份参考图；AI 默认生成正面照和全身综合设定板</div>}
          </div>
        </>}
        {budget.errors.length > 0 && <div className="flex items-start gap-1.5 rounded-xl bg-red-500/10 px-3 py-2 text-[10px] text-red-300"><AlertCircle size={12} />{budget.errors[0]}</div>}
        {error && <div className="flex items-start gap-1.5 rounded-xl bg-red-500/10 px-3 py-2 text-[10px] text-red-300"><AlertCircle size={12} />{error}</div>}
      </div>
    </Shell>
  );
};

const directorDefaults = normalizeCinematicSettings({});

export const CinematicDirectorNode: React.FC<BaseProps & { onRun: (id: string) => void }> = props => {
  const { data, allNodes, onUpdate, onRun } = props;
  const dark = (props.canvasTheme || 'dark') === 'dark';
  const locked = useNodeLocked(data.type);
  const { models, loading } = useCinematicDirectorModels();
  const state = normalizeCinematicSettings(data.cinematicDirector || directorDefaults) as typeof directorDefaults & CinematicDirectorSettings;
  const videoModels = listVideoGenerationProviders().filter(model => model.id === 'google-flow-omni-flash' || model.id === 'jimeng-seedance-2-0');
  const selectedModel = getCinematicVideoModel(state.videoModel);
  const unsupportedAspect = Boolean(selectedModel && !selectedModel.supportedAspectRatios?.includes(state.aspectRatio));
  const castNode = allNodes.find(node => data.parentIds?.includes(node.id) && node.type === NodeType.CINEMATIC_CAST);
  const cast = castNode?.cinematicCast?.characters || [];
  const budget = validateCinematicReferenceBudget(cast, state.videoModel);
  const update = (patch: Partial<CinematicDirectorSettings>) => onUpdate(data.id, { cinematicDirector: { ...state, ...normalizeCinematicSettings({ ...state, ...patch }), provider: state.provider || 'auto', status: data.cinematicDirector?.status || 'idle', output: data.cinematicDirector?.output, error: undefined } });
  const resolutions = CINEMATIC_RESOLUTION_PRESETS[state.aspectRatio as keyof typeof CINEMATIC_RESOLUTION_PRESETS] || [];
  return (
    <Shell {...props} icon={<Film size={20} />} label={data.title || '电影短片导演'} subtitle={data.cinematicDirector?.status === 'running' ? '导演 Skill 执行中…' : `${state.shotCount} 镜头 · ${state.totalDuration} 秒 · ${selectedModel?.name || state.videoModel}`} minHeight={CINEMATIC_DIRECTOR_NODE_HEIGHT}>
      <div className="space-y-3 px-5 py-4">
        <div className="grid grid-cols-2 gap-2"><Field dark={dark} label="导演执行模型"><Select dark={dark} value={state.provider || 'auto'} onChange={event => update({ provider: event.target.value })} onPointerDown={stop}><option value="auto">自动选择</option>{models.map(model => <option key={model.id} value={model.id}>{model.name}{!model.available ? ' · 未登录' : ''}</option>)}</Select></Field><Field dark={dark} label="运行状态"><div className={`flex h-8 items-center rounded-lg border px-2.5 text-[10px] ${field(dark)}`}>{loading ? '正在读取模型…' : data.cinematicDirector?.status === 'completed' ? '已完成，可重新执行' : data.cinematicDirector?.status === 'failed' ? '失败，可重试' : '等待执行'}</div></Field></div>
        <div className="grid grid-cols-2 gap-2"><Field dark={dark} label="视觉风格"><Select dark={dark} value={state.visualStyle} onChange={event => update({ visualStyle: event.target.value })} onPointerDown={stop}>{CINEMATIC_VISUAL_STYLES.map(style => <option key={style.id} value={style.id}>{style.label}</option>)}</Select></Field><Field dark={dark} label="目标平台"><Select dark={dark} value={state.platform} onChange={event => update({ platform: event.target.value })} onPointerDown={stop}>{CINEMATIC_PLATFORMS.map(platform => <option key={platform} value={platform}>{platform}</option>)}</Select></Field></div>
        {state.visualStyle === 'custom' && <Field dark={dark} label="自定义风格"><Input dark={dark} value={state.customVisualStyle} onChange={event => update({ customVisualStyle: event.target.value })} onPointerDown={stop} /></Field>}
        <div className="grid grid-cols-3 gap-2"><Field dark={dark} label="画幅"><Select dark={dark} value={state.aspectRatio} onChange={event => update({ aspectRatio: event.target.value })} onPointerDown={stop}>{CINEMATIC_ASPECT_RATIOS.map(ratio => <option key={ratio} value={ratio}>{ratio}</option>)}</Select></Field><Field dark={dark} label="分辨率"><Select dark={dark} value={`${state.width}x${state.height}`} onChange={event => { const [width, height] = event.target.value.split('x').map(Number); update({ width, height }); }} onPointerDown={stop}>{resolutions.map(resolution => <option key={`${resolution.width}x${resolution.height}`} value={`${resolution.width}x${resolution.height}`}>{resolution.label}</option>)}</Select></Field><Field dark={dark} label="节奏"><Select dark={dark} value={state.pace} onChange={event => update({ pace: event.target.value })} onPointerDown={stop}>{CINEMATIC_PACES.map(pace => <option key={pace} value={pace}>{pace}</option>)}</Select></Field></div>
        <div className="grid grid-cols-3 gap-2"><Field dark={dark} label="总时长（秒）"><Input dark={dark} type="number" min={4} max={600} value={state.totalDuration} onChange={event => update({ totalDuration: Number(event.target.value) })} onPointerDown={stop} /></Field><Field dark={dark} label="镜头数量"><Input dark={dark} type="number" min={1} max={30} value={state.shotCount} onChange={event => update({ shotCount: Number(event.target.value) })} onPointerDown={stop} /></Field><Field dark={dark} label="每镜头（秒）"><Input dark={dark} type="number" min={4} max={15} value={state.durationPerShot} onChange={event => update({ durationPerShot: Number(event.target.value) })} onPointerDown={stop} /></Field></div>
        <Field dark={dark} label="视频生成模型"><Select dark={dark} value={state.videoModel} onChange={event => update({ videoModel: event.target.value })} onPointerDown={stop}>{videoModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</Select></Field>
        <div className={`grid grid-cols-2 gap-2 rounded-xl border px-3 py-2.5 text-[10px] ${dark ? 'border-cyan-400/20 bg-cyan-400/[0.06]' : 'border-cyan-200 bg-cyan-50'}`}><div><div className={muted(dark)}>模型能力</div><div className="mt-1">{selectedModel?.supportedAspectRatios?.join(' / ')} · {selectedModel?.supportedDurations?.join('/') || '自动'} 秒</div></div><div><div className={muted(dark)}>原生音频</div><div className="mt-1 text-cyan-200">{state.audioEnabled ? '随模型开启' : '关闭 / 模型不支持'}</div></div></div>
        {budget.errors.length > 0 && <div className="rounded-xl bg-red-500/10 px-3 py-2 text-[10px] text-red-300">{budget.errors[0]}</div>}
        {unsupportedAspect && <div className="rounded-xl bg-amber-500/10 px-3 py-2 text-[10px] text-amber-200">{selectedModel?.name} 不支持 {state.aspectRatio}；请切换为 16:9 / 9:16，或改用即梦 Seedance 2.0。</div>}
        {data.cinematicDirector?.error && <div className="rounded-xl bg-red-500/10 px-3 py-2 text-[10px] leading-4 text-red-300">{data.cinematicDirector.error}</div>}
        {locked ? <LockedNodeOverlay dark={dark} /> : <Button dark={dark} tone="primary" className="w-full" disabled={data.cinematicDirector?.status === 'running' || unsupportedAspect} onClick={() => onRun(data.id)} onPointerDown={stop}>{data.cinematicDirector?.status === 'running' ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}执行电影导演 Skill</Button>}
        <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[10px] ${dark ? 'bg-white/[0.04] text-neutral-400' : 'bg-neutral-50 text-neutral-500'}`}><Check size={12} className="text-emerald-400" />输入剧本与角色参考图后，生成可编辑的导演分镜 JSON</div>
      </div>
    </Shell>
  );
};

const storyboardDefaults = (data: NodeData): NonNullable<NodeData['cinematicStoryboard']> => data.cinematicStoryboard || { shots: [], cast: [], expanded: false, concurrency: 2, status: 'idle' };

export const CinematicStoryboardNode: React.FC<BaseProps & { onGenerateShot: (storyboardId: string, shotId: string) => void; onBatchGenerate: (id: string) => void; onRetryFailed: (id: string) => void; onCancelShot?: (storyboardId: string, shotId: string) => void; onPauseBatch?: (id: string) => void; onResumeBatch?: (id: string) => void }> = props => {
  const { data, allNodes, onUpdate, onGenerateShot, onBatchGenerate, onRetryFailed, onCancelShot, onPauseBatch, onResumeBatch } = props;
  const dark = (props.canvasTheme || 'dark') === 'dark';
  const stored = storyboardDefaults(data);
  const directorNode = allNodes.find(node => data.parentIds?.includes(node.id) && node.type === NodeType.CINEMATIC_DIRECTOR);
  const settings = normalizeCinematicSettings(directorNode?.cinematicDirector || {});
  const directorOutput = directorNode?.cinematicDirector?.output;
  // App.tsx persists the director output into this node when the pipeline is
  // created. Keep the node's own state authoritative afterwards so deleting
  // every shot is not undone by a still-present director output.
  const state = stored;
  const [optimizing, setOptimizing] = useState<string | null>(null);
  const [previewShotId, setPreviewShotId] = useState<string | null>(null);
  const [error, setError] = useState(state.error || '');
  const update = (patch: Partial<typeof state>) => onUpdate(data.id, { cinematicStoryboard: { ...state, ...patch } });
  const updateShot = (id: string, patch: Partial<CinematicShot>) => update({ shots: state.shots.map(shot => shot.id === id ? { ...shot, ...patch } : shot) });
  const completed = state.shots.filter(shot => shot.generation.status === 'completed' && shot.generation.videoUrl).length;
  const failed = state.shots.filter(shot => shot.generation.status === 'failed').length;
  const waiting = state.shots.filter(shot => shot.generation.status !== 'completed').length;
  const running = state.shots.filter(shot => ['queued', 'generating'].includes(shot.generation.status)).length;
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
  }, [previewShotId, previewableShots]);
  const optimize = async (shot: CinematicShot) => {
    setOptimizing(shot.id); setError('');
    try { updateShot(shot.id, { prompt: await optimizeCinematicPrompt({ prompt: shot.prompt, videoModel: settings.videoModel, aspectRatio: settings.aspectRatio, duration: shot.duration }) }); } catch (cause) { setError(cause instanceof Error ? cause.message : '提示词优化失败'); } finally { setOptimizing(null); }
  };
  return (
    <>
      <Shell {...props} icon={<Film size={20} />} label={data.title || '电影分镜'} subtitle={`${state.shots.length} 个镜头 · ${completed} 已生成`} minHeight={state.expanded ? undefined : CINEMATIC_STORYBOARD_COLLAPSED_HEIGHT}>
      <div className="space-y-3 px-5 py-4">
        <div className="space-y-2"><div className="min-w-0 truncate text-[10px] text-cyan-300">{completed}/{state.shots.length} 已完成 · {running ? `运行 ${running}` : statusLabel(state.status)}</div><div className="flex w-full items-center justify-end gap-1.5"><Select aria-label="并发数量" dark={dark} className="w-[104px] shrink-0" value={String(state.concurrency)} onChange={event => update({ concurrency: Number(event.target.value) as 1 | 2 | 3 | 4 })} onPointerDown={stop}><option value="1">并发 1</option><option value="2">并发 2</option><option value="3">并发 3</option><option value="4">并发 4</option></Select><Button dark={dark} className="min-w-[76px] shrink-0" aria-expanded={state.expanded} onClick={() => update({ expanded: !state.expanded })} onPointerDown={stop}>{state.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{state.expanded ? '收起' : '展开'}</Button></div></div>
        {!state.expanded && <div className={`rounded-xl border px-3 py-3 text-[10px] ${dark ? 'border-white/8 bg-white/[0.025] text-neutral-300' : 'border-neutral-200 bg-neutral-50 text-neutral-600'}`}>{state.shots.length ? state.shots.slice(0, 8).map(shot => <div key={shot.id} className="flex items-center justify-between gap-2 py-1"><span className="truncate">{String(shot.order).padStart(2, '0')} · {shot.title}</span><span className="flex shrink-0 items-center gap-1.5"><GenerationElapsed {...shot.generation} className={`text-[9px] ${muted(dark)}`} /><span className={shot.generation.status === 'completed' ? 'text-emerald-400' : shot.generation.status === 'failed' ? 'text-red-400' : muted(dark)}>{statusLabel(shot.generation.status)}</span></span></div>) : '等待导演节点生成分镜 JSON'}</div>}
        {state.expanded && <div className="space-y-2 overflow-y-auto pr-1" style={{ maxHeight: CINEMATIC_STORYBOARD_MAX_LIST_HEIGHT }}>{state.shots.map(shot => <CinematicShotCard key={shot.id} shot={shot} cast={state.cast} dark={dark} optimizing={optimizing === shot.id} onChange={patch => updateShot(shot.id, patch)} onPreview={() => setPreviewShotId(shot.id)} onCancel={() => onCancelShot?.(data.id, shot.id)} onRecompile={() => updateShot(shot.id, { prompt: recompileCinematicShotPrompt(shot, settings, state.cast) })} onOptimize={() => void optimize(shot)} onGenerate={() => onGenerateShot(data.id, shot.id)} onDelete={() => update({ shots: state.shots.filter(item => item.id !== shot.id).map((item, index) => ({ ...item, order: index + 1 })) })} />)}</div>}
        {error && <div className="flex items-start gap-1.5 rounded-xl bg-red-500/10 px-3 py-2 text-[10px] text-red-300"><AlertCircle size={12} />{error}</div>}
        <div className="flex flex-wrap gap-1.5"><Button dark={dark} onClick={() => void navigator.clipboard?.writeText(JSON.stringify({ version: '1.0', global: directorOutput?.global || settings, cast: state.cast, shots: state.shots }, null, 2))} onPointerDown={stop}><Save size={12} />导出 JSON</Button>{state.status === 'generating' && <Button dark={dark} onClick={() => onPauseBatch?.(data.id)} onPointerDown={stop}><Pause size={12} />暂停队列</Button>}{state.status === 'paused' && <Button dark={dark} onClick={() => onResumeBatch?.(data.id)} onPointerDown={stop}><Play size={12} />继续队列</Button>}<Button dark={dark} tone="primary" disabled={!state.shots.length || state.status === 'generating' || state.status === 'paused' || waiting === 0} onClick={() => onBatchGenerate(data.id)} onPointerDown={stop}><Play size={12} />批量生成待处理镜头（{waiting}）</Button>{failed > 0 && <Button dark={dark} onClick={() => onRetryFailed(data.id)} onPointerDown={stop}><RefreshCw size={12} />只重试失败项（{failed}）</Button>}</div>
      </div>
      </Shell>
      {previewShot && <CinematicShotPreviewModal shot={previewShot} dark={dark} index={previewIndex} total={previewableShots.length} onClose={() => setPreviewShotId(null)} onPrevious={() => movePreview(-1)} onNext={() => movePreview(1)} onRegenerate={() => onGenerateShot(data.id, previewShot.id)} onCancel={() => onCancelShot?.(data.id, previewShot.id)} />}
    </>
  );
};

const CinematicShotPreviewModal: React.FC<{ shot: CinematicShot; dark: boolean; index: number; total: number; onClose: () => void; onPrevious: () => void; onNext: () => void; onRegenerate: () => void; onCancel: () => void }> = ({ shot, dark, index, total, onClose, onPrevious, onNext, onRegenerate, onCancel }) => {
  if (!shot.generation.videoUrl || typeof document === 'undefined') return null;
  const generating = shot.generation.status === 'queued' || shot.generation.status === 'generating';
  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" role="presentation" onPointerDown={onClose}>
      <div className={`w-[min(960px,calc(100vw-32px))] max-h-[92vh] overflow-hidden rounded-3xl border shadow-2xl ${surface(dark)}`} role="dialog" aria-modal="true" aria-labelledby="cinematic-shot-preview-title" onPointerDown={event => event.stopPropagation()}>
        <div className={`flex items-center justify-between border-b px-5 py-4 ${dark ? 'border-white/8' : 'border-neutral-200'}`}><div className="min-w-0"><div id="cinematic-shot-preview-title" className="truncate text-sm font-semibold">{String(shot.order).padStart(2, '0')} · {shot.title}</div><div className={`mt-1 flex items-center gap-2 text-[10px] ${muted(dark)}`}>{index + 1}/{total} · {shot.duration}s · {shot.width}×{shot.height}<GenerationElapsed {...shot.generation} /></div></div><button type="button" aria-label="关闭预览" onClick={onClose} onPointerDown={stop} className={`rounded-xl p-2 ${dark ? 'text-neutral-400 hover:bg-white/10 hover:text-white' : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900'}`}><X size={17} /></button></div>
        <div className="grid max-h-[calc(92vh-154px)] gap-3 overflow-y-auto p-5 md:grid-cols-[minmax(0,1.25fr)_minmax(240px,0.75fr)]"><div className={`relative rounded-2xl border p-3 ${dark ? 'border-cyan-400/25 bg-black/30' : 'border-cyan-200 bg-neutral-50'}`}><div className={`mb-2 text-[10px] ${dark ? 'text-cyan-200' : 'text-cyan-700'}`}>当前生成结果</div><video key={shot.generation.videoUrl} src={shot.generation.videoUrl} controls playsInline className="max-h-[58vh] w-full rounded-xl bg-black object-contain" onPointerDown={stop} />{generating && <div className="absolute inset-x-3 bottom-3 rounded-xl bg-black/75 px-3 py-2 text-center text-[10px] text-amber-200">正在重新生成，当前仍保留上一版结果</div>}</div><div className={`space-y-3 rounded-2xl border p-4 text-[10px] leading-5 ${dark ? 'border-white/8 bg-white/[0.025] text-neutral-300' : 'border-neutral-200 bg-neutral-50 text-neutral-700'}`}><div><div className={`mb-1 ${muted(dark)}`}>场景</div><div>{shot.scene}</div></div><div><div className={`mb-1 ${muted(dark)}`}>动作 / 表演</div><div>{shot.action}</div></div><div><div className={`mb-1 ${muted(dark)}`}>视频提示词</div><div className="max-h-40 overflow-y-auto whitespace-pre-wrap">{shot.prompt}</div></div>{shot.generation.error && <div className="rounded-xl bg-red-500/10 px-3 py-2 text-red-300">{shot.generation.error}</div>}</div></div>
        <div className={`flex flex-wrap items-center justify-between gap-2 border-t px-5 py-4 ${dark ? 'border-white/8' : 'border-neutral-200'}`}><div className="flex items-center gap-1.5"><Button dark={dark} disabled={index <= 0} onClick={onPrevious} onPointerDown={stop}><ChevronLeft size={12} />上一个</Button><Button dark={dark} disabled={index >= total - 1} onClick={onNext} onPointerDown={stop}>下一个<ChevronRight size={12} /></Button></div><div className="flex flex-wrap gap-1.5">{generating && <GenerationCancelButton dark={dark} onCancel={onCancel} />}<Button dark={dark} tone="primary" disabled={generating} onClick={onRegenerate} onPointerDown={stop}>{generating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} {generating ? '重新生成中' : '重新生成此镜头'}</Button></div></div>
      </div>
    </div>,
    document.body,
  );
};

const CinematicShotCard: React.FC<{ shot: CinematicShot; cast: CinematicCastMember[]; dark: boolean; optimizing: boolean; onChange: (patch: Partial<CinematicShot>) => void; onPreview: () => void; onCancel: () => void; onRecompile: () => void; onOptimize: () => void; onGenerate: () => void; onDelete: () => void }> = ({ shot, cast, dark, optimizing, onChange, onPreview, onCancel, onRecompile, onOptimize, onGenerate, onDelete }) => {
  const participants = cast.filter(member => shot.cast.includes(member.id)).map(member => member.name).join('、');
  const generating = shot.generation.status === 'queued' || shot.generation.status === 'generating';
  return <div className={`rounded-xl border p-3 ${dark ? 'border-white/8 bg-white/[0.025]' : 'border-neutral-200 bg-neutral-50'}`}>
    <div className="flex items-center justify-between gap-2"><div className="truncate text-[11px] font-semibold">{String(shot.order).padStart(2, '0')} · {shot.title}</div><span className="flex shrink-0 items-center gap-1.5 text-[10px]"><span className={shot.generation.status === 'completed' ? 'text-emerald-400' : shot.generation.status === 'failed' ? 'text-red-400' : muted(dark)}>{statusLabel(shot.generation.status)}</span><GenerationElapsed {...shot.generation} className={muted(dark)} /></span></div>
    <div className="mt-2 grid grid-cols-[1fr_70px] gap-2"><Field dark={dark} label="镜头标题"><Input dark={dark} value={shot.title} onChange={event => onChange({ title: event.target.value })} onPointerDown={stop} /></Field><Field dark={dark} label="时长"><Input dark={dark} type="number" min={4} max={15} value={shot.duration} onChange={event => onChange({ duration: Number(event.target.value) })} onPointerDown={stop} /></Field></div>
    <Field dark={dark} label="场景"><TextArea dark={dark} rows={2} value={shot.scene} onChange={event => onChange({ scene: event.target.value })} onPointerDown={stop} /></Field>
    <Field dark={dark} label="动作 / 表演"><TextArea dark={dark} rows={2} value={shot.action} onChange={event => onChange({ action: event.target.value })} onPointerDown={stop} /></Field>
    <div className="grid grid-cols-3 gap-2"><Field dark={dark} label="景别"><Select dark={dark} value={shot.camera.shotType} onChange={event => onChange({ camera: { ...shot.camera, shotType: event.target.value } })} onPointerDown={stop}>{CINEMATIC_SHOT_TYPES.map(value => <option key={value} value={value}>{value}</option>)}</Select></Field><Field dark={dark} label="视场角"><Select dark={dark} value={shot.camera.fov} onChange={event => onChange({ camera: { ...shot.camera, fov: event.target.value } })} onPointerDown={stop}>{CINEMATIC_FOVS.map(value => <option key={value} value={value}>{value}</option>)}</Select></Field><Field dark={dark} label="运镜"><Input dark={dark} value={shot.camera.motion} onChange={event => onChange({ camera: { ...shot.camera, motion: event.target.value } })} onPointerDown={stop} /></Field></div>
    <Field dark={dark} label={`角色 · ${participants || '未指定'}`}><Select dark={dark} value={shot.cast[0] || ''} onChange={event => onChange({ cast: event.target.value ? [event.target.value] : [] })} onPointerDown={stop}><option value="">不指定</option>{cast.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</Select></Field>
    {shot.dialogue && <Field dark={dark} label="对白"><Input dark={dark} value={shot.dialogue.text} onChange={event => onChange({ dialogue: { ...shot.dialogue!, text: event.target.value } })} onPointerDown={stop} /></Field>}
    <Field dark={dark} label="视频提示词"><TextArea dark={dark} rows={4} value={shot.prompt} onChange={event => onChange({ prompt: event.target.value })} onPointerDown={stop} /></Field>
    {shot.generation.videoUrl && <button type="button" className="group relative mt-2 block w-full overflow-hidden rounded-xl bg-black" onClick={onPreview} onPointerDown={stop} aria-label={`预览 ${shot.title}`}><LazyVideo src={shot.generation.videoUrl} loop={false} controls={false} className="max-h-44 w-full rounded-xl bg-black object-contain" placeholderClassName="h-32 w-full rounded-xl bg-black" onPointerDown={stop} /><span className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity group-hover:opacity-100"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-white"><Maximize2 size={15} /></span></span>{generating && <span className="absolute inset-x-2 bottom-2 rounded-lg bg-amber-500/85 px-2 py-1 text-center text-[9px] text-black">正在重新生成 · 旧结果仍可预览</span>}</button>}
    {shot.generation.error && <div className="mt-2 rounded-lg bg-red-500/10 px-2.5 py-2 text-[10px] leading-4 text-red-300">{shot.generation.error}</div>}
    <div className="mt-2 flex flex-wrap gap-1.5"><Button dark={dark} onClick={onRecompile} onPointerDown={stop}><RefreshCw size={12} />重新编译</Button><Button dark={dark} disabled={optimizing} onClick={onOptimize} onPointerDown={stop}>{optimizing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}优化提示词</Button>{shot.generation.videoUrl && <Button dark={dark} onClick={onPreview} onPointerDown={stop}><Maximize2 size={12} />预览</Button>}{generating && <GenerationCancelButton dark={dark} onCancel={onCancel} />}<Button dark={dark} tone="primary" disabled={generating} onClick={onGenerate} onPointerDown={stop}>{generating ? <Loader2 size={12} className="animate-spin" /> : shot.generation.videoUrl ? <RefreshCw size={12} /> : <Video size={12} />}{shot.generation.videoUrl ? '重生成' : '生成'}</Button><Button dark={dark} tone="danger" onClick={onDelete} onPointerDown={stop}><Trash2 size={12} /></Button></div>
  </div>;
};

export const CinematicVideoMergeNode: React.FC<BaseProps & { onMerge: (id: string) => void }> = props => {
  const { data, allNodes, onUpdate, onMerge } = props;
  const dark = (props.canvasTheme || 'dark') === 'dark';
  const storyboard = allNodes.find(node => data.parentIds?.includes(node.id) && node.type === NodeType.CINEMATIC_STORYBOARD);
  const state = data.cinematicVideoMerge || { status: 'idle' as const, outputFormat: 'mp4' as const, fps: 30, skipFailed: true };
  const shots = storyboard?.cinematicStoryboard?.shots || [];
  const completed = shots.filter(shot => shot.generation.status === 'completed' && shot.generation.videoUrl).length;
  const update = (patch: Partial<typeof state>) => onUpdate(data.id, { cinematicVideoMerge: { ...state, ...patch } });
  return <Shell {...props} icon={<Merge size={20} />} label={data.title || '电影成片拼接'} subtitle={`${completed} 个已完成镜头 · 统一输出`} minHeight={CINEMATIC_VIDEO_MERGE_NODE_HEIGHT}>
    <div className="space-y-3 px-5 py-4">
      <div className="grid grid-cols-2 gap-2"><Field dark={dark} label="输出格式"><Select dark={dark} value={state.outputFormat} onChange={event => update({ outputFormat: event.target.value as typeof state.outputFormat })} onPointerDown={stop}><option value="mp4">MP4 · H.264 + AAC</option><option value="mov">MOV</option><option value="webm">WebM</option></Select></Field><Field dark={dark} label="帧率"><Select dark={dark} value={String(state.fps)} onChange={event => update({ fps: Number(event.target.value) })} onPointerDown={stop}><option value="24">24 fps</option><option value="30">30 fps</option><option value="60">60 fps</option></Select></Field></div>
      <label className={`flex items-center gap-2 text-[10px] ${muted(dark)}`}><input type="checkbox" checked={state.skipFailed} onChange={event => update({ skipFailed: event.target.checked })} onPointerDown={stop} className="accent-cyan-400" />跳过失败镜头继续拼接</label>
      {state.outputUrl && <LazyVideo src={state.outputUrl} loop={false} controls className="max-h-48 w-full rounded-xl bg-black object-contain" placeholderClassName="h-44 w-full rounded-xl bg-black" onPointerDown={stop} />}
      {state.error && <div className="rounded-xl bg-red-500/10 px-3 py-2 text-[10px] text-red-300">{state.error}</div>}
      <Button dark={dark} tone="primary" className="w-full" disabled={!completed || state.status === 'queued' || state.status === 'rendering'} onClick={() => onMerge(data.id)} onPointerDown={stop}>{state.status === 'queued' || state.status === 'rendering' ? <Loader2 size={13} className="animate-spin" /> : <Merge size={13} />} {state.status === 'success' ? '重新拼接' : '拼接最终视频'}</Button>
      <div className={`text-[10px] ${muted(dark)}`}>{state.status === 'success' ? '成片已保存到当前项目 · 默认继承每个镜头原声音频' : '按分镜顺序调用现有视频拼接服务'}</div>
    </div>
  </Shell>;
};
