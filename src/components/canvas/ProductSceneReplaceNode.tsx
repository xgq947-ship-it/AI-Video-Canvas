import React from 'react';
import { Box, FileText, Film, Image as ImageIcon, Loader2, PackageCheck, Ruler, Tags, UserRound, WandSparkles, X } from 'lucide-react';
import { NodeData, NodeStatus, NodeType } from '../../types';
import { NodeConnectors } from './NodeConnectors';
import { validateProductDimensions } from '../../../shared/productSceneReplacement.js';
import { MASSAGE_EQUIPMENT_SECTIONS } from '../../../shared/massageEquipmentCategories.js';
import {
  IMAGE_GENERATION_PROVIDERS,
  getImageGenerationProvider,
  getVideoGenerationProvider,
  normalizeImageAspectRatio,
  resolveVideoModelForAspectRatio,
  supportedImageOutputCounts,
  videoModelsForAspectRatio,
} from '../../../shared/generationProviders.js';
import { cancelProductSceneJob } from '../../services/generationService';

// 与服务端同一个默认值：产品短视频以竖版投放为主。
const DEFAULT_ASPECT_RATIO = '9:16';

interface Props {
  workflowId?: string;
  data: NodeData;
  allNodes: NodeData[];
  selected: boolean;
  canvasTheme: 'dark' | 'light';
  onUpdate: (id: string, updates: Partial<NodeData>) => void;
  onGenerate: (id: string) => void;
  onNodePointerDown: (event: React.PointerEvent, id: string) => void;
  onContextMenu: (event: React.MouseEvent, id: string) => void;
  onConnectorDown: (event: React.PointerEvent, id: string, side: 'left' | 'right') => void;
}

const previewUrl = (node?: NodeData) => node?.resultUrl || node?.editorBackgroundUrl;

export const ProductSceneReplaceNode: React.FC<Props> = ({
  workflowId,
  data,
  allNodes,
  selected,
  canvasTheme,
  onUpdate,
  onGenerate,
  onNodePointerDown,
  onContextMenu,
  onConnectorDown,
}) => {
  const isDark = canvasTheme === 'dark';
  const connectedImages = (data.parentIds || [])
    .map(id => allNodes.find(node => node.id === id))
    .filter((node): node is NodeData => Boolean(
      node &&
      (node.type === NodeType.IMAGE || node.type === NodeType.IMAGE_EDITOR) &&
      previewUrl(node)
    ));
  const connectedTextNodes = (data.parentIds || [])
    .map(id => allNodes.find(node => node.id === id))
    .filter((node): node is NodeData => Boolean(node?.type === NodeType.TEXT));

  const availableIds = new Set(connectedImages.map(node => node.id));
  const sceneId = data.sceneReferenceId && availableIds.has(data.sceneReferenceId)
    ? data.sceneReferenceId
    : connectedImages[0]?.id || '';
  const productId = data.productReferenceId && availableIds.has(data.productReferenceId) && data.productReferenceId !== sceneId
    ? data.productReferenceId
    : connectedImages.find(node => node.id !== sceneId)?.id || '';
  const sceneNode = allNodes.find(node => node.id === sceneId);
  const productNode = allNodes.find(node => node.id === productId);
  const promptSourceId = data.productSceneVideoPromptSourceId && connectedTextNodes.some(node => node.id === data.productSceneVideoPromptSourceId)
    ? data.productSceneVideoPromptSourceId
    : connectedTextNodes[0]?.id || '';
  const promptNode = allNodes.find(node => node.id === promptSourceId);
  const imageProvider = getImageGenerationProvider(data.imageModel)
    || getImageGenerationProvider('google-flow-nano-banana-pro')!;
  const imageCounts = supportedImageOutputCounts(imageProvider.id);
  const imageCount = Math.min(imageCounts[imageCounts.length - 1], Math.max(1, data.productSceneImageCount || 1));
  // 用户指定的这一个比例同时决定替换图和短视频；不在图片模型能力表里时收口到它支持的值。
  const aspectRatio = normalizeImageAspectRatio(imageProvider.id, data.aspectRatio || DEFAULT_ASPECT_RATIO)
    || DEFAULT_ASPECT_RATIO;
  // 比例是硬的、模型是软的：选的视频模型撑不住这个比例就自动换一个撑得住的。
  const videoChoice = resolveVideoModelForAspectRatio(aspectRatio, data.productSceneVideoModel || 'gemini-web-video');
  const videoProvider = videoChoice ? getVideoGenerationProvider(videoChoice.modelId) : null;
  const videoCandidates = videoModelsForAspectRatio(aspectRatio);
  const videoDurations = videoProvider?.supportedDurations || [];
  const dimensions = data.productDimensions || { length: 0, width: 0, height: 0, unit: 'cm' as const };
  const dimensionError = validateProductDimensions(dimensions);
  const missingVideoPrompt = data.productSceneAutoGenerateVideo && !promptNode?.prompt?.trim();
  // 没有任何视频模型支持这个比例时不做静默裁切，直接不让生成，并在界面上说清楚。
  const unsupportedVideoRatio = Boolean(data.productSceneAutoGenerateVideo && !videoProvider);
  const canGenerate = Boolean(
    sceneNode && productNode && !dimensionError && !missingVideoPrompt
    && !unsupportedVideoRatio && data.status !== NodeStatus.LOADING
  );

  React.useEffect(() => {
    const updates: Partial<NodeData> = {};
    if (sceneId !== (data.sceneReferenceId || '')) updates.sceneReferenceId = sceneId || undefined;
    if (productId !== (data.productReferenceId || '')) updates.productReferenceId = productId || undefined;
    if (promptSourceId !== (data.productSceneVideoPromptSourceId || '')) updates.productSceneVideoPromptSourceId = promptSourceId || undefined;
    // 比例只由用户决定，不再跟着场景参考图变 —— 之前换一张竖图就会把用户选好的
    // 比例悄悄改掉，而视频那边的比例又是另一个独立字段，两边对不上就被平台裁切。
    if (aspectRatio !== data.aspectRatio) updates.aspectRatio = aspectRatio;
    // 视频模型跟着比例走，把自动换过的结果写回节点，界面与提交保持一致。
    if (videoChoice && videoChoice.modelId !== data.productSceneVideoModel) {
      updates.productSceneVideoModel = videoChoice.modelId;
    }
    if (Object.keys(updates).length > 0) {
      onUpdate(data.id, updates);
    }
  }, [aspectRatio, data.aspectRatio, data.id, data.productReferenceId, data.productSceneVideoModel, data.productSceneVideoPromptSourceId, data.sceneReferenceId, onUpdate, productId, promptSourceId, sceneId, videoChoice]);

  const handleCancel = async () => {
    if (!workflowId || !data.productSceneJobId) return;
    try {
      await cancelProductSceneJob(data.productSceneJobId, workflowId);
      onUpdate(data.id, { productSceneStageLabel: '正在结束当前任务，后续视频将不再提交' });
    } catch (error) {
      onUpdate(data.id, { errorMessage: error instanceof Error ? error.message : '取消队列失败' });
    }
  };

  const updateDimension = (field: 'length' | 'width' | 'height', raw: string) => {
    onUpdate(data.id, {
      productDimensions: { ...dimensions, [field]: raw === '' ? 0 : Number(raw) }
    });
  };

  const referenceCard = (
    label: string,
    value: string,
    role: 'scene' | 'product',
    icon: React.ReactNode,
  ) => {
    const node = allNodes.find(item => item.id === value);
    return (
      <div className={`min-w-0 flex-1 rounded-xl border p-2.5 ${isDark ? 'border-neutral-700 bg-[#181818]' : 'border-neutral-200 bg-neutral-50'}`}>
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
          {icon}<span>{label}</span>
        </div>
        <div className={`mb-2 flex h-24 items-center justify-center overflow-hidden rounded-lg ${isDark ? 'bg-neutral-900' : 'bg-neutral-200'}`}>
          {previewUrl(node) ? (
            <img src={previewUrl(node)} alt={label} className="h-full w-full object-cover" draggable={false} />
          ) : (
            <div className="px-3 text-center text-xs text-neutral-500">连接一张图片节点</div>
          )}
        </div>
        <select
          value={value}
          onChange={event => onUpdate(data.id, role === 'scene'
            ? { sceneReferenceId: event.target.value || undefined }
            : { productReferenceId: event.target.value || undefined })}
          onPointerDown={event => event.stopPropagation()}
          className={`w-full rounded-lg border px-2 py-1.5 text-xs outline-none ${isDark ? 'border-neutral-700 bg-[#242424] text-neutral-200' : 'border-neutral-300 bg-white text-neutral-800'}`}
        >
          <option value="">请选择已连接图片</option>
          {connectedImages.map((item, index) => (
            <option key={item.id} value={item.id} disabled={role === 'scene' ? item.id === productId : item.id === sceneId}>
              {item.title || `参考图 ${index + 1}`}
            </option>
          ))}
        </select>
      </div>
    );
  };

  return (
    <div
      data-node-id={data.id}
      className="absolute group/node touch-none pointer-events-auto"
      style={{ transform: `translate(${data.x}px, ${data.y}px)`, zIndex: selected ? 50 : 10 }}
      onPointerDown={event => onNodePointerDown(event, data.id)}
      onContextMenu={event => onContextMenu(event, data.id)}
    >
      <NodeConnectors nodeId={data.id} onConnectorDown={onConnectorDown} canvasTheme={canvasTheme} />
      <div className={`w-[460px] overflow-hidden rounded-2xl border shadow-2xl transition-all duration-200 ${isDark ? 'border-neutral-700 bg-[#101010]' : 'border-neutral-200 bg-white'} ${selected ? 'border-cyan-500 ring-1 ring-cyan-500/30' : ''}`}>
        <div className={`flex items-center justify-between border-b px-4 py-3 ${isDark ? 'border-neutral-800' : 'border-neutral-200'}`}>
          <div className="flex items-center gap-2 font-semibold"><WandSparkles size={17} className="text-cyan-400" />产品短视频生成</div>
          <span className="text-[11px] text-neutral-500">替换图 → 视频队列</span>
        </div>

        <div className="space-y-3 p-3" onPointerDown={event => event.stopPropagation()}>
          <div className="flex gap-2.5">
            {referenceCard('场景参考', sceneId, 'scene', <ImageIcon size={14} className="text-blue-400" />)}
            {referenceCard('我方产品', productId, 'product', <PackageCheck size={14} className="text-emerald-400" />)}
          </div>

          <label className={`block rounded-xl border p-3 ${isDark ? 'border-neutral-700 bg-[#181818]' : 'border-neutral-200 bg-neutral-50'}`}>
            <span className="mb-2 flex items-center gap-1.5 text-xs font-semibold"><FileText size={14} className="text-cyan-400" />短视频提示词来源</span>
            <select
              value={promptSourceId}
              onChange={event => onUpdate(data.id, { productSceneVideoPromptSourceId: event.target.value || undefined })}
              className={`w-full rounded-lg border px-2.5 py-2 text-xs outline-none ${isDark ? 'border-neutral-700 bg-[#242424]' : 'border-neutral-300 bg-white'}`}
            >
              <option value="">未连接文本节点（仍可只生成图片）</option>
              {connectedTextNodes.map((node, index) => <option key={node.id} value={node.id}>{node.title || `短视频提示词 ${index + 1}`}</option>)}
            </select>
            {promptNode?.prompt && <p className="mt-2 line-clamp-2 text-[11px] text-neutral-500">{promptNode.prompt}</p>}
          </label>

          <label className={`block rounded-xl border p-3 ${isDark ? 'border-neutral-700 bg-[#181818]' : 'border-neutral-200 bg-neutral-50'}`}>
            <span className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
              <Tags size={14} className="text-violet-400" />产品类别
              <span className="font-normal text-neutral-500">（可选）</span>
            </span>
            <select
              value={data.productCategory || ''}
              onChange={event => onUpdate(data.id, { productCategory: event.target.value || undefined })}
              className={`w-full rounded-lg border px-2.5 py-2 text-sm outline-none focus:border-cyan-500 ${isDark ? 'border-neutral-700 bg-[#242424] text-neutral-200' : 'border-neutral-300 bg-white text-neutral-800'}`}
            >
              <option value="">自动识别产品类别</option>
              {MASSAGE_EQUIPMENT_SECTIONS.map(section => (
                <optgroup key={section.title} label={section.title}>
                  {section.items.map(name => <option key={name} value={name}>{name}</option>)}
                </optgroup>
              ))}
            </select>
          </label>

          <div className={`rounded-xl border p-3 ${isDark ? 'border-neutral-700 bg-[#181818]' : 'border-neutral-200 bg-neutral-50'}`}>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold"><Ruler size={14} className="text-amber-400" />产品真实尺寸</div>
            <div className="flex items-center gap-2">
              {(['length', 'width', 'height'] as const).map((field, index) => (
                <React.Fragment key={field}>
                  {index > 0 && <span className="text-neutral-600">×</span>}
                  <label className="min-w-0 flex-1">
                    <span className="mb-1 block text-[10px] text-neutral-500">{{ length: '长', width: '宽', height: '高' }[field]}</span>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={dimensions[field] || ''}
                      onChange={event => updateDimension(field, event.target.value)}
                      className={`w-full rounded-lg border px-2 py-1.5 text-sm outline-none focus:border-cyan-500 ${isDark ? 'border-neutral-700 bg-[#242424]' : 'border-neutral-300 bg-white'}`}
                    />
                  </label>
                </React.Fragment>
              ))}
              <select
                value={dimensions.unit}
                onChange={event => onUpdate(data.id, { productDimensions: { ...dimensions, unit: event.target.value as 'mm' | 'cm' } })}
                className={`mt-4 rounded-lg border px-2 py-1.5 text-sm outline-none ${isDark ? 'border-neutral-700 bg-[#242424]' : 'border-neutral-300 bg-white'}`}
              >
                <option value="cm">cm</option><option value="mm">mm</option>
              </select>
            </div>
          </div>

          <label className={`block rounded-xl border p-3 ${isDark ? 'border-neutral-700 bg-[#181818]' : 'border-neutral-200 bg-neutral-50'}`}>
            <span className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
              <UserRound size={14} className="text-rose-400" />人物设定
              <span className="font-normal text-neutral-500">（可选，留空则参考场景图的人物类型）</span>
            </span>
            <input
              type="text"
              value={data.personaBrief || ''}
              onChange={event => onUpdate(data.id, { personaBrief: event.target.value })}
              placeholder="例：30 岁左右女性，短发，浅色家居服"
              className={`w-full rounded-lg border px-2.5 py-2 text-sm outline-none focus:border-cyan-500 ${isDark ? 'border-neutral-700 bg-[#242424] text-neutral-200' : 'border-neutral-300 bg-white text-neutral-800'}`}
            />
          </label>

          <div className="flex items-center gap-2 text-xs">
            <label className="flex items-center gap-2"><input type="checkbox" checked={data.preserveProductMarkings !== false} onChange={event => onUpdate(data.id, { preserveProductMarkings: event.target.checked })} />保留产品 Logo／文字</label>
          </div>

          <div className={`rounded-lg px-3 py-2 text-[11px] ${isDark ? 'bg-neutral-900 text-neutral-400' : 'bg-neutral-100 text-neutral-600'}`}>
            <div>识图：{data.productSceneRecognitionModel || (data.productSceneRecognitionProvider === 'gemini-web' ? 'Gemini Web' : 'Codex CLI · gpt-5.6-sol')}</div>
            <div className="mt-0.5">生图：{imageProvider.name} · {imageCount} 张 · {aspectRatio}</div>
            {data.productSceneAutoGenerateVideo && (
              <div className="mt-0.5">
                视频：{videoProvider ? `${videoProvider.name} · ${aspectRatio}` : `没有模型支持 ${aspectRatio}`}
                {videoChoice?.switched && <span className="ml-1 text-amber-400">（已自动切换，所选模型不支持 {aspectRatio}）</span>}
              </div>
            )}
            {data.status === NodeStatus.LOADING && (
              <div className="mt-1 font-medium text-cyan-400">当前阶段：{data.productSceneStageLabel || '正在处理'}</div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <select
              aria-label="识图模型"
              value={data.productSceneRecognitionProvider || 'codex-cli'}
              onChange={event => onUpdate(data.id, { productSceneRecognitionProvider: event.target.value as 'codex-cli' | 'gemini-web' })}
              className={`rounded-xl border px-3 py-2 text-xs outline-none ${isDark ? 'border-neutral-700 bg-[#181818]' : 'border-neutral-300 bg-white'}`}
            >
              <option value="codex-cli">Codex CLI 识图</option>
              <option value="gemini-web">Gemini Web 识图</option>
            </select>
            <select
              value={data.imageModel || 'google-flow-nano-banana-pro'}
              onChange={event => {
                const next = getImageGenerationProvider(event.target.value)!;
                onUpdate(data.id, {
                  imageModel: next.id,
                  productSceneImageCount: Math.min(data.productSceneImageCount || 1, next.maxOutputCount),
                  aspectRatio: next.supportedAspectRatios.includes(data.aspectRatio) ? data.aspectRatio : next.supportedAspectRatios[0],
                });
              }}
              className={`min-w-0 rounded-xl border px-3 py-2 text-xs outline-none ${isDark ? 'border-neutral-700 bg-[#181818]' : 'border-neutral-300 bg-white'}`}
            >
              {IMAGE_GENERATION_PROVIDERS.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
            <select
              aria-label="输出比例"
              value={aspectRatio}
              onChange={event => onUpdate(data.id, { aspectRatio: event.target.value })}
              className={`rounded-xl border px-2 py-2 text-xs outline-none ${isDark ? 'border-neutral-700 bg-[#181818]' : 'border-neutral-300 bg-white'}`}
              title="替换图与短视频统一使用这个比例；所选视频模型不支持时会自动换用支持它的模型"
            >
              {imageProvider.supportedAspectRatios.filter(ratio => ratio !== 'Auto').map(ratio => (
                <option key={ratio} value={ratio}>
                  {ratio}{videoModelsForAspectRatio(ratio).length === 0 ? '（无视频模型）' : ''}
                </option>
              ))}
            </select>
            {imageCounts.length > 1 ? (
              <select
                aria-label="生成图片数量"
                value={imageCount}
                onChange={event => onUpdate(data.id, { productSceneImageCount: Number(event.target.value) })}
                className={`rounded-xl border px-2 py-2 text-xs outline-none ${isDark ? 'border-neutral-700 bg-[#181818]' : 'border-neutral-300 bg-white'}`}
              >
                {imageCounts.map(count => <option key={count} value={count}>{count} 张图片</option>)}
              </select>
            ) : <div className="flex items-center rounded-xl border border-neutral-800 px-3 text-xs text-neutral-500">单张输出</div>}
          </div>

          <div className={`rounded-xl border p-3 ${isDark ? 'border-neutral-700 bg-[#181818]' : 'border-neutral-200 bg-neutral-50'}`}>
            <label className="flex items-center justify-between text-xs font-semibold">
              <span className="flex items-center gap-1.5"><Film size={14} className="text-violet-400" />自动生成视频</span>
              <input type="checkbox" checked={data.productSceneAutoGenerateVideo === true} onChange={event => onUpdate(data.id, { productSceneAutoGenerateVideo: event.target.checked })} />
            </label>
            {data.productSceneAutoGenerateVideo && (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {/* 只列出支持当前比例的模型：比例是硬的，模型跟着比例走。
                    视频比例不再单独选 —— 替换图就是视频首帧，两边必须一致。 */}
                <select
                  aria-label="视频模型"
                  value={videoProvider?.id || ''}
                  onChange={event => {
                    const next = getVideoGenerationProvider(event.target.value)!;
                    onUpdate(data.id, {
                      productSceneVideoModel: next.id,
                      productSceneVideoDuration: next.supportedDurations[0],
                      productSceneVideoGenerateAudio: next.supportsNativeAudio,
                    });
                  }}
                  className={`col-span-3 rounded-lg border px-2 py-2 text-xs ${isDark ? 'border-neutral-700 bg-[#242424]' : 'border-neutral-300 bg-white'}`}
                >
                  {videoCandidates.length === 0
                    ? <option value="">没有模型支持 {aspectRatio}</option>
                    : videoCandidates.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
                </select>
                {videoDurations.length > 0 && <select value={data.productSceneVideoDuration || videoDurations[0]} onChange={event => onUpdate(data.id, { productSceneVideoDuration: Number(event.target.value) })} className={`rounded-lg border px-2 py-2 text-xs ${isDark ? 'border-neutral-700 bg-[#242424]' : 'border-neutral-300 bg-white'}`}>
                  {videoDurations.map(duration => <option key={duration} value={duration}>{duration} 秒</option>)}
                </select>}
                {videoProvider?.supportsNativeAudio && <label className="flex items-center gap-1.5 text-[11px]"><input type="checkbox" checked={data.productSceneVideoGenerateAudio !== false} onChange={event => onUpdate(data.id, { productSceneVideoGenerateAudio: event.target.checked })} />原生音频</label>}
              </div>
            )}
            {missingVideoPrompt && <p className="mt-2 text-[11px] text-amber-400">自动视频已开启，请连接包含短视频提示词的文本节点。</p>}
            {unsupportedVideoRatio && (
              <p className="mt-2 text-[11px] text-red-400">
                当前没有支持 {aspectRatio} 的图生视频模型。请换一个比例，或关闭「自动生成视频」只出替换图 ——
                强行生成只会被平台裁切，而且不会报错。
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={!canGenerate}
              onClick={() => onGenerate(data.id)}
              className="flex h-11 items-center gap-2 rounded-xl bg-cyan-500 px-4 text-sm font-bold text-black transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
              title={!sceneNode || !productNode ? '请连接并指定两张图片' : dimensionError || (missingVideoPrompt ? '请连接短视频提示词文本节点' : '分析并生成')}
            >
              {data.status === NodeStatus.LOADING ? <Loader2 size={16} className="animate-spin" /> : <Box size={16} />}
              {data.status === NodeStatus.LOADING
                ? '生成中'
                : (data.productSceneJobStatus === 'failed' || data.productSceneJobStatus === 'partial_failed' ? '从失败阶段重试' : '一键生成')}
            </button>
            {data.status === NodeStatus.LOADING && data.productSceneJobId && (
              <button type="button" onClick={() => void handleCancel()} className="flex h-11 items-center gap-1.5 rounded-xl border border-red-400/30 px-3 text-xs text-red-400 hover:bg-red-400/10"><X size={13} />取消队列</button>
            )}
          </div>

          {data.errorMessage && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{data.errorMessage}</div>}
        </div>
      </div>
    </div>
  );
};
