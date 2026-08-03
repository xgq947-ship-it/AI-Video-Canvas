import { DEFAULT_NODE_WIDTH } from '../../shared/canvasCoords.js';

const RESULT_GAP = 100;
const ROW_GAP = 320;

/**
 * Video Remix 始终只在画布上维护一个 Final Video 节点。重复渲染更新该节点，
 * 不展开内部 Shot，也不覆盖用户移动后的坐标和自定义显示名。
 */
export function upsertVideoRemixFinalNode(nodes, remixNodeId, output) {
  const list = Array.isArray(nodes) ? nodes : [];
  const remixNode = list.find(node => node?.id === remixNodeId);
  if (!remixNode || !output?.nodeId || !output?.url) return list;
  const existing = list.find(node => node?.id === output.nodeId);
  const values = {
    type: 'Video',
    title: 'Video Remix 成片',
    displayName: `${remixNode.title || 'Video Remix'} · 成片`,
    prompt: 'Video Remix final output',
    status: 'success',
    resultUrl: output.url,
    videoDuration: Number(output.duration) || 0,
    videoModel: 'video-remix-final',
    generateAudio: true,
    aspectRatio: output.aspectRatio || '16:9',
    resultAspectRatio: `${Number(output.width) || 1920}/${Number(output.height) || 1080}`,
    resolution: `${Number(output.width) || 1920}×${Number(output.height) || 1080}`,
    parentIds: [remixNodeId],
    errorMessage: undefined,
  };
  if (existing) {
    return list.map(node => node.id === output.nodeId
      ? {
          ...node,
          ...values,
          x: node.x,
          y: node.y,
          displayName: node.displayName || values.displayName,
          parentIds: Array.isArray(node.parentIds) ? node.parentIds : values.parentIds,
        }
      : node);
  }
  const targetX = Number(remixNode.x || 0) + DEFAULT_NODE_WIDTH + RESULT_GAP;
  let targetY = Number(remixNode.y || 0);
  while (list.some(node => (
    Math.abs(Number(node.x || 0) - targetX) < 430
    && Math.abs(Number(node.y || 0) - targetY) < 300
  ))) {
    targetY += ROW_GAP;
  }
  return [
    ...list,
    {
      id: output.nodeId,
      x: targetX,
      y: targetY,
      model: 'video-remix-final',
      ...values,
    },
  ];
}

/**
 * Explicitly sends a project-level Remix output to the canvas. Unlike the
 * legacy container-node path this result is a regular, unconnected Video node:
 * the standalone Remix workspace remains the source of truth.
 */
export function upsertVideoRemixProjectFinalNode(
  nodes,
  remixProject,
  output,
  position = { x: 0, y: 0 }
) {
  const list = Array.isArray(nodes) ? nodes : [];
  if (!remixProject?.id || !output?.nodeId || !output?.url) return list;
  const existingId = remixProject.finalCanvasNodeId || output.nodeId;
  const existing = list.find(node => node?.id === existingId);
  const values = {
    type: 'Video',
    title: '视频复刻成片',
    displayName: `${remixProject.title || '短视频复刻'} · 成片`,
    prompt: '短视频复刻最终成片',
    status: 'success',
    resultUrl: output.url,
    videoDuration: Number(output.duration) || 0,
    videoModel: 'video-remix-final',
    generateAudio: true,
    aspectRatio: output.aspectRatio || '16:9',
    resultAspectRatio: `${Number(output.width) || 1920}/${Number(output.height) || 1080}`,
    resolution: `${Number(output.width) || 1920}×${Number(output.height) || 1080}`,
    parentIds: [],
    errorMessage: undefined,
  };
  if (existing) {
    return list.map(node => node.id === existingId
      ? {
          ...node,
          ...values,
          id: existingId,
          x: node.x,
          y: node.y,
          displayName: node.displayName || values.displayName,
          parentIds: Array.isArray(node.parentIds)
            ? node.parentIds.filter(parentId => parentId !== remixProject.id)
            : [],
        }
      : node);
  }
  return [
    ...list,
    {
      // When the user deleted a previously-sent canvas node, keep reusing its
      // stable project link instead of creating a second ID that the task does
      // not remember.
      id: existingId,
      x: Number(position.x) || 0,
      y: Number(position.y) || 0,
      model: 'video-remix-final',
      ...values,
    },
  ];
}
