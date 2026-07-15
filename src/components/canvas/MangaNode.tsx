/**
 * MangaNode.tsx
 *
 * AI 漫剧生产节点的自包含渲染与逻辑：配音(Audio) / 音效(SFX) / 背景音乐(BGM) /
 * 字幕(Subtitle) / Remotion 成片(Render)。
 *
 * 直接调用后端 API（/api/audio/*、/api/render/*），并通过 onUpdate 持久化节点字段。
 * 成片节点从「直接连接的父节点」构建统一 manifest 并提交渲染、轮询进度、预览成片。
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Mic, Music, Volume2, Type as TypeIcon, Clapperboard, Upload, Play,
  Loader2, Download, FolderOpen, RotateCcw, AlertTriangle, CheckCircle2,
  Settings2, ChevronDown,
} from 'lucide-react';
import { NodeData, NodeType } from '../../types';
import { NodeConnectors } from './NodeConnectors';
// @ts-ignore — 纯 JS 共享模块，类型由 shared/manifest.d.ts 提供
import { buildManifestFromNodes } from '@/shared/manifest.js';

interface MangaNodeProps {
  data: NodeData;
  allNodes: NodeData[];
  selected: boolean;
  canvasTheme?: 'dark' | 'light';
  onUpdate: (id: string, updates: Partial<NodeData>) => void;
  onNodePointerDown: (e: React.PointerEvent, id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  onConnectorDown: (e: React.PointerEvent, id: string, side: 'left' | 'right') => void;
  onExpand?: (url: string) => void;
}

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

const NUM = (v: any, d = 0) => (v == null || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

const meta: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  [NodeType.AUDIO]: { label: '配音', color: '#34d399', icon: <Mic size={14} /> },
  [NodeType.SFX]: { label: '音效', color: '#fbbf24', icon: <Volume2 size={14} /> },
  [NodeType.BGM]: { label: '背景音乐', color: '#a78bfa', icon: <Music size={14} /> },
  [NodeType.SUBTITLE]: { label: '字幕', color: '#60a5fa', icon: <TypeIcon size={14} /> },
  [NodeType.RENDER]: { label: 'Remotion 成片', color: '#f87171', icon: <Clapperboard size={14} /> },
};

const inputCls =
  'w-full bg-[#1a1a1a] border border-neutral-700 rounded px-2 py-1 text-xs text-white outline-none focus:border-blue-500';
const labelCls = 'text-[10px] text-neutral-400 mb-0.5 block';

const NumField: React.FC<{ label: string; value: any; onChange: (v: number) => void; step?: number; min?: number }> = ({
  label, value, onChange, step = 0.1, min = 0,
}) => (
  <div className="flex-1">
    <label className={labelCls}>{label}</label>
    <input
      type="number" step={step} min={min} value={value ?? ''}
      onChange={(e) => onChange(NUM(e.target.value))}
      onPointerDown={stop} onWheel={stop} className={inputCls}
    />
  </div>
);

export const MangaNode: React.FC<MangaNodeProps> = ({
  data, allNodes, selected, canvasTheme = 'dark',
  onUpdate, onNodePointerDown, onContextMenu, onConnectorDown, onExpand,
}) => {
  const m = meta[data.type] || meta[NodeType.AUDIO];
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const up = (u: Partial<NodeData>) => onUpdate(data.id, u);

  // 探测音频真实时长并回填 timelineEnd
  const probeDuration = (url: string) => {
    try {
      const a = document.createElement('audio');
      a.preload = 'metadata';
      a.src = url;
      a.onloadedmetadata = () => {
        const dur = Math.round(a.duration * 100) / 100;
        if (dur && isFinite(dur)) {
          const start = NUM(data.timelineStart, 0);
          up({ durationSec: dur, timelineEnd: Math.round((start + dur) * 100) / 100 });
        }
      };
    } catch { /* ignore */ }
  };

  const importAudio = async (file: File) => {
    setBusy(true); setMsg('导入中…');
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const subtype = data.type === NodeType.BGM ? 'bgm' : data.type === NodeType.SFX ? 'sfx' : 'dialogue';
      const res = await fetch('/api/audio/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl, filename: file.name, subtype }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '上传失败');
      up({ mediaUrl: json.url });
      probeDuration(json.url);
      setMsg('已导入');
    } catch (e: any) { setMsg('错误: ' + e.message); }
    finally { setBusy(false); }
  };

  const generateTts = async () => {
    const text = data.ttsText || data.subtitleText || data.prompt || '';
    if (!text.trim()) { setMsg('请先输入配音文本'); return; }
    setBusy(true); setMsg('合成配音中…');
    try {
      const res = await fetch('/api/audio/minimax/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text, speaker: data.speaker, voiceId: data.voiceId,
          speed: data.voiceSpeed, emotion: data.voiceEmotion,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'TTS 失败');
      up({ mediaUrl: json.url, durationSec: json.durationSec });
      if (json.durationSec) {
        const start = NUM(data.timelineStart, 0);
        up({ mediaUrl: json.url, durationSec: json.durationSec, timelineEnd: Math.round((start + json.durationSec) * 100) / 100 });
      }
      setMsg('配音完成');
    } catch (e: any) { setMsg('错误: ' + e.message); }
    finally { setBusy(false); }
  };

  // ---- 成片节点：清单预览 + 渲染 + 轮询 ----
  const manifestPreview = data.type === NodeType.RENDER
    ? buildManifestFromNodes(data.id, allNodes, {
        project: { id: data.id, title: data.title || '漫剧成片' },
        composition: { width: NUM(data.compWidth, 1280), height: NUM(data.compHeight, 720), fps: NUM(data.compFps, 24) },
      })
    : null;

  const startRender = async () => {
    if (!manifestPreview) return;
    setBusy(true); setMsg('提交渲染…');
    try {
      const res = await fetch('/api/render/remotion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest: manifestPreview }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.missing) up({ renderMissing: json.missing });
        throw new Error(json.error || '提交失败');
      }
      up({
        renderJobId: json.jobId, renderStatus: json.status, renderStage: json.stage,
        renderProgress: json.progress || 0, renderOutputUrl: undefined, renderError: undefined, renderMissing: undefined,
      });
      setMsg(null);
    } catch (e: any) { setMsg('错误: ' + e.message); up({ renderStatus: 'failed', renderError: e.message }); }
    finally { setBusy(false); }
  };

  const cancelRender = async () => {
    if (!data.renderJobId) return;
    await fetch(`/api/render/remotion/${data.renderJobId}/cancel`, { method: 'POST' }).catch(() => {});
  };

  const revealInFinder = async () => {
    if (!data.renderJobId) return;
    await fetch(`/api/render/remotion/${data.renderJobId}/reveal`, { method: 'POST' }).catch(() => {});
  };

  // 轮询渲染进度
  useEffect(() => {
    if (data.type !== NodeType.RENDER) return;
    if (!data.renderJobId) return;
    if (data.renderStatus && !['queued', 'rendering'].includes(data.renderStatus)) return;
    let alive = true;
    let missCount = 0; // 连续 404 计数：任务已不存在（如保存后重载、服务重启）时复位，避免无限轮询
    const tick = async () => {
      try {
        const res = await fetch(`/api/render/remotion/${data.renderJobId}`);
        if (res.status === 404) {
          if (!alive) return;
          if (++missCount >= 3) {
            // 陈旧任务已丢失：复位到可重新渲染状态，停止轮询
            up({ renderJobId: undefined, renderStatus: undefined, renderStage: undefined, renderProgress: undefined });
          }
          return;
        }
        if (!res.ok) return;
        missCount = 0;
        const j = await res.json();
        if (!alive) return;
        up({
          renderStatus: j.status, renderStage: j.stage, renderProgress: j.progress,
          renderOutputUrl: j.output || undefined, renderError: j.error || undefined,
          renderMissing: j.missing || undefined,
        });
      } catch { /* ignore */ }
    };
    const id = setInterval(tick, 1200);
    tick();
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.type, data.renderJobId, data.renderStatus]);

  const isAudioKind = data.type === NodeType.AUDIO || data.type === NodeType.SFX || data.type === NodeType.BGM;

  return (
    <div
      className="absolute group/node touch-none pointer-events-auto"
      style={{ transform: `translate(${data.x}px, ${data.y}px)`, zIndex: selected ? 50 : 10 }}
      onPointerDown={(e) => onNodePointerDown(e, data.id)}
      onContextMenu={(e) => onContextMenu(e, data.id)}
    >
      <NodeConnectors nodeId={data.id} onConnectorDown={onConnectorDown} canvasTheme={canvasTheme} />

      <div
        className={`relative rounded-2xl border flex flex-col shadow-2xl bg-[#0f0f0f] ${selected ? 'border-blue-500/50 ring-1 ring-blue-500/30' : 'border-neutral-800'}`}
        style={{ width: 340 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-neutral-800">
          <div className="flex min-w-0 items-center gap-1.5" style={{ color: m.color }}>
            {m.icon}
            <span className="truncate text-xs font-semibold">{data.title || m.label}</span>
          </div>
          <span className={`shrink-0 text-[10px] ${data.mediaUrl || data.renderOutputUrl || data.subtitleText ? 'text-emerald-400' : 'text-neutral-600'}`}>
            {data.mediaUrl || data.renderOutputUrl || data.subtitleText ? '已配置' : '待配置'}
          </span>
        </div>

        <div className="p-3 flex flex-col gap-2.5" onWheel={stop}>
          {/* 音频类：配音/音效/BGM */}
          {isAudioKind && (
            <>
              {data.type === NodeType.AUDIO && (
                <div className="flex flex-col gap-1.5 pb-2 border-b border-neutral-800/60">
                  <label className={labelCls}>配音文本</label>
                  <textarea
                    value={data.ttsText ?? data.subtitleText ?? ''}
                    onChange={(e) => up({ ttsText: e.target.value })}
                    onPointerDown={stop}
                    placeholder="输入台词，用 MiniMax TTS 合成配音"
                    className={inputCls + ' resize-none'} style={{ minHeight: 48 }}
                  />
                  <button onClick={generateTts} onPointerDown={stop} disabled={busy}
                    className="flex items-center justify-center gap-1.5 py-1.5 rounded bg-emerald-600/90 hover:bg-emerald-500 text-white text-xs font-medium disabled:opacity-50">
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Mic size={13} />} 生成配音
                  </button>
                </div>
              )}

              {/* 导入本地音频 */}
              <input ref={fileRef} type="file" accept="audio/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importAudio(f); e.currentTarget.value = ''; }} />
              <button onClick={() => fileRef.current?.click()} onPointerDown={stop} disabled={busy}
                className="flex items-center justify-center gap-1.5 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-medium disabled:opacity-50">
                <Upload size={13} /> {data.type === NodeType.AUDIO ? '导入配音' : data.type === NodeType.SFX ? '导入音效' : '导入背景音乐'}
              </button>

              {data.mediaUrl && (
                <audio src={data.mediaUrl} controls onPointerDown={stop}
                  className="w-full h-8" style={{ colorScheme: 'dark' }} />
              )}

              {showAdvanced && (
                <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-[#141414] p-2">
                  {data.type === NodeType.AUDIO && (
                    <>
                      <div className="flex gap-1.5">
                        <input value={data.speaker ?? ''} onChange={(e) => up({ speaker: e.target.value })}
                          onPointerDown={stop} placeholder="角色名" className={inputCls} />
                        <input value={data.voiceId ?? ''} onChange={(e) => up({ voiceId: e.target.value })}
                          onPointerDown={stop} placeholder="音色 ID" className={inputCls} />
                      </div>
                      <div className="flex gap-1.5">
                        <NumField label="语速" value={data.voiceSpeed ?? 1} onChange={(v) => up({ voiceSpeed: v })} step={0.1} />
                        <div className="flex-1">
                          <label className={labelCls}>情绪</label>
                          <select value={data.voiceEmotion ?? ''} onChange={(e) => up({ voiceEmotion: e.target.value })}
                            onPointerDown={stop} className={inputCls}>
                            <option value="">默认</option>
                            <option value="happy">开心</option>
                            <option value="sad">悲伤</option>
                            <option value="angry">愤怒</option>
                            <option value="fearful">恐惧</option>
                            <option value="neutral">中性</option>
                          </select>
                        </div>
                      </div>
                    </>
                  )}
                  <div className="flex gap-1.5">
                    <NumField label="起始(s)" value={data.timelineStart ?? 0} onChange={(v) => up({ timelineStart: v })} />
                    <NumField label="结束(s)" value={data.timelineEnd ?? ''} onChange={(v) => up({ timelineEnd: v })} />
                    <NumField label="音量" value={data.audioVolume ?? (data.type === NodeType.BGM ? 0.15 : 1)} onChange={(v) => up({ audioVolume: v })} step={0.05} />
                  </div>
                  <div className="flex gap-1.5">
                    <NumField label="淡入(s)" value={data.fadeIn ?? (data.type === NodeType.BGM ? 1 : 0)} onChange={(v) => up({ fadeIn: v })} />
                    <NumField label="淡出(s)" value={data.fadeOut ?? (data.type === NodeType.BGM ? 1 : 0)} onChange={(v) => up({ fadeOut: v })} />
                  </div>
                  <div className="flex gap-3 text-[11px] text-neutral-300">
                    <label className="flex items-center gap-1" onPointerDown={stop}>
                      <input type="checkbox" checked={!!data.loop} onChange={(e) => up({ loop: e.target.checked })} /> 循环
                    </label>
                    {data.type === NodeType.BGM && (
                      <label className="flex items-center gap-1" onPointerDown={stop}>
                        <input type="checkbox" checked={data.ducking !== false} onChange={(e) => up({ ducking: e.target.checked })} /> 对白闪避
                      </label>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* 字幕 */}
          {data.type === NodeType.SUBTITLE && (
            <>
              <label className={labelCls}>字幕文本</label>
              <textarea value={data.subtitleText ?? ''} onChange={(e) => up({ subtitleText: e.target.value })}
                onPointerDown={stop} placeholder="输入字幕内容" className={inputCls + ' resize-none'} style={{ minHeight: 44 }} />
              {/* 预览 */}
              <div className="rounded bg-black/70 py-2 px-2 text-center">
                <span className="text-white text-sm" style={{ textShadow: '0 1px 3px #000' }}>
                  {data.subtitleText || '字幕预览'}
                </span>
              </div>
              {showAdvanced && (
                <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-[#141414] p-2">
                  <input value={data.speaker ?? ''} onChange={(e) => up({ speaker: e.target.value })}
                    onPointerDown={stop} placeholder="角色名（可选）" className={inputCls} />
                  <div className="flex gap-1.5">
                    <NumField label="起始(s)" value={data.timelineStart ?? 0} onChange={(v) => up({ timelineStart: v })} />
                    <NumField label="结束(s)" value={data.timelineEnd ?? 3} onChange={(v) => up({ timelineEnd: v })} />
                  </div>
                </div>
              )}
            </>
          )}

          {/* Remotion 成片 */}
          {data.type === NodeType.RENDER && manifestPreview && (
            <>
              <div className="text-[11px] text-neutral-300 bg-[#1a1a1a] rounded p-2 flex flex-col gap-0.5">
                <div>镜头: <b>{manifestPreview.shots.length}</b> · 音轨: <b>{manifestPreview.audioTracks.length}</b> · 字幕: <b>{manifestPreview.subtitles.length}</b></div>
                <div className="text-neutral-500">连接素材节点后即可自动组装</div>
              </div>

              {showAdvanced && (
                <div className="flex gap-1.5 rounded-lg border border-neutral-800 bg-[#141414] p-2">
                  <NumField label="宽" value={data.compWidth ?? 1280} onChange={(v) => up({ compWidth: v })} step={2} />
                  <NumField label="高" value={data.compHeight ?? 720} onChange={(v) => up({ compHeight: v })} step={2} />
                  <NumField label="fps" value={data.compFps ?? 24} onChange={(v) => up({ compFps: v })} step={1} />
                </div>
              )}

              {data.renderMissing && data.renderMissing.length > 0 && (
                <div className="text-[11px] text-amber-400 bg-amber-950/30 rounded p-2 flex gap-1">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  <div>缺失素材：{data.renderMissing.map((x) => x.raw).join('、')}</div>
                </div>
              )}

              {/* 进度 */}
              {data.renderStatus && ['queued', 'rendering'].includes(data.renderStatus) && (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[11px] text-neutral-300">
                    <span className="flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> {data.renderStage}</span>
                    <span>{Math.round((data.renderProgress || 0) * 100)}%</span>
                  </div>
                  <div className="h-1.5 bg-neutral-800 rounded overflow-hidden">
                    <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.round((data.renderProgress || 0) * 100)}%` }} />
                  </div>
                  <button onClick={cancelRender} onPointerDown={stop}
                    className="text-[11px] text-neutral-400 hover:text-white">取消</button>
                </div>
              )}

              {data.renderStatus === 'failed' && (
                <div className="text-[11px] text-red-400 bg-red-950/30 rounded p-2">渲染失败：{data.renderError}</div>
              )}

              {data.renderStatus === 'success' && data.renderOutputUrl && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1 text-[11px] text-emerald-400"><CheckCircle2 size={13} /> 渲染成功</div>
                  <video src={data.renderOutputUrl} controls className="w-full rounded" style={{ aspectRatio: '16/9' }}
                    onPointerDown={stop} onDoubleClick={() => onExpand?.(data.renderOutputUrl!)} />
                  <div className="flex gap-1.5">
                    <a href={data.renderOutputUrl} download onPointerDown={stop}
                      className="flex-1 flex items-center justify-center gap-1 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-white text-[11px]">
                      <Download size={12} /> 下载
                    </a>
                    <button onClick={revealInFinder} onPointerDown={stop}
                      className="flex-1 flex items-center justify-center gap-1 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-white text-[11px]">
                      <FolderOpen size={12} /> Finder
                    </button>
                  </div>
                </div>
              )}

              {(!data.renderStatus || ['success', 'failed', 'cancelled'].includes(data.renderStatus)) && (
                <button onClick={startRender} onPointerDown={stop} disabled={busy || manifestPreview.shots.length === 0}
                  className="flex items-center justify-center gap-1.5 py-2 rounded bg-red-600/90 hover:bg-red-500 text-white text-xs font-semibold disabled:opacity-40">
                  {busy ? <Loader2 size={13} className="animate-spin" /> : data.renderStatus === 'success' ? <RotateCcw size={13} /> : <Play size={13} />}
                  {data.renderStatus === 'success' ? '重新渲染' : '开始渲染成片'}
                </button>
              )}
            </>
          )}

          <button
            type="button"
            onClick={() => setShowAdvanced(v => !v)}
            onPointerDown={stop}
            className="flex items-center justify-between rounded-lg px-1 py-1 text-[11px] text-neutral-500 transition-colors hover:text-neutral-200"
          >
            <span className="flex items-center gap-1.5"><Settings2 size={12} /> 高级设置</span>
            <ChevronDown size={12} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
          </button>

          {msg && <div className="text-[11px] text-neutral-400">{msg}</div>}
        </div>
      </div>
    </div>
  );
};
