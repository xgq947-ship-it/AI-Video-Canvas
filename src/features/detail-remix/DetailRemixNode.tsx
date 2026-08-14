import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Database,
  Download,
  FolderOpen,
  Images,
  ListOrdered,
  Loader2,
  RefreshCw,
  Sparkles,
  UserRound,
  WandSparkles,
} from 'lucide-react';
import { GenerationCancelButton } from '../../components/canvas/GenerationCancelButton';
import { NodeConnectors } from '../../components/canvas/NodeConnectors';
import { NodeData, NodeStatus, NodeType } from '../../types';
import {
  DETAIL_REMIX_INPUT_PORTS,
  DETAIL_REMIX_NODE_HEIGHT,
  DETAIL_REMIX_NODE_WIDTH,
  DETAIL_REMIX_PORT_LABELS,
  buildDetailRemixInputMapping,
  createDetailRemixNodeData,
  syncDetailRemixInputRefs,
  validateDetailRemixPreflight,
  type DetailRemixInputPort,
  type DetailRemixNodeData,
} from '../../../shared/detailRemix.js';
import {
  getImageGenerationProvider,
  listImageGenerationProviders,
  normalizeImageResolution,
} from '../../../shared/generationProviders.js';
import {
  cancelDetailRemixJob,
  createDetailRemixJob,
  retryFailedDetailRemixPages,
} from '../../services/detailRemixService';
import { resolveImageNodeDisplayName } from '../../utils/nodeDisplayName.js';

interface DetailRemixNodeProps {
  workflowId?: string;
  data: NodeData;
  allNodes: NodeData[];
  selected: boolean;
  canvasTheme?: 'dark' | 'light';
  onUpdate: (id: string, updates: Partial<NodeData>) => void;
  onNodePointerDown: (event: React.PointerEvent, id: string) => void;
  onContextMenu: (event: React.MouseEvent, id: string) => void;
  onConnectorDown: (
    event: React.PointerEvent,
    id: string,
    side: 'left' | 'right',
    portId?: string,
  ) => void;
  onImportFolder?: (
    controller: Pick<NodeData, 'id' | 'x' | 'y'>,
    role: 'competitor' | 'own',
    files: File[],
  ) => Promise<unknown>;
}

const inputPorts: Array<{ id: DetailRemixInputPort; label: string }> = DETAIL_REMIX_INPUT_PORTS.map(id => ({
  id,
  label: DETAIL_REMIX_PORT_LABELS[id],
}));

const previewUrl = (node?: NodeData) => node?.resultUrl || node?.editorBackgroundUrl;

const sourcePixelDimensions = (node: NodeData) => {
  const [width, height] = String(node.resultAspectRatio || '').split('/').map(Number);
  return Number.isInteger(width) && Number.isInteger(height) && width >= 32 && height >= 32
    ? { sourceWidth: width, sourceHeight: height }
    : {};
};

const isUsableImage = (node?: NodeData): node is NodeData => Boolean(
  node
  && (node.type === NodeType.IMAGE || node.type === NodeType.IMAGE_EDITOR)
  && previewUrl(node)
  && !node.detailRemixSourceJobId,
);

const terminalState = (state: DetailRemixNodeData) => (
  ['plates-ready', 'completed', 'outdated', 'error', 'cancelled'].includes(state.status)
);

const isBusyState = (state: DetailRemixNodeData, node: NodeData) => (
  node.status === NodeStatus.LOADING
  || ['analyzing', 'generating-final', 'generating-plates', 'composing'].includes(state.status)
);

const collectEntryFiles = async (entry: any): Promise<File[]> => {
  if (!entry) return [];
  if (entry.isFile) {
    return new Promise(resolve => entry.file(
      (file: File) => {
        if (!file.webkitRelativePath && entry.fullPath) {
          try {
            Object.defineProperty(file, 'relativePath', {
              value: String(entry.fullPath).replace(/^\/+/, ''),
              configurable: true,
            });
          } catch {
            // Some browser File implementations are not extensible. Falling
            // back to file.name still keeps the import usable.
          }
        }
        resolve([file]);
      },
      () => resolve([]),
    ));
  }
  if (!entry.isDirectory) return [];
  const reader = entry.createReader();
  const entries: any[] = [];
  while (true) {
    const batch = await new Promise<any[]>(resolve => reader.readEntries(resolve, () => resolve([])));
    if (!batch.length) break;
    entries.push(...batch);
  }
  return (await Promise.all(entries.map(collectEntryFiles))).flat();
};

export const DetailRemixNode: React.FC<DetailRemixNodeProps> = ({
  workflowId,
  data,
  allNodes,
  selected,
  canvasTheme = 'dark',
  onUpdate,
  onNodePointerDown,
  onContextMenu,
  onConnectorDown,
  onImportFolder,
}) => {
  const dark = canvasTheme === 'dark';
  const state = createDetailRemixNodeData(data.detailRemix || {});
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const [localError, setLocalError] = React.useState('');
  const [localNotice, setLocalNotice] = React.useState('');
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [draggingFolderRole, setDraggingFolderRole] = React.useState<'competitor' | 'own' | null>(null);
  const competitorFolderInputRef = React.useRef<HTMLInputElement>(null);
  const ownFolderInputRef = React.useRef<HTMLInputElement>(null);
  const folderImportBusy = state.folderImports.competitor.status === 'uploading'
    || state.folderImports.own.status === 'uploading';
  const generationBusy = isBusyState(state, data);
  const busy = generationBusy || folderImportBusy;
  const imageNodes = allNodes.filter(isUsableImage);
  const byId = new Map(allNodes.map(node => [node.id, node]));
  const selectedCharacterId = state.inputRefs.characterReference.nodeIds[0] || '';
  const selectableReferenceNodes = imageNodes.filter(node => (
    !state.inputRefs.competitorDetailNodeIds.includes(node.id)
    && !state.inputRefs.ownDetailNodeIds.includes(node.id)
  ));
  const ownPoints = state.analysis?.ownSellingPoints || [];
  const pages = state.analysis?.pages || [];
  const ownKnowledgeQueue = {
    ...state.queueProgress.ownKnowledge,
    total: state.queueProgress.ownKnowledge.total || state.inputRefs.ownDetailNodeIds.length,
  };
  const competitorQueue = {
    ...state.queueProgress.competitor,
    total: state.queueProgress.competitor.total || state.inputRefs.competitorDetailNodeIds.length,
  };
  const resultCount = pages.filter((page: any) => (
    page?.resultReady || page?.resultUrl || page?.finalUrl || page?.compositeReady || page?.plateReady
  )).length;
  const failedPages = pages.filter((page: any) => page?.status === 'failed');
  const validationFailedPages = pages.filter((page: any) => (
    page?.status === 'failed_validation' || page?.terminalStatus === 'FAILED_VALIDATION'
  ));
  const safeFailedPages = failedPages.filter((page: any) => (
    !page?.codexImageJobId
    && !page?.plateCodexImageJobId
    && !page?.composeCodexImageJobId
    && !page?.resultReady
    && page?.recognitionStatus !== 'completed'
  ));
  const formatFailedPages = safeFailedPages.filter((page: any) => (
    /JSON|结构化|格式校验/u.test(String(page?.recognitionLastError || page?.error || ''))
  ));
  const failedPageNumbers = safeFailedPages.map((page: any) => Number(page.index) + 1);
  const provider = getImageGenerationProvider(data.imageModel || 'google-flow-nano-banana-pro')
    || getImageGenerationProvider('google-flow-nano-banana-pro')!;
  const resolution = normalizeImageResolution(provider.id, data.resolution) || provider.resolutions[0] || 'Auto';

  const commitStateAndRefs = React.useCallback((nextState: DetailRemixNodeData) => {
    const mapping = buildDetailRemixInputMapping(nextState.inputRefs);
    const synced = syncDetailRemixInputRefs({
      ...data,
      parentIds: Object.keys(mapping),
      inputPortByParentId: mapping,
      detailRemix: nextState,
    }, mapping);
    const normalized = createDetailRemixNodeData(synced.detailRemix);
    stateRef.current = normalized;
    onUpdate(data.id, {
      parentIds: synced.parentIds,
      inputPortByParentId: synced.inputPortByParentId,
      detailRemix: normalized,
    });
    return normalized;
  }, [data, onUpdate]);

  const withInputRefs = (inputRefs: DetailRemixNodeData['inputRefs']) => commitStateAndRefs(
    createDetailRemixNodeData({
      ...state,
      inputRefs,
      status: terminalState(state) && state.status !== 'error' ? 'outdated' : state.status,
      needsRegeneration: Boolean(state.jobId),
    }),
  );

  const handleFolderFiles = async (role: 'competitor' | 'own', files: File[]) => {
    if (busy || !files.length) return;
    if (!onImportFolder) {
      setLocalError('当前版本尚未连接文件夹导入能力，请完整重启应用后重试');
      return;
    }
    setLocalError('');
    try {
      await onImportFolder({ id: data.id, x: data.x, y: data.y }, role, files);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '详情文件夹导入失败');
    }
  };

  const handleFolderDrop = async (event: React.DragEvent, role: 'competitor' | 'own') => {
    event.preventDefault();
    event.stopPropagation();
    setDraggingFolderRole(null);
    const entries = Array.from(event.dataTransfer.items)
      .map(item => (item as any).webkitGetAsEntry?.())
      .filter(Boolean);
    const files = entries.length
      ? (await Promise.all(entries.map(collectEntryFiles))).flat()
      : Array.from(event.dataTransfer.files);
    await handleFolderFiles(role, files);
  };

  const updateCharacterEnabled = (enabled: boolean) => {
    setLocalError('');
    withInputRefs({
      ...state.inputRefs,
      characterReference: { ...state.inputRefs.characterReference, enabled },
    });
  };

  const updateCharacterReference = (nodeId: string) => {
    setLocalError('');
    withInputRefs({
      ...state.inputRefs,
      characterReference: { ...state.inputRefs.characterReference, nodeIds: nodeId ? [nodeId] : [] },
    });
  };

  const updatePlateSettings = (nodeUpdates: Partial<NodeData>, stateUpdates: Partial<DetailRemixNodeData> = {}) => {
    const nextState = createDetailRemixNodeData({
      ...state,
      ...stateUpdates,
      status: state.jobId && terminalState(state) && state.status !== 'error' ? 'outdated' : state.status,
      needsRegeneration: Boolean(state.jobId),
    });
    stateRef.current = nextState;
    onUpdate(data.id, { ...nodeUpdates, detailRemix: nextState });
  };

  const handleExecute = async () => {
    if (busy) return;
    if (!workflowId) {
      setLocalError('请先新建或打开一个项目');
      return;
    }
    const requestState = state;
    const preflight = validateDetailRemixPreflight(requestState, allNodes, { phase: 'final' });
    if (!preflight.ok || !preflight.refs) {
      setLocalError(preflight.error || '详情输入尚未准备好');
      return;
    }
    const referenceNodes = (ids: string[]) => ids.map(id => byId.get(id)).filter(isUsableImage);
    const competitorNodes = referenceNodes(preflight.refs.competitorDetailNodeIds);
    const ownNodes = referenceNodes(preflight.refs.ownDetailNodeIds);
    const characterNodes = referenceNodes(preflight.refs.characterNodeIds);
    const productNodes = referenceNodes(preflight.refs.productNodeIds);
    const requestFingerprint = JSON.stringify({
      competitor: competitorNodes.map(node => [node.id, previewUrl(node)]),
      own: ownNodes.map(node => [node.id, previewUrl(node)]),
      characterReferenceEnabled: requestState.inputRefs.characterReference.enabled,
      characters: characterNodes.map(node => [node.id, previewUrl(node)]),
      products: productNodes.map(node => [node.id, previewUrl(node)]),
      recognitionProvider: requestState.recognitionProvider,
      imageModel: provider.id,
      sizingMode: 'match-competitor',
      competitorDimensions: competitorNodes.map(node => [node.id, node.resultAspectRatio || '']),
      resolution,
    });
    const requestId = requestState.pendingRequestId
      && requestState.pendingRequestFingerprint === requestFingerprint
      ? requestState.pendingRequestId
      : crypto.randomUUID();
    const pending = createDetailRemixNodeData({
      ...requestState,
      pendingRequestId: requestId,
      pendingRequestFingerprint: requestFingerprint,
      status: 'analyzing',
      stage: 'queued',
      stageLabel: '正在创建商品详情复刻任务',
      errorMessage: undefined,
      needsRegeneration: false,
      compositionNeedsRegeneration: false,
      activeInputFingerprint: requestFingerprint,
      queueProgress: {
        ownKnowledge: {
          status: 'waiting', total: ownNodes.length, completed: 0, failed: 0, sellingPointCount: 0,
        },
        competitor: {
          status: 'waiting', total: competitorNodes.length, completed: 0, failed: 0,
        },
        composition: { status: 'waiting', total: 0, completed: 0, failed: 0 },
      },
    });
    stateRef.current = pending;
    setLocalError('');
    setLocalNotice('');
    onUpdate(data.id, {
      status: NodeStatus.LOADING,
      generationStartTime: Date.now(),
      errorMessage: undefined,
      detailRemix: pending,
    });
    try {
      const job = await createDetailRemixJob({
        jobId: requestId,
        workflowId,
        nodeId: data.id,
        competitorImages: competitorNodes.map(node => previewUrl(node)!),
        ownDetailImages: ownNodes.map(node => previewUrl(node)!),
        competitorNodeIds: competitorNodes.map(node => node.id),
        ownDetailNodeIds: ownNodes.map(node => node.id),
        characterReferenceEnabled: requestState.inputRefs.characterReference.enabled,
        characterImages: characterNodes.map(node => previewUrl(node)!),
        characterNodeIds: characterNodes.map(node => node.id),
        productImages: productNodes.map(node => previewUrl(node)!),
        productNodeIds: productNodes.map(node => node.id),
        recognitionProvider: requestState.recognitionProvider,
        imageModel: provider.id,
        sizingMode: 'match-competitor',
        competitorDetails: competitorNodes.map((node, index) => ({
          imageUrl: previewUrl(node)!,
          nodeId: node.id,
          order: index,
          ...sourcePixelDimensions(node),
        })),
        resolution,
      });
      const latest = stateRef.current;
      onUpdate(data.id, {
        status: NodeStatus.LOADING,
        detailRemix: createDetailRemixNodeData({
          ...latest,
          pendingRequestId: undefined,
          pendingRequestFingerprint: undefined,
          jobId: job.id,
          jobStatus: job.status,
          stage: job.stage,
          stageLabel: job.stageLabel,
          version: job.version,
          analysis: { ...latest.analysis, pages: job.pages || [] },
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法创建商品详情复刻任务';
      setLocalError(message);
      onUpdate(data.id, {
        status: NodeStatus.ERROR,
        generationStartTime: undefined,
        errorMessage: message,
        detailRemix: createDetailRemixNodeData({
          ...stateRef.current,
          pendingRequestId: requestId,
          pendingRequestFingerprint: requestFingerprint,
          status: 'error',
          errorMessage: message,
        }),
      });
    }
  };

  const handleRetryFailed = async () => {
    if (busy || !workflowId || !state.jobId || safeFailedPages.length === 0) return;
    const retrying = createDetailRemixNodeData({
      ...stateRef.current,
      status: 'analyzing',
      jobStatus: 'pending',
      stage: 'queued',
      stageLabel: `准备仅重试失败页（${safeFailedPages.length} 页）`,
      errorMessage: undefined,
    });
    stateRef.current = retrying;
    setLocalError('');
    setLocalNotice('');
    onUpdate(data.id, {
      status: NodeStatus.LOADING,
      generationStartTime: Date.now(),
      errorMessage: undefined,
      detailRemix: retrying,
    });
    try {
      const job = await retryFailedDetailRemixPages(state.jobId, workflowId);
      const latest = stateRef.current;
      onUpdate(data.id, {
        status: NodeStatus.LOADING,
        detailRemix: createDetailRemixNodeData({
          ...latest,
          jobStatus: job.status,
          stage: job.stage,
          stageLabel: job.stageLabel,
          analysis: { ...latest.analysis, pages: job.pages || [] },
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法重试失败详情页';
      setLocalError(message);
      onUpdate(data.id, {
        status: resultCount ? NodeStatus.SUCCESS : NodeStatus.ERROR,
        generationStartTime: undefined,
        errorMessage: message,
        detailRemix: createDetailRemixNodeData({
          ...stateRef.current,
          status: 'error',
          errorMessage: message,
        }),
      });
    }
  };

  const handleExport = async () => {
    if (!workflowId || !state.jobId || !resultCount) return;
    if (!window.evanDesktop?.exportDetailRemix) {
      setLocalError('一键导出仅在 Evan 桌面应用中可用，请完整重启桌面应用后重试');
      return;
    }
    setLocalError('');
    setLocalNotice('');
    try {
      const result = await window.evanDesktop.exportDetailRemix({ jobId: state.jobId, workflowId });
      if (!result.canceled) {
        setLocalNotice(`已按顺序导出 ${result.count} 张：01 至 ${String(result.count).padStart(2, '0')}`);
      }
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '详情图导出失败');
    }
  };

  const handleCancel = async () => {
    if (!workflowId || !state.jobId) return;
    try {
      const job = await cancelDetailRemixJob(state.jobId, workflowId);
      const latest = stateRef.current;
      onUpdate(data.id, {
        status: resultCount ? NodeStatus.SUCCESS : NodeStatus.IDLE,
        generationStartTime: undefined,
        errorMessage: job.error || undefined,
        detailRemix: createDetailRemixNodeData({
          ...latest,
          status: 'cancelled',
          jobStatus: job.status,
          stage: job.stage,
          stageLabel: job.stageLabel,
          errorMessage: job.error,
        }),
      });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '取消失败');
    }
  };

  const folderImportCard = (
    role: 'competitor' | 'own',
    label: string,
    accent: string,
    inputRef: React.RefObject<HTMLInputElement | null>,
  ) => {
    const info = state.folderImports[role];
    const ids = role === 'competitor'
      ? state.inputRefs.competitorDetailNodeIds
      : state.inputRefs.ownDetailNodeIds;
    const uploading = info.status === 'uploading';
    const folderLabel = uploading
      ? `正在导入 ${info.uploaded + info.failed}/${info.total}`
      : info.folderName || (ids.length ? '已通过端口绑定图片' : '尚未导入文件夹');
    return (
      <div
        className={`min-w-0 flex-1 rounded-xl border p-2.5 transition-colors ${draggingFolderRole === role
          ? 'border-violet-400 bg-violet-500/10'
          : dark ? 'border-neutral-700 bg-[#181818]' : 'border-neutral-200 bg-neutral-50'}`}
        onDragEnter={event => {
          if (!busy && event.dataTransfer.types.includes('Files')) setDraggingFolderRole(role);
        }}
        onDragOver={event => {
          if (busy || !event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDraggingFolderRole(null);
        }}
        onDrop={event => void handleFolderDrop(event, role)}
      >
        <div className="flex items-center justify-between gap-2">
          <span className={`truncate text-xs font-semibold ${accent}`}>{label}</span>
          <span className="rounded-full bg-neutral-500/15 px-2 py-0.5 text-[11px] text-neutral-500">{ids.length} 张</span>
        </div>
        <div className="mt-1 truncate text-[10px] text-neutral-500" title={folderLabel}>{folderLabel}</div>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] ${dark ? 'border-neutral-600 hover:border-neutral-400' : 'border-neutral-300 hover:bg-neutral-100'} disabled:opacity-40`}
        >
          {uploading ? <Loader2 size={12} className="animate-spin" /> : <FolderOpen size={12} />}
          {ids.length ? '替换文件夹' : '选择文件夹'}
        </button>
      </div>
    );
  };

  const statusTone = state.status === 'error'
    ? 'text-red-400'
    : ['completed', 'plates-ready'].includes(state.status)
      ? 'text-emerald-400'
      : state.status === 'outdated'
        ? 'text-amber-400'
        : 'text-cyan-400';
  const queuePercent = (queue: { total: number; completed: number; failed: number }) => (
    queue.total > 0 ? Math.min(100, Math.round(((queue.completed + queue.failed) / queue.total) * 100)) : 0
  );
  const ownQueueLabel = ownKnowledgeQueue.status === 'completed'
    ? '卖点、参数与产品角度库已就绪'
    : ownKnowledgeQueue.status === 'processing'
      ? '正在识别卖点、参数与产品角度'
      : '等待读取我的详情';
  const competitorQueueLabel = competitorQueue.status === 'completed'
    ? '竞品队列已完成'
    : competitorQueue.status === 'processing'
      ? `正在处理第 ${Math.min(competitorQueue.total, (competitorQueue.currentIndex ?? 0) + 1)} 张`
      : '等待逐张处理竞品';

  return (
    <div
      data-node-id={data.id}
      className="group/node absolute touch-none pointer-events-auto"
      style={{ transform: `translate(${data.x}px, ${data.y}px)`, zIndex: selected ? 50 : 10 }}
      onPointerDown={event => onNodePointerDown(event, data.id)}
      onContextMenu={event => onContextMenu(event, data.id)}
    >
      <NodeConnectors
        nodeId={data.id}
        hideLeft
        inputPorts={inputPorts}
        onConnectorDown={onConnectorDown}
        canvasTheme={canvasTheme}
      />
      <div
        className={`overflow-hidden rounded-[22px] border shadow-2xl transition-all ${dark ? 'border-neutral-700 bg-[#101010]' : 'border-neutral-200 bg-white'} ${selected ? 'border-violet-500 ring-1 ring-violet-500/30' : ''}`}
        style={{ width: DETAIL_REMIX_NODE_WIDTH, height: DETAIL_REMIX_NODE_HEIGHT }}
      >
        <div className={`flex h-[54px] items-center justify-between border-b px-4 ${dark ? 'border-neutral-800' : 'border-neutral-200'}`}>
          <div className="flex items-center gap-2 font-semibold">
            <WandSparkles size={18} className="text-violet-400" />商品详情一键复刻
          </div>
          <span className="text-[11px] text-neutral-500">分析提示词 → 一次生成最终图</span>
        </div>

        <div
          className="space-y-2 overflow-y-auto p-3"
          style={{ height: DETAIL_REMIX_NODE_HEIGHT - 54 }}
          onPointerDown={event => event.stopPropagation()}
        >
          <input
            ref={competitorFolderInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
            multiple
            hidden
            {...({ webkitdirectory: '', directory: '' } as any)}
            onChange={event => {
              const files = Array.from(event.currentTarget.files || []);
              event.currentTarget.value = '';
              void handleFolderFiles('competitor', files);
            }}
          />
          <input
            ref={ownFolderInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
            multiple
            hidden
            {...({ webkitdirectory: '', directory: '' } as any)}
            onChange={event => {
              const files = Array.from(event.currentTarget.files || []);
              event.currentTarget.value = '';
              void handleFolderFiles('own', files);
            }}
          />
          <div className={`rounded-xl border px-3 py-2 text-[11px] leading-5 ${dark ? 'border-violet-500/20 bg-violet-500/5 text-neutral-400' : 'border-violet-200 bg-violet-50 text-neutral-600'}`}>
            导入后，“我的详情”在最上方、“竞品详情”在下方。系统会从我的详情中识别卖点、Logo、产品角度与可追溯参数证据，无需单独上传产品图；参数页自动进入严格模式，参数名和值分栏映射，无证据字段直接删除。正式生成时把竞品原图、匹配产品、证据页、可选人物及逐位置替换清单一次性交给 AI，不做本地叠字或多轮拼图。
          </div>

          <div className="flex gap-2">
            {folderImportCard('own', '我的详情文件夹', 'text-cyan-400', ownFolderInputRef)}
            {folderImportCard('competitor', '竞品详情文件夹', 'text-rose-400', competitorFolderInputRef)}
          </div>
          <p className="px-1 text-[10px] text-neutral-500">也可以把散图连接到左侧对应端口；只有自动识别不到清晰产品角度时，才需要使用“产品补充图（可选）”。</p>

          <div className={`rounded-xl border p-3 ${dark ? 'border-neutral-700 bg-[#181818]' : 'border-neutral-200 bg-neutral-50'}`}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-xs font-semibold"><UserRound size={14} className="text-amber-400" />人物参考图 <span className="font-normal text-neutral-500">（可选）</span></span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-neutral-500">{state.inputRefs.characterReference.enabled ? '已开启' : '已关闭'}</span>
                <button
                  type="button"
                  role="switch"
                  aria-label="启用人物参考图"
                  aria-checked={state.inputRefs.characterReference.enabled}
                  onClick={() => updateCharacterEnabled(!state.inputRefs.characterReference.enabled)}
                  className={`relative h-6 w-11 rounded-full transition-colors ${state.inputRefs.characterReference.enabled ? 'bg-violet-500' : 'bg-neutral-600'}`}
                >
                  <span className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition-transform ${state.inputRefs.characterReference.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>
            <select
              value={selectedCharacterId}
              onChange={event => updateCharacterReference(event.target.value)}
              disabled={!state.inputRefs.characterReference.enabled}
              className={`w-full rounded-lg border px-2.5 py-2 text-xs outline-none ${dark ? 'border-neutral-700 bg-[#242424]' : 'border-neutral-300 bg-white'} disabled:opacity-45`}
            >
              <option value="">{state.inputRefs.characterReference.enabled
                ? selectableReferenceNodes.length ? '请选择人物参考图（执行前必选）' : '请先在画布导入一张人物参考图'
                : '人物参考已关闭'}</option>
              {selectableReferenceNodes.map((node, index) => (
                <option key={node.id} value={node.id}>{resolveImageNodeDisplayName(node, index + 1)}</option>
              ))}
            </select>
            <p className="mt-1.5 text-[10px] text-neutral-500">
              开启后，仅在竞品详情原本有人物时，用所选参考图保持同一人物身份；关闭时不会发送人物图。
            </p>
          </div>

          <div className={`rounded-xl border px-3 py-2.5 ${dark ? 'border-neutral-700 bg-neutral-900/70' : 'border-neutral-200 bg-neutral-50'}`}>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className={`flex items-center gap-1.5 font-semibold ${statusTone}`}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : state.status === 'error' ? <AlertCircle size={13} /> : <CheckCircle2 size={13} />}
                {state.stageLabel || (state.status === 'idle' ? '等待执行' : state.status)}
              </span>
              <span className="text-neutral-500">卖点 {ownPoints.length} · 参数 {Number(state.verifiedFactCount) || 0} · 产品角度 {Number(state.productViewCount) || 0} · 最终图 {resultCount}</span>
            </div>
            {state.needsRegeneration && <div className="mt-1 text-[10px] text-amber-400">输入设置已变化；不会自动扣费，点“执行”才生成新版本。</div>}
            {safeFailedPages.length > 0 && !generationBusy && (
              <div className="mt-1 text-[10px] leading-4 text-amber-400">
                {formatFailedPages.length === safeFailedPages.length
                  ? `第 ${failedPageNumbers.join('、')} 页仅识图格式失败，尚未进入生图，可安全重试。`
                  : `第 ${failedPageNumbers.join('、')} 页在生图提交前失败，可只重试这些页面。`}
              </div>
            )}
            {validationFailedPages.length > 0 && !generationBusy && (
              <div className="mt-1 text-[10px] leading-4 text-red-400">
                第 {validationFailedPages.map((page: any) => Number(page.index) + 1).join('、')} 页已标记 FAILED_VALIDATION；一次定向修复后仍未通过，不会作为成功结果，也不会自动再次付费生成。
              </div>
            )}
            <div className="mt-2 space-y-2 border-t border-neutral-500/20 pt-2">
              <div>
                <div className="flex items-center justify-between gap-2 text-[10px]">
                  <span className="flex items-center gap-1 text-neutral-400"><Database size={11} />{ownQueueLabel}</span>
                  <span className="text-neutral-500">{ownKnowledgeQueue.completed}/{ownKnowledgeQueue.total} 张 · {ownKnowledgeQueue.sellingPointCount || ownPoints.length} 卖点 · {Number(state.verifiedFactCount) || 0} 参数 · {Number(state.productViewCount) || 0} 角度</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-neutral-500/20"><div className="h-full rounded-full bg-cyan-500 transition-[width]" style={{ width: `${queuePercent(ownKnowledgeQueue)}%` }} /></div>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2 text-[10px]">
                  <span className="flex items-center gap-1 text-neutral-400"><ListOrdered size={11} />{competitorQueueLabel}</span>
                  <span className="text-neutral-500">{competitorQueue.completed}/{competitorQueue.total} 张{competitorQueue.failed ? ` · 失败 ${competitorQueue.failed}` : ''}</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-neutral-500/20"><div className="h-full rounded-full bg-violet-500 transition-[width]" style={{ width: `${queuePercent(competitorQueue)}%` }} /></div>
              </div>
            </div>
            {(localError || data.errorMessage || state.errorMessage) && (
              <div className="mt-1.5 flex items-start gap-1 text-[11px] text-red-400"><AlertCircle size={12} className="mt-0.5 shrink-0" />{localError || data.errorMessage || state.errorMessage}</div>
            )}
            {localNotice && (
              <div className="mt-1.5 flex items-start gap-1 text-[11px] text-emerald-400"><CheckCircle2 size={12} className="mt-0.5 shrink-0" />{localNotice}</div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setAdvancedOpen(open => !open)}
            className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs ${dark ? 'border-neutral-700 bg-[#181818]' : 'border-neutral-300 bg-neutral-50'}`}
          >
            <span className="flex items-center gap-1.5"><Images size={13} />高级设置</span>
            <ChevronDown size={13} className={`transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
          </button>
          {advancedOpen && (
            <div className="grid grid-cols-2 gap-2">
              <select
                aria-label="详情识图模型"
                value={state.recognitionProvider}
                onChange={event => updatePlateSettings({}, { recognitionProvider: event.target.value as DetailRemixNodeData['recognitionProvider'] })}
                className={`rounded-lg border px-2 py-2 text-xs ${dark ? 'border-neutral-700 bg-[#181818]' : 'border-neutral-300 bg-white'}`}
              >
                <option value="gemini-web">Gemini Web 识图</option>
                <option value="codex-cli">Codex CLI 识图</option>
              </select>
              <select
                aria-label="详情图片模型"
                value={provider.id}
                onChange={event => {
                  const next = getImageGenerationProvider(event.target.value)!;
                  updatePlateSettings({
                    imageModel: next.id,
                    resolution: normalizeImageResolution(next.id, data.resolution) || next.resolutions[0],
                  });
                }}
                className={`min-w-0 rounded-lg border px-2 py-2 text-xs ${dark ? 'border-neutral-700 bg-[#181818]' : 'border-neutral-300 bg-white'}`}
              >
                {listImageGenerationProviders().filter(model => model.supportsImageToImage).map(model => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))}
              </select>
              <div
                aria-label="详情图尺寸"
                className={`rounded-lg border px-2 py-2 text-xs ${dark ? 'border-neutral-700 bg-[#181818]' : 'border-neutral-300 bg-white'}`}
                title="每一张结果都继承对应竞品图的原始宽高与像素尺寸"
              >
                <div className="text-[9px] text-neutral-500">输出尺寸</div>
                <div className="mt-0.5 font-medium">逐张跟随竞品原图</div>
              </div>
              <select
                aria-label="详情图分辨率"
                title="模型生成清晰度；最终图片的宽高仍逐张跟随竞品原图"
                value={resolution}
                onChange={event => updatePlateSettings({ resolution: event.target.value })}
                className={`rounded-lg border px-2 py-2 text-xs ${dark ? 'border-neutral-700 bg-[#181818]' : 'border-neutral-300 bg-white'}`}
              >
                {provider.resolutions.map(value => <option key={value}>{value}</option>)}
              </select>
            </div>
          )}

          <div className={`sticky bottom-0 z-10 -mx-3 border-t px-3 pb-1 pt-2 backdrop-blur ${dark ? 'border-neutral-800 bg-[#101010]/95' : 'border-neutral-200 bg-white/95'}`}>
            <div className="flex gap-2">
              {!generationBusy && safeFailedPages.length > 0 ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleRetryFailed()}
                  className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-violet-600 px-2 py-2.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-45"
                  title="保留全部成功图片，只重新识别并生成尚未进入生图的失败页"
                >
                  <RefreshCw size={14} />仅重试失败 {safeFailedPages.length} 页
                </button>
              ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleExecute()}
                className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                {generationBusy
                  ? '生成中'
                  : folderImportBusy
                    ? '导入中'
                    : state.jobId ? '重新生成最终详情' : '生成最终详情'}
              </button>
              )}
              {!generationBusy && resultCount > 0 && (
                <button
                  type="button"
                  disabled={folderImportBusy}
                  onClick={() => void handleExport()}
                  className={`flex shrink-0 items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-semibold ${dark ? 'border-cyan-700 text-cyan-300 hover:bg-cyan-500/10' : 'border-cyan-300 text-cyan-700 hover:bg-cyan-50'} disabled:opacity-45`}
                  title="选择文件夹，按页面顺序导出为 01、02……"
                >
                  <Download size={14} />一键导出 {resultCount} 张
                </button>
              )}
              {generationBusy && state.jobId && (
                <GenerationCancelButton
                  dark={dark}
                  onCancel={handleCancel}
                  label="取消生成"
                  className="shrink-0 px-3 text-xs"
                />
              )}
            </div>
            {!generationBusy && safeFailedPages.length > 0 && (
              <button
                type="button"
                disabled={folderImportBusy}
                onClick={() => void handleExecute()}
                className="mt-1.5 w-full text-center text-[10px] text-neutral-500 hover:text-neutral-300 disabled:opacity-40"
                title="创建新任务并重新生成所有页面，已有成功页也会再次生图"
              >
                全部重新生成（成功页也会重新生图）
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
