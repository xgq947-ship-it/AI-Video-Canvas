const IMAGE_NODE_WIDTH = 365;
const VIDEO_NODE_WIDTH = 385;
const RESULT_ROW_GAP = 48;
const VERSION_BATCH_GAP = 96;

function parseAspectRatio(value, fallback = 4 / 3) {
  if (!value || value === 'Auto') return fallback;
  const separator = value.includes('/') ? '/' : ':';
  const [width, height] = value.split(separator).map(Number);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? width / height
    : fallback;
}

function cacheBustedUrl(url, value) {
  return `${url}${url.includes('?') ? '&' : '?'}t=${value}`;
}

export function getProductSceneResultRowStep(job) {
  const imageHeight = IMAGE_NODE_WIDTH / parseAspectRatio(job?.aspectRatio);
  const hasVideoColumn = job?.autoGenerateVideo === true
    || (Array.isArray(job?.videoTasks) && job.videoTasks.length > 0);
  const videoHeight = hasVideoColumn
    ? VIDEO_NODE_WIDTH / parseAspectRatio(job?.videoAspectRatio, 16 / 9)
    : 0;
  return Math.max(imageHeight, videoHeight) + RESULT_ROW_GAP;
}

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
    resultUrl: cacheBustedUrl(job.resultUrl, now),
    parentIds: [sourceNode.id],
    model: job.imageModel,
    imageModel: job.imageModel,
    aspectRatio: job.aspectRatio,
    resolution: job.imageResolution || sourceNode?.resolution || 'Auto',
    productSceneSourceJobId: job.id,
  };
}

/**
 * 每一版结果往下让一段，避免新一版直接压在上一版身上。
 *
 * 「再点一次生成」是新增一版子节点而不是覆盖 —— 但如果新一版落在完全相同的坐标上，
 * 看起来仍然像覆盖（旧的其实被压在下面）。version 从 1 起。
 */
function versionOffset(job, rowStep, batchCount) {
  return (Math.max(1, Number(job?.version) || 1) - 1)
    * (rowStep * Math.max(1, batchCount) + VERSION_BATCH_GAP);
}

function resultNodeHeight(node) {
  const isVideo = node?.type === 'Video';
  return (isVideo ? VIDEO_NODE_WIDTH : IMAGE_NODE_WIDTH)
    / parseAspectRatio(node?.resultAspectRatio || node?.aspectRatio, isVideo ? 16 / 9 : 4 / 3);
}

function isCurrentBatchNode(node, job) {
  const jobId = String(job?.id || '');
  const sourceJobId = String(node?.productSceneSourceJobId || '');
  return node?.productSceneBatchJobId === jobId
    || sourceJobId === jobId
    || sourceJobId.startsWith(`${jobId}:`);
}

function resultNodesForSource(nodes, sourceNode) {
  const sourceNodeId = sourceNode?.id;
  const images = nodes.filter(node =>
    node?.productSceneSourceJobId
    && (
      node.productSceneLayoutSourceNodeId === sourceNodeId
      || (node.type === 'Image' && node.parentIds?.includes(sourceNodeId))
    )
  );
  const imageIds = new Set(images.map(node => node.id));
  const videos = nodes.filter(node =>
    node?.type === 'Video'
    && node?.productSceneSourceJobId
    && (
      node.productSceneLayoutSourceNodeId === sourceNodeId
      || node.parentIds?.some(parentId => imageIds.has(parentId))
    )
  );
  return [...images, ...videos];
}

function resolveVersionRowOffset(nodes, sourceNode, job, rowStep, batchCount) {
  const baseline = versionOffset(job, rowStep, batchCount);
  const version = Math.max(1, Number(job?.version) || 1);
  if (version <= 1) return baseline;

  const previousResults = resultNodesForSource(nodes, sourceNode).filter(node => {
    if (isCurrentBatchNode(node, job)) return false;
    const nodeVersion = Number(node.productSceneBatchVersion);
    return !Number.isFinite(nodeVersion) || nodeVersion < version;
  });
  if (previousResults.length === 0) return baseline;

  const previousBottom = Math.max(...previousResults.map(node =>
    Number(node.y || 0) + resultNodeHeight(node)
  ));
  const sourceY = Number(sourceNode?.y || 0);
  return Math.max(baseline, previousBottom + VERSION_BATCH_GAP - sourceY);
}

function versionSuffix(job) {
  const version = Math.max(1, Number(job?.version) || 1);
  return version > 1 ? ` v${version}` : '';
}

export function upsertProductSceneResultNode(nodes, sourceNode, job, now = Date.now()) {
  const resultUrls = Array.isArray(job.resultUrls) && job.resultUrls.length ? job.resultUrls : [job.resultUrl].filter(Boolean);
  const resultNodeIds = Array.isArray(job.resultNodeIds) && job.resultNodeIds.length ? job.resultNodeIds : [job.resultNodeId];
  const resultMetadata = Array.isArray(job.imageResults) ? job.imageResults : [];
  const imageEntries = resultUrls.map((resultUrl, completionIndex) => {
    const resultNodeId = resultNodeIds[completionIndex];
    const metadata = resultMetadata.find(item =>
      item?.nodeId === resultNodeId || item?.resultUrl === resultUrl
    );
    return {
      resultUrl,
      resultNodeId: metadata?.nodeId || resultNodeId,
      batchIndex: Number.isInteger(metadata?.index) && metadata.index >= 0
        ? metadata.index
        : completionIndex,
    };
  }).sort((left, right) => left.batchIndex - right.batchIndex);
  const batchCount = Math.max(
    imageEntries.length,
    ...imageEntries.map(entry => entry.batchIndex + 1)
  );
  const rowStep = getProductSceneResultRowStep(job);
  const rowOffset = resolveVersionRowOffset(nodes, sourceNode, job, rowStep, batchCount);
  const batchVersion = Math.max(1, Number(job?.version) || 1);
  const desired = imageEntries.map((entry, sequenceIndex) => ({
    ...buildProductSceneResultNode(sourceNode, {
      ...job,
      resultUrl: entry.resultUrl,
      resultNodeId: entry.resultNodeId,
      id: entry.batchIndex === 0 ? job.id : `${job.id}:image:${entry.batchIndex}`,
    }, now + sequenceIndex),
    title: (resultUrls.length === 1
      ? `${sourceNode?.productCategory || '产品'}场景图`
      : `${sourceNode?.productCategory || '产品'}场景图 ${entry.batchIndex + 1}`) + versionSuffix(job),
    x: Number(sourceNode?.x || 0) + 560,
    y: Number(sourceNode?.y || 0) + entry.batchIndex * rowStep + rowOffset,
    batchIndex: entry.batchIndex,
    batchCount,
    productSceneLayoutVersion: 2,
    productSceneLayoutSourceNodeId: sourceNode.id,
    productSceneBatchJobId: job.id,
    productSceneBatchVersion: batchVersion,
    productSceneLayoutRowStep: rowStep,
  }));
  const videoTasks = [...(job.videoTasks || [])]
    .sort((left, right) => Number(left.index) - Number(right.index));
  for (const task of videoTasks) {
    if (task.status !== 'success' || !task.resultUrl) continue;
    desired.push({
      id: task.videoNodeId,
      type: 'Video',
      title: `产品短视频 ${task.index + 1}${versionSuffix(job)}`,
      x: Number(sourceNode?.x || 0) + 980,
      y: Number(sourceNode?.y || 0) + task.index * rowStep + rowOffset,
      prompt: job.videoPrompt || '',
      status: 'success',
      resultUrl: cacheBustedUrl(task.resultUrl, now + task.index),
      parentIds: [task.imageNodeId],
      model: job.videoModel,
      videoModel: job.videoModel,
      videoDuration: job.videoDuration,
      aspectRatio: job.videoAspectRatio || '16:9',
      resolution: job.videoResolution || 'Auto',
      productSceneSourceJobId: `${job.id}:video:${task.index}`,
      batchIndex: task.index,
      batchCount,
      productSceneLayoutVersion: 2,
      productSceneLayoutSourceNodeId: sourceNode.id,
      productSceneBatchJobId: job.id,
      productSceneBatchVersion: batchVersion,
      productSceneLayoutRowStep: rowStep,
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
      : next.map((node, nodeIndex) => {
          if (nodeIndex !== index) return node;
          // Polling/recovery may refresh URLs and status many times. Layout and
          // connections are creation-time defaults; preserve subsequent user edits.
          return {
            ...node,
            ...resultNode,
            x: Number.isFinite(node.x) ? node.x : resultNode.x,
            y: Number.isFinite(node.y) ? node.y : resultNode.y,
            parentIds: Array.isArray(node.parentIds) ? node.parentIds : resultNode.parentIds,
            displayName: node.displayName,
            batchIndex: node.batchIndex ?? resultNode.batchIndex,
            batchCount: node.batchCount ?? resultNode.batchCount,
            productSceneLayoutVersion: node.productSceneLayoutVersion ?? resultNode.productSceneLayoutVersion,
            productSceneLayoutSourceNodeId: node.productSceneLayoutSourceNodeId ?? resultNode.productSceneLayoutSourceNodeId,
            productSceneBatchJobId: node.productSceneBatchJobId ?? resultNode.productSceneBatchJobId,
            productSceneBatchVersion: node.productSceneBatchVersion ?? resultNode.productSceneBatchVersion,
            productSceneLayoutRowStep: node.productSceneLayoutRowStep ?? resultNode.productSceneLayoutRowStep,
          };
        });
  }
  return next;
}
