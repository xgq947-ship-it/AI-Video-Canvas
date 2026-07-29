import { productSceneInputMappingPatch } from './productSceneInputMapping.js';

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

export function removeCanvasConnections(nodes, connections) {
  return (connections || []).reduce(
    (current, connection) => removeCanvasConnection(current, connection),
    nodes
  );
}
