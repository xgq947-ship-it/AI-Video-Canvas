import React from 'react';
import { Box, Image as ImageIcon, Loader2, PackageCheck, Ruler, Tags, UserRound, WandSparkles } from 'lucide-react';
import { NodeData, NodeStatus, NodeType } from '../../types';
import { NodeConnectors } from './NodeConnectors';
import {
  inferProductSceneAspectRatio,
  PRODUCT_SCENE_ASPECT_RATIOS,
  validateProductDimensions,
} from '../../../shared/productSceneReplacement.js';
import { MASSAGE_EQUIPMENT_SECTIONS } from '../../../shared/massageEquipmentCategories.js';

interface Props {
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

const IMAGE_MODELS = [
  { id: 'google-flow-nano-banana-pro', label: 'Google Flow · Nano Banana Pro' },
  { id: 'google-flow-nano-banana-2', label: 'Google Flow · Nano Banana 2' },
  { id: 'google-flow-nano-banana-2-lite', label: 'Google Flow · Nano Banana 2 Lite' },
];

const previewUrl = (node?: NodeData) => node?.resultUrl || node?.editorBackgroundUrl;

export const ProductSceneReplaceNode: React.FC<Props> = ({
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

  const availableIds = new Set(connectedImages.map(node => node.id));
  const sceneId = data.sceneReferenceId && availableIds.has(data.sceneReferenceId)
    ? data.sceneReferenceId
    : connectedImages[0]?.id || '';
  const productId = data.productReferenceId && availableIds.has(data.productReferenceId) && data.productReferenceId !== sceneId
    ? data.productReferenceId
    : connectedImages.find(node => node.id !== sceneId)?.id || '';
  const sceneNode = allNodes.find(node => node.id === sceneId);
  const productNode = allNodes.find(node => node.id === productId);
  const dimensions = data.productDimensions || { length: 0, width: 0, height: 0, unit: 'cm' as const };
  const dimensionError = validateProductDimensions(dimensions);
  const canGenerate = Boolean(sceneNode && productNode && !dimensionError && data.status !== NodeStatus.LOADING);

  React.useEffect(() => {
    const updates: Partial<NodeData> = {};
    if (sceneId !== (data.sceneReferenceId || '')) updates.sceneReferenceId = sceneId || undefined;
    if (productId !== (data.productReferenceId || '')) updates.productReferenceId = productId || undefined;
    if (sceneId && data.sceneAspectReferenceId !== sceneId) {
      updates.sceneAspectReferenceId = sceneId;
      updates.aspectRatio = inferProductSceneAspectRatio(sceneNode?.resultAspectRatio || sceneNode?.aspectRatio, '1:1');
    }
    if (Object.keys(updates).length > 0) {
      onUpdate(data.id, updates);
    }
  }, [data.id, data.productReferenceId, data.sceneAspectReferenceId, data.sceneReferenceId, onUpdate, productId, sceneId, sceneNode?.aspectRatio, sceneNode?.resultAspectRatio]);

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
          <div className="flex items-center gap-2 font-semibold"><WandSparkles size={17} className="text-cyan-400" />产品场景替换</div>
          <span className="text-[11px] text-neutral-500">场景反推 · 全新人物</span>
        </div>

        <div className="space-y-3 p-3" onPointerDown={event => event.stopPropagation()}>
          <div className="flex gap-2.5">
            {referenceCard('场景参考', sceneId, 'scene', <ImageIcon size={14} className="text-blue-400" />)}
            {referenceCard('我方产品', productId, 'product', <PackageCheck size={14} className="text-emerald-400" />)}
          </div>

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
            <div>识图：{data.productSceneRecognitionModel || 'Codex CLI · gpt-5.6-sol'}</div>
            <div className="mt-0.5">生图：{IMAGE_MODELS.find(model => model.id === data.imageModel)?.label || 'Google Flow · Nano Banana Pro'}</div>
            {data.status === NodeStatus.LOADING && (
              <div className="mt-1 font-medium text-cyan-400">当前阶段：{data.productSceneStageLabel || (data.productSceneStage === 'generating' ? 'Google Flow 正在生成图片' : 'Codex 正在识别两张图片')}</div>
            )}
          </div>

          <div className="flex gap-2">
            <select
              value={data.imageModel || 'google-flow-nano-banana-pro'}
              onChange={event => onUpdate(data.id, { imageModel: event.target.value })}
              className={`min-w-0 flex-1 rounded-xl border px-3 text-xs outline-none ${isDark ? 'border-neutral-700 bg-[#181818]' : 'border-neutral-300 bg-white'}`}
            >
              {IMAGE_MODELS.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
            </select>
            <select
              aria-label="输出画幅"
              value={PRODUCT_SCENE_ASPECT_RATIOS.includes(data.aspectRatio) ? data.aspectRatio : inferProductSceneAspectRatio(sceneNode?.resultAspectRatio || sceneNode?.aspectRatio, '1:1')}
              onChange={event => onUpdate(data.id, { aspectRatio: event.target.value })}
              className={`w-[82px] rounded-xl border px-2 text-xs outline-none ${isDark ? 'border-neutral-700 bg-[#181818]' : 'border-neutral-300 bg-white'}`}
              title="默认匹配场景参考图，也可以手动修改"
            >
              {PRODUCT_SCENE_ASPECT_RATIOS.map(ratio => <option key={ratio} value={ratio}>{ratio}</option>)}
            </select>
            <button
              type="button"
              disabled={!canGenerate}
              onClick={() => onGenerate(data.id)}
              className="flex h-11 items-center gap-2 rounded-xl bg-cyan-500 px-4 text-sm font-bold text-black transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
              title={!sceneNode || !productNode ? '请连接并指定两张图片' : dimensionError || '分析并生成'}
            >
              {data.status === NodeStatus.LOADING ? <Loader2 size={16} className="animate-spin" /> : <Box size={16} />}
              {data.status === NodeStatus.LOADING
                ? (data.productSceneStage === 'generating' ? '生成中' : '分析中')
                : (data.productSceneJobStatus === 'failed' ? '从失败阶段重试' : '一键替换生成')}
            </button>
          </div>

          {data.errorMessage && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{data.errorMessage}</div>}
        </div>
      </div>
    </div>
  );
};
