import {
  DETAIL_REMIX_NODE_HEIGHT,
  DETAIL_REMIX_NODE_WIDTH,
  buildDetailRemixInputMapping,
  createDetailRemixNodeData,
  syncDetailRemixInputRefs,
} from '../../shared/detailRemix.js';
import {
  DETAIL_REMIX_IMPORT_COLUMN_GAP,
  DETAIL_REMIX_IMPORT_LAYOUT_VERSION,
  DETAIL_REMIX_IMPORT_NODE_WIDTH,
  DETAIL_REMIX_IMPORT_ROW_GAP,
  reflowDetailRemixFolderNodes,
} from './detailRemixFolderImport.js';

const IMAGE_NODE_TYPE = 'Image';
const DETAIL_REMIX_NODE_TYPE = 'Detail Page Remix';
const SUCCESS_STATUS = 'success';

const parseAspectRatio = value => {
  const text = String(value || '3:4');
  const separator = text.includes('/') ? '/' : ':';
  const [width, height] = text.split(separator).map(Number);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? width / height
    : 3 / 4;
};

const imageNodeHeight = node => (
  DETAIL_REMIX_IMPORT_NODE_WIDTH / parseAspectRatio(
    node?.resultAspectRatio || node?.aspectRatio,
  )
);

const nodeBottom = node => {
  const y = Number(node?.y || 0);
  if (node?.type === DETAIL_REMIX_NODE_TYPE) return y + DETAIL_REMIX_NODE_HEIGHT;
  if (node?.type === IMAGE_NODE_TYPE) return y + imageNodeHeight(node);
  return y;
};

/** Place generated slices in one dedicated row below the source details. */
function layoutSliceNodesBelowSources(nodes, sliceNodes, controller, sourceNodeIds) {
  const sourceIds = new Set(sourceNodeIds);
  const sourceNodes = nodes.filter(node => sourceIds.has(node.id));
  const sourceLeft = sourceNodes.length
    ? Math.min(...sourceNodes.map(node => Number(node.x || 0)))
    : Number(controller.x || 0);
  const sourceRight = sourceNodes.length
    ? Math.max(...sourceNodes.map(node => Number(node.x || 0) + DETAIL_REMIX_IMPORT_NODE_WIDTH))
    : Number(controller.x || 0) + DETAIL_REMIX_NODE_WIDTH;
  const centerX = (sourceLeft + sourceRight) / 2;
  const horizontalStep = DETAIL_REMIX_IMPORT_NODE_WIDTH + DETAIL_REMIX_IMPORT_COLUMN_GAP;
  const rowWidth = sliceNodes.length * DETAIL_REMIX_IMPORT_NODE_WIDTH
    + Math.max(0, sliceNodes.length - 1) * DETAIL_REMIX_IMPORT_COLUMN_GAP;
  const startX = centerX - rowWidth / 2;

  // Keep the new row clear of the controller, original imports, earlier stitch
  // versions and generated detail results that belong to this workflow.
  const relatedNodes = nodes.filter(node => (
    node.id === controller.id
    || sourceIds.has(node.id)
    || node?.detailRemixImport?.controllerNodeId === controller.id
    || node?.detailStitchArchive?.controllerNodeId === controller.id
    || node?.detailRemixSourceNodeId === controller.id
  ));
  const rowY = Math.max(...relatedNodes.map(nodeBottom)) + DETAIL_REMIX_IMPORT_ROW_GAP;

  return sliceNodes.map((node, index) => ({
    ...node,
    x: startX + index * horizontalStep,
    y: rowY,
  }));
}

const orderedSlices = record => {
  const slices = [...(record.slices || [])].sort((left, right) => left.startY - right.startY);
  if (slices.length === 0) throw new Error('重切片结果为空');
  let expectedStart = 0;
  const ids = new Set();
  for (let index = 0; index < slices.length; index += 1) {
    const slice = slices[index];
    if (slice.index !== index || slice.startY !== expectedStart || slice.endY <= slice.startY) {
      throw new Error('重切片顺序或范围不连续');
    }
    if (!slice.url || !slice.nodeId || ids.has(slice.nodeId)) {
      throw new Error('重切片缺少唯一节点 ID 或媒体路径');
    }
    ids.add(slice.nodeId);
    expectedStart = slice.endY;
  }
  if (expectedStart !== record.canvasHeight) throw new Error('重切片没有完整覆盖拼接长图');
  return slices;
};

const archivePatch = (
  node,
  controllerNodeId,
  stitchId,
  archivedAt,
  order,
) => ({
  ...node,
  detailStitchArchive: {
    controllerNodeId,
    stitchId,
    archivedAt,
    order,
  },
});

function sliceNode(
  slice,
  record,
  controller,
  folderName,
) {
  return {
    id: slice.nodeId,
    type: IMAGE_NODE_TYPE,
    title: `竞品重切片 ${String(slice.index + 1).padStart(2, '0')}`,
    x: controller.x,
    y: controller.y,
    prompt: `智能重切片 ${String(slice.index + 1).padStart(2, '0')}`,
    status: SUCCESS_STATUS,
    resultUrl: slice.url,
    model: 'Upload',
    imageModel: record.imageModel,
    aspectRatio: slice.targetAspectRatio,
    resultAspectRatio: `${slice.width}/${slice.height}`,
    resolution: 'Auto',
    detailRemixImport: {
      controllerNodeId: controller.id,
      role: 'competitor',
      folderName,
      relativePath: `${record.stitchId}_${slice.id}.png`,
      order: slice.index,
      layoutVersion: DETAIL_REMIX_IMPORT_LAYOUT_VERSION,
    },
    detailStitchSource: {
      stitchId: record.stitchId,
      sliceId: slice.id,
      startY: slice.startY,
      endY: slice.endY,
      source: slice.source,
    },
  };
}

/**
 * One immutable canvas transaction: archive originals, insert slices, replace
 * ordered refs + semantic ports, then place the slices below the source row.
 * Validation finishes before any new array is returned.
 */
export function applyDetailStitchSlices(
  nodes,
  controllerNodeId,
  record,
  options = {},
) {
  const controller = nodes.find(node => node.id === controllerNodeId);
  if (!controller || controller.type !== DETAIL_REMIX_NODE_TYPE) {
    throw new Error('商品详情复刻节点不存在');
  }
  if (record.controllerNodeId !== controllerNodeId) throw new Error('拼接任务不属于当前节点');
  const slices = orderedSlices(record);
  const current = createDetailRemixNodeData(controller.detailRemix || {});
  const currentCompetitorIds = [...current.inputRefs.competitorDetailNodeIds];
  if (currentCompetitorIds.length === 0) throw new Error('当前节点没有可替换的竞品图');
  const stitchedSourceIds = (record.sources || []).map(source => source.nodeId);
  if (JSON.stringify(stitchedSourceIds) !== JSON.stringify(currentCompetitorIds)) {
    throw new Error('拼接期间竞品输入已变化，为避免页序错乱未执行替换，请重新打开重切片');
  }
  const existingIds = new Set(nodes.map(node => node.id));
  const activeIds = new Set(currentCompetitorIds);
  for (const slice of slices) {
    if (existingIds.has(slice.nodeId) && !activeIds.has(slice.nodeId)) {
      throw new Error('新切片节点 ID 与画布现有节点冲突');
    }
  }
  const missing = currentCompetitorIds.filter(id => !existingIds.has(id));
  if (missing.length) throw new Error('竞品原始节点已丢失，未执行替换');

  const now = options.now?.() || new Date().toISOString();
  const priorStitch = current.detailStitch;
  const originalCompetitorNodeIds = priorStitch?.status === 'active'
    && Array.isArray(priorStitch.originalCompetitorNodeIds)
    ? priorStitch.originalCompetitorNodeIds
    : currentCompetitorIds;
  const originalFolderImport = priorStitch?.status === 'active' && priorStitch.originalFolderImport
    ? priorStitch.originalFolderImport
    : current.folderImports.competitor;
  if (originalCompetitorNodeIds.some(id => !existingIds.has(id))) {
    throw new Error('已归档的原始竞品节点已丢失');
  }

  const newIds = slices.map(slice => slice.nodeId);
  const folderName = `${current.folderImports.competitor.folderName || '竞品详情'} · 智能重切片`;
  const inputRefs = { ...current.inputRefs, competitorDetailNodeIds: newIds };
  const nextState = createDetailRemixNodeData({
    ...current,
    inputRefs,
    folderImports: {
      ...current.folderImports,
      competitor: {
        folderName,
        status: 'completed',
        total: newIds.length,
        uploaded: newIds.length,
        failed: 0,
        nodeIds: newIds,
        startedAt: record.createdAt,
        completedAt: now,
      },
    },
    detailStitch: {
      status: 'active',
      stitchId: record.stitchId,
      fullImageUrl: record.fullImageUrl,
      originalCompetitorNodeIds,
      originalFolderImport,
      sourceNodeIds: currentCompetitorIds,
      activeSliceNodeIds: newIds,
      appliedAt: now,
    },
    status: current.jobId ? 'outdated' : current.status,
    needsRegeneration: Boolean(current.jobId),
  });
  const mapping = buildDetailRemixInputMapping(inputRefs);
  const nextController = syncDetailRemixInputRefs({
    ...controller,
    parentIds: Object.keys(mapping),
    inputPortByParentId: mapping,
    detailRemix: nextState,
  }, mapping);
  const newNodes = layoutSliceNodesBelowSources(
    nodes,
    slices.map(slice => sliceNode(slice, record, controller, folderName)),
    controller,
    currentCompetitorIds,
  );
  const newIdSet = new Set(newIds);
  const withoutPreviousVersionOfSameIds = nodes.filter(node => !newIdSet.has(node.id));
  const archived = withoutPreviousVersionOfSameIds.map(node => {
    const order = currentCompetitorIds.indexOf(node.id);
    if (order >= 0) return archivePatch(node, controllerNodeId, record.stitchId, now, order);
    return node.id === controllerNodeId ? nextController : node;
  });
  return [...archived, ...newNodes];
}

export function canRestoreDetailStitchOriginals(controller) {
  return controller?.detailRemix?.detailStitch?.status === 'active'
    && Array.isArray(controller.detailRemix.detailStitch.originalCompetitorNodeIds)
    && controller.detailRemix.detailStitch.originalCompetitorNodeIds.length > 0;
}

/** Restore archived originals without deleting generated slices. */
export function restoreDetailStitchOriginals(
  nodes,
  controllerNodeId,
  options = {},
) {
  const controller = nodes.find(node => node.id === controllerNodeId);
  if (!controller || !canRestoreDetailStitchOriginals(controller)) {
    throw new Error('当前节点没有可恢复的原始竞品切片');
  }
  const current = createDetailRemixNodeData(controller.detailRemix || {});
  const stitch = current.detailStitch;
  const originalIds = [...stitch.originalCompetitorNodeIds];
  const byId = new Map(nodes.map(node => [node.id, node]));
  if (originalIds.some(id => !byId.has(id))) throw new Error('原始竞品切片已丢失，无法恢复');
  const activeIds = [...current.inputRefs.competitorDetailNodeIds];
  const inputRefs = { ...current.inputRefs, competitorDetailNodeIds: originalIds };
  const restoredAt = options.now?.() || new Date().toISOString();
  const nextState = createDetailRemixNodeData({
    ...current,
    inputRefs,
    folderImports: {
      ...current.folderImports,
      competitor: stitch.originalFolderImport || {
        folderName: '竞品详情', status: 'completed', total: originalIds.length,
        uploaded: originalIds.length, failed: 0, nodeIds: originalIds,
      },
    },
    detailStitch: { ...stitch, status: 'restored', restoredAt },
    status: current.jobId ? 'outdated' : current.status,
    needsRegeneration: Boolean(current.jobId),
  });
  const mapping = buildDetailRemixInputMapping(inputRefs);
  const nextController = syncDetailRemixInputRefs({
    ...controller,
    parentIds: Object.keys(mapping),
    inputPortByParentId: mapping,
    detailRemix: nextState,
  }, mapping);
  const originalSet = new Set(originalIds);
  const activeSet = new Set(activeIds);
  const restored = nodes.map(node => {
    if (node.id === controllerNodeId) return nextController;
    if (originalSet.has(node.id)) return { ...node, detailStitchArchive: undefined };
    if (activeSet.has(node.id)) {
      return archivePatch(node, controllerNodeId, stitch.stitchId, restoredAt, activeIds.indexOf(node.id));
    }
    return node;
  });
  return reflowDetailRemixFolderNodes(restored, controllerNodeId);
}
