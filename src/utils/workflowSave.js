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

/**
 * The server may rewrite nested Remix media URLs while organizing a project.
 * Only accept that normalized record when the client has not edited it since
 * the submitted snapshot was captured.
 */
export function mergeServerNormalizedVideoRemixes(
  currentProjects,
  submittedProjects,
  normalizedProjects
) {
  const submittedById = new Map((submittedProjects || []).map(project => [project.id, project]));
  const normalizedById = new Map((normalizedProjects || []).map(project => [project.id, project]));
  return (currentProjects || []).map(current => {
    const submitted = submittedById.get(current.id);
    const normalized = normalizedById.get(current.id);
    if (!submitted || !normalized) return current;
    return current.updatedAt === submitted.updatedAt ? normalized : current;
  });
}
