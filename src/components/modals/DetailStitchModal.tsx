import React from 'react';
import {
  Check,
  Loader2,
  Plus,
  RotateCcw,
  Scissors,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';

import {
  DETAIL_STITCH_MAX_SLICE_HEIGHT,
  DETAIL_STITCH_MIN_SLICE_HEIGHT,
  buildDetailStitchSlices,
  type DetailStitchCut,
  type DetailStitchRecord,
  type DetailStitchSlice,
} from '../../../shared/detailStitch';
import { getImageGenerationProvider } from '../../../shared/generationProviders.js';
import {
  exportCompetitorDetailSlices,
  planCompetitorDetailSlices,
  stitchCompetitorDetails,
  type DetailStitchSourceInput,
} from '../../services/detailStitchService';

interface DetailStitchModalProps {
  isOpen: boolean;
  workflowId: string;
  controllerNodeId: string;
  imageModel: string;
  sources: DetailStitchSourceInput[];
  canvasTheme?: 'dark' | 'light';
  onClose: () => void;
  onConfirm: (record: DetailStitchRecord) => void | Promise<void>;
}

type Phase = 'stitching' | 'planning' | 'ready' | 'exporting' | 'error';

const cloneCuts = (cuts: DetailStitchCut[]) => cuts.map(cut => ({ ...cut }));

export const DetailStitchModal: React.FC<DetailStitchModalProps> = ({
  isOpen,
  workflowId,
  controllerNodeId,
  imageModel,
  sources,
  canvasTheme = 'dark',
  onClose,
  onConfirm,
}) => {
  const dark = canvasTheme === 'dark';
  const [phase, setPhase] = React.useState<Phase>('stitching');
  const [record, setRecord] = React.useState<DetailStitchRecord | null>(null);
  const [cuts, setCuts] = React.useState<DetailStitchCut[]>([]);
  const [defaultCuts, setDefaultCuts] = React.useState<DetailStitchCut[]>([]);
  const [selectedCut, setSelectedCut] = React.useState<number | null>(null);
  const [error, setError] = React.useState('');
  const [previewWidth, setPreviewWidth] = React.useState(640);
  const previewColumnRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<{ index: number; clientY: number; y: number } | null>(null);
  const provider = getImageGenerationProvider(imageModel);
  const supportedAspectRatios = provider?.supportedAspectRatios || [];

  const acceptPlan = React.useCallback((next: DetailStitchRecord) => {
    const nextCuts = cloneCuts(next.cuts || []);
    setRecord(next);
    setCuts(nextCuts);
    setDefaultCuts(cloneCuts(nextCuts));
    setSelectedCut(null);
    setPhase('ready');
  }, []);

  React.useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setRecord(null);
    setCuts([]);
    setDefaultCuts([]);
    setSelectedCut(null);
    setError('');
    setPhase('stitching');
    void (async () => {
      try {
        const stitched = await stitchCompetitorDetails({
          workflowId,
          controllerNodeId,
          imageModel,
          sources,
        });
        if (cancelled) return;
        setRecord(stitched);
        setPhase('planning');
        const planned = await planCompetitorDetailSlices({
          workflowId,
          stitchId: stitched.stitchId,
          imageModel,
        });
        if (!cancelled) acceptPlan(planned);
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : '详情图智能重切片失败');
        setPhase('error');
      }
    })();
    return () => { cancelled = true; };
  }, [acceptPlan, controllerNodeId, imageModel, isOpen, sources, workflowId]);

  React.useEffect(() => {
    const element = previewColumnRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width;
      if (width) setPreviewWidth(Math.max(320, width - 32));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [isOpen]);

  const slices: DetailStitchSlice[] = React.useMemo(() => {
    if (!record) return [];
    try {
      return buildDetailStitchSlices({
        cuts,
        canvasWidth: record.canvasWidth,
        canvasHeight: record.canvasHeight,
        supportedAspectRatios,
      });
    } catch {
      return [];
    }
  }, [cuts, record, supportedAspectRatios]);

  if (!isOpen) return null;

  const displayWidth = record ? Math.min(record.canvasWidth, previewWidth) : previewWidth;
  const scale = record ? displayWidth / record.canvasWidth : 1;
  const displayHeight = record ? record.canvasHeight * scale : 0;
  const candidateLines = record
    ? [...(record.candidates || [])].sort((left, right) => right.score - left.score).slice(0, 160)
    : [];

  const retryPlanning = async () => {
    if (!record || phase === 'exporting') return;
    setError('');
    setPhase('planning');
    try {
      acceptPlan(await planCompetitorDetailSlices({ workflowId, stitchId: record.stitchId, imageModel }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '重新识别切割点失败');
      setPhase('error');
    }
  };

  const addCut = () => {
    if (!record) return;
    const boundaries = [0, ...cuts.map(cut => cut.y), record.canvasHeight];
    let largestIndex = 0;
    for (let index = 1; index < boundaries.length - 1; index += 1) {
      if (boundaries[index + 1] - boundaries[index] > boundaries[largestIndex + 1] - boundaries[largestIndex]) {
        largestIndex = index;
      }
    }
    const start = boundaries[largestIndex];
    const end = boundaries[largestIndex + 1];
    if (end - start < DETAIL_STITCH_MIN_SLICE_HEIGHT * 2) {
      setError(`每段至少需要 ${DETAIL_STITCH_MIN_SLICE_HEIGHT}px，当前已无法再分`);
      return;
    }
    const nextY = Math.round((start + end) / 2);
    const next = [...cuts, { y: nextY, source: 'manual' as const }].sort((a, b) => a.y - b.y);
    setCuts(next);
    setSelectedCut(next.findIndex(cut => cut.y === nextY));
    setError('');
  };

  const deleteSelectedCut = () => {
    if (selectedCut === null || !record) return;
    const previousY = selectedCut === 0 ? 0 : cuts[selectedCut - 1].y;
    const nextY = selectedCut === cuts.length - 1
      ? record.canvasHeight
      : cuts[selectedCut + 1].y;
    if (nextY - previousY > DETAIL_STITCH_MAX_SLICE_HEIGHT) {
      setError(`删除后该切片会超过 ${DETAIL_STITCH_MAX_SLICE_HEIGHT}px，已保留这条切割线`);
      return;
    }
    setCuts(current => current.filter((_, index) => index !== selectedCut));
    setSelectedCut(null);
    setError('');
  };

  const moveCut = React.useCallback((index: number, proposed: number) => {
    if (!record) return;
    setCuts(current => {
      const previousY = index === 0 ? 0 : current[index - 1].y;
      const nextY = index === current.length - 1 ? record.canvasHeight : current[index + 1].y;
      const lowerBound = Math.max(
        previousY + DETAIL_STITCH_MIN_SLICE_HEIGHT,
        nextY - DETAIL_STITCH_MAX_SLICE_HEIGHT,
      );
      const upperBound = Math.min(
        nextY - DETAIL_STITCH_MIN_SLICE_HEIGHT,
        previousY + DETAIL_STITCH_MAX_SLICE_HEIGHT,
      );
      const y = Math.max(
        lowerBound,
        Math.min(upperBound, Math.round(proposed)),
      );
      return current.map((cut, cutIndex) => (
        cutIndex === index ? { y, source: 'manual' as const } : cut
      ));
    });
    setError('');
  }, [record]);

  const handleLinePointerDown = (event: React.PointerEvent, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { index, clientY: event.clientY, y: cuts[index].y };
    setSelectedCut(index);
  };

  const handleLinePointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || !record) return;
    event.preventDefault();
    event.stopPropagation();
    const proposed = Math.round(drag.y + (event.clientY - drag.clientY) / scale);
    moveCut(drag.index, proposed);
  };

  const confirm = async () => {
    if (!record || !slices.length || phase !== 'ready') return;
    setPhase('exporting');
    setError('');
    try {
      const exported = await exportCompetitorDetailSlices({
        workflowId,
        stitchId: record.stitchId,
        imageModel,
        cuts,
        nodeIds: slices.map(() => crypto.randomUUID()),
      });
      await onConfirm(exported);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '确认切片失败');
      setPhase('ready');
    }
  };

  const loadingLabel = phase === 'stitching'
    ? '正在无损拼接原始切片…'
    : '正在识别视觉模块与安全切割点…';

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onPointerDown={event => event.stopPropagation()}
    >
      <div className={`flex h-[94vh] w-[min(1480px,96vw)] flex-col overflow-hidden rounded-2xl border shadow-2xl ${dark ? 'border-neutral-700 bg-[#101010] text-white' : 'border-neutral-200 bg-white text-neutral-900'}`}>
        <header className={`flex h-16 shrink-0 items-center justify-between border-b px-5 ${dark ? 'border-neutral-800' : 'border-neutral-200'}`}>
          <div>
            <div className="flex items-center gap-2 text-base font-semibold"><Scissors size={18} className="text-violet-400" />详情拼接重新切片</div>
            <div className="mt-0.5 text-[11px] text-neutral-500">先确认切割线，再替换竞品输入；现有复刻生成管线不变</div>
          </div>
          <button type="button" aria-label="关闭详情重切片" onClick={onClose} disabled={phase === 'exporting'} className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-500/15 disabled:opacity-40"><X size={18} /></button>
        </header>

        {['stitching', 'planning'].includes(phase) && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <Loader2 size={34} className="animate-spin text-violet-400" />
            <div className="text-sm font-medium">{loadingLabel}</div>
            <div className="text-xs text-neutral-500">中间产物使用 PNG，不会经过 JPEG 二次压缩</div>
          </div>
        )}

        {phase === 'error' && !record && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
            <div className="text-sm text-red-400">{error}</div>
            <button type="button" onClick={onClose} className="rounded-lg border border-neutral-600 px-4 py-2 text-sm">关闭</button>
          </div>
        )}

        {record && !['stitching', 'planning'].includes(phase) && (
          <>
            <div className="flex min-h-0 flex-1">
              <div ref={previewColumnRef} className={`min-w-0 flex-1 overflow-auto p-4 ${dark ? 'bg-black/35' : 'bg-neutral-100'}`}>
                <div className="mx-auto relative shadow-2xl" style={{ width: displayWidth, height: displayHeight }}>
                  <img
                    src={record.fullImageUrl}
                    alt="拼接后的竞品详情长图"
                    draggable={false}
                    className="block h-full w-full select-none"
                  />
                  {candidateLines.map(candidate => (
                    <div
                      key={`candidate-${candidate.y}`}
                      className="pointer-events-none absolute left-0 right-0 border-t border-emerald-400/20"
                      style={{ top: candidate.y * scale }}
                    />
                  ))}
                  {cuts.map((cut, index) => (
                    <div
                      key={`cut-${index}`}
                      role="slider"
                      aria-label={`第 ${index + 1} 条切割线`}
                      aria-valuemin={0}
                      aria-valuemax={record.canvasHeight}
                      aria-valuenow={cut.y}
                      aria-valuetext={`${cut.y}px，${cut.source === 'manual' ? '手动' : '自动'}`}
                      tabIndex={0}
                      onPointerDown={event => handleLinePointerDown(event, index)}
                      onPointerMove={handleLinePointerMove}
                      onPointerUp={event => {
                        dragRef.current = null;
                        event.currentTarget.releasePointerCapture(event.pointerId);
                      }}
                      onPointerCancel={() => { dragRef.current = null; }}
                      onKeyDown={event => {
                        if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
                        event.preventDefault();
                        const direction = event.key === 'ArrowUp' ? -1 : 1;
                        moveCut(index, cut.y + direction * (event.shiftKey ? 50 : 10));
                      }}
                      className={`absolute -left-2 -right-2 z-10 h-5 -translate-y-1/2 cursor-ns-resize touch-none ${selectedCut === index ? 'text-amber-300' : 'text-violet-300'}`}
                      style={{ top: cut.y * scale }}
                    >
                      <div className={`absolute left-2 right-2 top-1/2 border-t-2 border-dashed ${selectedCut === index ? 'border-amber-300' : 'border-violet-400'}`} />
                      <span className={`absolute right-3 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[10px] font-semibold text-black ${selectedCut === index ? 'bg-amber-300' : 'bg-violet-300'}`}>
                        ✂ {cut.y}px · {cut.source === 'manual' ? '手动' : '自动'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <aside className={`w-[390px] shrink-0 overflow-y-auto border-l p-4 ${dark ? 'border-neutral-800' : 'border-neutral-200'}`}>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className={`rounded-lg border p-2.5 ${dark ? 'border-neutral-700 bg-neutral-900' : 'border-neutral-200 bg-neutral-50'}`}><div className="text-neutral-500">拼接尺寸</div><div className="mt-1 font-semibold">{record.canvasWidth} × {record.canvasHeight}px</div></div>
                  <div className={`rounded-lg border p-2.5 ${dark ? 'border-neutral-700 bg-neutral-900' : 'border-neutral-200 bg-neutral-50'}`}><div className="text-neutral-500">切片数量</div><div className="mt-1 font-semibold">{slices.length} 张</div></div>
                </div>
                {record.widthAdjustedCount > 0 && (
                  <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] leading-5 text-amber-400">
                    {record.widthAdjustedCount} 张图片宽度不一致，已等比缩放到众数宽度 {record.canvasWidth}px。
                  </div>
                )}
                {record.sources.some(source => source.dedupTrimmedTop > 0) && (
                  <div className="mt-2 rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-3 py-2 text-[11px] text-cyan-300">
                    已自动去除 {record.sources.filter(source => source.dedupTrimmedTop > 0).length} 处相邻重复区。
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void retryPlanning()} className="flex items-center gap-1.5 rounded-lg border border-violet-500/50 px-2.5 py-1.5 text-[11px] text-violet-300"><WandSparkles size={12} />重新识别</button>
                  <button type="button" onClick={addCut} className="flex items-center gap-1.5 rounded-lg border border-neutral-600 px-2.5 py-1.5 text-[11px]"><Plus size={12} />新增切割线</button>
                  <button type="button" onClick={deleteSelectedCut} disabled={selectedCut === null} className="flex items-center gap-1.5 rounded-lg border border-neutral-600 px-2.5 py-1.5 text-[11px] disabled:opacity-35"><Trash2 size={12} />删除</button>
                  <button type="button" onClick={() => { setCuts(cloneCuts(defaultCuts)); setSelectedCut(null); setError(''); }} className="flex items-center gap-1.5 rounded-lg border border-neutral-600 px-2.5 py-1.5 text-[11px]"><RotateCcw size={12} />恢复默认</button>
                </div>

                <div className="mt-4 text-xs font-semibold">切片预估 <span className="font-normal text-neutral-500">· 模型 {provider?.name || imageModel}</span></div>
                <div className="mt-2 space-y-1.5">
                  {slices.map(slice => {
                    const loss = Math.round(slice.expectedCropLoss * 1000) / 10;
                    return (
                      <div key={slice.id} className={`grid grid-cols-[34px_1fr_auto] items-center gap-2 rounded-lg border px-2.5 py-2 text-[11px] ${dark ? 'border-neutral-700 bg-neutral-900/70' : 'border-neutral-200 bg-neutral-50'}`}>
                        <span className="font-semibold text-violet-400">{String(slice.index + 1).padStart(2, '0')}</span>
                        <span>{slice.height}px · {slice.targetAspectRatio}</span>
                        <span className={loss >= 2 ? 'text-amber-400' : 'text-emerald-400'}>预期裁切 {loss}%</span>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-3 text-[10px] leading-4 text-neutral-500">
                  这里显示的是按请求宽高比计算的预期值，不是“零裁切”保证。模型实际返回尺寸不同时，现有复刻流程会重算实际损失。
                </p>
                {error && <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11px] text-red-400">{error}</div>}
              </aside>
            </div>

            <footer className={`flex h-16 shrink-0 items-center justify-between border-t px-5 ${dark ? 'border-neutral-800' : 'border-neutral-200'}`}>
              <div className="text-[11px] text-neutral-500">拖动虚线微调；单张最高 {DETAIL_STITCH_MAX_SLICE_HEIGHT}px。确认前不会改动画布节点，原始切片可随时恢复。</div>
              <div className="flex gap-2">
                <button type="button" onClick={onClose} disabled={phase === 'exporting'} className="rounded-lg border border-neutral-600 px-4 py-2 text-sm disabled:opacity-40">取消</button>
                <button type="button" onClick={() => void confirm()} disabled={phase !== 'ready' || !slices.length} className="flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-40">
                  {phase === 'exporting' ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                  {phase === 'exporting' ? '正在导出切片…' : `确认并替换 ${slices.length} 张`}
                </button>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
};
