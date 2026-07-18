const IMAGE_TYPES = new Set(['Image', 'Image Editor']);
const VIDEO_TYPES = new Set(['Video', 'Video Editor']);
const AUDIO_TYPES = new Set(['Audio']);

const KIND_LABELS = {
  image: '参考图',
  video: '参考视频',
  audio: '参考语音',
};

function referenceKind(type) {
  if (IMAGE_TYPES.has(type)) return 'image';
  if (VIDEO_TYPES.has(type)) return 'video';
  if (AUDIO_TYPES.has(type)) return 'audio';
  return null;
}

/**
 * 按 parentIds 的连线顺序给直接参考素材分类编号。
 * 图片、视频、语音分别从 1 开始，编号稳定且可用于 @ 引用。
 */
export function collectNodeReferences(parentIds, nodes) {
  const counters = { image: 0, video: 0, audio: 0 };
  const byId = new Map(nodes.map(node => [node.id, node]));

  return (parentIds || []).flatMap((parentId) => {
    const node = byId.get(parentId);
    if (!node) return [];
    const kind = referenceKind(node.type);
    if (!kind) return [];

    const index = ++counters[kind];
    const url = kind === 'audio' ? (node.mediaUrl || node.resultUrl) : node.resultUrl;
    const previewUrl = kind === 'video' ? (node.lastFrame || node.resultUrl) : url;
    return [{
      id: node.id,
      kind,
      index,
      label: `${KIND_LABELS[kind]}${index}`,
      title: node.title || node.type,
      url,
      previewUrl,
    }];
  });
}

/**
 * 提取提示词中的参考标签。同时兼容 @图片1、@视频1、@音频1 简写。
 */
export function extractReferenceLabels(prompt) {
  const labels = new Set();
  const pattern = /@(\u53c2\u8003)?(\u56fe|\u56fe\u7247|\u89c6\u9891|\u8bed\u97f3|\u97f3\u9891)(\d+)/g;
  for (const match of String(prompt || '').matchAll(pattern)) {
    const rawKind = match[2];
    const prefix = rawKind === '图' || rawKind === '图片'
      ? '参考图'
      : rawKind === '视频'
        ? '参考视频'
        : '参考语音';
    labels.add(`${prefix}${Number(match[3])}`);
  }
  return labels;
}

/**
 * 不写 @ 时保留旧行为：使用全部连接参考。
 * 写了 @ 时只返回被点名的素材，供真实生成参数筛选。
 */
export function selectPromptReferences(references, prompt) {
  const labels = extractReferenceLabels(prompt);
  if (labels.size === 0) return [...references];
  return references.filter(reference => labels.has(reference.label));
}

