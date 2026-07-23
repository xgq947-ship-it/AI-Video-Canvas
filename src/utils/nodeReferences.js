// 产品场景替换的控制节点自身不持有 resultUrl（成图落在它自动创建的子 Image 节点上），
// 因此不能算作参考素材，否则会占掉一个「参考图N」编号却拿不到图。
const IMAGE_TYPES = new Set(['Image', 'Image Editor']);
const VIDEO_TYPES = new Set(['Video', 'Video Editor']);
const AUDIO_TYPES = new Set(['Audio']);

const KIND_LABELS = {
  image: '参考图',
  video: '参考视频',
  audio: '参考语音',
};

// 通用编号标签（参考图N/参考视频N/参考语音N）额外接受的 @ 简写前缀
const KIND_ALIASES = {
  image: ['参考图', '图片', '图'],
  video: ['参考视频', '视频'],
  audio: ['参考语音', '语音', '音频'],
};

function referenceKind(type) {
  if (IMAGE_TYPES.has(type)) return 'image';
  if (VIDEO_TYPES.has(type)) return 'video';
  if (AUDIO_TYPES.has(type)) return 'audio';
  return null;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 按 parentIds 的连线顺序收集直接参考素材。
 * 若源节点已保存为素材库素材（node.assetName），标签直接用素材名（如"人物肯豆"）；
 * 否则回退到旧的按类型编号（参考图1/参考视频1/参考语音1...），编号只统计未命名的素材，保持连续。
 */
export function collectNodeReferences(parentIds, nodes) {
  const counters = { image: 0, video: 0, audio: 0 };
  const byId = new Map(nodes.map(node => [node.id, node]));

  return (parentIds || []).flatMap((parentId) => {
    const node = byId.get(parentId);
    if (!node) return [];
    const kind = referenceKind(node.type);
    if (!kind) return [];

    const assetName = node.assetName?.trim();
    const label = assetName || `${KIND_LABELS[kind]}${++counters[kind]}`;
    const url = kind === 'audio' ? (node.mediaUrl || node.resultUrl) : node.resultUrl;
    const previewUrl = kind === 'video' ? (node.lastFrame || node.resultUrl) : url;
    return [{
      id: node.id,
      kind,
      label,
      assetName: assetName || undefined,
      title: node.title || node.type,
      url,
      previewUrl,
    }];
  });
}

/**
 * 提取提示词中被 @ 点名的参考标签。
 * - 素材名标签（如 @人物肯豆）按字面精确匹配。
 * - 编号标签兼容 @图片1、@视频1、@音频1 等简写。
 * 按候选文本长度从长到短匹配，避免"参考图10"被误判成"参考图1"。
 */
export function extractReferenceLabels(prompt, references = []) {
  const text = String(prompt || '');
  const candidates = [];
  for (const reference of references) {
    if (!reference.label) continue;
    const generic = reference.label.match(/^(参考图|参考视频|参考语音)(\d+)$/);
    if (generic) {
      const [, prefix, num] = generic;
      const kind = prefix === '参考图' ? 'image' : prefix === '参考视频' ? 'video' : 'audio';
      for (const alias of KIND_ALIASES[kind]) {
        candidates.push({ surface: `${alias}${num}`, canonical: reference.label });
      }
    } else {
      candidates.push({ surface: reference.label, canonical: reference.label });
    }
  }

  const labels = new Set();
  if (candidates.length === 0) return labels;

  candidates.sort((a, b) => b.surface.length - a.surface.length);
  const surfaceToCanonical = new Map(candidates.map(c => [c.surface, c.canonical]));
  const pattern = new RegExp(`@(${candidates.map(c => escapeRegExp(c.surface)).join('|')})`, 'g');
  for (const match of text.matchAll(pattern)) {
    labels.add(surfaceToCanonical.get(match[1]));
  }
  return labels;
}

/**
 * 不写 @ 时保留旧行为：使用全部连接参考。
 * 写了 @ 时只返回被点名的素材，供真实生成参数筛选。
 */
export function selectPromptReferences(references, prompt) {
  const labels = extractReferenceLabels(prompt, references);
  if (labels.size === 0) return [...references];
  return references.filter(reference => labels.has(reference.label));
}
