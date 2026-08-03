import { PROMPT_OPTIMIZATION_PROFILES } from './promptOptimizationProfiles.js';

export const VIDEO_REMIX_ASSET_PROMPT_PROFILES = Object.freeze({
  characters: Object.freeze([
    'image-identity-front',
    'image-identity-angles',
    'image-identity-board',
  ]),
  scenes: Object.freeze([
    'image-scene-establishing',
    'image-scene-layout',
    'image-scene-material-lighting',
  ]),
  props: Object.freeze([
    'image-prop-front',
    'image-prop-angles',
    'image-prop-details',
  ]),
});

export const VIDEO_REMIX_ASSET_PRIMARY_PROFILE = Object.freeze({
  characters: 'image-identity-front',
  scenes: 'image-scene-establishing',
  props: 'image-prop-front',
});

const KIND_LABELS = Object.freeze({
  characters: '人物',
  scenes: '场景',
  props: '道具或产品',
});

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return [...new Set((values || []).map(String).filter(Boolean))];
}

function promptHash(value) {
  const input = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sceneZoneSummary(asset) {
  const zones = Array.isArray(asset?.zones) ? asset.zones : [];
  return zones
    .map(zone => `${compact(zone.name)}：${compact(zone.description)}`)
    .filter(value => !value.endsWith('：'))
    .join('；');
}

export function buildVideoRemixAssetMasterPrompt(kind, asset) {
  const provided = compact(asset?.masterPrompt);
  if (provided) return provided;
  const name = compact(asset?.name) || '未命名资产';
  if (kind === 'characters') {
    return [
      `人物“${name}”的中文身份主提示词。`,
      `固定身份：${compact(asset?.identity) || '依据已确认主参考图锁定脸型、五官、年龄感、肤色、发型与身体比例。'}`,
      '身份、脸部骨骼、五官间距、发际线、身材比例与固定记忆点在所有镜头中保持一致；服装造型由各镜头单独指定，姿势、表情和机位可以变化。',
    ].filter(Boolean).join('\n');
  }
  if (kind === 'scenes') {
    return [
      `场景“${name}”的中文空间主提示词。`,
      `固定视觉：${compact(asset?.visualDescription) || '依据已确认主参考图锁定空间拓扑、功能分区、固定构件、材质、色彩与光线。'}`,
      sceneZoneSummary(asset) ? `固定功能区：${sceneZoneSummary(asset)}` : '',
      compact(asset?.audioDescription) ? `环境声音：${compact(asset.audioDescription)}` : '',
      '门窗、通道、墙角、固定家具与主要光源的位置关系在所有镜头中保持可推导的一致空间。',
    ].filter(Boolean).join('\n');
  }
  return [
    `道具或产品“${name}”的中文结构主提示词。`,
    `固定结构：${compact(asset?.description) || '依据已确认主参考图锁定外轮廓、长宽厚比例、组件数量、材质分区、颜色与标志位置。'}`,
    `资产级别：${asset?.category === 'hero' ? '核心商品' : asset?.category === 'background' ? '背景元素' : '交互道具'}。`,
    '外轮廓、尺寸比例、圆角、组件和开孔数量、按钮与接口位置、材质、颜色、标志位置和真实尺度在所有镜头中保持一致。',
  ].filter(Boolean).join('\n');
}

export function buildVideoRemixAssetAnchorBlock(kind, asset) {
  const provided = compact(asset?.anchorBlock);
  if (provided) return provided;
  const id = compact(asset?.id) || 'ASSET';
  const name = compact(asset?.name) || '未命名资产';
  const masterPrompt = buildVideoRemixAssetMasterPrompt(kind, asset);
  if (kind === 'characters') {
    return `【人物身份锁定 ${id}｜${name}】${compact(masterPrompt)} 每个镜头均视为同一名人物，保持脸部骨骼、五官比例、年龄感、肤色、发型和身体比例一致；服装由当前镜头选定的造型单独约束。`;
  }
  if (kind === 'scenes') {
    return `【场景空间锁定 ${id}｜${name}】${compact(masterPrompt)} 每个镜头均位于同一连续空间，保持门窗、通道、固定构件、功能区、材质、主光方向和色温一致。`;
  }
  return `【道具结构锁定 ${id}｜${name}】${compact(masterPrompt)} 每个镜头均为同一个实体，保持轮廓、长宽厚比例、组件数量、材质分区、颜色、标志位置和真实尺度一致。`;
}

function dependenciesFor(kind, index) {
  const profiles = VIDEO_REMIX_ASSET_PROMPT_PROFILES[kind] || [];
  if (index <= 0) return [];
  if (index === 1) return profiles.slice(0, 1);
  return profiles.slice(0, 2);
}

function itemPrompt(kind, asset, profile, masterPrompt, anchorBlock, index) {
  const dependencyText = index === 0
    ? '这是该资产的主参考图，优先建立唯一身份或结构。'
    : `严格基于前序已经确认的参考图继续生成，只改变本图要求的观察角度或信息组织。`;
  return [
    `输出图片尺寸比例：${profile.aspectRatio}`,
    `【资产类型】${KIND_LABELS[kind]}`,
    `【资产编号】${compact(asset?.id)}`,
    `【资产名称】${compact(asset?.name)}`,
    `【资产主提示词】\n${masterPrompt}`,
    `【本图任务】\n${profile.systemInstruction}`,
    `【生成顺序】${dependencyText}`,
    `【跨镜头锁定】\n${anchorBlock}`,
  ].filter(Boolean).join('\n\n');
}

export function buildVideoRemixAssetConsistencyDefinition(kind, asset) {
  if (!VIDEO_REMIX_ASSET_PROMPT_PROFILES[kind]) return null;
  const masterPrompt = buildVideoRemixAssetMasterPrompt(kind, asset);
  const anchorBlock = buildVideoRemixAssetAnchorBlock(kind, {
    ...asset,
    masterPrompt,
  });
  const items = VIDEO_REMIX_ASSET_PROMPT_PROFILES[kind].map((profileId, index) => {
    const profile = PROMPT_OPTIMIZATION_PROFILES[profileId];
    return {
      id: profileId,
      profileId,
      label: profile.label,
      description: profile.description,
      aspectRatio: profile.aspectRatio,
      dependsOn: dependenciesFor(kind, index),
      prompt: itemPrompt(kind, asset, profile, masterPrompt, anchorBlock, index),
      status: 'pending',
    };
  });
  const definitionHash = promptHash({
    kind,
    assetId: asset?.id,
    masterPrompt,
    anchorBlock,
    prompts: items.map(item => item.prompt),
  });
  return {
    kind,
    masterPrompt,
    anchorBlock,
    definitionHash,
    primaryProfileId: VIDEO_REMIX_ASSET_PRIMARY_PROFILE[kind],
    primaryConfirmed: false,
    confirmed: false,
    status: 'draft',
    items,
  };
}

export function mergeVideoRemixAssetConsistencyPack(definition, stored, seedImages = []) {
  if (!definition) return null;
  const sameDefinition = stored?.definitionHash === definition.definitionHash;
  const storedById = new Map(
    sameDefinition && Array.isArray(stored?.items)
      ? stored.items.map(item => [item.profileId || item.id, item])
      : []
  );
  const primarySeed = unique(seedImages)[0];
  const items = definition.items.map((item, index) => {
    const previous = storedById.get(item.profileId);
    if (previous?.url) {
      return {
        ...item,
        ...previous,
        prompt: item.prompt,
        dependsOn: item.dependsOn,
        status: ['ready', 'confirmed'].includes(previous.status) ? previous.status : 'ready',
      };
    }
    if (index === 0 && primarySeed) {
      return {
        ...item,
        url: primarySeed,
        status: 'ready',
        source: 'existing',
      };
    }
    return {
      ...item,
      ...(previous || {}),
      prompt: item.prompt,
      dependsOn: item.dependsOn,
      status: previous?.status === 'failed' ? 'failed' : 'pending',
    };
  });
  const readyCount = items.filter(item => item.url && ['ready', 'confirmed'].includes(item.status)).length;
  const allReady = readyCount === items.length && items.length > 0;
  const anyGenerating = items.some(item => item.status === 'generating');
  const anyFailed = items.some(item => item.status === 'failed');
  return {
    ...definition,
    ...(sameDefinition ? stored : {}),
    definitionHash: definition.definitionHash,
    masterPrompt: definition.masterPrompt,
    anchorBlock: definition.anchorBlock,
    primaryProfileId: definition.primaryProfileId,
    primaryConfirmed: Boolean(sameDefinition && stored?.primaryConfirmed),
    confirmed: Boolean(allReady && sameDefinition && stored?.confirmed),
    status: allReady
      ? 'ready'
      : anyGenerating
        ? 'generating'
        : anyFailed
          ? 'partial'
          : readyCount > 0
            ? 'partial'
            : 'draft',
    items,
  };
}

export function getVideoRemixConsistencyReferenceImages(asset, preferredProfileIds = []) {
  const pack = asset?.consistencyPack;
  const ready = new Map(
    (Array.isArray(pack?.items) ? pack.items : [])
      .filter(item => item?.url && ['ready', 'confirmed'].includes(item.status))
      .map(item => [item.profileId || item.id, String(item.url)])
  );
  const ordered = [];
  for (const profileId of preferredProfileIds) {
    const url = ready.get(profileId);
    if (url && !ordered.includes(url)) ordered.push(url);
  }
  for (const url of ready.values()) {
    if (!ordered.includes(url)) ordered.push(url);
  }
  // source=analysis 的图片是视频分析帧，不是已经选定的人物/场景/道具资产。
  // 它们仍可用于分镜构图，但不能进入跨镜头资产一致性引用。
  if (asset?.source !== 'analysis') {
    for (const url of unique(asset?.referenceImages)) {
      if (!ordered.includes(url)) ordered.push(url);
    }
  }
  return ordered;
}
