import { filenameFromMediaUrl } from './nodeDisplayName.js';

export const PRODUCT_SCENE_INPUT_MAPPING_VERSION = 1;

const IMAGE_TYPES = new Set(['Image', 'Image Editor']);

function connectedNodes(node, allNodes, predicate) {
  const byId = new Map(allNodes.map(item => [item.id, item]));
  return [...new Set(node?.parentIds || [])]
    .map(id => byId.get(id))
    .filter(item => item && predicate(item));
}

function inferredImageRole(node) {
  const label = [
    node?.displayName,
    node?.assetName,
    node?.resultName,
    node?.title,
    filenameFromMediaUrl(node?.resultUrl || node?.editorBackgroundUrl),
  ].filter(Boolean).join(' ').toLowerCase();
  if (/(场景|背景|环境|空间|scene|background|location)/i.test(label)) return 'scene';
  if (/(产品|商品|设备|器材|product|item|goods)/i.test(label)) return 'product';
  return null;
}

function fillInitialImageRoles(mapping, images) {
  let sceneReferenceNodeId = mapping.sceneReferenceNodeId;
  let productImageNodeId = mapping.productImageNodeId;
  const sorted = [...images].sort((left, right) => left.id.localeCompare(right.id));
  const assigned = new Set([sceneReferenceNodeId, productImageNodeId].filter(Boolean));

  if (!sceneReferenceNodeId) {
    const semanticScene = sorted.find(item => !assigned.has(item.id) && inferredImageRole(item) === 'scene');
    if (semanticScene) {
      sceneReferenceNodeId = semanticScene.id;
      assigned.add(semanticScene.id);
    }
  }
  if (!productImageNodeId) {
    const semanticProduct = sorted.find(item => !assigned.has(item.id) && inferredImageRole(item) === 'product');
    if (semanticProduct) {
      productImageNodeId = semanticProduct.id;
      assigned.add(semanticProduct.id);
    }
  }

  const remaining = sorted.filter(item => !assigned.has(item.id));
  if (sceneReferenceNodeId && !productImageNodeId && remaining[0]) {
    productImageNodeId = remaining[0].id;
  } else if (productImageNodeId && !sceneReferenceNodeId && remaining[0]) {
    sceneReferenceNodeId = remaining[0].id;
  } else if (!sceneReferenceNodeId && !productImageNodeId && remaining.length >= 2) {
    // Legacy projects had no semantic edge metadata. A stable id sort is the
    // only order-independent fallback; parentIds/edge creation order is ignored.
    sceneReferenceNodeId = remaining[0].id;
    productImageNodeId = remaining[1].id;
  }

  return { ...mapping, sceneReferenceNodeId, productImageNodeId };
}

export function resolveProductSceneInputMapping(node, allNodes) {
  const images = connectedNodes(node, allNodes, item => IMAGE_TYPES.has(item.type));
  const textNodes = connectedNodes(node, allNodes, item => item.type === 'Text');
  const imageIds = new Set(images.map(item => item.id));
  const textIds = new Set(textNodes.map(item => item.id));
  const stored = node?.productSceneInputMapping;
  const hasExplicitMapping = Boolean(stored && typeof stored === 'object');

  let mapping = {
    version: PRODUCT_SCENE_INPUT_MAPPING_VERSION,
    sceneReferenceNodeId: hasExplicitMapping
      ? stored.sceneReferenceNodeId
      : node?.sceneReferenceId,
    productImageNodeId: hasExplicitMapping
      ? stored.productImageNodeId
      : node?.productReferenceId,
    promptSourceNodeId: hasExplicitMapping
      ? stored.promptSourceNodeId
      : node?.productSceneVideoPromptSourceId,
  };

  if (!imageIds.has(mapping.sceneReferenceNodeId)) mapping.sceneReferenceNodeId = undefined;
  if (
    !imageIds.has(mapping.productImageNodeId)
    || mapping.productImageNodeId === mapping.sceneReferenceNodeId
  ) {
    mapping.productImageNodeId = undefined;
  }
  if (!textIds.has(mapping.promptSourceNodeId)) mapping.promptSourceNodeId = undefined;

  if (!hasExplicitMapping) {
    mapping = fillInitialImageRoles(mapping, images);
    if (!mapping.promptSourceNodeId) {
      mapping.promptSourceNodeId = [...textNodes]
        .sort((left, right) => left.id.localeCompare(right.id))[0]?.id;
    }
  }
  return mapping;
}

export function productSceneInputMappingPatch(mapping) {
  const normalized = {
    version: PRODUCT_SCENE_INPUT_MAPPING_VERSION,
    sceneReferenceNodeId: mapping?.sceneReferenceNodeId || undefined,
    productImageNodeId: mapping?.productImageNodeId || undefined,
    promptSourceNodeId: mapping?.promptSourceNodeId || undefined,
  };
  return {
    productSceneInputMapping: normalized,
    // Keep the established scalar fields readable by older builds and by the
    // current generation service while projects migrate lazily.
    sceneReferenceId: normalized.sceneReferenceNodeId,
    productReferenceId: normalized.productImageNodeId,
    productSceneVideoPromptSourceId: normalized.promptSourceNodeId,
  };
}

export function productSceneInputMappingNeedsSync(node, mapping) {
  const stored = node?.productSceneInputMapping;
  return (
    stored?.version !== PRODUCT_SCENE_INPUT_MAPPING_VERSION
    || (stored?.sceneReferenceNodeId || '') !== (mapping?.sceneReferenceNodeId || '')
    || (stored?.productImageNodeId || '') !== (mapping?.productImageNodeId || '')
    || (stored?.promptSourceNodeId || '') !== (mapping?.promptSourceNodeId || '')
    || (node?.sceneReferenceId || '') !== (mapping?.sceneReferenceNodeId || '')
    || (node?.productReferenceId || '') !== (mapping?.productImageNodeId || '')
    || (node?.productSceneVideoPromptSourceId || '') !== (mapping?.promptSourceNodeId || '')
  );
}

export function assignProductSceneInputOnConnect(node, parentNode, allNodes) {
  const parentIds = [...new Set([...(node?.parentIds || []), parentNode.id])];
  const connectedNode = { ...node, parentIds };
  let mapping = resolveProductSceneInputMapping(connectedNode, allNodes);

  if (parentNode.type === 'Text') {
    if (!mapping.promptSourceNodeId) {
      mapping = { ...mapping, promptSourceNodeId: parentNode.id };
    }
    return productSceneInputMappingPatch(mapping);
  }
  if (!IMAGE_TYPES.has(parentNode.type)) return {};
  if (
    mapping.sceneReferenceNodeId === parentNode.id
    || mapping.productImageNodeId === parentNode.id
  ) {
    return productSceneInputMappingPatch(mapping);
  }

  const role = inferredImageRole(parentNode);
  if (role === 'scene' && !mapping.sceneReferenceNodeId) {
    mapping = { ...mapping, sceneReferenceNodeId: parentNode.id };
  } else if (role === 'product' && !mapping.productImageNodeId) {
    mapping = { ...mapping, productImageNodeId: parentNode.id };
  } else if (mapping.sceneReferenceNodeId && !mapping.productImageNodeId) {
    mapping = { ...mapping, productImageNodeId: parentNode.id };
  } else if (mapping.productImageNodeId && !mapping.sceneReferenceNodeId) {
    mapping = { ...mapping, sceneReferenceNodeId: parentNode.id };
  } else if (!mapping.sceneReferenceNodeId && !mapping.productImageNodeId) {
    const images = connectedNodes(connectedNode, allNodes, item => IMAGE_TYPES.has(item.type));
    mapping = fillInitialImageRoles(mapping, images);
  }
  return productSceneInputMappingPatch(mapping);
}
