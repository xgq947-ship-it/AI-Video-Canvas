/**
 * Shared data contract for the canvas-native video analysis workflow.
 *
 * The old Video Remix workspace keeps a richer analysis model for backward
 * compatibility. The canvas only needs this small, generation-ready shape:
 * one global continuity block and one prompt pair per shot.
 */

import { buildVideoRemixAssetConsistencyDefinition } from './videoRemixAssetPrompts.js';

export const VIDEO_ANALYSIS_SCHEMA_VERSION = 1;

export const VIDEO_ANALYSIS_INPUT_PORTS = Object.freeze([
  'source-video',
  'product-reference',
  'character-reference',
  'scene-reference',
]);

export const VIDEO_ANALYSIS_PORT_LABELS = Object.freeze({
  'source-video': '参考视频',
  'product-reference': '产品参考图',
  'character-reference': '人物参考图',
  'scene-reference': '场景参考图',
});

// 统一画布把“要生成/保留的资产图”和“自动接入关键帧的参考图”分开：
// 人物保留完整三图资产包，但关键帧默认只接入全身综合设定板；场景、道具
// 各保留一张稳定参考图。旧版短视频复刻仍使用自己的三图一致性逻辑。
export const VIDEO_ANALYSIS_ASSET_GENERATION_PROFILE_IDS = Object.freeze({
  characters: Object.freeze([
    'image-identity-front',
    'image-identity-angles',
    'image-identity-board',
  ]),
  scenes: Object.freeze(['image-scene-establishing']),
  props: Object.freeze(['image-prop-front']),
});

export const VIDEO_ANALYSIS_ASSET_REFERENCE_PROFILE_IDS = Object.freeze({
  characters: 'image-identity-board',
  scenes: 'image-scene-establishing',
  props: 'image-prop-front',
});

export const VIDEO_ANALYSIS_ASSET_REFERENCE_RULES = Object.freeze({
  characters: '人物实体保留正面身份照、面部多角度、全身综合设定板 3 张资产图；关键帧默认只引用全身综合设定板，统一锁定人物身份与服装结构。',
  scenes: '每个场景实体只生成并引用 1 张广角建立图，统一锁定空间布局、光线和材质。',
  props: '每个道具实体只生成并引用 1 张结构主图，统一锁定形状、比例和材质。',
});

export const VIDEO_ANALYSIS_STATUSES = Object.freeze([
  'idle',
  'ready',
  'analyzing',
  'completed',
  'outdated',
  'error',
]);

const array = value => (Array.isArray(value) ? value : []);
const text = value => String(value ?? '').trim();

const VIDEO_ANALYSIS_ASSET_KINDS = Object.freeze(['characters', 'scenes', 'props']);
const DEFAULT_ASSET_GENERATION_COUNTS = Object.freeze({ characters: 3, scenes: 1, props: 1 });

const referenceRuleFor = kind => VIDEO_ANALYSIS_ASSET_REFERENCE_RULES[kind] || '';

const withReferenceRule = (kind, prompt) => {
  const value = text(prompt);
  const rule = referenceRuleFor(kind);
  if (!value || !rule) return value;
  const marker = '【画布参考图规则】';
  const markerIndex = value.indexOf(marker);
  if (markerIndex >= 0) {
    return `${value.slice(0, markerIndex).trim()}\n\n${marker}${rule}`;
  }
  return `${value}\n\n【画布参考图规则】${rule}`;
};

const assetPromptFallback = (kind, item, index) => {
  const name = text(item?.name) || `${kind === 'characters' ? '人物' : kind === 'scenes' ? '场景' : '道具'} ${index + 1}`;
  const prompt = text(item?.prompt)
    || text(item?.masterPrompt)
    || text(item?.identity)
    || text(item?.visualDescription)
    || text(item?.description);
  return {
    id: text(item?.id) || `${kind.slice(0, -1)}_${String(index + 1).padStart(2, '0')}`,
    name,
    prompt,
    anchorBlock: text(item?.anchorBlock),
    primaryProfileId: text(item?.primaryProfileId),
    profiles: array(item?.profiles).map((profile, profileIndex) => ({
      id: text(profile?.id || profile?.profileId) || `profile_${profileIndex + 1}`,
      profileId: text(profile?.profileId || profile?.id) || `profile_${profileIndex + 1}`,
      label: text(profile?.label) || `角度 ${profileIndex + 1}`,
      prompt: text(profile?.prompt) || prompt,
      aspectRatio: text(profile?.aspectRatio),
      dependsOn: unique(profile?.dependsOn),
    })),
  };
};

const normalizeCanvasAssetProfiles = (kind, item) => {
  const requiredProfileIds = VIDEO_ANALYSIS_ASSET_GENERATION_PROFILE_IDS[kind] || [];
  const existingProfiles = array(item?.profiles);
  const definition = buildVideoRemixAssetConsistencyDefinition(kind, {
    ...item,
    masterPrompt: text(item?.masterPrompt) || text(item?.prompt),
    anchorBlock: text(item?.anchorBlock),
  }) || {};
  const definitionProfiles = array(definition.items);
  const profiles = requiredProfileIds.map(profileId => {
    const existing = existingProfiles.find(profile => (
      text(profile?.profileId || profile?.id) === profileId
    ));
    const fallback = definitionProfiles.find(profile => (
      text(profile?.profileId || profile?.id) === profileId
    ));
    const selected = existing || fallback;
    if (!selected) return null;
    return {
      id: text(selected.id || selected.profileId) || profileId,
      profileId,
      label: text(selected.label) || text(fallback?.label) || profileId,
      prompt: withReferenceRule(kind, selected.prompt || fallback?.prompt || item.prompt),
      aspectRatio: text(selected.aspectRatio) || text(fallback?.aspectRatio),
      // Always restore the canonical character profile order/dependencies when
      // migrating a result that was previously normalized down to one profile.
      dependsOn: unique(fallback?.dependsOn || selected.dependsOn),
    };
  }).filter(Boolean);
  const preferredProfileId = VIDEO_ANALYSIS_ASSET_REFERENCE_PROFILE_IDS[kind];
  const selectedReference = profiles.find(profile => profile.profileId === preferredProfileId);
  return {
    ...item,
    primaryProfileId: selectedReference?.profileId || profiles[0]?.profileId || '',
    referenceRule: referenceRuleFor(kind),
    profiles,
  };
};

const normalizeAssetPromptGroups = (global = {}) => {
  const provided = global.assetPrompts && typeof global.assetPrompts === 'object'
    ? global.assetPrompts
    : {};
  const legacy = {
    characters: array(global.characters),
    scenes: array(global.scenes),
    props: array(global.props).filter(item => !item?.removed),
  };
  return Object.fromEntries(VIDEO_ANALYSIS_ASSET_KINDS.map(kind => [
    kind,
    array(provided[kind] ?? legacy[kind])
      .map((item, index) => assetPromptFallback(kind, item, index))
      .map(item => normalizeCanvasAssetProfiles(kind, item)),
  ]));
};

export function normalizeVideoAnalysisAssetGeneration(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(VIDEO_ANALYSIS_ASSET_KINDS.map(kind => {
    const item = source[kind] && typeof source[kind] === 'object' ? source[kind] : {};
    const count = DEFAULT_ASSET_GENERATION_COUNTS[kind];
    return [kind, {
      enabled: item.enabled === true,
      count,
    }];
  }));
}

const valueOf = value => {
  if (value && typeof value === 'object' && Object.hasOwn(value, 'value')) return text(value.value);
  return text(value);
};

const unique = values => [...new Set(array(values).map(value => text(value)).filter(Boolean))];

const inferAspectRatio = source => {
  const width = Number(source?.width);
  const height = Number(source?.height);
  if (width > 0 && height > 0) return width >= height ? '16:9' : '9:16';
  if (source?.orientation === 'portrait') return '9:16';
  return '16:9';
};

export function createVideoAnalysisNodeData(overrides = {}) {
  const inputRefs = overrides.inputRefs || {};
  return {
    analysisVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
    inputRefs: {
      videoNodeId: text(inputRefs.videoNodeId) || undefined,
      productNodeIds: unique(inputRefs.productNodeIds),
      characterNodeIds: unique(inputRefs.characterNodeIds),
      sceneNodeIds: unique(inputRefs.sceneNodeIds),
    },
    assetGeneration: normalizeVideoAnalysisAssetGeneration(overrides.assetGeneration),
    ...(overrides.result ? { result: normalizeVideoAnalysisResult(overrides.result) } : {}),
    ...(overrides.generatedGraph ? { generatedGraph: { ...overrides.generatedGraph } } : {}),
    status: VIDEO_ANALYSIS_STATUSES.includes(overrides.status) ? overrides.status : 'idle',
    ...(text(overrides.errorMessage) ? { errorMessage: text(overrides.errorMessage) } : {}),
    ...(Number.isFinite(Number(overrides.migrationVersion))
      ? { migrationVersion: Number(overrides.migrationVersion) }
      : {}),
  };
}

/**
 * Keep parent-to-port mapping and the denormalized inputRefs in sync. The
 * mapping is the source of truth; parentIds alone must never decide a role.
 */
export function syncVideoAnalysisInputRefs(node, inputPortByParentId = {}) {
  const next = {
    videoNodeId: undefined,
    productNodeIds: [],
    characterNodeIds: [],
    sceneNodeIds: [],
  };
  for (const [parentId, rawPort] of Object.entries(inputPortByParentId || {})) {
    const port = text(rawPort);
    if (port === 'source-video' && !next.videoNodeId) next.videoNodeId = parentId;
    if (port === 'product-reference') next.productNodeIds.push(parentId);
    if (port === 'character-reference') next.characterNodeIds.push(parentId);
    if (port === 'scene-reference') next.sceneNodeIds.push(parentId);
  }
  return {
    ...node,
    parentIds: Object.keys(inputPortByParentId || {}),
    inputPortByParentId: { ...inputPortByParentId },
    videoAnalysis: createVideoAnalysisNodeData({
      ...(node.videoAnalysis || {}),
      inputRefs: next,
      status: next.videoNodeId ? (node.videoAnalysis?.result ? 'outdated' : 'ready') : 'idle',
      errorMessage: undefined,
    }),
  };
}

export function inferVideoAnalysisInputPort(parentType, currentMapping = {}) {
  if (parentType === 'Video' || parentType === 'Reference Video') return 'source-video';
  const used = new Set(Object.values(currentMapping || {}));
  if (!used.has('product-reference')) return 'product-reference';
  if (!used.has('character-reference')) return 'character-reference';
  if (!used.has('scene-reference')) return 'scene-reference';
  return 'product-reference';
}

export function assignVideoAnalysisInputPort(node, parent, targetPortId) {
  if (!node || node.type !== 'Video Analysis' || !parent?.id) return node;
  const mapping = { ...(node.inputPortByParentId || {}) };
  const requestedPort = VIDEO_ANALYSIS_INPUT_PORTS.includes(targetPortId)
    ? targetPortId
    : inferVideoAnalysisInputPort(parent.type, mapping);
  // The source slot is the only slot that accepts a video. Image-like parents
  // may be dropped on any reference row, but never become the source video;
  // conversely a second video always replaces the source slot.
  const port = (parent.type === 'Video' || parent.type === 'Reference Video')
    ? 'source-video'
    : requestedPort === 'source-video'
      ? inferVideoAnalysisInputPort(parent.type, mapping)
      : requestedPort;

  // A source video and each single-value role have one semantic slot. Multiple
  // product/character/scene references remain allowed and use the same port.
  if (port === 'source-video') {
    for (const [parentId, value] of Object.entries(mapping)) {
      if (value === port && parentId !== parent.id) delete mapping[parentId];
    }
  }
  mapping[parent.id] = port;
  return syncVideoAnalysisInputRefs(node, mapping);
}

export function normalizeVideoAnalysisResult(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const global = source.global && typeof source.global === 'object' ? source.global : {};
  const shots = array(source.shots).map((shot, index) => {
    const item = shot && typeof shot === 'object' ? shot : {};
    const startTime = Number(item.startTime ?? item.start ?? 0);
    const endTime = Number(item.endTime ?? item.end ?? startTime);
    const duration = Number(item.duration) > 0
      ? Number(item.duration)
      : Math.max(0, endTime - startTime);
    return {
      id: text(item.id || item.shotId) || `shot_${String(index + 1).padStart(2, '0')}`,
      order: Number(item.order) > 0 ? Number(item.order) : index + 1,
      startTime: Number.isFinite(startTime) ? startTime : 0,
      endTime: Number.isFinite(endTime) ? endTime : duration,
      duration: Number.isFinite(duration) ? duration : 0,
      summary: text(item.summary) || `镜头 ${index + 1}`,
      imagePrompt: text(item.imagePrompt),
      videoPrompt: text(item.videoPrompt),
      ...(text(item.sourceKeyframeUrl) ? { sourceKeyframeUrl: text(item.sourceKeyframeUrl) } : {}),
      ...(text(item.dialogue) ? { dialogue: text(item.dialogue) } : {}),
      ...(text(item.soundPrompt) ? { soundPrompt: text(item.soundPrompt) } : {}),
    };
  }).sort((left, right) => left.order - right.order);

  const characterConsistency = text(global.characterConsistency)
    || array(global.characters).map(item => `${text(item.name)}：${text(item.identity)}`).filter(Boolean).join('；');
  const sceneConsistency = text(global.sceneConsistency)
    || array(global.scenes).map(item => `${text(item.name)}：${text(item.visualDescription)}`).filter(Boolean).join('；');
  const productRequirements = text(global.productRequirements)
    || array(global.props).filter(item => item.category === 'hero' || !item.category)
      .map(item => `${text(item.name)}：${text(item.description)}`).filter(Boolean).join('；');
  const globalPromptPrefix = text(global.globalPromptPrefix)
    || [characterConsistency, sceneConsistency, productRequirements].filter(Boolean).join('\n');
  const assetPrompts = normalizeAssetPromptGroups(global);

  return {
    analysisVersion: VIDEO_ANALYSIS_SCHEMA_VERSION,
    global: {
      story: typeof global.story === 'object'
        ? text(global.story.summary)
        : text(global.story),
      visualStyle: text(global.visualStyle) || text(global.style),
      aspectRatio: text(global.aspectRatio) || inferAspectRatio(value.source),
      characterConsistency,
      sceneConsistency,
      productRequirements,
      globalPromptPrefix,
      assetPrompts,
    },
    shots,
  };
}

export function markVideoAnalysisDependentsStale(nodes, changedNodeId) {
  const list = array(nodes);
  const analysisIds = new Set(
    list
      .filter(node => node?.type === 'Video Analysis')
      .filter(node => {
        const refs = node.videoAnalysis?.inputRefs || {};
        return [
          refs.videoNodeId,
          ...array(refs.productNodeIds),
          ...array(refs.characterNodeIds),
          ...array(refs.sceneNodeIds),
        ].includes(changedNodeId);
      })
      .map(node => node.id)
  );
  if (analysisIds.size === 0) return list;
  return list.map(node => {
    if (analysisIds.has(node.id) && node.videoAnalysis?.status !== 'analyzing') {
      return {
        ...node,
        videoAnalysis: createVideoAnalysisNodeData({
          ...node.videoAnalysis,
          status: node.videoAnalysis?.result ? 'outdated' : 'ready',
        }),
      };
    }
    if (node.origin?.type === 'video-remix' && analysisIds.has(node.origin.analysisNodeId)) {
      return { ...node, needsUpdate: true };
    }
    return node;
  });
}

const buildRemixAssetPrompt = (kind, asset, index) => {
  const definition = buildVideoRemixAssetConsistencyDefinition(kind, asset) || {};
  const requiredProfileIds = VIDEO_ANALYSIS_ASSET_GENERATION_PROFILE_IDS[kind] || [];
  const profiles = requiredProfileIds.map(profileId => {
    const item = array(definition.items).find(candidate => (
      text(candidate.profileId || candidate.id) === profileId
    ));
    if (!item) return null;
    return {
      id: text(item.profileId || item.id),
      profileId,
      label: text(item.label),
      prompt: withReferenceRule(kind, item.prompt),
      aspectRatio: text(item.aspectRatio),
      dependsOn: unique(item.dependsOn),
    };
  }).filter(Boolean);
  const preferredProfileId = VIDEO_ANALYSIS_ASSET_REFERENCE_PROFILE_IDS[kind];
  const selected = profiles.find(profile => profile.profileId === preferredProfileId) || profiles[0];
  return {
    id: text(asset?.id) || `${kind.slice(0, -1)}_${String(index + 1).padStart(2, '0')}`,
    name: text(asset?.name) || `${kind === 'characters' ? '人物' : kind === 'scenes' ? '场景' : '道具'} ${index + 1}`,
    prompt: text(definition.masterPrompt)
      || text(asset?.masterPrompt)
      || text(asset?.identity)
      || text(asset?.visualDescription)
      || text(asset?.description),
    anchorBlock: text(definition.anchorBlock) || text(asset?.anchorBlock),
    primaryProfileId: selected?.profileId || text(definition.primaryProfileId),
    referenceRule: referenceRuleFor(kind),
    profiles,
  };
};

export function buildVideoAnalysisResultFromRemix({ globalAnalysis, shotAnalyses, source }) {
  const global = globalAnalysis && typeof globalAnalysis === 'object' ? globalAnalysis : {};
  const characters = array(global.characters);
  const scenes = array(global.scenes);
  const props = array(global.props);
  const prefix = [
    global.story?.summary,
    global.style,
    ...characters.map(item => item.anchorBlock || item.masterPrompt || item.identity),
    ...scenes.map(item => item.anchorBlock || item.masterPrompt || item.visualDescription),
    ...props.filter(item => item.category === 'hero' || !item.category)
      .map(item => item.anchorBlock || item.masterPrompt || item.description),
  ].map(text).filter(Boolean).join('\n');

  const imagePromptFor = (shot) => {
    const frame = shot.frameBlueprint || {};
    const subjects = array(frame.subjects).map(subject => {
      const character = characters.find(item => item.id === subject.id);
      return [
        character?.name,
        subject.pose,
        subject.facing ? `朝向${subject.facing}` : '',
        Number(subject.scale) > 0 ? `画面比例${subject.scale}` : '',
      ].map(text).filter(Boolean).join('，');
    }).filter(Boolean);
    const shotProps = array(frame.props).map(item => {
      const prop = props.find(candidate => candidate.id === item.id);
      return [prop?.name, prop?.description].map(text).filter(Boolean).join('：');
    }).filter(Boolean);
    const scene = shot.scene?.sceneId
      ? scenes.find(item => item.id === shot.scene.sceneId)
      : scenes[0];
    return [
      valueOf(shot.storyBeat),
      valueOf(frame.shotSize),
      valueOf(frame.cameraAngle),
      scene && `${scene.name}：${scene.visualDescription}`,
      ...subjects,
      ...shotProps,
    ].map(text).filter(Boolean).join('；');
  };

  const videoPromptFor = (shot) => {
    const actions = array(shot.motionBlueprint?.subjects).flatMap(subject =>
      array(subject.actionSequence).map(action => action.action)
    );
    const propActions = array(shot.motionBlueprint?.propInteractions).map(item => item.action);
    const camera = array(shot.cameraBlueprint?.movement).map(item => item.type).filter(Boolean);
    const dialogue = array(shot.audioBlueprint?.dialogue).map(item => valueOf(item.text));
    const sound = [
      valueOf(shot.audioBlueprint?.environment),
      ...array(shot.audioBlueprint?.soundEvents).map(item => item.description),
    ];
    return [
      valueOf(shot.storyBeat),
      ...actions,
      ...propActions,
      camera.length ? `镜头运动：${camera.join('、')}` : '',
      dialogue.length ? `对白：${dialogue.join('；')}` : '',
      sound.filter(Boolean).length ? `声音：${sound.filter(Boolean).join('；')}` : '',
    ].map(text).filter(Boolean).join('；');
  };

  const shots = array(shotAnalyses).map((shot, index) => ({
    id: text(shot.shotId) || `shot_${String(index + 1).padStart(2, '0')}`,
    order: index + 1,
    startTime: Number(shot.start) || 0,
    endTime: Number(shot.end) || Number(shot.start) || 0,
    duration: Number(shot.duration) || Math.max(0, Number(shot.end) - Number(shot.start)),
    summary: valueOf(shot.storyBeat) || `镜头 ${index + 1}`,
    imagePrompt: imagePromptFor(shot),
    videoPrompt: videoPromptFor(shot),
    ...(array(shot.audioBlueprint?.dialogue).length
      ? { dialogue: array(shot.audioBlueprint.dialogue).map(item => valueOf(item.text)).filter(Boolean).join('；') }
      : {}),
    ...(valueOf(shot.audioBlueprint?.environment)
      ? { soundPrompt: valueOf(shot.audioBlueprint.environment) }
      : {}),
  }));

  return normalizeVideoAnalysisResult({
    source,
    global: {
      story: global.story?.summary,
      visualStyle: global.style,
      aspectRatio: inferAspectRatio(source),
      characterConsistency: characters.map(item => `${item.name}：${item.identity}`).filter(Boolean).join('；'),
      sceneConsistency: scenes.map(item => `${item.name}：${item.visualDescription}`).filter(Boolean).join('；'),
      productRequirements: props.filter(item => item.category === 'hero' || !item.category)
        .map(item => `${item.name}：${item.description}`).filter(Boolean).join('；'),
      globalPromptPrefix: prefix,
      assetPrompts: {
        characters: characters.map((asset, index) => buildRemixAssetPrompt('characters', asset, index)),
        scenes: scenes.map((asset, index) => buildRemixAssetPrompt('scenes', asset, index)),
        props: props.filter(item => !item.removed)
          .map((asset, index) => buildRemixAssetPrompt('props', asset, index)),
      },
    },
    shots,
  });
}
