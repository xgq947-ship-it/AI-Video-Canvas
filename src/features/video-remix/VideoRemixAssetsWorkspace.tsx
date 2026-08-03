import React from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  Edit3,
  Images,
  Library,
  Loader2,
  Package,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';

import {
  addVideoRemixCharacterLook,
  applyVideoRemixAssetConsistencyResult,
  beginVideoRemixAssetConsistencyGeneration,
  confirmVideoRemixAssets,
  confirmVideoRemixAssetConsistencyPack,
  confirmVideoRemixAssetPrimaryReference,
  createVideoRemixState,
  getVideoRemixAssetConsistencyPack,
  getVideoRemixAssetConsistencyReadiness,
  getVideoRemixMinimumAssetReadiness,
  prepareVideoRemixAssetConsistencyPack,
  replaceVideoRemixAsset,
  replaceVideoRemixCharacterLook,
  resolveVideoRemixAsset,
  resolveVideoRemixCharacterLook,
  setVideoRemixPropRemoved,
  setVideoRemixAssetConsistencyError,
  setVideoRemixShotCharacterLook,
  type AssetSource,
  type SceneZone,
  type VideoRemixAssetReplacement,
} from '../../../shared/videoRemix.js';
import { listVideoRemixConsistencyImageProviders } from '../../../shared/generationProviders.js';
import { AssetLibraryPanel, type LibraryAsset } from '../../components/AssetLibraryPanel';
import { generateImage } from '../../services/generationService';
import { NodeData } from '../../types';
import {
  importVideoRemixLibraryAsset,
  listVideoRemixLibraryAssets,
  uploadVideoRemixAssetImage,
} from './videoRemixService';

type VideoRemixState = ReturnType<typeof createVideoRemixState>;
type AssetKind = 'characters' | 'scenes' | 'props';
type AssetTarget = {
  kind: AssetKind;
  assetId: string;
  lookId?: string;
};
type ConsistencyUploadTarget = {
  kind: AssetKind;
  assetId: string;
  profileId: string;
};

interface TargetSnapshot {
  name: string;
  description: string;
  identity: string;
  visualDescription: string;
  audioDescription: string;
  voiceDescription: Record<string, string>;
  zones: SceneZone[];
  category: 'hero' | 'interactive' | 'background';
  referenceImages: string[];
  masterPrompt: string;
  anchorBlock: string;
  source: AssetSource;
  replacement?: VideoRemixAssetReplacement;
}

const SOURCE_LABEL: Record<AssetSource, string> = {
  analysis: 'AI 剧情方案',
  generated: 'AI 生成',
  upload: '本地上传',
  library: '素材库',
};

const KIND_LABEL: Record<AssetKind, string> = {
  characters: '人物',
  scenes: '场景',
  props: '道具',
};

const PROP_CATEGORY_LABEL = {
  hero: '核心商品',
  interactive: '交互道具',
  background: '背景元素',
} as const;

const IMAGE_MODELS = listVideoRemixConsistencyImageProviders();
const DEFAULT_IMAGE_MODEL_ID = IMAGE_MODELS.find(
  model => model.id === 'google-flow-nano-banana-pro'
)?.id || IMAGE_MODELS[0]?.id || '';

function chosenReferenceImages(
  source: AssetSource | undefined,
  referenceImages: string[] | undefined
) {
  if (source === 'analysis') return [];
  return (referenceImages || []).filter(Boolean);
}

function snapshotForTarget(
  state: VideoRemixState,
  target: AssetTarget
): TargetSnapshot | null {
  if (target.kind === 'characters' && target.lookId) {
    const character = state.assets.characters.find(item => item.id === target.assetId);
    const base = character?.looks.find(item => item.id === target.lookId);
    if (!base) return null;
    const current = resolveVideoRemixCharacterLook(base);
    return {
      name: current.name,
      description: current.description,
      identity: '',
      visualDescription: '',
      audioDescription: '',
      voiceDescription: {},
      zones: [],
      category: 'interactive',
      referenceImages: chosenReferenceImages(current.source, current.referenceImages),
      masterPrompt: '',
      anchorBlock: '',
      source: current.source || 'analysis',
      replacement: base.replacement,
    };
  }

  if (target.kind === 'characters') {
    const base = state.assets.characters.find(item => item.id === target.assetId);
    if (!base) return null;
    const current = resolveVideoRemixAsset(base);
    return {
      name: current.name,
      description: '',
      identity: current.identity,
      visualDescription: '',
      audioDescription: '',
      voiceDescription: Object.fromEntries(
        Object.entries(current.voiceDescription || {}).map(([key, value]) => [
          key,
          String(value || ''),
        ])
      ),
      zones: [],
      category: 'interactive',
      referenceImages: chosenReferenceImages(current.source, current.referenceImages),
      masterPrompt: current.masterPrompt || '',
      anchorBlock: current.anchorBlock || '',
      source: current.source,
      replacement: base.replacement,
    };
  }
  if (target.kind === 'scenes') {
    const base = state.assets.scenes.find(item => item.id === target.assetId);
    if (!base) return null;
    const current = resolveVideoRemixAsset(base);
    return {
      name: current.name,
      description: '',
      identity: '',
      visualDescription: current.visualDescription,
      audioDescription: current.audioDescription || '',
      voiceDescription: {},
      zones: current.zones || [],
      category: 'interactive',
      referenceImages: chosenReferenceImages(current.source, current.referenceImages),
      masterPrompt: current.masterPrompt || '',
      anchorBlock: current.anchorBlock || '',
      source: current.source,
      replacement: base.replacement,
    };
  }
  const base = state.assets.props.find(item => item.id === target.assetId);
  if (!base) return null;
  const current = resolveVideoRemixAsset(base);
  return {
    name: current.name,
    description: current.description,
    identity: '',
    visualDescription: '',
    audioDescription: '',
    voiceDescription: {},
    zones: [],
    category: current.category,
    referenceImages: chosenReferenceImages(current.source, current.referenceImages),
    masterPrompt: current.masterPrompt || '',
    anchorBlock: current.anchorBlock || '',
    source: current.source,
    replacement: base.replacement,
  };
}

function replacementFromSnapshot(
  target: AssetTarget,
  snapshot: TargetSnapshot,
  source: AssetSource,
  overrides: Partial<TargetSnapshot> & Partial<VideoRemixAssetReplacement> = {}
): VideoRemixAssetReplacement {
  const referenceImages = overrides.referenceImages === undefined
    ? snapshot.referenceImages
    : overrides.referenceImages;
  const common: VideoRemixAssetReplacement = {
    ...(snapshot.replacement || {}),
    ...overrides,
    source,
    name: overrides.name ?? snapshot.name,
    referenceImages,
    updatedAt: new Date().toISOString(),
  };
  if (target.lookId) {
    return {
      ...common,
      description: overrides.description ?? snapshot.description,
    };
  }
  const semanticOverride = overrides.name !== undefined
    || overrides.description !== undefined
    || overrides.identity !== undefined
    || overrides.visualDescription !== undefined
    || overrides.zones !== undefined
    || overrides.category !== undefined;
  common.masterPrompt = Object.hasOwn(overrides, 'masterPrompt')
    ? overrides.masterPrompt
    : semanticOverride ? undefined : snapshot.masterPrompt;
  common.anchorBlock = Object.hasOwn(overrides, 'anchorBlock')
    ? overrides.anchorBlock
    : semanticOverride ? undefined : snapshot.anchorBlock;
  if (target.kind === 'characters') {
    return {
      ...common,
      identity: overrides.identity ?? snapshot.identity,
      voiceDescription: overrides.voiceDescription ?? snapshot.voiceDescription,
    };
  }
  if (target.kind === 'scenes') {
    return {
      ...common,
      visualDescription: overrides.visualDescription ?? snapshot.visualDescription,
      audioDescription: overrides.audioDescription ?? snapshot.audioDescription,
      zones: overrides.zones ?? snapshot.zones,
    };
  }
  return {
    ...common,
    description: overrides.description ?? snapshot.description,
    category: overrides.category ?? snapshot.category,
  };
}

export const VideoRemixAssetsWorkspace: React.FC<{
  node: NodeData;
  state: VideoRemixState;
  workflowId?: string;
  onUpdateNode: (nodeId: string, updates: Partial<NodeData>) => void;
  onSelectAnalysis: () => void;
  simpleMode?: boolean;
  onConfirmed?: () => void;
  dark: boolean;
}> = ({
  node,
  state,
  workflowId,
  onUpdateNode,
  onSelectAnalysis,
  simpleMode = false,
  onConfirmed,
  dark,
}) => {
  const [activeKind, setActiveKind] = React.useState<AssetKind>('characters');
  const [pickerTarget, setPickerTarget] = React.useState<AssetTarget | null>(null);
  const [editorTarget, setEditorTarget] = React.useState<AssetTarget | null>(null);
  const [uploadTarget, setUploadTarget] = React.useState<AssetTarget | null>(null);
  const [consistencyUploadTarget, setConsistencyUploadTarget] = React.useState<ConsistencyUploadTarget | null>(null);
  const [busy, setBusy] = React.useState('');
  const [error, setError] = React.useState('');
  const [copied, setCopied] = React.useState('');
  const [consistencyModelId, setConsistencyModelId] = React.useState(
    DEFAULT_IMAGE_MODEL_ID
  );
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const consistencyFileInputRef = React.useRef<HTMLInputElement>(null);
  const workingRef = React.useRef(state);

  const persist = React.useCallback((next: VideoRemixState) => {
    workingRef.current = next;
    onUpdateNode(node.id, { videoRemix: next });
  }, [node.id, onUpdateNode]);

  React.useEffect(() => {
    if (!busy) workingRef.current = state;
  }, [busy, state]);

  const applyReplacement = React.useCallback((
    target: AssetTarget,
    replacement: VideoRemixAssetReplacement | null
  ) => {
    const next = target.kind === 'characters' && target.lookId
      ? replaceVideoRemixCharacterLook(
        workingRef.current,
        target.assetId,
        target.lookId,
        replacement
      )
      : replaceVideoRemixAsset(
        workingRef.current,
        target.kind,
        target.assetId,
        replacement
      );
    persist(next);
  }, [persist]);

  const copyText = React.useCallback(async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(current => current === key ? '' : current), 1600);
    } catch {
      setError('复制失败，请手动选择提示词复制');
    }
  }, []);

  const requireProject = () => {
    if (!workflowId) throw new Error('请先保存当前项目，再添加资产参考图');
    return workflowId;
  };

  const startUpload = (target: AssetTarget) => {
    setUploadTarget(target);
    setError('');
    fileInputRef.current?.click();
  };

  const handleUpload = async (file?: File) => {
    const target = uploadTarget;
    if (!file || !target || busy) return;
    const snapshot = snapshotForTarget(state, target);
    if (!snapshot) return;
    setBusy(`upload:${target.assetId}:${target.lookId || ''}`);
    setError('');
    try {
      const url = await uploadVideoRemixAssetImage({
        workflowId: requireProject(),
        file,
        prompt: `${KIND_LABEL[target.kind]} ${snapshot.name}`,
      });
      applyReplacement(
        target,
        replacementFromSnapshot(target, snapshot, 'upload', {
          referenceImages: [url],
        })
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '图片上传失败');
    } finally {
      setBusy('');
      setUploadTarget(null);
    }
  };

  const startConsistencyUpload = (target: ConsistencyUploadTarget) => {
    setConsistencyUploadTarget(target);
    setError('');
    consistencyFileInputRef.current?.click();
  };

  const handleConsistencyUpload = async (file?: File) => {
    const target = consistencyUploadTarget;
    if (!file || !target || busy) return;
    const pack = getVideoRemixAssetConsistencyPack(
      workingRef.current,
      target.kind,
      target.assetId
    );
    const item = pack?.items.find(candidate => candidate.profileId === target.profileId);
    if (!pack || !item) return;
    const missingDependency = item.dependsOn.find(dependency => (
      !pack.items.find(candidate => candidate.profileId === dependency)?.url
    ));
    if ((item.dependsOn.length > 0 && !pack.primaryConfirmed) || missingDependency) {
      setError('请先确认并准备好前序参考图，再上传此设定图');
      setConsistencyUploadTarget(null);
      return;
    }
    setBusy(`consistency-upload:${target.assetId}:${target.profileId}`);
    setError('');
    try {
      const url = await uploadVideoRemixAssetImage({
        workflowId: requireProject(),
        file,
        prompt: item.prompt,
      });
      persist(applyVideoRemixAssetConsistencyResult(
        workingRef.current,
        target.kind,
        target.assetId,
        target.profileId,
        { url, source: 'upload' }
      ));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '一致性参考图上传失败');
    } finally {
      setBusy('');
      setConsistencyUploadTarget(null);
    }
  };

  const handleLibrarySelection = async (selected: LibraryAsset) => {
    const target = pickerTarget;
    if (!target || busy) return;
    const snapshot = snapshotForTarget(state, target);
    if (!snapshot) return;
    setBusy(`library:${target.assetId}:${target.lookId || ''}`);
    setError('');
    try {
      const projectId = requireProject();
      let candidates: LibraryAsset[] = [selected];
      if (target.kind === 'characters' && selected.characterId) {
        const library = await listVideoRemixLibraryAssets();
        if (target.lookId && selected.lookId) {
          candidates = library.filter(item => (
            item.type === 'image'
            && item.characterId === selected.characterId
            && item.lookId === selected.lookId
          ));
        } else if (!target.lookId) {
          candidates = library.filter(item => (
            item.type === 'image'
            && item.characterId === selected.characterId
            && !item.lookId
          ));
        }
        if (candidates.length === 0) candidates = [selected];
      }
      candidates = candidates
        .filter(item => item.type === 'image')
        .filter((item, index, list) => list.findIndex(candidate => candidate.url === item.url) === index)
        .slice(0, 14);
      const referenceImages = await Promise.all(
        candidates.map(item => importVideoRemixLibraryAsset({
          workflowId: projectId,
          sourceUrl: item.url,
        }))
      );
      const displayName = target.lookId
        ? selected.lookName || selected.name
        : target.kind === 'characters'
          ? selected.characterName || selected.name
          : selected.name;
      const replacement = replacementFromSnapshot(target, snapshot, 'library', {
        name: displayName,
        ...(selected.description
          ? target.kind === 'scenes'
            ? { visualDescription: selected.description }
            : target.kind === 'characters' && !target.lookId
              ? { identity: selected.description }
              : { description: selected.description }
          : {}),
        referenceImages,
        libraryAssetId: selected.id,
        libraryCharacterId: selected.characterId,
        libraryLookId: selected.lookId,
      });
      applyReplacement(target, replacement);
      setPickerTarget(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '素材库替换失败');
    } finally {
      setBusy('');
    }
  };

  const saveEditor = (
    target: AssetTarget,
    values: Partial<TargetSnapshot>
  ) => {
    const snapshot = snapshotForTarget(state, target);
    if (!snapshot) return;
    const semanticChanged = values.name !== snapshot.name
      || values.description !== snapshot.description
      || values.identity !== snapshot.identity
      || values.visualDescription !== snapshot.visualDescription
      || JSON.stringify(values.zones) !== JSON.stringify(snapshot.zones)
      || values.category !== snapshot.category;
    const promptOverrides = semanticChanged && values.masterPrompt === snapshot.masterPrompt
      ? { ...values, masterPrompt: undefined, anchorBlock: undefined }
      : values;
    applyReplacement(
      target,
      replacementFromSnapshot(target, snapshot, snapshot.source, promptOverrides)
    );
    setEditorTarget(null);
  };

  const generateAsset = async (
    target: AssetTarget,
    values: Partial<TargetSnapshot>,
    prompt: string,
    modelId: string
  ) => {
    if (busy) return;
    const snapshot = snapshotForTarget(state, target);
    if (!snapshot) return;
    const semanticChanged = values.name !== snapshot.name
      || values.description !== snapshot.description
      || values.identity !== snapshot.identity
      || values.visualDescription !== snapshot.visualDescription
      || JSON.stringify(values.zones) !== JSON.stringify(snapshot.zones)
      || values.category !== snapshot.category;
    const promptOverrides = semanticChanged && values.masterPrompt === snapshot.masterPrompt
      ? { ...values, masterPrompt: undefined, anchorBlock: undefined }
      : values;
    setBusy(`generate:${target.assetId}:${target.lookId || ''}`);
    setError('');
    try {
      const selectedModel = IMAGE_MODELS.find(model => model.id === modelId);
      const preferredAspectRatio = target.kind === 'scenes'
        ? '16:9'
        : target.kind === 'props'
          ? '1:1'
          : '3:4';
      const aspectRatio = selectedModel?.supportedAspectRatios.includes(preferredAspectRatio)
        ? preferredAspectRatio
        : selectedModel?.supportedAspectRatios.includes('1:1')
          ? '1:1'
          : selectedModel?.supportedAspectRatios[0] || preferredAspectRatio;
      const characterReferences = target.lookId
        ? (() => {
            const character = resolveVideoRemixAsset(
              state.assets.characters.find(item => item.id === target.assetId)!
            );
            return chosenReferenceImages(
              character.source,
              character.referenceImages
            ).slice(0, selectedModel?.maxReferenceImages || 1);
          })()
        : [];
      const imageUrl = await generateImage({
        workflowId: requireProject(),
        nodeId: `${node.id}_${target.kind}_${target.assetId}_${target.lookId || 'asset'}`,
        prompt,
        aspectRatio,
        resolution: '自动',
        imageModel: modelId,
        ...(characterReferences.length > 0 ? { imageBase64: characterReferences } : {}),
      });
      applyReplacement(
        target,
        replacementFromSnapshot(target, snapshot, 'generated', {
          ...promptOverrides,
          referenceImages: [imageUrl],
          generatedPrompt: prompt,
        })
      );
      setEditorTarget(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'AI 资产生成失败');
    } finally {
      setBusy('');
    }
  };

  const generateConsistencyItemInternal = React.useCallback(async (
    kind: AssetKind,
    assetId: string,
    profileId: string
  ) => {
    let working = prepareVideoRemixAssetConsistencyPack(
      workingRef.current,
      kind,
      assetId
    );
    let pack = getVideoRemixAssetConsistencyPack(working, kind, assetId);
    const item = pack?.items.find(candidate => candidate.profileId === profileId);
    const model = IMAGE_MODELS.find(candidate => candidate.id === consistencyModelId);
    if (!pack || !item) throw new Error('找不到该资产的一致性参考图任务');
    if (!model) throw new Error('请选择可用的图片模型');
    if (item.dependsOn.length > 0 && !pack.primaryConfirmed) {
      throw new Error('请先确认主参考图，再生成其余角度');
    }
    const missingDependency = item.dependsOn.find(dependency => (
      !pack!.items.find(candidate => candidate.profileId === dependency)?.url
    ));
    if (missingDependency) throw new Error('前序参考图尚未生成，请按顺序继续');
    const aspectRatio = model.supportedAspectRatios.includes(item.aspectRatio)
      ? item.aspectRatio
      : model.supportedAspectRatios.includes('1:1')
        ? '1:1'
        : model.supportedAspectRatios[0] || item.aspectRatio;
    const itemIndex = pack.items.findIndex(candidate => candidate.profileId === profileId);
    const references = pack.items
      .slice(0, Math.max(1, itemIndex + 1))
      .map(candidate => candidate.url)
      .filter((url): url is string => Boolean(url))
      .slice(0, model.maxReferenceImages);
    working = beginVideoRemixAssetConsistencyGeneration(
      working,
      kind,
      assetId,
      profileId
    );
    persist(working);
    try {
      const url = await generateImage({
        workflowId: requireProject(),
        nodeId: `${node.id}_${kind}_${assetId}_${profileId}`,
        prompt: item.prompt,
        aspectRatio,
        resolution: model.defaultResolution || model.resolutions[0] || '自动',
        imageModel: model.id,
        ...(references.length > 0 ? { imageBase64: references } : {}),
      });
      working = applyVideoRemixAssetConsistencyResult(
        workingRef.current,
        kind,
        assetId,
        profileId,
        { url }
      );
      persist(working);
      return true;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '一致性参考图生成失败';
      persist(setVideoRemixAssetConsistencyError(
        workingRef.current,
        kind,
        assetId,
        profileId,
        message
      ));
      throw caught;
    }
  }, [consistencyModelId, node.id, persist, workflowId]);

  const generateConsistencyItem = async (
    kind: AssetKind,
    assetId: string,
    profileId: string
  ) => {
    if (busy) return;
    setBusy(`consistency:${assetId}:${profileId}`);
    setError('');
    try {
      await generateConsistencyItemInternal(kind, assetId, profileId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '一致性参考图生成失败');
    } finally {
      setBusy('');
    }
  };

  const generateConsistencyDependents = async (kind: AssetKind, assetId: string) => {
    if (busy) return;
    const pack = getVideoRemixAssetConsistencyPack(workingRef.current, kind, assetId);
    if (!pack?.primaryConfirmed) {
      setError('请先确认主参考图，再生成其余两张设定图');
      return;
    }
    setBusy(`consistency-batch:${assetId}`);
    setError('');
    try {
      for (const item of pack.items.slice(1)) {
        const latest = getVideoRemixAssetConsistencyPack(
          workingRef.current,
          kind,
          assetId
        );
        const latestItem = latest?.items.find(candidate => candidate.profileId === item.profileId);
        if (latestItem?.url && ['ready', 'confirmed'].includes(latestItem.status)) continue;
        await generateConsistencyItemInternal(kind, assetId, item.profileId);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '一致性参考图批量生成失败');
    } finally {
      setBusy('');
    }
  };

  const confirmPrimary = (kind: AssetKind, assetId: string) => {
    persist(confirmVideoRemixAssetPrimaryReference(
      workingRef.current,
      kind,
      assetId
    ));
  };

  const confirmPack = (kind: AssetKind, assetId: string) => {
    persist(confirmVideoRemixAssetConsistencyPack(
      workingRef.current,
      kind,
      assetId
    ));
  };

  const addLook = (characterId: string) => {
    const id = `LOOK_USER_${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
    const next = addVideoRemixCharacterLook(state, characterId, {
      id,
      name: '新造型',
      description: '请编辑服装、发型和配饰',
      referenceImages: [],
      source: 'upload',
    });
    persist(next);
    setEditorTarget({ kind: 'characters', assetId: characterId, lookId: id });
  };

  const allShotsReady = state.shots.length > 0
    && state.shots.every(shot => shot.analysisStatus === 'ready');
  const hasAssets = Boolean(state.story);
  const consistencyReadiness = getVideoRemixAssetConsistencyReadiness(state);
  const minimumAssetReadiness = getVideoRemixMinimumAssetReadiness(state);

  const confirmAssetsAndContinue = () => {
    const next = confirmVideoRemixAssets(workingRef.current);
    persist(next);
    if (next.assetReview?.confirmed) onConfirmed?.();
  };

  if (!hasAssets) {
    return (
      <div className={`mt-7 flex min-h-[360px] items-center justify-center rounded-[26px] border ${
        dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
      }`}>
        <div className="max-w-sm text-center">
          <Library size={28} className="mx-auto text-cyan-400" />
          <div className="mt-4 text-sm font-medium">需要先完成全片分析</div>
          <p className={`mt-2 text-xs leading-5 ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
            Gemini 建立稳定的人物、场景与道具 ID 后，才能安全执行全局替换。
          </p>
          <button
            type="button"
            onClick={onSelectAnalysis}
            className={`mt-5 rounded-xl px-5 py-2.5 text-xs font-medium ${
              dark ? 'bg-white text-neutral-950' : 'bg-neutral-900 text-white'
            }`}
          >
            前往分析页
          </button>
        </div>
      </div>
    );
  }

  const activeAssets = state.assets[activeKind];
  const allowedCategories = pickerTarget?.kind === 'characters'
    ? ['Character']
    : pickerTarget?.kind === 'scenes'
      ? ['Scene']
      : ['Item', 'Massage Equipment'];
  const editorSnapshot = editorTarget
    ? snapshotForTarget(state, editorTarget)
    : null;

  return (
    <div className="mt-7 space-y-5">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        className="hidden"
        onChange={event => {
          void handleUpload(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      <input
        ref={consistencyFileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        className="hidden"
        onChange={event => {
          void handleConsistencyUpload(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      <section className={`rounded-[26px] border p-5 ${
        dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
      }`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">AI 已整理剧情所需资产</div>
            <div className={`mt-1 text-[11px] ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
              先看中文需求和提示词，再选择 AI 生成、上传自己的图片或从素材库替换；这里不再使用分镜截图冒充资产图。
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <label className={`text-[10px] ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
              一致性图片模型
              <select
                value={consistencyModelId}
                disabled={Boolean(busy)}
                onChange={event => setConsistencyModelId(event.target.value)}
                className={`ml-2 rounded-lg border px-2.5 py-2 text-[10px] outline-none ${
                  dark ? 'border-white/8 bg-[#171819] text-neutral-200' : 'border-neutral-200 bg-white text-neutral-700'
                }`}
              >
                {IMAGE_MODELS.map(model => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={
                !allShotsReady
                || Boolean(busy)
                || !minimumAssetReadiness.ready
              }
              onClick={confirmAssetsAndContinue}
              title={!minimumAssetReadiness.ready
                ? '最少为一名人物生成或上传一张主参考图'
                : undefined}
              className={`flex h-10 items-center gap-2 rounded-xl px-4 text-xs font-medium disabled:opacity-40 ${
                state.assetReview?.confirmed
                  ? dark ? 'bg-emerald-400/12 text-emerald-300' : 'bg-emerald-50 text-emerald-700'
                  : dark ? 'bg-cyan-400 text-neutral-950' : 'bg-cyan-600 text-white'
              }`}
            >
              <Check size={14} />
              {state.assetReview?.confirmed
                ? '已可生成视频'
                : minimumAssetReadiness.characterAssets > 0
                  ? '使用当前人物直接生成视频'
                  : '按提示词直接生成视频'}
            </button>
          </div>
        </div>

        <div className={`mt-4 rounded-xl px-3 py-2.5 text-[11px] ${
          minimumAssetReadiness.ready
            ? dark ? 'bg-emerald-400/8 text-emerald-300' : 'bg-emerald-50 text-emerald-700'
            : dark ? 'bg-white/[0.035] text-neutral-400' : 'bg-neutral-50 text-neutral-600'
        }`}>
          {minimumAssetReadiness.characterAssets > 0
            ? `人物主参考已准备 ${minimumAssetReadiness.preparedCharacters}/${minimumAssetReadiness.characterAssets}`
            : '原片没有人物，可直接使用中文提示词生成'}
          {' · 场景、道具、多角度设定图和关键帧均为可选增强，不会阻止视频生成'}
          {consistencyReadiness.confirmed > 0
            ? ` · 已锁定 ${consistencyReadiness.confirmed} 个三图参考包`
            : ''}
        </div>

        <div className={`mt-5 flex w-fit rounded-xl p-1 ${
          dark ? 'bg-black/35' : 'bg-neutral-100'
        }`}>
          {([
            ['characters', '人物', <Users size={14} />],
            ['scenes', '场景', <Images size={14} />],
            ['props', '道具', <Package size={14} />],
          ] as const).map(([kind, label, icon]) => (
            <button
              key={kind}
              type="button"
              onClick={() => setActiveKind(kind)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs ${
                activeKind === kind
                  ? dark ? 'bg-white text-neutral-950' : 'bg-white text-neutral-900 shadow-sm'
                  : dark ? 'text-neutral-500' : 'text-neutral-500'
              }`}
            >
              {icon}
              {label} {state.assets[kind].length}
            </button>
          ))}
        </div>

        {error && (
          <div className={`mt-4 flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs ${
            dark ? 'bg-red-500/8 text-red-300' : 'bg-red-50 text-red-700'
          }`}>
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}
      </section>

      <div className="space-y-4">
        {activeAssets.map(asset => {
          const target: AssetTarget = { kind: activeKind, assetId: asset.id };
          const snapshot = snapshotForTarget(state, target)!;
          const isRemoved = activeKind === 'props' && 'removed' in asset && asset.removed;
          const consistencyPack = getVideoRemixAssetConsistencyPack(
            state,
            activeKind,
            asset.id
          );
          const primaryReference = consistencyPack?.items.find(
            item => item.profileId === consistencyPack.primaryProfileId
          );
          const selectedPreview = primaryReference?.url || snapshot.referenceImages[0];
          const requirement = activeKind === 'characters'
            ? snapshot.identity
            : activeKind === 'scenes'
              ? snapshot.visualDescription
              : snapshot.description;
          const promptText = consistencyPack?.masterPrompt
            || snapshot.masterPrompt
            || requirement;
          const anchorText = consistencyPack?.anchorBlock || snapshot.anchorBlock;
          const promptCopyKey = `asset-master:${asset.id}`;
          return (
            <article key={asset.id} className={`rounded-[26px] border p-5 ${
              dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
            } ${isRemoved ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[9px] font-medium ${
                      dark ? 'bg-white/6 text-neutral-400' : 'bg-neutral-100 text-neutral-500'
                    }`}>
                      {asset.id}
                    </span>
                    <span className={`rounded-full px-2.5 py-1 text-[9px] ${
                      snapshot.source === 'analysis'
                        ? dark ? 'bg-white/6 text-neutral-400' : 'bg-neutral-100 text-neutral-500'
                        : dark ? 'bg-cyan-400/10 text-cyan-300' : 'bg-cyan-50 text-cyan-700'
                    }`}>
                      {SOURCE_LABEL[snapshot.source]}
                    </span>
                    {isRemoved && <span className="text-[10px] text-red-400">已从生成中移除</span>}
                  </div>
                  <h3 className="mt-3 text-lg font-semibold">{snapshot.name}</h3>
                  <div className={`mt-1 text-[11px] ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                    出现于 {(asset.appearsInShots || []).length} 个镜头
                  </div>
                </div>
                <AssetActions
                  busy={Boolean(busy)}
                  canReset={Boolean(asset.replacement)}
                  dark={dark}
                  onEdit={() => setEditorTarget(target)}
                  onLibrary={() => setPickerTarget(target)}
                  onUpload={() => startUpload(target)}
                  onReset={() => applyReplacement(target, null)}
                />
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                <section className={`rounded-2xl border p-4 ${
                  dark ? 'border-white/8 bg-black/20' : 'border-neutral-200 bg-neutral-50'
                }`}>
                  <div className="flex items-center gap-2 text-xs font-medium">
                    <Sparkles size={14} className="text-cyan-400" />
                    AI 对剧情的{KIND_LABEL[activeKind]}要求
                  </div>
                  <p className={`mt-3 text-xs leading-6 ${dark ? 'text-neutral-300' : 'text-neutral-700'}`}>
                    {requirement || 'AI 尚未提供具体描述，可点击“编辑方案”补充。'}
                  </p>
                  {activeKind === 'characters' && Object.keys(snapshot.voiceDescription).length > 0 && (
                    <p className={`mt-3 text-[11px] leading-5 ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>
                      声音建议：{Object.values(snapshot.voiceDescription).filter(Boolean).join('；')}
                    </p>
                  )}
                  {activeKind === 'scenes' && snapshot.audioDescription && (
                    <p className={`mt-3 text-[11px] leading-5 ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>
                      环境声：{snapshot.audioDescription}
                    </p>
                  )}
                  {activeKind === 'scenes' && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {snapshot.zones.map(zone => (
                        <span key={zone.id} className={`rounded-full px-3 py-1 text-[10px] ${
                          dark ? 'bg-white/6 text-neutral-400' : 'bg-neutral-100 text-neutral-600'
                        }`}>
                          {zone.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {activeKind === 'props' && (
                    <div className="mt-4 flex items-center gap-3">
                      <span className={`rounded-full px-3 py-1 text-[10px] ${
                        dark ? 'bg-white/6 text-neutral-400' : 'bg-neutral-100 text-neutral-600'
                      }`}>
                        {PROP_CATEGORY_LABEL[snapshot.category]}
                      </span>
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => persist(setVideoRemixPropRemoved(state, asset.id, !isRemoved))}
                        className={`flex items-center gap-1.5 text-[10px] ${
                          isRemoved ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {isRemoved ? <RotateCcw size={12} /> : <Trash2 size={12} />}
                        {isRemoved ? '恢复道具' : '从生成中删除'}
                      </button>
                    </div>
                  )}

                  <div className={`mt-4 rounded-xl border p-3 ${
                    dark ? 'border-cyan-400/15 bg-cyan-400/[0.025]' : 'border-cyan-100 bg-white'
                  }`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className={`text-[10px] font-medium ${dark ? 'text-cyan-200' : 'text-cyan-800'}`}>
                        可直接使用的中文生成提示词
                      </span>
                      <button
                        type="button"
                        onClick={() => void copyText(promptCopyKey, promptText)}
                        className={`flex shrink-0 items-center gap-1 text-[9px] ${
                          dark ? 'text-cyan-300' : 'text-cyan-700'
                        }`}
                      >
                        {copied === promptCopyKey ? <Check size={10} /> : <Copy size={10} />}
                        {copied === promptCopyKey ? '已复制' : '复制提示词'}
                      </button>
                    </div>
                    <pre className={`mt-2 max-h-52 overflow-y-auto whitespace-pre-wrap font-sans text-[10px] leading-5 ${
                      dark ? 'text-neutral-300' : 'text-neutral-700'
                    }`}>{promptText}</pre>
                    {anchorText && (
                      <details className={`mt-3 border-t pt-3 ${
                        dark ? 'border-white/8' : 'border-neutral-100'
                      }`}>
                        <summary className={`cursor-pointer text-[9px] ${
                          dark ? 'text-neutral-500' : 'text-neutral-500'
                        }`}>
                          查看跨镜头不变形锚点
                        </summary>
                        <pre className={`mt-2 whitespace-pre-wrap font-sans text-[10px] leading-5 ${
                          dark ? 'text-neutral-400' : 'text-neutral-600'
                        }`}>{anchorText}</pre>
                      </details>
                    )}
                  </div>
                </section>

                {selectedPreview ? (
                  <AssetPreview label="已选主参考图" url={selectedPreview} dark={dark} />
                ) : (
                  <div className={`flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed px-6 text-center ${
                    dark ? 'border-white/10 bg-black/20' : 'border-neutral-200 bg-neutral-50'
                  }`}>
                    <Images size={22} className={dark ? 'text-neutral-600' : 'text-neutral-400'} />
                    <div className="mt-3 text-xs font-medium">尚未选择资产图片</div>
                    <p className={`mt-2 text-[10px] leading-5 ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>
                      这是 AI 的文字方案，不是视频截图。可在下方直接 AI 生成主图，或上传自己的替换图片。
                    </p>
                  </div>
                )}
              </div>

              {!isRemoved && consistencyPack && (
                <ConsistencyPackPanel
                  assetId={asset.id}
                  kind={activeKind}
                  pack={consistencyPack}
                  dark={dark}
                  busy={busy}
                  copied={copied}
                  onCopy={(key, value) => void copyText(key, value)}
                  onGenerate={profileId => void generateConsistencyItem(
                    activeKind,
                    asset.id,
                    profileId
                  )}
                  onUpload={profileId => startConsistencyUpload({
                    kind: activeKind,
                    assetId: asset.id,
                    profileId,
                  })}
                  onGenerateDependents={() => void generateConsistencyDependents(
                    activeKind,
                    asset.id
                  )}
                  onConfirmPrimary={() => confirmPrimary(activeKind, asset.id)}
                  onConfirmPack={() => confirmPack(activeKind, asset.id)}
                  minimumRequired={simpleMode && activeKind === 'characters'}
                  optional={simpleMode && activeKind !== 'characters'}
                />
              )}

              {activeKind === 'characters' && (
                <CharacterLooks
                  state={state}
                  characterId={asset.id}
                  dark={dark}
                  busy={Boolean(busy)}
                  onEdit={lookId => setEditorTarget({ ...target, lookId })}
                  onLibrary={lookId => setPickerTarget({ ...target, lookId })}
                  onUpload={lookId => startUpload({ ...target, lookId })}
                  onReset={lookId => applyReplacement({ ...target, lookId }, null)}
                  onAdd={() => addLook(asset.id)}
                  onSetShotLook={(shotId, lookId) => persist(
                    setVideoRemixShotCharacterLook(
                      state,
                      shotId,
                      asset.id,
                      lookId
                    )
                  )}
                />
              )}
            </article>
          );
        })}
      </div>

      {pickerTarget && (
        <AssetLibraryPanel
          isOpen
          variant="modal"
          canvasTheme={dark ? 'dark' : 'light'}
          title={`选择${pickerTarget.lookId ? '人物造型' : KIND_LABEL[pickerTarget.kind]}素材`}
          allowedCategories={allowedCategories}
          initialCategory={allowedCategories[0]}
          allowedTypes={['image']}
          selectOnly
          onClose={() => setPickerTarget(null)}
          onSelectAsset={asset => void handleLibrarySelection(asset)}
        />
      )}

      {editorTarget && editorSnapshot && (
        <AssetEditorModal
          key={`${editorTarget.kind}:${editorTarget.assetId}:${editorTarget.lookId || ''}`}
          target={editorTarget}
          snapshot={editorSnapshot}
          dark={dark}
          busy={Boolean(busy)}
          onClose={() => setEditorTarget(null)}
          onSave={values => saveEditor(editorTarget, values)}
          onGenerate={(values, prompt, modelId) => void generateAsset(
            editorTarget,
            values,
            prompt,
            modelId
          )}
        />
      )}
    </div>
  );
};

const AssetActions: React.FC<{
  busy: boolean;
  canReset: boolean;
  dark: boolean;
  onEdit: () => void;
  onLibrary: () => void;
  onUpload: () => void;
  onReset: () => void;
}> = ({ busy, canReset, dark, onEdit, onLibrary, onUpload, onReset }) => (
  <div className="flex flex-wrap gap-2">
    {[
      [onEdit, <Edit3 size={12} />, '编辑方案'],
      [onLibrary, <Library size={12} />, '从素材库选择'],
      [onUpload, <Upload size={12} />, '上传替换图'],
    ].map(([handler, icon, label]) => (
      <button
        key={String(label)}
        type="button"
        disabled={busy}
        onClick={handler as () => void}
        className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] disabled:opacity-40 ${
          dark ? 'bg-white/6 text-neutral-300' : 'bg-neutral-100 text-neutral-600'
        }`}
      >
        {icon as React.ReactNode}
        {label as string}
      </button>
    ))}
    {canReset && (
      <button
        type="button"
        disabled={busy}
        onClick={onReset}
        className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] disabled:opacity-40 ${
          dark ? 'bg-white/6 text-neutral-400' : 'bg-neutral-100 text-neutral-500'
        }`}
      >
        <RotateCcw size={12} />
        恢复 AI 方案
      </button>
    )}
  </div>
);

const AssetPreview: React.FC<{
  label: string;
  url?: string;
  dark: boolean;
}> = ({ label, url, dark }) => (
  <figure className={`overflow-hidden rounded-2xl border ${
    dark ? 'border-white/8 bg-black/30' : 'border-neutral-200 bg-neutral-50'
  }`}>
    <div className="aspect-[4/3]">
      {url ? (
        <img src={url} alt={label} className="h-full w-full object-cover" />
      ) : (
        <div className={`flex h-full items-center justify-center text-[10px] ${
          dark ? 'text-neutral-600' : 'text-neutral-400'
        }`}>
          暂无参考图
        </div>
      )}
    </div>
    <figcaption className={`px-3 py-2 text-[9px] ${
      dark ? 'text-neutral-500' : 'text-neutral-400'
    }`}>
      {label}
    </figcaption>
  </figure>
);

type ConsistencyPack = NonNullable<ReturnType<typeof getVideoRemixAssetConsistencyPack>>;

const CONSISTENCY_STATUS_LABEL: Record<ConsistencyPack['items'][number]['status'], string> = {
  pending: '待生成',
  generating: '生成中',
  ready: '待确认',
  confirmed: '已锁定',
  failed: '生成失败',
};

const ConsistencyPackPanel: React.FC<{
  assetId: string;
  kind: AssetKind;
  pack: ConsistencyPack;
  dark: boolean;
  busy: string;
  copied: string;
  onCopy: (key: string, value: string) => void;
  onGenerate: (profileId: string) => void;
  onUpload: (profileId: string) => void;
  onGenerateDependents: () => void;
  onConfirmPrimary: () => void;
  onConfirmPack: () => void;
  minimumRequired?: boolean;
  optional?: boolean;
}> = ({
  assetId,
  kind,
  pack,
  dark,
  busy,
  copied,
  onCopy,
  onGenerate,
  onUpload,
  onGenerateDependents,
  onConfirmPrimary,
  onConfirmPack,
  minimumRequired = false,
  optional = false,
}) => {
  const primary = pack.items.find(item => item.profileId === pack.primaryProfileId);
  const dependentItems = pack.items.filter(item => item.profileId !== pack.primaryProfileId);
  const allReady = pack.items.every(item => (
    item.url && ['ready', 'confirmed'].includes(item.status)
  ));
  const missingDependents = dependentItems.filter(item => !item.url).length;
  const visibleItems = pack.primaryConfirmed || pack.confirmed
    ? pack.items
    : primary ? [primary] : [];
  const running = Boolean(busy);
  return (
    <section className={`mt-5 rounded-2xl border p-4 ${
      pack.confirmed
        ? dark ? 'border-emerald-400/20 bg-emerald-400/[0.035]' : 'border-emerald-200 bg-emerald-50/40'
        : dark ? 'border-cyan-400/15 bg-black/20' : 'border-cyan-100 bg-cyan-50/35'
    }`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium">
            <ShieldCheck size={14} className={pack.confirmed ? 'text-emerald-400' : 'text-cyan-400'} />
            {pack.confirmed
              ? '资产一致性已锁定'
              : pack.primaryConfirmed
                ? '可选增强：补齐一致性图片'
                : optional
                  ? '可选：生成或上传参考图'
                  : minimumRequired
                    ? '最低要求：生成或上传人物主参考图'
                    : '生成或上传主参考图'}
            <span className={`rounded-full px-2 py-0.5 text-[9px] ${
              pack.confirmed
                ? dark ? 'bg-emerald-400/10 text-emerald-300' : 'bg-emerald-100 text-emerald-700'
                : dark ? 'bg-white/6 text-neutral-400' : 'bg-white text-neutral-500'
            }`}>
              {pack.confirmed ? '已锁定' : `${pack.items.filter(item => item.url).length}/3 张`}
            </span>
          </div>
          <p className={`mt-1 text-[10px] leading-5 ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>
            {!pack.primaryConfirmed
              ? `${optional ? '可以跳过，视频会直接使用上方中文提示词。' : '直接按 AI 方案生成，也可以上传自己的图片。'}主图准备好后即可进入视频生成；其余两张只用于进一步提升跨镜头一致性。`
              : kind === 'characters'
                ? '人物主身份照已准备，可直接生成视频；面部多角度和全身设定板属于推荐增强。'
                : kind === 'scenes'
                  ? '主场景图已准备；多机位布局和材质灯光图属于可选增强。'
                  : '主结构图已准备；多角度结构和细节尺度图属于可选增强。'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {primary?.url && !pack.primaryConfirmed && (
            <button
              type="button"
              disabled={running}
              onClick={onConfirmPrimary}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-medium disabled:opacity-40 ${
                dark ? 'bg-cyan-400 text-neutral-950' : 'bg-cyan-600 text-white'
              }`}
            >
              <Check size={12} />
              {minimumRequired || optional ? '需要更多角度：确认主图' : '确认主参考图'}
            </button>
          )}
          {pack.primaryConfirmed && missingDependents > 0 && (
            <button
              type="button"
              disabled={running}
              onClick={onGenerateDependents}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-medium disabled:opacity-40 ${
                dark ? 'bg-cyan-400 text-neutral-950' : 'bg-cyan-600 text-white'
              }`}
            >
              {busy === `consistency-batch:${assetId}`
                ? <Loader2 size={12} className="animate-spin" />
                : <Sparkles size={12} />}
              一键生成剩余 {missingDependents} 张
            </button>
          )}
          {allReady && pack.primaryConfirmed && !pack.confirmed && (
            <button
              type="button"
              disabled={running}
              onClick={onConfirmPack}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-medium disabled:opacity-40 ${
                dark ? 'bg-emerald-400 text-neutral-950' : 'bg-emerald-600 text-white'
              }`}
            >
              <ShieldCheck size={12} />
              锁定三图参考包
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {visibleItems.map(item => {
          const index = pack.items.findIndex(candidate => candidate.profileId === item.profileId);
          const key = `prompt:${assetId}:${item.profileId}`;
          const itemBusy = busy === `consistency:${assetId}:${item.profileId}`;
          const dependencyBlocked = (
            index > 0 && !pack.primaryConfirmed
          ) || item.dependsOn.some(dependency => (
            !pack.items.find(candidate => candidate.profileId === dependency)?.url
          ));
          return (
            <article key={item.profileId} className={`overflow-hidden rounded-xl border ${
              dark ? 'border-white/8 bg-white/[0.025]' : 'border-neutral-200 bg-white'
            }`}>
              <div className={`relative flex aspect-[4/3] items-center justify-center overflow-hidden ${
                dark ? 'bg-black/35' : 'bg-neutral-100'
              }`}>
                {item.url ? (
                  <img src={item.url} alt={item.label} className="h-full w-full object-contain" />
                ) : itemBusy ? (
                  <div className="text-center text-[10px] text-cyan-400">
                    <Loader2 size={20} className="mx-auto animate-spin" />
                    <div className="mt-2">正在生成</div>
                  </div>
                ) : (
                  <div className={`px-4 text-center text-[10px] leading-5 ${dark ? 'text-neutral-600' : 'text-neutral-400'}`}>
                    {dependencyBlocked ? '确认主参考图后生成' : '尚未生成'}
                  </div>
                )}
                <span className={`absolute left-2 top-2 rounded-full px-2 py-1 text-[8px] ${
                  item.status === 'confirmed'
                    ? 'bg-emerald-500/85 text-white'
                    : item.status === 'failed'
                      ? 'bg-red-500/85 text-white'
                      : 'bg-black/65 text-white'
                }`}>
                  {index + 1} · {item.status === 'ready' && (minimumRequired || optional)
                    ? '可直接使用'
                    : CONSISTENCY_STATUS_LABEL[item.status]}
                </span>
              </div>
              <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-medium">{item.label}</div>
                    <div className={`mt-1 text-[9px] ${dark ? 'text-neutral-600' : 'text-neutral-400'}`}>
                      {item.aspectRatio} · {index === 0 ? '主参考图' : '依赖前序参考图'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onCopy(key, item.prompt)}
                    className={`shrink-0 rounded-lg p-1.5 ${dark ? 'bg-white/6 text-neutral-400' : 'bg-neutral-100 text-neutral-500'}`}
                    title="复制对应提示词"
                  >
                    {copied === key ? <Check size={11} /> : <Copy size={11} />}
                  </button>
                </div>
                <details
                  open={index === 0 && !item.url}
                  className={`mt-3 rounded-lg border px-2.5 py-2 ${
                    dark ? 'border-white/8 bg-black/20' : 'border-neutral-100 bg-neutral-50'
                  }`}
                >
                  <summary className={`cursor-pointer text-[9px] ${
                    dark ? 'text-neutral-400' : 'text-neutral-600'
                  }`}>
                    查看这张图的对应提示词
                  </summary>
                  <pre className={`mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap font-sans text-[9px] leading-4 ${
                    dark ? 'text-neutral-400' : 'text-neutral-600'
                  }`}>{item.prompt}</pre>
                </details>
                {item.error && <div className="mt-2 text-[9px] leading-4 text-red-400">{item.error}</div>}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={running || dependencyBlocked}
                    onClick={() => onGenerate(item.profileId)}
                    className={`flex h-8 items-center justify-center gap-1 rounded-lg text-[9px] disabled:opacity-35 ${
                      dark ? 'bg-white/7 text-neutral-300' : 'bg-neutral-100 text-neutral-600'
                    }`}
                  >
                    {itemBusy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                    {item.url ? '重新生成' : index === 0 ? 'AI 生成主图' : 'AI 生成'}
                  </button>
                  <button
                    type="button"
                    disabled={running || dependencyBlocked}
                    onClick={() => onUpload(item.profileId)}
                    className={`flex h-8 items-center justify-center gap-1 rounded-lg text-[9px] disabled:opacity-35 ${
                      dark ? 'bg-white/7 text-neutral-300' : 'bg-neutral-100 text-neutral-600'
                    }`}
                  >
                    <Upload size={11} />
                    {index === 0 ? '上传自己的图' : '上传图片'}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};

const CharacterLooks: React.FC<{
  state: VideoRemixState;
  characterId: string;
  dark: boolean;
  busy: boolean;
  onEdit: (lookId: string) => void;
  onLibrary: (lookId: string) => void;
  onUpload: (lookId: string) => void;
  onReset: (lookId: string) => void;
  onAdd: () => void;
  onSetShotLook: (shotId: string, lookId: string) => void;
}> = ({
  state,
  characterId,
  dark,
  busy,
  onEdit,
  onLibrary,
  onUpload,
  onReset,
  onAdd,
  onSetShotLook,
}) => {
  const character = state.assets.characters.find(item => item.id === characterId)!;
  const shots = state.shots.filter(shot => (
    shot.characters.some(item => item.characterId === characterId)
  ));
  return (
    <div className={`mt-5 rounded-2xl border p-4 ${
      dark ? 'border-white/8 bg-black/20' : 'border-neutral-200 bg-neutral-50'
    }`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-medium">人物造型</div>
          <div className={`mt-1 text-[10px] ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
            人物身份与服装造型分离；下方选择只影响对应镜头。
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onAdd}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] disabled:opacity-40 ${
            dark ? 'bg-white/6 text-neutral-300' : 'bg-white text-neutral-600'
          }`}
        >
          <Plus size={12} />
          新增造型
        </button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {character.looks.map(baseLook => {
          const look = resolveVideoRemixCharacterLook(baseLook);
          const lookImages = chosenReferenceImages(look.source, look.referenceImages);
          return (
            <div key={look.id} className={`rounded-xl border p-3 ${
              dark ? 'border-white/8 bg-white/[0.025]' : 'border-neutral-200 bg-white'
              }`}>
              <div className="flex gap-3">
                {lookImages[0] && (
                  <div className={`h-16 w-12 shrink-0 overflow-hidden rounded-lg ${
                    dark ? 'bg-black/40' : 'bg-neutral-100'
                  }`}>
                    <img
                      src={lookImages[0]}
                      alt={look.name}
                      className="h-full w-full object-cover"
                    />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium">
                      {look.name}
                      {look.source === 'analysis' && (
                        <span className={`ml-2 text-[8px] font-normal ${
                          dark ? 'text-cyan-400/70' : 'text-cyan-700'
                        }`}>
                          AI 造型要求
                        </span>
                      )}
                    </span>
                    <span className={`text-[9px] ${dark ? 'text-neutral-600' : 'text-neutral-400'}`}>
                      {look.id}
                    </span>
                  </div>
                  <p className={`mt-1 line-clamp-2 text-[10px] leading-4 ${
                    dark ? 'text-neutral-500' : 'text-neutral-500'
                  }`}>
                    {look.description}
                  </p>
                </div>
              </div>
              <div className="mt-3">
                <AssetActions
                  busy={busy}
                  canReset={Boolean(baseLook.replacement)}
                  dark={dark}
                  onEdit={() => onEdit(look.id)}
                  onLibrary={() => onLibrary(look.id)}
                  onUpload={() => onUpload(look.id)}
                  onReset={() => onReset(look.id)}
                />
              </div>
            </div>
          );
        })}
      </div>
      {shots.length > 0 && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {shots.map(shot => {
            const selected = shot.characters.find(
              item => item.characterId === characterId
            );
            const selectedLookId = selected?.lookOverride?.locked
              ? selected.lookOverride.lookId
              : selected?.lookId || character.looks[0]?.id;
            return (
              <label key={shot.shotId} className={`rounded-xl border p-3 ${
                dark ? 'border-white/8 bg-white/[0.02]' : 'border-neutral-200 bg-white'
              }`}>
                <span className={`block text-[9px] ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                  镜头 {shot.shotId} · 单镜头造型
                </span>
                <select
                  value={selectedLookId}
                  disabled={busy}
                  onChange={event => onSetShotLook(shot.shotId, event.target.value)}
                  className={`mt-2 w-full rounded-lg border px-2 py-1.5 text-[10px] outline-none ${
                    dark ? 'border-white/8 bg-[#171819] text-neutral-200' : 'border-neutral-200 bg-white text-neutral-700'
                  }`}
                >
                  {character.looks.map(look => (
                    <option key={look.id} value={look.id}>
                      {resolveVideoRemixCharacterLook(look).name}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
};

const AssetEditorModal: React.FC<{
  target: AssetTarget;
  snapshot: TargetSnapshot;
  dark: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (values: Partial<TargetSnapshot>) => void;
  onGenerate: (
    values: Partial<TargetSnapshot>,
    prompt: string,
    modelId: string
  ) => void;
}> = ({
  target,
  snapshot,
  dark,
  busy,
  onClose,
  onSave,
  onGenerate,
}) => {
  const [name, setName] = React.useState(snapshot.name);
  const [description, setDescription] = React.useState(snapshot.description);
  const [identity, setIdentity] = React.useState(snapshot.identity);
  const [visualDescription, setVisualDescription] = React.useState(snapshot.visualDescription);
  const [audioDescription, setAudioDescription] = React.useState(snapshot.audioDescription);
  const [voiceDescription, setVoiceDescription] = React.useState(snapshot.voiceDescription);
  const [zones, setZones] = React.useState(snapshot.zones.map(zone => ({ ...zone })));
  const [category, setCategory] = React.useState(snapshot.category);
  const [masterPrompt, setMasterPrompt] = React.useState(snapshot.masterPrompt);
  const [anchorBlock, setAnchorBlock] = React.useState(snapshot.anchorBlock);
  const [modelId, setModelId] = React.useState(DEFAULT_IMAGE_MODEL_ID || 'gemini-web-image');
  const [prompt, setPrompt] = React.useState(() => {
    const detail = target.lookId
      ? snapshot.description
      : target.kind === 'characters'
        ? snapshot.identity
        : target.kind === 'scenes'
          ? snapshot.visualDescription
          : snapshot.description;
    return [
      `为短视频复刻创建${target.lookId ? '人物造型' : KIND_LABEL[target.kind]}参考图。`,
      `名称：${snapshot.name}。`,
      detail,
      target.kind === 'characters' ? '干净背景，身份特征清晰，适合作为跨镜头一致性参考。' : '',
      target.kind === 'scenes' ? '无文字水印，空间结构清楚，适合作为场景一致性参考。' : '',
      target.kind === 'props' ? '主体完整，材质与关键外观清晰，适合作为道具一致性参考。' : '',
    ].filter(Boolean).join('\n');
  });
  const values = {
    name,
    description,
    identity,
    visualDescription,
    audioDescription,
    voiceDescription,
    zones,
    category,
    masterPrompt,
    anchorBlock,
  };

  return (
    <div className="fixed inset-0 z-[420] flex items-center justify-center bg-black/65 p-6 backdrop-blur-sm">
      <div className={`flex max-h-[calc(100vh-48px)] w-[min(760px,calc(100vw-48px))] flex-col overflow-hidden rounded-3xl border shadow-2xl ${
        dark ? 'border-white/10 bg-[#111214]' : 'border-neutral-200 bg-white'
      }`}>
        <div className={`flex items-center justify-between border-b px-6 py-5 ${
          dark ? 'border-white/8' : 'border-neutral-200'
        }`}>
          <div>
            <div className="text-sm font-semibold">
              编辑{target.lookId ? '人物造型' : KIND_LABEL[target.kind]}
            </div>
            <div className={`mt-1 text-[10px] ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
              文本会进入后续提示词；AI 生成会消耗所选平台额度。
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className={`rounded-xl p-2 ${dark ? 'bg-white/6 text-neutral-400' : 'bg-neutral-100 text-neutral-500'}`}
          >
            <X size={17} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
          <EditorField label="名称" value={name} onChange={setName} dark={dark} />
          {(target.lookId || target.kind === 'props') && (
            <EditorField
              label={target.lookId ? '造型描述' : '道具描述'}
              value={description}
              onChange={setDescription}
              dark={dark}
              rows={3}
            />
          )}
          {!target.lookId && target.kind === 'characters' && (
            <>
              <EditorField
                label="人物身份（不要绑定服装）"
                value={identity}
                onChange={setIdentity}
                dark={dark}
                rows={4}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ['language', '语言'],
                  ['gender', '声音性别'],
                  ['ageFeel', '年龄感'],
                  ['tone', '音色'],
                  ['pitch', '音高'],
                  ['speakingStyle', '说话方式'],
                ].map(([key, label]) => (
                  <EditorField
                    key={key}
                    label={label}
                    value={voiceDescription[key] || ''}
                    onChange={value => setVoiceDescription(current => ({
                      ...current,
                      [key]: value,
                    }))}
                    dark={dark}
                  />
                ))}
              </div>
            </>
          )}
          {target.kind === 'scenes' && (
            <>
              <EditorField
                label="视觉描述"
                value={visualDescription}
                onChange={setVisualDescription}
                dark={dark}
                rows={4}
              />
              <EditorField
                label="环境声音描述"
                value={audioDescription}
                onChange={setAudioDescription}
                dark={dark}
                rows={3}
              />
              <div>
                <div className={`text-[10px] font-medium ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                  场景功能区
                </div>
                <div className="mt-2 space-y-2">
                  {zones.map((zone, index) => (
                    <div key={zone.id} className="grid gap-2 sm:grid-cols-[0.8fr_1.2fr]">
                      <EditorField
                        label={zone.id}
                        value={zone.name}
                        onChange={value => setZones(current => current.map((item, itemIndex) => (
                          itemIndex === index ? { ...item, name: value } : item
                        )))}
                        dark={dark}
                      />
                      <EditorField
                        label="区域功能"
                        value={zone.description}
                        onChange={value => setZones(current => current.map((item, itemIndex) => (
                          itemIndex === index ? { ...item, description: value } : item
                        )))}
                        dark={dark}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          {target.kind === 'props' && (
            <label className="block">
              <span className={`text-[10px] font-medium ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                道具分类
              </span>
              <select
                value={category}
                onChange={event => setCategory(event.target.value as typeof category)}
                className={`mt-2 w-full rounded-xl border px-3 py-2.5 text-xs outline-none ${
                  dark ? 'border-white/8 bg-black/25 text-neutral-200' : 'border-neutral-200 bg-white text-neutral-700'
                }`}
              >
                <option value="hero">核心商品</option>
                <option value="interactive">交互道具</option>
                <option value="background">背景元素</option>
              </select>
            </label>
          )}

          {!target.lookId && (
            <div className={`rounded-2xl border p-4 ${
              dark ? 'border-white/8 bg-black/20' : 'border-neutral-200 bg-neutral-50'
            }`}>
              <div className="text-xs font-medium">跨镜头一致性文字锁定</div>
              <div className={`mt-1 text-[10px] ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                默认由分析结果自动生成；只有需要精确修正身份或产品结构时再编辑。
              </div>
              <div className="mt-3 space-y-3">
                <EditorField
                  label="中文资产主提示词"
                  value={masterPrompt}
                  onChange={setMasterPrompt}
                  dark={dark}
                  rows={5}
                />
                <EditorField
                  label="冻结锚点（每个镜头逐字复用）"
                  value={anchorBlock}
                  onChange={setAnchorBlock}
                  dark={dark}
                  rows={4}
                />
              </div>
            </div>
          )}

          <div className={`rounded-2xl border p-4 ${
            dark ? 'border-cyan-400/15 bg-cyan-400/[0.035]' : 'border-cyan-100 bg-cyan-50/60'
          }`}>
            <div className="flex items-center gap-2 text-xs font-medium">
              <Sparkles size={14} className="text-cyan-400" />
              AI 重新设计
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_220px]">
              <EditorField
                label="生成提示词"
                value={prompt}
                onChange={setPrompt}
                dark={dark}
                rows={5}
              />
              <label className="block">
                <span className={`text-[10px] font-medium ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                  图片模型
                </span>
                <select
                  value={modelId}
                  onChange={event => setModelId(event.target.value)}
                  className={`mt-2 w-full rounded-xl border px-3 py-2.5 text-xs outline-none ${
                    dark ? 'border-white/8 bg-black/25 text-neutral-200' : 'border-neutral-200 bg-white text-neutral-700'
                  }`}
                >
                  {IMAGE_MODELS.map(model => (
                    <option key={model.id} value={model.id}>{model.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy || !prompt.trim() || !modelId}
                  onClick={() => onGenerate(values, prompt.trim(), modelId)}
                  className={`mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl text-xs font-medium disabled:opacity-40 ${
                    dark ? 'bg-cyan-400 text-neutral-950' : 'bg-cyan-600 text-white'
                  }`}
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  {busy ? '生成中…' : '生成并设为当前资产'}
                </button>
              </label>
            </div>
          </div>
        </div>

        <div className={`flex justify-end gap-3 border-t px-6 py-4 ${
          dark ? 'border-white/8' : 'border-neutral-200'
        }`}>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className={`rounded-xl px-4 py-2.5 text-xs ${
              dark ? 'bg-white/6 text-neutral-300' : 'bg-neutral-100 text-neutral-600'
            }`}
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() => onSave(values)}
            className={`rounded-xl px-5 py-2.5 text-xs font-medium disabled:opacity-40 ${
              dark ? 'bg-white text-neutral-950' : 'bg-neutral-900 text-white'
            }`}
          >
            保存文本
          </button>
        </div>
      </div>
    </div>
  );
};

const EditorField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  dark: boolean;
  rows?: number;
}> = ({ label, value, onChange, dark, rows = 1 }) => (
  <label className="block">
    <span className={`text-[10px] font-medium ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
      {label}
    </span>
    {rows > 1 ? (
      <textarea
        value={value}
        rows={rows}
        onChange={event => onChange(event.target.value)}
        className={`mt-2 w-full resize-y rounded-xl border px-3 py-2.5 text-xs leading-5 outline-none ${
          dark ? 'border-white/8 bg-black/25 text-neutral-200' : 'border-neutral-200 bg-white text-neutral-700'
        }`}
      />
    ) : (
      <input
        value={value}
        onChange={event => onChange(event.target.value)}
        className={`mt-2 w-full rounded-xl border px-3 py-2.5 text-xs outline-none ${
          dark ? 'border-white/8 bg-black/25 text-neutral-200' : 'border-neutral-200 bg-white text-neutral-700'
        }`}
      />
    )}
  </label>
);
