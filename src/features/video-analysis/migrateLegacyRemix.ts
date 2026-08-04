import type { NodeData, NodeGroup } from '../../types';
import { NodeStatus, NodeType } from '../../types';
import type { VideoRemixProject } from '../../../shared/videoRemixProjects.js';
import {
  buildVideoAnalysisResultFromRemix,
  createVideoAnalysisNodeData,
} from '../../../shared/videoAnalysis.js';
import { buildVideoRemixGraph } from './remixGraphBuilder';

const MIGRATION_VERSION = 1;

const safeId = (value: string) => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_');

const allReferences = (asset: any): string[] => [...new Set([
  ...(Array.isArray(asset?.referenceImages) ? asset.referenceImages : []),
  ...(Array.isArray(asset?.replacement?.referenceImages) ? asset.replacement.referenceImages : []),
  ...(Array.isArray(asset?.looks) ? asset.looks.flatMap((look: any) => look?.referenceImages || []) : []),
].filter(value => typeof value === 'string' && value.trim()))];

const assetNode = ({
  id,
  title,
  x,
  y,
  references,
  referenceKind,
}: {
  id: string;
  title: string;
  x: number;
  y: number;
  references: string[];
  referenceKind: 'character' | 'scene' | 'product';
}): NodeData | null => {
  const resultUrl = references[0];
  if (!resultUrl) return null;
  return {
    id,
    type: NodeType.IMAGE,
    title,
    x,
    y,
    prompt: '',
    status: NodeStatus.SUCCESS,
    resultUrl,
    parentIds: [],
    model: '迁移资产',
    aspectRatio: 'Auto',
    resolution: 'Auto',
    ...(referenceKind === 'character' ? { characterReferenceUrls: references } : {}),
  };
};

const sourceNode = (project: VideoRemixProject, existing: NodeData[], analysisX: number, analysisY: number) => {
  const existingSource = project.sourceCanvasNodeId
    ? existing.find(node => node.id === project.sourceCanvasNodeId && node.type === NodeType.VIDEO)
    : undefined;
  if (existingSource) return existingSource;
  const source = project.state?.source;
  const resultUrl = source?.previewUrl || source?.localUrl || source?.sourceUrl;
  if (!resultUrl) return null;
  return {
    id: `video-analysis-${safeId(project.id)}-source`,
    type: NodeType.VIDEO,
    title: source?.title || `${project.title} · 参考视频`,
    x: analysisX - 520,
    y: analysisY,
    prompt: '',
    status: NodeStatus.SUCCESS,
    resultUrl,
    model: '迁移参考视频',
    videoModel: 'reference-video',
    aspectRatio: source?.orientation === 'portrait' ? '9:16' : '16:9',
    resolution: 'Auto',
    parentIds: [],
  } satisfies NodeData;
};

const migrationResult = (project: VideoRemixProject) => {
  const state = project.state || ({} as VideoRemixProject['state']);
  if (!Array.isArray(state.shots) || state.shots.length === 0) return null;
  return buildVideoAnalysisResultFromRemix({
    globalAnalysis: {
      story: state.story || { summary: '', structure: [] },
      style: state.story?.style,
      characters: state.assets?.characters || [],
      scenes: state.assets?.scenes || [],
      props: state.assets?.props || [],
    },
    shotAnalyses: state.shots,
    source: state.source || undefined,
  });
};

export interface LegacyRemixCanvasMigrationResult {
  nodes: NodeData[];
  groups: NodeGroup[];
  videoRemixes: VideoRemixProject[];
  migrated: boolean;
  migratedProjectIds: string[];
}

/**
 * Convert persisted project-level remix records into ordinary canvas nodes.
 * Stable IDs and a project marker make this safe to run on every load.
 */
export function migrateLegacyRemixProjectsToCanvas({
  nodes,
  groups,
  videoRemixes,
  now = new Date().toISOString(),
}: {
  nodes: NodeData[];
  groups: NodeGroup[];
  videoRemixes: VideoRemixProject[];
  now?: string;
}): LegacyRemixCanvasMigrationResult {
  const nextNodes = [...nodes];
  const nextGroups = [...groups];
  const migratedProjectIds: string[] = [];
  const migratedProjects = videoRemixes.map(project => {
    if (project.canvasMigrationVersion === MIGRATION_VERSION) return project;

    const analysisId = project.canvasAnalysisNodeId || `video-analysis-${safeId(project.id)}`;
    if (nextNodes.some(node => node.id === analysisId)) {
      migratedProjectIds.push(project.id);
      return {
        ...project,
        canvasMigrationVersion: MIGRATION_VERSION,
        canvasAnalysisNodeId: analysisId,
        updatedAt: now,
      };
    }

    const source = project.state?.source;
    const existingSource = project.sourceCanvasNodeId
      ? nextNodes.find(node => node.id === project.sourceCanvasNodeId && node.type === NodeType.VIDEO)
      : undefined;
    const migrationColumn = migratedProjectIds.length;
    const analysisX = existingSource ? existingSource.x + 520 : migrationColumn * 2200;
    const analysisY = existingSource?.y || 0;
    const createdSource = sourceNode(project, nextNodes, analysisX, analysisY);
    if (createdSource && !nextNodes.some(node => node.id === createdSource.id)) nextNodes.push(createdSource);
    const sourceId = (createdSource?.resultUrl ? createdSource.id : undefined)
      || (existingSource?.resultUrl ? existingSource.id : undefined);

    const referenceNodeIds: Record<'product' | 'character' | 'scene', string[]> = {
      product: [],
      character: [],
      scene: [],
    };
    const referenceAssets = [
      ...(project.state?.assets?.props || [])
        .filter((asset: any) => asset?.category === 'hero')
        .map((asset: any, index: number) => ({ asset, kind: 'product' as const, index })),
      ...(project.state?.assets?.characters || [])
        .map((asset: any, index: number) => ({ asset, kind: 'character' as const, index })),
      ...(project.state?.assets?.scenes || [])
        .map((asset: any, index: number) => ({ asset, kind: 'scene' as const, index })),
    ];
    for (const { asset, kind, index } of referenceAssets) {
      const references = allReferences(asset);
      const id = `video-analysis-${safeId(project.id)}-${kind}-${safeId(asset.id || String(index + 1))}`;
      const node = assetNode({
        id,
        title: asset.name || (kind === 'product' ? '迁移产品参考图' : kind === 'character' ? '迁移人物参考图' : '迁移场景参考图'),
        x: analysisX - 520,
        y: analysisY + (referenceNodeIds.product.length + referenceNodeIds.character.length + referenceNodeIds.scene.length) * 230,
        references,
        referenceKind: kind,
      });
      if (!node) continue;
      if (!nextNodes.some(existing => existing.id === id)) nextNodes.push(node);
      referenceNodeIds[kind].push(id);
    }

    const inputPortByParentId: Record<string, string> = {};
    if (sourceId) inputPortByParentId[sourceId] = 'source-video';
    for (const id of referenceNodeIds.product) inputPortByParentId[id] = 'product-reference';
    for (const id of referenceNodeIds.character) inputPortByParentId[id] = 'character-reference';
    for (const id of referenceNodeIds.scene) inputPortByParentId[id] = 'scene-reference';
    const analysisNode: NodeData = {
      id: analysisId,
      type: NodeType.VIDEO_ANALYSIS,
      title: project.title || '视频分析',
      x: analysisX,
      y: analysisY,
      prompt: '',
      status: sourceId ? NodeStatus.IDLE : NodeStatus.ERROR,
      errorMessage: sourceId ? undefined : '迁移记录缺少可用的参考视频',
      model: 'video-analysis',
      aspectRatio: source?.orientation === 'portrait' ? '9:16' : '16:9',
      resolution: 'Auto',
      parentIds: Object.keys(inputPortByParentId),
      inputPortByParentId,
      outputPortId: 'analysis-output',
      videoAnalysis: createVideoAnalysisNodeData({
        status: sourceId ? 'ready' : 'error',
        migrationVersion: MIGRATION_VERSION,
        inputRefs: {
          videoNodeId: sourceId,
          productNodeIds: referenceNodeIds.product,
          characterNodeIds: referenceNodeIds.character,
          sceneNodeIds: referenceNodeIds.scene,
        },
      }),
    };
    nextNodes.push(analysisNode);

    const result = migrationResult(project);
    if (result && sourceId) {
      const built = buildVideoRemixGraph({
        analysisNode,
        result,
        existingNodes: nextNodes,
        existingGroups: nextGroups,
        now,
      });
      const inputNodeIds = [
        sourceId,
        ...referenceNodeIds.product,
        ...referenceNodeIds.character,
        ...referenceNodeIds.scene,
      ].filter((id): id is string => Boolean(id));
      const groupNodeIds = [...new Set([...built.group.nodeIds, ...inputNodeIds])];
      const migratedGroup = { ...built.group, nodeIds: groupNodeIds };
      nextNodes.splice(0, nextNodes.length, ...built.nodes.map(node => (
        inputNodeIds.includes(node.id) ? { ...node, groupId: migratedGroup.id } : node
      )));
      nextGroups.splice(0, nextGroups.length, ...nextGroups.filter(group => group.id !== migratedGroup.id), migratedGroup);
    } else {
      const groupId = `video-remix-group-${safeId(analysisId)}`;
      const inputNodeIds = [
        sourceId,
        ...referenceNodeIds.product,
        ...referenceNodeIds.character,
        ...referenceNodeIds.scene,
        analysisId,
      ].filter((id): id is string => Boolean(id));
      const migratedGroup = {
        id: groupId,
        nodeIds: [...new Set(inputNodeIds)],
        label: '短视频复刻工作流',
      };
      nextNodes.splice(0, nextNodes.length, ...nextNodes.map(node => (
        inputNodeIds.includes(node.id) ? { ...node, groupId } : node
      )));
      nextGroups.splice(0, nextGroups.length, ...nextGroups.filter(group => group.id !== groupId), migratedGroup);
    }

    migratedProjectIds.push(project.id);
    return {
      ...project,
      sourceCanvasNodeId: sourceId || project.sourceCanvasNodeId,
      canvasMigrationVersion: MIGRATION_VERSION,
      canvasAnalysisNodeId: analysisId,
      updatedAt: now,
    };
  });

  return {
    nodes: nextNodes,
    groups: nextGroups,
    videoRemixes: migratedProjects,
    migrated: migratedProjectIds.length > 0,
    migratedProjectIds,
  };
}
