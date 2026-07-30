import React from 'react';
import {
  AlertCircle,
  Check,
  Edit3,
  Images,
  Library,
  Loader2,
  Package,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';

import {
  addVideoRemixCharacterLook,
  confirmVideoRemixAssets,
  createVideoRemixState,
  replaceVideoRemixAsset,
  replaceVideoRemixCharacterLook,
  resolveVideoRemixAsset,
  resolveVideoRemixCharacterLook,
  setVideoRemixPropRemoved,
  setVideoRemixShotCharacterLook,
  type AssetSource,
  type SceneZone,
  type VideoRemixAssetReplacement,
} from '../../../shared/videoRemix.js';
import { listImageGenerationProviders } from '../../../shared/generationProviders.js';
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
  source: AssetSource;
  replacement?: VideoRemixAssetReplacement;
}

const SOURCE_LABEL: Record<AssetSource, string> = {
  analysis: '沿用反推',
  generated: 'AI 生成',
  upload: '本地上传',
  library: '素材库',
};

const KIND_LABEL: Record<AssetKind, string> = {
  characters: '人物',
  scenes: '场景',
  props: '道具',
};

const IMAGE_MODELS = listImageGenerationProviders().filter(
  model => model.id !== 'codex-imagegen'
);

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
      referenceImages: current.referenceImages || [],
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
      referenceImages: current.referenceImages || [],
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
      referenceImages: current.referenceImages || [],
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
    referenceImages: current.referenceImages || [],
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
  const common = {
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

function originalPreviewFor(
  state: VideoRemixState,
  target: AssetTarget
) {
  if (target.kind === 'characters' && target.lookId) {
    return state.assets.characters
      .find(item => item.id === target.assetId)
      ?.looks.find(item => item.id === target.lookId)
      ?.referenceImages?.[0];
  }
  return state.assets[target.kind]
    .find(item => item.id === target.assetId)
    ?.referenceImages?.[0];
}

export const VideoRemixAssetsWorkspace: React.FC<{
  node: NodeData;
  state: VideoRemixState;
  workflowId?: string;
  onUpdateNode: (nodeId: string, updates: Partial<NodeData>) => void;
  onSelectAnalysis: () => void;
  dark: boolean;
}> = ({
  node,
  state,
  workflowId,
  onUpdateNode,
  onSelectAnalysis,
  dark,
}) => {
  const [activeKind, setActiveKind] = React.useState<AssetKind>('characters');
  const [pickerTarget, setPickerTarget] = React.useState<AssetTarget | null>(null);
  const [editorTarget, setEditorTarget] = React.useState<AssetTarget | null>(null);
  const [uploadTarget, setUploadTarget] = React.useState<AssetTarget | null>(null);
  const [busy, setBusy] = React.useState('');
  const [error, setError] = React.useState('');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const persist = React.useCallback((next: VideoRemixState) => {
    onUpdateNode(node.id, { videoRemix: next });
  }, [node.id, onUpdateNode]);

  const applyReplacement = React.useCallback((
    target: AssetTarget,
    replacement: VideoRemixAssetReplacement | null
  ) => {
    const next = target.kind === 'characters' && target.lookId
      ? replaceVideoRemixCharacterLook(
        state,
        target.assetId,
        target.lookId,
        replacement
      )
      : replaceVideoRemixAsset(state, target.kind, target.assetId, replacement);
    persist(next);
  }, [persist, state]);

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
    applyReplacement(
      target,
      replacementFromSnapshot(target, snapshot, snapshot.source, values)
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
        ? resolveVideoRemixAsset(
          state.assets.characters.find(item => item.id === target.assetId)!
        ).referenceImages.slice(0, selectedModel?.maxReferenceImages || 1)
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
          ...values,
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
  const hasAssets = Boolean(state.story) && (
    state.assets.characters.length
    + state.assets.scenes.length
    + state.assets.props.length > 0
  );

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

      <section className={`rounded-[26px] border p-5 ${
        dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
      }`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">资产替换</div>
            <div className={`mt-1 text-[11px] ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
              稳定 ID 不变；当前资产会自动作用于所有引用 Shot。人物造型可逐 Shot 单独选择。
            </div>
          </div>
          <button
            type="button"
            disabled={!allShotsReady || Boolean(busy)}
            onClick={() => persist(confirmVideoRemixAssets(state))}
            className={`flex h-10 items-center gap-2 rounded-xl px-4 text-xs font-medium disabled:opacity-40 ${
              state.assetReview?.confirmed
                ? dark ? 'bg-emerald-400/12 text-emerald-300' : 'bg-emerald-50 text-emerald-700'
                : dark ? 'bg-cyan-400 text-neutral-950' : 'bg-cyan-600 text-white'
            }`}
          >
            <Check size={14} />
            {state.assetReview?.confirmed ? '资产已确认' : '确认资产并进入下一阶段'}
          </button>
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
          const originalPreview = originalPreviewFor(state, target);
          const currentPreview = snapshot.referenceImages[0] || originalPreview;
          const isRemoved = activeKind === 'props' && 'removed' in asset && asset.removed;
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
                    出现于 {(asset.appearsInShots || []).length} 个 Shot
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

              <div className="mt-5 grid gap-5 lg:grid-cols-[300px_1fr]">
                <div className="grid grid-cols-2 gap-3">
                  <AssetPreview label="原截图" url={originalPreview} dark={dark} />
                  <AssetPreview label="当前资产" url={currentPreview} dark={dark} />
                </div>
                <div>
                  <p className={`text-xs leading-6 ${dark ? 'text-neutral-300' : 'text-neutral-700'}`}>
                    {activeKind === 'characters'
                      ? snapshot.identity
                      : activeKind === 'scenes'
                        ? snapshot.visualDescription
                        : snapshot.description}
                  </p>
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
                        {snapshot.category}
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
                </div>
              </div>

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
      [onEdit, <Edit3 size={12} />, '编辑 / AI'],
      [onLibrary, <Library size={12} />, '素材库'],
      [onUpload, <Upload size={12} />, '上传'],
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
        沿用反推
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
          <div className="text-xs font-medium">Character Looks</div>
          <div className={`mt-1 text-[10px] ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
            Identity 与服装造型分离；下方选择只影响对应 Shot。
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
          return (
            <div key={look.id} className={`rounded-xl border p-3 ${
              dark ? 'border-white/8 bg-white/[0.025]' : 'border-neutral-200 bg-white'
            }`}>
              <div className="flex gap-3">
                <div className={`h-16 w-12 shrink-0 overflow-hidden rounded-lg ${
                  dark ? 'bg-black/40' : 'bg-neutral-100'
                }`}>
                  {look.referenceImages?.[0] && (
                    <img
                      src={look.referenceImages[0]}
                      alt={look.name}
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium">{look.name}</span>
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
                  {shot.shotId} · 单镜头造型
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
  const [modelId, setModelId] = React.useState(IMAGE_MODELS[0]?.id || 'gemini-web-image');
  const [prompt, setPrompt] = React.useState(() => {
    const detail = target.lookId
      ? snapshot.description
      : target.kind === 'characters'
        ? snapshot.identity
        : target.kind === 'scenes'
          ? snapshot.visualDescription
          : snapshot.description;
    return [
      `为短视频 Video Remix 创建${target.lookId ? '人物造型' : KIND_LABEL[target.kind]}参考图。`,
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
              文本会进入后续 Prompt；AI 生成会消耗所选平台额度。
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
                label="Character Identity（不要绑定服装）"
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
                  Scene Zones
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
                <option value="hero">hero · 核心商品</option>
                <option value="interactive">interactive · 交互道具</option>
                <option value="background">background · 背景元素</option>
              </select>
            </label>
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
                label="生成 Prompt"
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
