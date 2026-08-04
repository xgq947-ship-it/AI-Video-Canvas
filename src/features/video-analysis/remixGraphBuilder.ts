import type { NodeGroup, NodeData } from '../../types';
import { NodeStatus, NodeType } from '../../types';
import {
  createVideoAnalysisNodeData,
  normalizeVideoAnalysisAssetGeneration,
  normalizeVideoAnalysisResult,
  VIDEO_ANALYSIS_ASSET_GENERATION_PROFILE_IDS,
  VIDEO_ANALYSIS_ASSET_REFERENCE_PROFILE_IDS,
  type VideoAnalysisAssetProfile,
  type VideoAnalysisAssetPrompt,
  type VideoAnalysisResult,
} from '../../../shared/videoAnalysis.js';

export const REMIX_LAYOUT = Object.freeze({
  version: 5,
  assetStartGap: 520,
  // 人物三张资产图也沿同一列纵向排列；场景、道具仍按实体各一张排列。
  assetColumnGap: 430,
  assetRowGap: 1320,
  assetProfileRowGap: 420,
  assetKindRowGap: 1700,
  shotRowGap: 620,
  shotVideoColumnGap: 450,
  finalColumnGap: 480,
});

export interface RemixGraphBuildResult {
  nodes: NodeData[];
  group: NodeGroup;
  generatedNodeIds: string[];
  edgeIds: string[];
}

type AssetKind = 'characters' | 'scenes' | 'props';

const ASSET_KINDS: AssetKind[] = ['characters', 'scenes', 'props'];
const safeId = (value: string) => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_');

const stableNodeId = (analysisNodeId: string, shotId: string, role: 'keyframe' | 'video') =>
  `${analysisNodeId}__${safeId(shotId)}__${role}`;

const stableAssetNodeId = (
  analysisNodeId: string,
  kind: AssetKind,
  assetId: string,
  profileId: string,
) => `${analysisNodeId}__asset__${kind}__${safeId(assetId)}__${safeId(profileId)}`;

const findShotOriginNode = (
  nodes: NodeData[],
  analysisNodeId: string,
  shotId: string,
  role: 'keyframe' | 'video' | 'final',
) => nodes.find(node => (
  node.origin?.type === 'video-remix'
  && node.origin.analysisNodeId === analysisNodeId
  && node.origin.role === role
  && (role === 'final' ? !node.origin.shotId : node.origin.shotId === shotId)
));

const findAssetOriginNode = (
  nodes: NodeData[],
  analysisNodeId: string,
  kind: AssetKind,
  assetId: string,
  profileId: string,
) => nodes.find(node => (
  node.origin?.type === 'video-remix'
  && node.origin.analysisNodeId === analysisNodeId
  && node.origin.role === 'asset'
  && node.origin.assetKind === kind
  && node.origin.assetId === assetId
  && node.origin.assetProfileId === profileId
));

const inheritedReferencesFor = (analysisNode: NodeData) => {
  const refs = analysisNode.videoAnalysis?.inputRefs as {
    productNodeIds?: string[];
    characterNodeIds?: string[];
    sceneNodeIds?: string[];
  } | undefined || {};
  return {
    productNodeIds: [...(refs.productNodeIds || [])],
    characterNodeIds: [...(refs.characterNodeIds || [])],
    sceneNodeIds: [...(refs.sceneNodeIds || [])],
  };
};

const emptyInheritedReferences = () => ({
  productNodeIds: [],
  characterNodeIds: [],
  sceneNodeIds: [],
});

const analysisPrompt = (prefix: string, prompt: string) =>
  [prefix.trim(), prompt.trim()].filter(Boolean).join('\n\n');

const assetReferenceCount = (refs: ReturnType<typeof inheritedReferencesFor>, kind: AssetKind) => {
  if (kind === 'characters') return refs.characterNodeIds.length;
  if (kind === 'scenes') return refs.sceneNodeIds.length;
  return refs.productNodeIds.length;
};

const defaultAssetAspectRatio = (kind: AssetKind) => {
  if (kind === 'characters') return '3:4';
  if (kind === 'scenes') return '16:9';
  return '1:1';
};

const fallbackProfiles = (
  asset: VideoAnalysisAssetPrompt,
  kind: AssetKind,
): VideoAnalysisAssetProfile[] => {
  const prompt = asset.prompt.trim();
  if (!prompt) return [];
  const profileIds = VIDEO_ANALYSIS_ASSET_GENERATION_PROFILE_IDS[kind] || [];
  const labels: Record<string, string> = {
    'image-identity-front': '正面身份照',
    'image-identity-angles': '面部多角度',
    'image-identity-board': '全身综合设定板',
    'image-scene-establishing': '场景广角',
    'image-prop-front': '道具结构',
  };
  return profileIds.map((profileId, index) => ({
    id: `${asset.id}-${profileId}`,
    profileId,
    label: labels[profileId] || `参考图 ${index + 1}`,
    prompt: `${prompt}\n\n【本图任务】${labels[profileId] || '资产参考图'}。严格锁定身份、比例、材质和结构。`,
    aspectRatio: profileId === 'image-identity-front' ? '1:1' : defaultAssetAspectRatio(kind),
    dependsOn: profileIds.slice(0, index),
  }));
};

const profilesFor = (asset: VideoAnalysisAssetPrompt, kind: AssetKind) => {
  const profiles = asset.profiles?.length > 0 ? asset.profiles : fallbackProfiles(asset, kind);
  const requiredProfileIds = VIDEO_ANALYSIS_ASSET_GENERATION_PROFILE_IDS[kind] || [];
  const ordered = requiredProfileIds
    .map(profileId => profiles.find(profile => profile.profileId === profileId))
    .filter((profile): profile is VideoAnalysisAssetProfile => Boolean(profile));
  return ordered.length > 0 ? ordered : profiles.slice(0, 1);
};

const activeAssetKindsFor = (
  analysisNode: NodeData,
  refs: ReturnType<typeof inheritedReferencesFor>,
) => {
  const generation = normalizeVideoAnalysisAssetGeneration(analysisNode.videoAnalysis?.assetGeneration);
  return ASSET_KINDS.filter(kind => generation[kind].enabled && assetReferenceCount(refs, kind) === 0);
};

/**
 * Build the complete canvas graph in one pure transaction. Existing generated
 * nodes are upserted by stable origin; user-edited prompts, generated results
 * and hand-moved coordinates survive re-analysis. Asset nodes deliberately have
 * no analysis-node parent: they can be generated from their own prompt without
 * accidentally trying to execute the non-media analysis node first.
 */
export function buildVideoRemixGraph({
  analysisNode,
  result,
  existingNodes,
  existingGroups = [],
  now = new Date().toISOString(),
}: {
  analysisNode: NodeData;
  result: VideoAnalysisResult;
  existingNodes: NodeData[];
  existingGroups?: NodeGroup[];
  now?: string;
}): RemixGraphBuildResult {
  const normalized = normalizeVideoAnalysisResult(result);
  if (!analysisNode?.id || normalized.shots.length === 0) {
    throw new Error('视频分析结果没有可生成的镜头');
  }

  const analysisNodeId = analysisNode.id;
  const inheritedReferences = inheritedReferencesFor(analysisNode);
  const activeAssetKinds = activeAssetKindsFor(analysisNode, inheritedReferences);
  const groupId = analysisNode.groupId || `video-remix-group-${safeId(analysisNodeId)}`;
  const baseX = Number(analysisNode.x) || 0;
  const baseY = Number(analysisNode.y) || 0;
  const nextById = new Map(existingNodes.map(node => [node.id, node]));
  const previousResult = analysisNode.videoAnalysis?.result;
  const resultChanged = Boolean(previousResult)
    && JSON.stringify(normalizeVideoAnalysisResult(previousResult)) !== JSON.stringify(normalized);
  const currentShotIds = new Set(normalized.shots.map(shot => shot.id));

  for (const [nodeId, node] of nextById) {
    if (
      node.origin?.type === 'video-remix'
      && node.origin.analysisNodeId === analysisNodeId
      && (node.origin.role === 'keyframe' || node.origin.role === 'video')
      && node.origin.shotId
      && !currentShotIds.has(node.origin.shotId)
    ) {
      nextById.delete(nodeId);
    }
  }

  const generatedNodeIds: string[] = [];
  const edgeIds: string[] = [];
  const assetNodeIds: string[] = [];
  const assetReferenceNodeIds: string[] = [];
  const videoNodeIds: string[] = [];
  const assetPrompts = normalized.global.assetPrompts || {
    characters: [],
    scenes: [],
    props: [],
  };

  // 资产列：人物的三张资产图全部保留并纵向排列，场景和道具每个实体一张。
  // 关键帧只连接 assetReferenceNodeIds，人物的另外两张图不会自动进入视频参考。
  const assetPrimaryX = baseX + REMIX_LAYOUT.assetStartGap;
  activeAssetKinds.forEach((kind, kindIndex) => {
    const assets = assetPrompts[kind] || [];
    const kindBaseY = baseY + kindIndex * REMIX_LAYOUT.assetKindRowGap;

    assets.forEach((asset, assetIndex) => {
      const profiles = profilesFor(asset, kind);
      if (profiles.length === 0) return;
      const assetBaseY = kindBaseY + assetIndex * REMIX_LAYOUT.assetRowGap;
      const nodeIdByProfileId = new Map(profiles.map(profile => [
        profile.profileId,
        stableAssetNodeId(analysisNodeId, kind, asset.id, profile.profileId),
      ]));
      const mainNodeId = nodeIdByProfileId.get(profiles[0].profileId)!;
      const referenceProfileId = VIDEO_ANALYSIS_ASSET_REFERENCE_PROFILE_IDS[kind];

      profiles.forEach((profile, profileIndex) => {
        const nodeId = nodeIdByProfileId.get(profile.profileId)!;
        const previous = nextById.get(nodeId)
          || findAssetOriginNode([...nextById.values()], analysisNodeId, kind, asset.id, profile.profileId);
        const positionIsStable = previous?.origin?.layoutVersion === REMIX_LAYOUT.version;
        const promptLocked = previous?.promptSource === 'user' && previous.promptLocked;
        const isMain = profileIndex === 0;
        const isReference = profile.profileId === referenceProfileId;
        const parentIds = profile.dependsOn
          .map(profileId => nodeIdByProfileId.get(profileId))
          .filter((parentId): parentId is string => Boolean(parentId));
        const assetNode: NodeData = {
          ...(previous || {}),
          id: nodeId,
          type: NodeType.IMAGE,
          title: `${kind === 'characters' ? '人物' : kind === 'scenes' ? '场景' : '道具'} · ${asset.name} · ${profile.label}`,
          x: positionIsStable ? previous!.x : assetPrimaryX,
          y: positionIsStable
            ? previous!.y
            : assetBaseY + profileIndex * REMIX_LAYOUT.assetProfileRowGap,
          prompt: promptLocked ? previous!.prompt : profile.prompt,
          promptSource: promptLocked ? 'user' : 'analysis',
          promptLocked,
          status: previous?.status || NodeStatus.IDLE,
          model: previous?.model || 'Banana Pro',
          imageModel: previous?.imageModel || 'google-flow-nano-banana-pro',
          imageGenerationCount: 1,
          aspectRatio: profile.aspectRatio || defaultAssetAspectRatio(kind),
          resolution: previous?.resolution || '2K',
          parentIds,
          inputPortByParentId: Object.fromEntries(parentIds.map(parentId => [parentId, 'asset-main-output'])),
          outputPortId: 'asset-output',
          inheritedReferences: emptyInheritedReferences(),
          groupId,
          videoAnalysisAssetKind: kind,
          videoAnalysisAssetId: asset.id,
          videoAnalysisAssetProfileId: profile.profileId,
          videoAnalysisAssetRole: isMain ? 'main' : 'angle',
          videoAnalysisAssetMainNodeId: mainNodeId,
          videoAnalysisAssetMainLocked: isMain
            ? Boolean(previous?.videoAnalysisAssetMainLocked)
            : Boolean(nextById.get(mainNodeId)?.videoAnalysisAssetMainLocked),
          videoAnalysisAssetReferenceBoundary: isReference,
          origin: {
            type: 'video-remix',
            analysisNodeId,
            assetKind: kind,
            assetId: asset.id,
            assetProfileId: profile.profileId,
            assetRole: isMain ? 'main' : 'angle',
            role: 'asset',
            layoutVersion: REMIX_LAYOUT.version,
          },
          needsUpdate: Boolean(previous?.needsUpdate)
            || Boolean(previous && previous.prompt !== profile.prompt && !promptLocked)
            || Boolean(previous?.resultUrl && resultChanged),
        };
        nextById.set(nodeId, assetNode);
        assetNodeIds.push(nodeId);
        generatedNodeIds.push(nodeId);
        if (isReference) assetReferenceNodeIds.push(nodeId);
        parentIds.forEach(parentId => edgeIds.push(`${parentId}->${nodeId}`));
      });
    });
  });

  // 只清掉这个分析节点之前生成、且已经不属于当前资产包的节点。
  // 只处理明确标记为本分析资产的节点，不触碰用户手动创建的图片节点。
  const selectedAssetNodeIds = new Set(assetNodeIds);
  for (const [nodeId, node] of nextById) {
    if (
      node.origin?.type === 'video-remix'
      && node.origin.analysisNodeId === analysisNodeId
      && node.origin.role === 'asset'
      && !selectedAssetNodeIds.has(nodeId)
    ) {
      nextById.delete(nodeId);
    }
  }

  const shotKeyframeX = baseX
    + REMIX_LAYOUT.assetStartGap
    + (assetNodeIds.length > 0 ? REMIX_LAYOUT.assetColumnGap : 0);
  const shotVideoX = shotKeyframeX + REMIX_LAYOUT.shotVideoColumnGap;

  normalized.shots.forEach((shot, index) => {
    const keyframeX = shotKeyframeX;
    const videoX = shotVideoX;
    const y = baseY + index * REMIX_LAYOUT.shotRowGap;
    const keyframeId = stableNodeId(analysisNodeId, shot.id, 'keyframe');
    const videoId = stableNodeId(analysisNodeId, shot.id, 'video');
    const previousKeyframe = nextById.get(keyframeId)
      || findShotOriginNode([...nextById.values()], analysisNodeId, shot.id, 'keyframe');
    const previousVideo = nextById.get(videoId)
      || findShotOriginNode([...nextById.values()], analysisNodeId, shot.id, 'video');
    const keyframePrompt = analysisPrompt(normalized.global.globalPromptPrefix, shot.imagePrompt);
    const previousKeyframeLocked = previousKeyframe?.promptSource === 'user' && previousKeyframe.promptLocked;
    const previousVideoLocked = previousVideo?.promptSource === 'user' && previousVideo.promptLocked;
    const keyframePositionIsStable = previousKeyframe?.origin?.layoutVersion === REMIX_LAYOUT.version;
    const videoPositionIsStable = previousVideo?.origin?.layoutVersion === REMIX_LAYOUT.version;

    const keyframe: NodeData = {
      ...(previousKeyframe || {}),
      id: keyframeId,
      type: NodeType.IMAGE,
      title: `镜头 ${String(shot.order).padStart(2, '0')} · 关键帧`,
      x: keyframePositionIsStable ? previousKeyframe!.x : keyframeX,
      y: keyframePositionIsStable ? previousKeyframe!.y : y,
      prompt: previousKeyframeLocked ? previousKeyframe!.prompt : keyframePrompt,
      promptSource: previousKeyframeLocked ? 'user' : 'analysis',
      promptLocked: previousKeyframeLocked,
      status: previousKeyframe?.status || NodeStatus.IDLE,
      model: previousKeyframe?.model || 'Banana Pro',
      imageModel: previousKeyframe?.imageModel || 'google-flow-nano-banana-pro',
      aspectRatio: normalized.global.aspectRatio || '9:16',
      resolution: previousKeyframe?.resolution || '2K',
      // 分析节点提供镜头语义；只有选定的资产参考节点提供真实图片输入。
      // 人物的其它两张资产图仍留在画布并可单独生成，但不会自动进入关键帧。
      parentIds: [analysisNodeId, ...assetReferenceNodeIds],
      inputPortByParentId: {
        [analysisNodeId]: 'analysis-output',
        ...Object.fromEntries(assetReferenceNodeIds.map(id => [id, 'asset-reference'])),
      },
      inheritedReferences,
      groupId,
      origin: {
        type: 'video-remix',
        analysisNodeId,
        shotId: shot.id,
        order: shot.order,
        role: 'keyframe',
        layoutVersion: REMIX_LAYOUT.version,
      },
      needsUpdate: Boolean(previousKeyframe?.needsUpdate)
        || Boolean(previousKeyframe && previousKeyframe.prompt !== keyframePrompt && !previousKeyframeLocked)
        || Boolean(previousKeyframe?.resultUrl && resultChanged),
    };

    const video: NodeData = {
      ...(previousVideo || {}),
      id: videoId,
      type: NodeType.VIDEO,
      title: `镜头 ${String(shot.order).padStart(2, '0')} · 视频`,
      x: videoPositionIsStable ? previousVideo!.x : videoX,
      y: videoPositionIsStable ? previousVideo!.y : y,
      prompt: previousVideoLocked ? previousVideo!.prompt : shot.videoPrompt,
      promptSource: previousVideoLocked ? 'user' : 'analysis',
      promptLocked: previousVideoLocked,
      status: previousVideo?.status || NodeStatus.IDLE,
      model: previousVideo?.model || 'Seedance 2.0',
      videoModel: previousVideo?.videoModel || 'seedance-2-0',
      videoDuration: shot.duration,
      generateAudio: previousVideo?.generateAudio !== false,
      aspectRatio: normalized.global.aspectRatio || '9:16',
      resolution: previousVideo?.resolution || 'Auto',
      parentIds: [keyframeId],
      inputPortByParentId: { [keyframeId]: 'keyframe-output' },
      inheritedReferences,
      groupId,
      origin: {
        type: 'video-remix',
        analysisNodeId,
        shotId: shot.id,
        order: shot.order,
        role: 'video',
        layoutVersion: REMIX_LAYOUT.version,
      },
      needsUpdate: Boolean(previousVideo?.needsUpdate)
        || Boolean(previousVideo && previousVideo.prompt !== shot.videoPrompt && !previousVideoLocked)
        || Boolean(previousVideo?.resultUrl && resultChanged),
    };

    nextById.set(keyframe.id, keyframe);
    nextById.set(video.id, video);
    generatedNodeIds.push(keyframe.id, video.id);
    videoNodeIds.push(video.id);
    edgeIds.push(`${analysisNodeId}->${keyframe.id}`, `${keyframe.id}->${video.id}`);
    assetReferenceNodeIds.forEach(assetId => edgeIds.push(`${assetId}->${keyframe.id}`));
  });

  const previousFinal = findShotOriginNode([...nextById.values()], analysisNodeId, '', 'final');
  const finalId = previousFinal?.id || `${analysisNodeId}__final`;
  const finalNode: NodeData = {
    ...(previousFinal || {}),
    id: finalId,
    type: NodeType.RENDER,
    title: previousFinal?.title || '短视频复刻 · 最终成片',
    x: previousFinal?.origin?.layoutVersion === REMIX_LAYOUT.version
      ? previousFinal.x
      : shotVideoX + REMIX_LAYOUT.finalColumnGap,
    y: previousFinal?.origin?.layoutVersion === REMIX_LAYOUT.version
      ? previousFinal.y
      : baseY + Math.max(0, (normalized.shots.length - 1) * REMIX_LAYOUT.shotRowGap / 2),
    prompt: '',
    status: previousFinal?.status || NodeStatus.IDLE,
    model: 'remotion',
    aspectRatio: normalized.global.aspectRatio || '9:16',
    resolution: previousFinal?.resolution || 'Auto',
    parentIds: videoNodeIds,
    inputPortByParentId: Object.fromEntries(videoNodeIds.map(id => [id, 'video-output'])),
    compWidth: normalized.global.aspectRatio === '9:16' ? 1080 : 1920,
    compHeight: normalized.global.aspectRatio === '9:16' ? 1920 : 1080,
    compFps: previousFinal?.compFps || 24,
    groupId,
    origin: {
      type: 'video-remix',
      analysisNodeId,
      role: 'final',
      layoutVersion: REMIX_LAYOUT.version,
    },
    needsUpdate: Boolean(previousFinal?.needsUpdate)
      || Boolean(previousFinal?.renderOutputUrl && resultChanged),
  };
  nextById.set(finalNode.id, finalNode);
  generatedNodeIds.push(finalNode.id);
  videoNodeIds.forEach(videoId => edgeIds.push(`${videoId}->${finalNode.id}`));

  const generatedAt = now;
  const updatedAnalysisNode: NodeData = {
    ...analysisNode,
    title: analysisNode.title || '视频分析',
    status: NodeStatus.SUCCESS,
    groupId,
    videoAnalysis: createVideoAnalysisNodeData({
      ...analysisNode.videoAnalysis,
      result: normalized,
      status: 'completed',
      generatedGraph: {
        nodeIds: generatedNodeIds,
        edgeIds,
        generatedAt,
      },
      errorMessage: undefined,
    }),
  };
  nextById.set(analysisNodeId, updatedAnalysisNode);

  const groupNodeIds = [analysisNodeId, ...generatedNodeIds];
  const group: NodeGroup = {
    id: groupId,
    nodeIds: groupNodeIds,
    label: '短视频复刻工作流',
  };
  void existingGroups;

  return {
    nodes: [...nextById.values()].map(node => groupNodeIds.includes(node.id) ? { ...node, groupId } : node),
    group,
    generatedNodeIds,
    edgeIds,
  };
}
