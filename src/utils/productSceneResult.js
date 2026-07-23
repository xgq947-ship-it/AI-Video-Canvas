export function buildProductSceneResultNode(sourceNode, job, now = Date.now()) {
  if (!job?.resultUrl || !job?.resultNodeId) throw new Error('产品场景任务缺少结果图片');
  return {
    id: job.resultNodeId,
    type: 'Image',
    title: `${sourceNode?.productCategory || '产品'}场景图`,
    x: Number(sourceNode?.x || 0) + 560,
    y: Number(sourceNode?.y || 0),
    prompt: job.prompt || '',
    status: 'success',
    resultUrl: `${job.resultUrl}?t=${now}`,
    parentIds: [sourceNode.id],
    model: 'Google Flow',
    imageModel: job.imageModel,
    aspectRatio: job.aspectRatio,
    resolution: sourceNode?.resolution || 'Auto',
    productSceneSourceJobId: job.id,
  };
}

export function upsertProductSceneResultNode(nodes, sourceNode, job, now = Date.now()) {
  const resultNode = buildProductSceneResultNode(sourceNode, job, now);
  const index = nodes.findIndex(node => node.id === job.resultNodeId || node.productSceneSourceJobId === job.id);
  if (index < 0) return [...nodes, resultNode];
  return nodes.map((node, nodeIndex) => nodeIndex === index ? { ...node, ...resultNode } : node);
}
