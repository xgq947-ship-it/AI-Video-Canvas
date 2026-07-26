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
    model: job.imageModel,
    imageModel: job.imageModel,
    aspectRatio: job.aspectRatio,
    resolution: sourceNode?.resolution || 'Auto',
    productSceneSourceJobId: job.id,
  };
}

export function upsertProductSceneResultNode(nodes, sourceNode, job, now = Date.now()) {
  const resultUrls = Array.isArray(job.resultUrls) && job.resultUrls.length ? job.resultUrls : [job.resultUrl].filter(Boolean);
  const resultNodeIds = Array.isArray(job.resultNodeIds) && job.resultNodeIds.length ? job.resultNodeIds : [job.resultNodeId];
  const desired = resultUrls.map((resultUrl, index) => ({
    ...buildProductSceneResultNode(sourceNode, {
      ...job,
      resultUrl,
      resultNodeId: resultNodeIds[index],
      id: index === 0 ? job.id : `${job.id}:image:${index}`,
    }, now + index),
    title: resultUrls.length === 1
      ? `${sourceNode?.productCategory || '产品'}场景图`
      : `${sourceNode?.productCategory || '产品'}场景图 ${index + 1}`,
    x: Number(sourceNode?.x || 0) + 560,
    y: Number(sourceNode?.y || 0) + index * 300,
  }));
  for (const task of job.videoTasks || []) {
    if (task.status !== 'success' || !task.resultUrl) continue;
    desired.push({
      id: task.videoNodeId,
      type: 'Video',
      title: `产品短视频 ${task.index + 1}`,
      x: Number(sourceNode?.x || 0) + 980,
      y: Number(sourceNode?.y || 0) + task.index * 300,
      prompt: job.videoPrompt || '',
      status: 'success',
      resultUrl: `${task.resultUrl}?t=${now + task.index}`,
      parentIds: [task.imageNodeId],
      model: job.videoModel,
      videoModel: job.videoModel,
      videoDuration: job.videoDuration,
      aspectRatio: job.videoAspectRatio || '16:9',
      resolution: job.videoResolution || 'Auto',
      productSceneSourceJobId: `${job.id}:video:${task.index}`,
    });
  }
  let next = [...nodes];
  for (const resultNode of desired) {
    const index = next.findIndex(node => node.id === resultNode.id || node.productSceneSourceJobId === resultNode.productSceneSourceJobId);
    next = index < 0
      ? [...next, resultNode]
      : next.map((node, nodeIndex) => nodeIndex === index ? { ...node, ...resultNode } : node);
  }
  return next;
}
