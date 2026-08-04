import { createVideoRemixState } from './videoRemix.js';

export const VIDEO_REMIX_PROJECTS_SCHEMA_VERSION = 1;

const LEGACY_VIDEO_REMIX_NODE_TYPE = 'Video Remix';

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueId(prefix = 'remix') {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId ? `${prefix}_${randomId}` : `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function isoTimestamp(value, fallback) {
  const parsed = new Date(value || '');
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

/**
 * A project-level Video Remix record. The generation state is intentionally
 * independent from canvas position, selection, connections and undo history.
 */
export function createVideoRemixProject(overrides = {}, now = new Date().toISOString()) {
  const requestedId = compact(
    overrides.id
    || overrides.state?.remixId
    || overrides.videoRemix?.remixId
  );
  const id = requestedId || uniqueId('remix');
  const state = createVideoRemixState({
    ...(overrides.videoRemix || overrides.state || {}),
    remixId: id,
  });
  const createdAt = isoTimestamp(
    overrides.createdAt,
    isoTimestamp(state.updatedAt, now)
  );
  const updatedAt = isoTimestamp(
    overrides.updatedAt,
    isoTimestamp(state.updatedAt, createdAt)
  );
  const title = compact(overrides.title)
    || compact(state.source?.title)
    || '未命名复刻';
  return {
    schemaVersion: VIDEO_REMIX_PROJECTS_SCHEMA_VERSION,
    id,
    title,
    state,
    createdAt,
    updatedAt,
    ...(compact(overrides.sourceCanvasNodeId)
      ? { sourceCanvasNodeId: compact(overrides.sourceCanvasNodeId) }
      : {}),
    ...(compact(overrides.finalCanvasNodeId)
      ? { finalCanvasNodeId: compact(overrides.finalCanvasNodeId) }
      : {}),
    ...(Number.isFinite(Number(overrides.canvasMigrationVersion))
      ? { canvasMigrationVersion: Number(overrides.canvasMigrationVersion) }
      : {}),
    ...(compact(overrides.canvasAnalysisNodeId)
      ? { canvasAnalysisNodeId: compact(overrides.canvasAnalysisNodeId) }
      : {}),
  };
}

export function normalizeVideoRemixProjects(values, now = new Date().toISOString()) {
  const records = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    if (!value || typeof value !== 'object') continue;
    const record = createVideoRemixProject(value, now);
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    records.push(record);
  }
  return records;
}

/**
 * Converts historical canvas container nodes into project-level records.
 * Existing project-level records always win, so the migration is idempotent.
 * Canvas result nodes remain intact but no longer point at the removed
 * container node.
 */
export function migrateLegacyVideoRemixNodes(
  nodes,
  existingProjects,
  now = new Date().toISOString()
) {
  const sourceNodes = Array.isArray(nodes) ? nodes : [];
  const projects = normalizeVideoRemixProjects(existingProjects, now);
  const byId = new Map(projects.map(project => [project.id, project]));
  const legacyNodes = sourceNodes.filter(node => node?.type === LEGACY_VIDEO_REMIX_NODE_TYPE);
  const legacyNodeIds = new Set(legacyNodes.map(node => String(node.id || '')).filter(Boolean));

  for (const node of legacyNodes) {
    const state = createVideoRemixState(node.videoRemix || { remixId: node.id });
    const id = compact(state.remixId || node.id);
    if (!id || byId.has(id)) continue;
    const finalNode = sourceNodes.find(candidate => (
      candidate?.type === 'Video'
      && (
        candidate.videoModel === 'video-remix-final'
        || candidate.model === 'video-remix-final'
      )
      && (
        candidate.id === state.output?.nodeId
        || candidate.parentIds?.includes(node.id)
      )
    ));
    const sourceCanvasNodeId = (node.parentIds || []).find(parentId => (
      sourceNodes.some(candidate => candidate?.id === parentId && candidate?.type === 'Video')
    ));
    const record = createVideoRemixProject({
      id,
      title: node.title || node.displayName,
      state,
      sourceCanvasNodeId,
      finalCanvasNodeId: finalNode?.id || state.output?.nodeId,
      createdAt: node.createdAt,
      updatedAt: state.updatedAt,
    }, now);
    byId.set(record.id, record);
    projects.push(record);
  }

  const canvasNodes = sourceNodes
    .filter(node => node?.type !== LEGACY_VIDEO_REMIX_NODE_TYPE)
    .map(node => {
      if (!Array.isArray(node.parentIds) || node.parentIds.length === 0) return node;
      const parentIds = node.parentIds.filter(parentId => !legacyNodeIds.has(parentId));
      return parentIds.length === node.parentIds.length ? node : { ...node, parentIds };
    });

  return {
    nodes: canvasNodes,
    videoRemixes: projects,
    migrated: legacyNodes.length > 0,
    legacyNodeIds: [...legacyNodeIds],
  };
}

export function videoRemixProjectAsNode(project) {
  const record = createVideoRemixProject(project);
  return {
    id: record.id,
    type: LEGACY_VIDEO_REMIX_NODE_TYPE,
    title: record.title,
    x: 0,
    y: 0,
    prompt: '',
    status: 'idle',
    model: 'video-remix',
    aspectRatio: 'Auto',
    resolution: 'Auto',
    videoRemix: record.state,
  };
}
