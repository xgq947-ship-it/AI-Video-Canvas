import { productSceneInputMappingPatch } from './productSceneInputMapping.js';
import { createVideoAnalysisNodeData, syncVideoAnalysisInputRefs } from '../../shared/videoAnalysis.js';
import { createDetailRemixNodeData, syncDetailRemixInputRefs } from '../../shared/detailRemix.js';

export function removeCanvasConnection(nodes, connection) {
  if (!connection?.parentId || !connection?.childId) return nodes;
  let changed = false;
  const next = nodes.map(node => {
    if (node.id !== connection.childId || !(node.parentIds || []).includes(connection.parentId)) {
      return node;
    }

    changed = true;
    const updated = {
      ...node,
      parentIds: (node.parentIds || []).filter(parentId => parentId !== connection.parentId),
    };
    if (node.type === 'Video Analysis') {
      const mapping = { ...(node.inputPortByParentId || {}) };
      delete mapping[connection.parentId];
      return syncVideoAnalysisInputRefs(
        { ...updated, videoAnalysis: createVideoAnalysisNodeData(node.videoAnalysis || {}) },
        mapping
      );
    }
    if (node.type === 'Detail Page Remix') {
      const mapping = { ...(node.inputPortByParentId || {}) };
      delete mapping[connection.parentId];
      return syncDetailRemixInputRefs(
        { ...updated, detailRemix: createDetailRemixNodeData(node.detailRemix || {}) },
        mapping
      );
    }
    if (node.type !== 'Product Scene Replace') return updated;

    const stored = node.productSceneInputMapping;
    const hasExplicitMapping = Boolean(stored && typeof stored === 'object');
    const mapping = {
      version: 1,
      sceneReferenceNodeId: hasExplicitMapping ? stored.sceneReferenceNodeId : node.sceneReferenceId,
      productImageNodeId: hasExplicitMapping ? stored.productImageNodeId : node.productReferenceId,
      promptSourceNodeId: hasExplicitMapping ? stored.promptSourceNodeId : node.productSceneVideoPromptSourceId,
    };
    if (mapping.sceneReferenceNodeId === connection.parentId) {
      mapping.sceneReferenceNodeId = undefined;
    }
    if (mapping.productImageNodeId === connection.parentId) {
      mapping.productImageNodeId = undefined;
    }
    if (mapping.promptSourceNodeId === connection.parentId) {
      mapping.promptSourceNodeId = undefined;
    }
    return { ...updated, ...productSceneInputMappingPatch(mapping) };
  });
  return changed ? next : nodes;
}

/**
 * Would adding the edge parentId → childId close a directed cycle?
 *
 * Data flows parent → child (an edge is stored as `child.parentIds` containing
 * the parent). The new edge forms a loop iff `childId` can already reach
 * `parentId` in that direction — i.e. `childId` is already an ancestor of
 * `parentId`. So walk UP from `parentId` through `parentIds`; if `childId`
 * appears, the edge would be a cycle. A self-connection counts as a cycle too.
 *
 * Pure and graph-only (ignores node types) so it can be shared and unit-tested.
 */
export function wouldCreateCycle(nodes, parentId, childId) {
  if (!parentId || !childId) return false;
  if (parentId === childId) return true;
  const byId = new Map((nodes || []).map(node => [node.id, node]));
  const stack = [parentId];
  const visited = new Set();
  while (stack.length) {
    const currentId = stack.pop();
    if (currentId === childId) return true;
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    for (const ancestorId of byId.get(currentId)?.parentIds || []) {
      if (!visited.has(ancestorId)) stack.push(ancestorId);
    }
  }
  return false;
}

export function removeCanvasConnections(nodes, connections) {
  return (connections || []).reduce(
    (current, connection) => removeCanvasConnection(current, connection),
    nodes
  );
}

/**
 * Delete canvas nodes and disconnect every outgoing edge in one immutable
 * transaction. Semantic controllers must be disconnected through the same
 * helpers as an explicit Edge deletion, otherwise their denormalized inputRefs
 * keep IDs for images that no longer exist on the canvas.
 *
 * nodeIds may include an ID that is already absent. This intentionally repairs
 * older projects that persisted a dangling parent/reference before this guard
 * existed.
 */
export function removeCanvasNodes(nodes, nodeIds) {
  const deletedIds = new Set(
    (Array.isArray(nodeIds) ? nodeIds : []).map(value => String(value || '')).filter(Boolean)
  );
  if (!deletedIds.size) return nodes;
  const connections = [];
  for (const child of nodes || []) {
    for (const parentId of child?.parentIds || []) {
      if (deletedIds.has(parentId)) connections.push({ parentId, childId: child.id });
    }
  }
  return removeCanvasConnections(nodes, connections)
    .filter(node => !deletedIds.has(node.id));
}
