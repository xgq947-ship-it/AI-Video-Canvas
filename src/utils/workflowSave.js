const SERVER_NORMALIZED_MEDIA_FIELDS = [
  'resultUrl',
  'lastFrame',
  'editorCanvasData',
  'editorBackgroundUrl',
  'mediaUrl',
  'renderOutputUrl',
];

/**
 * Apply only the media URL rewrites performed by the server to the latest
 * client state. A save response may arrive after generation has completed;
 * replacing the whole node array would then resurrect the submitted loading
 * snapshot and delete nodes created while the request was in flight.
 */
export function mergeServerNormalizedNodes(currentNodes, submittedNodes, normalizedNodes) {
  const submittedById = new Map(submittedNodes.map(node => [node.id, node]));
  const normalizedById = new Map(normalizedNodes.map(node => [node.id, node]));

  return currentNodes.map(currentNode => {
    const submittedNode = submittedById.get(currentNode.id);
    const normalizedNode = normalizedById.get(currentNode.id);
    if (!submittedNode || !normalizedNode) return currentNode;

    let nextNode = currentNode;
    for (const field of SERVER_NORMALIZED_MEDIA_FIELDS) {
      const submittedValue = submittedNode[field];
      const normalizedValue = normalizedNode[field];
      const serverChangedValue = normalizedValue !== submittedValue;
      const clientStillHasSubmittedValue = currentNode[field] === submittedValue;
      if (!serverChangedValue || !clientStillHasSubmittedValue) continue;
      if (nextNode === currentNode) nextNode = { ...currentNode };
      nextNode[field] = normalizedValue;
    }
    return nextNode;
  });
}
