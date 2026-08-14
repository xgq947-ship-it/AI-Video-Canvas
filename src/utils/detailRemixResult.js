import { DETAIL_REMIX_NODE_HEIGHT, DETAIL_REMIX_NODE_WIDTH } from '../../shared/detailRemix.js';

const IMAGE_NODE_WIDTH = 365;
const RESULT_COLUMN_GAP = 80;
const RESULT_TOP_GAP = 160;
const VERSION_BATCH_GAP = 180;
const DETAIL_REMIX_RESULT_LAYOUT_VERSION = 3;

function parseAspectRatio(value, fallback = 3 / 4) {
  if (!value || value === 'Auto') return fallback;
  const separator = value.includes('/') ? '/' : ':';
  const [width, height] = String(value).split(separator).map(Number);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? width / height
    : fallback;
}

function cacheBustedUrl(url, value) {
  return `${url}${url.includes('?') ? '&' : '?'}t=${value}`;
}

function versionSuffix(job) {
  const version = Math.max(1, Number(job?.version) || 1);
  return version > 1 ? ` v${version}` : '';
}

function resultNodeHeight(node) {
  return IMAGE_NODE_WIDTH / parseAspectRatio(node?.resultAspectRatio || node?.aspectRatio);
}

function resultNodesForSource(nodes, sourceNodeId) {
  return nodes.filter(node => (
    node?.detailRemixSourceJobId
    && (
      node.detailRemixSourceNodeId === sourceNodeId
      || node.parentIds?.includes(sourceNodeId)
    )
  ));
}

function resolveVersionOffset(nodes, sourceNode, job, batchHeight) {
  const version = Math.max(1, Number(job?.version) || 1);
  const baseline = (version - 1) * (batchHeight + VERSION_BATCH_GAP);
  if (version <= 1) return baseline;
  const previous = resultNodesForSource(nodes, sourceNode.id).filter(node => (
    node.detailRemixSourceJobId !== job.id
    && Number(node.detailRemixBatchVersion || 1) < version
  ));
  if (previous.length === 0) return baseline;
  const previousBottom = Math.max(...previous.map(node => Number(node.y || 0) + resultNodeHeight(node)));
  const firstBatchTop = Number(sourceNode.y || 0) + DETAIL_REMIX_NODE_HEIGHT + RESULT_TOP_GAP;
  return Math.max(baseline, previousBottom + VERSION_BATCH_GAP - firstBatchTop);
}

function normalizePages(job) {
  if (!Array.isArray(job?.pages)) return [];
  return [...job.pages]
    .map((page, fallbackIndex) => ({ ...page, index: Number.isInteger(page?.index) ? page.index : fallbackIndex }))
    .sort((left, right) => left.index - right.index);
}

export function getDetailRemixResultRowStep(job) {
  const ratios = normalizePages(job).map(page => page?.aspectRatio).filter(Boolean);
  const fallbackRatio = job?.aspectRatio || '3:4';
  return [fallbackRatio, ...ratios].reduce((height, ratio) => (
    Math.max(height, IMAGE_NODE_WIDTH / parseAspectRatio(ratio))
  ), 0) + VERSION_BATCH_GAP;
}

function pageKey(page) {
  return String(page?.pageId || page?.id || `page-${Number(page?.index || 0) + 1}`);
}

function finalResult(page) {
  if (page?.resultNodeId && (page.finalUrl || page.resultUrl)) {
    return {
      id: page.resultNodeId,
      url: page.finalUrl || page.resultUrl,
      prompt: page.finalPrompt || page.prompt || '',
      kind: 'final',
    };
  }
  // Compatibility: show the most complete result from an old two-stage job,
  // never both the intermediate plate and composite rows.
  if (page?.compositeNodeId && page?.compositeUrl) {
    return {
      id: page.compositeNodeId,
      url: page.compositeUrl,
      prompt: page.composePrompt || page.analysis?.composePrompt || '',
      kind: 'composite',
    };
  }
  if (page?.plateNodeId && page?.plateUrl) {
    return {
      id: page.plateNodeId,
      url: page.plateUrl,
      prompt: page.blankPrompt || page.platePrompt || page.prompt || '',
      kind: 'plate',
    };
  }
  return null;
}

function buildResultNode(sourceNode, job, page, layout, now) {
  const result = finalResult(page);
  if (!result) return null;
  const index = Number(page.index || 0);
  return {
    id: result.id,
    type: 'Image',
    title: `最终详情 ${String(index + 1).padStart(2, '0')}${versionSuffix(job)}`,
    x: layout.startX + index * layout.horizontalStep,
    y: layout.resultY,
    prompt: String(result.prompt || ''),
    status: 'success',
    resultUrl: cacheBustedUrl(result.url, now),
    parentIds: [sourceNode.id],
    model: job.imageModel || sourceNode.imageModel || sourceNode.model,
    imageModel: job.imageModel || sourceNode.imageModel,
    aspectRatio: page.aspectRatio || job.aspectRatio || sourceNode.aspectRatio || 'Auto',
    ...(page.resultAspectRatio || (page.outputWidth && page.outputHeight)
      ? { resultAspectRatio: page.resultAspectRatio || `${page.outputWidth}/${page.outputHeight}` }
      : {}),
    resolution: job.imageResolution || job.resolution || sourceNode.resolution || 'Auto',
    batchIndex: index,
    batchCount: normalizePages(job).length,
    detailRemixSourceJobId: job.id,
    detailRemixSourceNodeId: sourceNode.id,
    detailRemixPageId: pageKey(page),
    detailRemixResultKind: 'final',
    detailRemixBatchVersion: Math.max(1, Number(job.version) || 1),
    detailRemixLayoutVersion: DETAIL_REMIX_RESULT_LAYOUT_VERSION,
  };
}

function stableResultIdentity(node) {
  return [node?.detailRemixSourceJobId, node?.detailRemixPageId, node?.detailRemixResultKind].join(':');
}

function mergeResultNode(existing, desired) {
  const alreadyUsesCurrentLayout = Number(existing.detailRemixLayoutVersion || 0)
    >= DETAIL_REMIX_RESULT_LAYOUT_VERSION;
  return {
    ...existing,
    ...desired,
    x: alreadyUsesCurrentLayout && Number.isFinite(existing.x) ? existing.x : desired.x,
    y: alreadyUsesCurrentLayout && Number.isFinite(existing.y) ? existing.y : desired.y,
    title: existing.title || desired.title,
    displayName: existing.displayName,
    parentIds: Array.isArray(existing.parentIds) ? existing.parentIds : desired.parentIds,
  };
}

/** Upsert one final Image per competitor page in one horizontal row below the controller. */
export function upsertDetailRemixResultNodes(nodes, sourceNode, job, now = Date.now()) {
  if (!sourceNode?.id || !job?.id) return nodes;
  const pages = normalizePages(job);
  if (pages.length === 0) return nodes;
  const batchHeight = getDetailRemixResultRowStep(job);
  const versionOffset = resolveVersionOffset(nodes, sourceNode, job, batchHeight);
  const horizontalStep = IMAGE_NODE_WIDTH + RESULT_COLUMN_GAP;
  const rowWidth = pages.length * IMAGE_NODE_WIDTH + Math.max(0, pages.length - 1) * RESULT_COLUMN_GAP;
  const startX = Number(sourceNode.x || 0) + DETAIL_REMIX_NODE_WIDTH / 2 - rowWidth / 2;
  const resultY = Number(sourceNode.y || 0) + DETAIL_REMIX_NODE_HEIGHT + RESULT_TOP_GAP + versionOffset;
  const layout = { startX, horizontalStep, resultY };
  const dismissed = new Set(job.dismissedResultNodeIds || []);
  const desired = pages
    .map((page, index) => buildResultNode(sourceNode, job, page, layout, now + index))
    .filter(result => result && !dismissed.has(result.id));

  let next = [...nodes];
  for (const resultNode of desired) {
    const identity = stableResultIdentity(resultNode);
    const index = next.findIndex(node => (
      node.id === resultNode.id
      || (node.detailRemixSourceJobId && stableResultIdentity(node) === identity)
    ));
    next = index < 0
      ? [...next, resultNode]
      : next.map((node, nodeIndex) => nodeIndex === index ? mergeResultNode(node, resultNode) : node);
  }
  return next;
}

export const upsertDetailRemixResultNode = upsertDetailRemixResultNodes;
