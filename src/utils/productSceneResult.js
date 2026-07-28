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

/**
 * 每一版结果往下让一段，避免新一版直接压在上一版身上。
 *
 * 「再点一次生成」是新增一版子节点而不是覆盖 —— 但如果新一版落在完全相同的坐标上，
 * 看起来仍然像覆盖（旧的其实被压在下面）。version 从 1 起。
 */
const VERSION_ROW_HEIGHT = 340;

function versionOffset(job) {
  return (Math.max(1, Number(job?.version) || 1) - 1) * VERSION_ROW_HEIGHT;
}

function versionSuffix(job) {
  const version = Math.max(1, Number(job?.version) || 1);
  return version > 1 ? ` v${version}` : '';
}

export function upsertProductSceneResultNode(nodes, sourceNode, job, now = Date.now()) {
  const resultUrls = Array.isArray(job.resultUrls) && job.resultUrls.length ? job.resultUrls : [job.resultUrl].filter(Boolean);
  const resultNodeIds = Array.isArray(job.resultNodeIds) && job.resultNodeIds.length ? job.resultNodeIds : [job.resultNodeId];
  const rowOffset = versionOffset(job);
  const desired = resultUrls.map((resultUrl, index) => ({
    ...buildProductSceneResultNode(sourceNode, {
      ...job,
      resultUrl,
      resultNodeId: resultNodeIds[index],
      id: index === 0 ? job.id : `${job.id}:image:${index}`,
    }, now + index),
    title: (resultUrls.length === 1
      ? `${sourceNode?.productCategory || '产品'}场景图`
      : `${sourceNode?.productCategory || '产品'}场景图 ${index + 1}`) + versionSuffix(job),
    x: Number(sourceNode?.x || 0) + 560,
    y: Number(sourceNode?.y || 0) + index * 300 + rowOffset,
  }));
  for (const task of job.videoTasks || []) {
    if (task.status !== 'success' || !task.resultUrl) continue;
    desired.push({
      id: task.videoNodeId,
      type: 'Video',
      title: `产品短视频 ${task.index + 1}${versionSuffix(job)}`,
      x: Number(sourceNode?.x || 0) + 980,
      y: Number(sourceNode?.y || 0) + task.index * 300 + rowOffset,
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
  // 用户删掉的结果节点不再补回来。任务本身是完成状态，恢复逻辑只看「结果在不在画布上」，
  // 分不清「还没恢复」和「已经删了」—— 少了这一层过滤，删掉的节点下一轮就长回来。
  const dismissed = new Set(job.dismissedResultNodeIds || []);
  let next = [...nodes];
  for (const resultNode of desired) {
    if (dismissed.has(resultNode.id)) continue;
    const index = next.findIndex(node => node.id === resultNode.id || node.productSceneSourceJobId === resultNode.productSceneSourceJobId);
    next = index < 0
      ? [...next, resultNode]
      : next.map((node, nodeIndex) => nodeIndex === index ? { ...node, ...resultNode } : node);
  }
  return next;
}
