import React, { useEffect, useRef, useState } from 'react';
import {
    ArrowLeft,
    ChevronRight,
    ClipboardPaste,
    Folder,
    FolderOpen,
    FolderUp,
    ImageOff,
    Trash2,
    Upload,
    X,
} from 'lucide-react';
import {
    MASSAGE_EQUIPMENT_CATEGORY,
    MASSAGE_EQUIPMENT_SECTIONS,
} from '../../shared/massageEquipmentCategories.js';
import { LazyVideo } from './LazyVideo';

export interface LibraryAsset {
    id: string;
    name: string;
    category: string;
    subcategory?: string;
    url: string;
    type: 'image' | 'video';
    description?: string;
    characterId?: string;
    characterName?: string;
    characterAssetRole?: 'identity-face' | 'identity-angles' | 'identity-board' | 'identity-fullbody' | 'identity-expression' | 'look-fullbody' | 'look-board';
    lookId?: string;
    lookName?: string;
}

interface AssetLibraryPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectAsset: (asset: LibraryAsset) => void;
    panelY?: number;
    panelLeft?: number;
    variant?: 'panel' | 'modal';
    canvasTheme?: 'dark' | 'light';
    previewAsset?: { name: string; url: string; type: 'image' | 'video' } | null;
    allowedCategories?: string[];
    allowedTypes?: Array<'image' | 'video'>;
    initialCategory?: string;
    title?: string;
    selectOnly?: boolean;
}

const MASSAGE_CATEGORY = MASSAGE_EQUIPMENT_CATEGORY;
const TOP_CATEGORIES = [
    { value: 'All', label: '全部' },
    { value: 'Character', label: '角色' },
    { value: 'Scene', label: '场景' },
    { value: 'Item', label: '道具' },
    { value: MASSAGE_CATEGORY, label: '按摩器材' },
] as const;

const MASSAGE_SECTIONS = MASSAGE_EQUIPMENT_SECTIONS;

const VISIBLE_CATEGORIES = new Set<string>(TOP_CATEGORIES.filter(category => category.value !== 'All').map(category => category.value));
const MEDIA_FILE_RE = /\.(png|jpe?g|webp|gif|avif|bmp|mp4|mov|webm|m4v)$/i;
const ACCEPTED_MEDIA = 'image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp,video/mp4,video/quicktime,video/webm,video/x-m4v';

const isSupportedMediaFile = (file: File) =>
    file.type.startsWith('image/') || file.type.startsWith('video/') || MEDIA_FILE_RE.test(file.name);

const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
    reader.readAsDataURL(file);
});

const collectEntryFiles = async (entry: any): Promise<File[]> => {
    if (!entry) return [];
    if (entry.isFile) {
        return new Promise(resolve => entry.file((file: File) => resolve([file]), () => resolve([])));
    }
    if (!entry.isDirectory) return [];

    const reader = entry.createReader();
    const entries: any[] = [];
    while (true) {
        const batch = await new Promise<any[]>(resolve => reader.readEntries(resolve, () => resolve([])));
        if (batch.length === 0) break;
        entries.push(...batch);
    }
    const nested = await Promise.all(entries.map(collectEntryFiles));
    return nested.flat();
};

const categoryLabel = (value: string) => TOP_CATEGORIES.find(category => category.value === value)?.label || value;

export const AssetLibraryPanel: React.FC<AssetLibraryPanelProps> = ({
    isOpen,
    onClose,
    onSelectAsset,
    panelY = 100,
    panelLeft = 80,
    variant = 'panel',
    canvasTheme = 'dark',
    previewAsset = null,
    allowedCategories,
    allowedTypes,
    initialCategory,
    title = '素材库',
    selectOnly = false
}) => {
    const [selectedCategory, setSelectedCategory] = useState(
        initialCategory || allowedCategories?.[0] || 'All'
    );
    const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null);
    const [assets, setAssets] = useState<LibraryAsset[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen && !previewAsset) void fetchLibrary();
    }, [isOpen, previewAsset]);

    useEffect(() => {
        if (
            isOpen
            && allowedCategories?.length
            && !allowedCategories.includes(selectedCategory)
        ) {
            setSelectedCategory(initialCategory || allowedCategories[0]);
            setSelectedSubcategory(null);
        }
    }, [allowedCategories, initialCategory, isOpen, selectedCategory]);

    const fetchLibrary = async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/library');
            if (response.ok) setAssets(await response.json());
        } catch (error) {
            console.error('Failed to load library:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteAsset = async (id: string, event: React.MouseEvent) => {
        event.stopPropagation();
        try {
            const response = await fetch(`/api/library/${id}`, { method: 'DELETE' });
            if (response.ok) setAssets(current => current.filter(asset => asset.id !== id));
        } catch (error) {
            console.error('Delete asset error:', error);
        }
    };

    const selectCategory = (category: string) => {
        setSelectedCategory(category);
        setSelectedSubcategory(null);
    };

    if (!isOpen) return null;
    const isDark = canvasTheme === 'dark';

    if (previewAsset && variant === 'panel') {
        const top = Math.min(Math.max(72, window.innerHeight - 520), Math.max(72, panelY));
        return (
            <div
                className={`fixed z-40 flex flex-col overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-xl animate-in slide-in-from-left-4 duration-200 ${isDark ? 'border-neutral-800 bg-[#0a0a0a]/95' : 'border-neutral-200 bg-white/95'}`}
                style={{
                    left: panelLeft,
                    width: Math.max(320, Math.min(700, window.innerWidth - panelLeft - 24)),
                    height: Math.max(260, Math.min(500, window.innerHeight - top - 24)),
                    top,
                }}
            >
                <div className={`flex h-14 shrink-0 items-center justify-between border-b px-4 ${isDark ? 'border-neutral-800' : 'border-neutral-200'}`}>
                    <span className={`min-w-0 truncate text-sm font-medium ${isDark ? 'text-neutral-200' : 'text-neutral-800'}`}>
                        {previewAsset.name || '素材预览'}
                    </span>
                    <button onClick={onClose} className={`rounded-lg p-2 transition-colors ${isDark ? 'text-neutral-400 hover:bg-neutral-800 hover:text-white' : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900'}`} title="关闭预览">
                        <X size={18} />
                    </button>
                </div>
                <div className={`min-h-0 flex-1 p-5 ${isDark ? 'bg-black/30' : 'bg-neutral-100'}`}>
                    <div className={`flex h-full w-full items-center justify-center overflow-hidden rounded-xl ${isDark ? 'bg-[#111]' : 'bg-white'}`}>
                        {previewAsset.type === 'video' ? (
                            <video src={previewAsset.url} controls className="max-h-full max-w-full object-contain" />
                        ) : (
                            <img src={previewAsset.url} alt={previewAsset.name} className="max-h-full max-w-full object-contain" />
                        )}
                    </div>
                </div>
            </div>
        );
    }

    const content = (
        <AssetLibraryContent
            selectedCategory={selectedCategory}
            selectedSubcategory={selectedSubcategory}
            onSelectCategory={selectCategory}
            onSelectSubcategory={setSelectedSubcategory}
            assets={assets}
            loading={loading}
            onSelectAsset={onSelectAsset}
            onDeleteAsset={handleDeleteAsset}
            onAssetsUploaded={uploaded => setAssets(current => [...uploaded, ...current])}
            variant={variant}
            canvasTheme={canvasTheme}
            allowedCategories={allowedCategories}
            allowedTypes={allowedTypes}
            selectOnly={selectOnly}
        />
    );

    if (variant === 'modal') {
        return (
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm animate-in fade-in duration-200">
                <div
                    className={`flex h-[min(720px,calc(100vh-48px))] w-[min(960px,calc(100vw-48px))] flex-col overflow-hidden rounded-3xl border shadow-2xl ${isDark ? 'border-neutral-800 bg-[#0a0a0a]' : 'border-neutral-200 bg-white'}`}
                    onClick={event => event.stopPropagation()}
                >
                    <div className={`flex h-[72px] shrink-0 items-center justify-between border-b px-6 ${isDark ? 'border-neutral-800' : 'border-neutral-200'}`}>
                        <div>
                            <h2 className={`text-xl font-semibold ${isDark ? 'text-white' : 'text-neutral-900'}`}>{title}</h2>
                            <p className={`mt-1 text-xs ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                                {selectOnly
                                    ? '选中后会复制到当前项目，不依赖素材库原文件'
                                    : '集中管理角色、场景、道具和按摩器材素材'}
                            </p>
                        </div>
                        <button onClick={onClose} className={`rounded-xl p-2.5 transition-colors ${isDark ? 'text-neutral-400 hover:bg-neutral-800 hover:text-white' : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900'}`} aria-label="关闭素材库">
                            <X size={21} />
                        </button>
                    </div>
                    {content}
                </div>
                <div className="absolute inset-0 -z-10" onClick={onClose} />
            </div>
        );
    }

    return (
        <div
            className={`fixed z-40 flex max-h-[560px] flex-col overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-xl animate-in slide-in-from-left-4 duration-200 ${isDark ? 'border-neutral-800 bg-[#0a0a0a]/95' : 'border-neutral-200 bg-white/95'}`}
            style={{
                left: panelLeft,
                width: Math.max(360, Math.min(720, window.innerWidth - panelLeft - 24)),
                top: Math.min(Math.max(72, window.innerHeight - 580), Math.max(72, panelY))
            }}
        >
            {content}
        </div>
    );
};

interface AssetLibraryContentProps {
    selectedCategory: string;
    selectedSubcategory: string | null;
    onSelectCategory: (category: string) => void;
    onSelectSubcategory: (subcategory: string | null) => void;
    assets: LibraryAsset[];
    loading: boolean;
    onSelectAsset: (asset: LibraryAsset) => void;
    onDeleteAsset: (id: string, event: React.MouseEvent) => void;
    onAssetsUploaded: (assets: LibraryAsset[]) => void;
    variant: 'panel' | 'modal';
    canvasTheme?: 'dark' | 'light';
    allowedCategories?: string[];
    allowedTypes?: Array<'image' | 'video'>;
    selectOnly?: boolean;
}

const AssetLibraryContent: React.FC<AssetLibraryContentProps> = ({
    selectedCategory,
    selectedSubcategory,
    onSelectCategory,
    onSelectSubcategory,
    assets,
    loading,
    onSelectAsset,
    onDeleteAsset,
    onAssetsUploaded,
    variant,
    canvasTheme = 'dark',
    allowedCategories,
    allowedTypes,
    selectOnly = false
}) => {
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [characterFilter, setCharacterFilter] = useState('All');
    const [lookFilter, setLookFilter] = useState('All');
    const [isDragging, setIsDragging] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);
    const isDark = canvasTheme === 'dark';

    const allowedCategorySet = allowedCategories?.length
        ? new Set(allowedCategories)
        : VISIBLE_CATEGORIES;
    const allowedTypeSet = allowedTypes?.length ? new Set(allowedTypes) : null;
    const availableTopCategories = TOP_CATEGORIES.filter(category => (
        category.value === 'All'
            ? !allowedCategories?.length
            : allowedCategorySet.has(category.value)
    ));
    const visibleAssets = assets.filter(asset => (
        allowedCategorySet.has(asset.category)
        && (!allowedTypeSet || allowedTypeSet.has(asset.type))
    ));
    const characterNames = [...new Set(
        visibleAssets.filter(asset => asset.category === 'Character' && asset.characterName)
            .map(asset => asset.characterName as string)
    )].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const lookNames = [...new Set(
        visibleAssets.filter(asset =>
            asset.category === 'Character' &&
            asset.lookName &&
            (characterFilter === 'All' || asset.characterName === characterFilter)
        ).map(asset => asset.lookName as string)
    )].sort((a, b) => a.localeCompare(b, 'zh-CN'));

    const filteredAssets = visibleAssets.filter(asset =>
        (selectedCategory === 'All' || asset.category === selectedCategory) &&
        (selectedCategory !== MASSAGE_CATEGORY || !selectedSubcategory || asset.subcategory === selectedSubcategory) &&
        (selectedCategory !== 'Character' || characterFilter === 'All' || asset.characterName === characterFilter) &&
        (selectedCategory !== 'Character' || lookFilter === 'All' || (lookFilter === 'identity' ? !asset.lookName : asset.lookName === lookFilter))
    ).sort((a, b) => {
        if (selectedCategory !== 'Character') return 0;
        return `${a.characterName || ''}|${a.lookName || '身份库'}|${a.name}`
            .localeCompare(`${b.characterName || ''}|${b.lookName || '身份库'}|${b.name}`, 'zh-CN');
    });

    const canUpload = !selectOnly && selectedCategory !== 'All' &&
        (selectedCategory !== MASSAGE_CATEGORY || Boolean(selectedSubcategory));

    const uploadFiles = React.useCallback(async (incomingFiles: File[]) => {
        if (!canUpload) return;
        const files = incomingFiles.filter(isSupportedMediaFile);
        if (files.length === 0) {
            window.alert('请选择图片或视频文件。');
            return;
        }
        const oversized = files.find(file => file.size > 100 * 1024 * 1024);
        if (oversized) {
            window.alert(`${oversized.name} 超过 100MB，无法上传。`);
            return;
        }

        const uploaded: LibraryAsset[] = [];
        const failed: string[] = [];
        setUploadProgress({ current: 0, total: files.length });
        for (const [index, file] of files.entries()) {
            try {
                const data = await readAsDataUrl(file);
                const response = await fetch('/api/library/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        data,
                        name: file.name,
                        category: selectedCategory,
                        subcategory: selectedSubcategory || undefined
                    })
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok || !result.asset) throw new Error(result.error || '上传失败');
                uploaded.push(result.asset);
            } catch (error) {
                console.error('[Asset Library Upload] Failed:', error);
                failed.push(file.name);
            } finally {
                setUploadProgress({ current: index + 1, total: files.length });
            }
        }
        setUploadProgress(null);
        if (uploaded.length > 0) onAssetsUploaded(uploaded);
        if (failed.length > 0) window.alert(`以下素材上传失败：${failed.join('、')}`);
    }, [canUpload, onAssetsUploaded, selectedCategory, selectedSubcategory]);

    useEffect(() => {
        if (!canUpload) return;
        const handlePaste = (event: ClipboardEvent) => {
            const active = document.activeElement as HTMLElement | null;
            if (active?.matches('input, textarea, [contenteditable="true"]')) return;
            const files = Array.from(event.clipboardData?.items || [])
                .filter(item => item.kind === 'file')
                .map(item => item.getAsFile())
                .filter((file): file is File => file !== null && isSupportedMediaFile(file));
            if (files.length === 0) return;
            event.preventDefault();
            void uploadFiles(files);
        };
        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [canUpload, uploadFiles]);

    const handleDrop = async (event: React.DragEvent) => {
        event.preventDefault();
        event.stopPropagation();
        setIsDragging(false);
        if (!canUpload) return;

        const entries = Array.from(event.dataTransfer.items)
            .map(item => (item as any).webkitGetAsEntry?.())
            .filter(Boolean);
        const droppedFiles = entries.length > 0
            ? (await Promise.all(entries.map(collectEntryFiles))).flat()
            : Array.from(event.dataTransfer.files);
        await uploadFiles(droppedFiles);
    };

    const selectTopCategory = (category: string) => {
        onSelectCategory(category);
        setCharacterFilter('All');
        setLookFilter('All');
    };

    const showMassageFolders = selectedCategory === MASSAGE_CATEGORY && !selectedSubcategory;
    const gridColumns = variant === 'modal' ? 'grid-cols-4' : 'grid-cols-3';

    return (
        <div
            className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
            onDragEnter={event => {
                if (event.dataTransfer.types.includes('Files') && canUpload) setIsDragging(true);
            }}
            onDragOver={event => {
                if (!event.dataTransfer.types.includes('Files') || !canUpload) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
            }}
            onDragLeave={event => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDragging(false);
            }}
            onDrop={handleDrop}
        >
            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPTED_MEDIA}
                className="hidden"
                onChange={event => {
                    void uploadFiles(Array.from(event.target.files || []));
                    event.target.value = '';
                }}
            />
            <input
                ref={folderInputRef}
                type="file"
                multiple
                accept={ACCEPTED_MEDIA}
                className="hidden"
                {...({ webkitdirectory: '', directory: '' } as any)}
                onChange={event => {
                    void uploadFiles(Array.from(event.target.files || []));
                    event.target.value = '';
                }}
            />

            <div className={`shrink-0 border-b px-5 py-4 ${isDark ? 'border-neutral-800/80' : 'border-neutral-200'}`}>
                <div className="flex gap-2 overflow-x-auto scrollbar-hide">
                    {availableTopCategories.map(category => (
                        <button
                            key={category.value}
                            onClick={() => selectTopCategory(category.value)}
                            className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition-all ${selectedCategory === category.value
                                ? isDark ? 'border-white bg-white text-black' : 'border-neutral-900 bg-neutral-900 text-white'
                                : isDark ? 'border-neutral-800 bg-neutral-900/80 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200' : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300'
                                }`}
                        >
                            {category.label}
                        </button>
                    ))}
                </div>

                {selectedCategory !== 'All' && (
                    <div className="mt-4 flex min-h-10 items-center justify-between gap-4">
                        <div className="min-w-0">
                            {selectedCategory === MASSAGE_CATEGORY ? (
                                <div className="flex items-center gap-2 text-sm">
                                    {selectedSubcategory && (
                                        <button
                                            onClick={() => onSelectSubcategory(null)}
                                            className={`rounded-lg p-1.5 transition-colors ${isDark ? 'text-neutral-400 hover:bg-neutral-800 hover:text-white' : 'text-neutral-500 hover:bg-neutral-100'}`}
                                            aria-label="返回按摩器材分类"
                                        >
                                            <ArrowLeft size={16} />
                                        </button>
                                    )}
                                    <button onClick={() => onSelectSubcategory(null)} className={isDark ? 'text-neutral-400 hover:text-white' : 'text-neutral-500 hover:text-neutral-900'}>
                                        按摩器材
                                    </button>
                                    {selectedSubcategory && (
                                        <>
                                            <ChevronRight size={14} className="text-neutral-600" />
                                            <span className={isDark ? 'font-medium text-white' : 'font-medium text-neutral-900'}>{selectedSubcategory}</span>
                                        </>
                                    )}
                                </div>
                            ) : (
                                <span className={`text-sm font-medium ${isDark ? 'text-neutral-200' : 'text-neutral-800'}`}>{categoryLabel(selectedCategory)}</span>
                            )}
                            <p className={`mt-1 text-xs ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                                {showMassageFolders
                                    ? '按产品类型进入对应素材文件夹'
                                    : selectOnly
                                        ? '选择一个素材作为当前资产'
                                        : '支持点击上传、粘贴，以及拖入文件或整个文件夹'}
                            </p>
                        </div>

                        {canUpload && (
                            <div className="flex shrink-0 items-center gap-2">
                                <span className={`hidden items-center gap-1 text-[11px] lg:flex ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                                    <ClipboardPaste size={13} /> ⌘V 粘贴
                                </span>
                                <button
                                    onClick={() => folderInputRef.current?.click()}
                                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${isDark ? 'border-neutral-700 text-neutral-300 hover:bg-neutral-800 hover:text-white' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'}`}
                                >
                                    <FolderUp size={14} /> 文件夹
                                </button>
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-500"
                                >
                                    <Upload size={14} /> 上传素材
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {selectedCategory === 'Character' && (
                <div className={`grid shrink-0 grid-cols-2 gap-2 border-b px-5 py-3 ${isDark ? 'border-neutral-800/80' : 'border-neutral-200'}`}>
                    <select
                        value={characterFilter}
                        onChange={event => {
                            setCharacterFilter(event.target.value);
                            setLookFilter('All');
                        }}
                        className={`rounded-lg border px-3 py-2 text-xs outline-none ${isDark ? 'border-neutral-700 bg-[#171717] text-neutral-200' : 'border-neutral-200 bg-white text-neutral-700'}`}
                    >
                        <option value="All">全部角色</option>
                        {characterNames.map(name => <option key={name} value={name}>{name}</option>)}
                    </select>
                    <select
                        value={lookFilter}
                        onChange={event => setLookFilter(event.target.value)}
                        className={`rounded-lg border px-3 py-2 text-xs outline-none ${isDark ? 'border-neutral-700 bg-[#171717] text-neutral-200' : 'border-neutral-200 bg-white text-neutral-700'}`}
                    >
                        <option value="All">全部造型</option>
                        <option value="identity">身份库</option>
                        {lookNames.map(name => <option key={name} value={name}>{name}</option>)}
                    </select>
                </div>
            )}

            <div
                className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
                style={{ scrollbarWidth: 'thin', scrollbarColor: isDark ? '#525252 #171717' : '#d4d4d4 #fafafa' }}
            >
                {loading ? (
                    <div className="py-16 text-center text-sm text-neutral-500">正在加载素材...</div>
                ) : showMassageFolders ? (
                    <div className="space-y-6">
                        {MASSAGE_SECTIONS.map(section => (
                            <section key={section.title}>
                                <div className="mb-2.5 flex items-center gap-2">
                                    <span className={`text-xs font-medium ${isDark ? 'text-neutral-400' : 'text-neutral-500'}`}>{section.title}</span>
                                    <span className={`h-px flex-1 ${isDark ? 'bg-neutral-800' : 'bg-neutral-200'}`} />
                                </div>
                                <div className={`grid gap-2.5 ${gridColumns}`}>
                                    {section.items.map(name => {
                                        const count = visibleAssets.filter(asset => asset.category === MASSAGE_CATEGORY && asset.subcategory === name).length;
                                        return (
                                            <button
                                                key={name}
                                                onClick={() => onSelectSubcategory(name)}
                                                className={`group flex min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition-all ${isDark ? 'border-neutral-800 bg-[#141414] hover:-translate-y-0.5 hover:border-neutral-600 hover:bg-[#191919]' : 'border-neutral-200 bg-neutral-50 hover:-translate-y-0.5 hover:border-neutral-300 hover:bg-white hover:shadow-sm'}`}
                                            >
                                                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isDark ? 'bg-blue-500/10 text-blue-400 group-hover:bg-blue-500/15' : 'bg-blue-50 text-blue-600'}`}>
                                                    <Folder size={20} />
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className={`block truncate text-sm font-medium ${isDark ? 'text-neutral-200' : 'text-neutral-800'}`}>{name}</span>
                                                    <span className={`mt-0.5 block text-[11px] ${isDark ? 'text-neutral-600' : 'text-neutral-400'}`}>{count} 个素材</span>
                                                </span>
                                                <ChevronRight size={15} className="shrink-0 text-neutral-600 transition-transform group-hover:translate-x-0.5" />
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>
                        ))}
                    </div>
                ) : filteredAssets.length === 0 ? (
                    <div className="flex min-h-[260px] flex-col items-center justify-center text-center">
                        <span className={`flex h-14 w-14 items-center justify-center rounded-2xl ${isDark ? 'bg-neutral-900 text-neutral-500' : 'bg-neutral-100 text-neutral-400'}`}>
                            {canUpload ? <Upload size={23} /> : <FolderOpen size={23} />}
                        </span>
                        <p className={`mt-4 text-sm font-medium ${isDark ? 'text-neutral-300' : 'text-neutral-700'}`}>
                            {canUpload
                                ? '这里还没有素材'
                                : selectOnly
                                    ? '当前分类没有可选素材'
                                    : '素材库暂时为空'}
                        </p>
                        <p className={`mt-1.5 max-w-sm text-xs leading-5 ${isDark ? 'text-neutral-600' : 'text-neutral-400'}`}>
                            {canUpload
                                ? '点击上传，或直接粘贴、拖入图片与视频；拖入文件夹时会批量导入其中的素材。'
                                : selectOnly
                                    ? '关闭后可在资产页直接上传，或先到主素材库添加素材。'
                                    : '选择一个具体分类后即可上传素材。'}
                        </p>
                        {canUpload && (
                            <button onClick={() => fileInputRef.current?.click()} className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500">
                                选择素材
                            </button>
                        )}
                    </div>
                ) : (
                    <div className={`grid content-start gap-3 ${variant === 'modal' ? 'grid-cols-5' : 'grid-cols-4'}`}>
                        {filteredAssets.map(asset => (
                            <div
                                key={asset.id}
                                className={`group relative aspect-square cursor-pointer overflow-hidden rounded-xl border ${isDark ? 'border-neutral-800 bg-neutral-900 hover:border-neutral-600' : 'border-neutral-200 bg-neutral-100 hover:border-neutral-300'}`}
                                onClick={() => onSelectAsset(asset)}
                            >
                                <ImageOff size={22} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-neutral-700" />
                                {asset.type === 'video' ? (
                                    <LazyVideo
                                        src={asset.url}
                                        muted
                                        playsInline
                                        controls={false}
                                        loop={false}
                                        containerClassName="relative h-full w-full"
                                        className="h-full w-full object-cover"
                                        // 占位保持透明：背后的 ImageOff 图标本来就是这一格的兜底显示。
                                        placeholderClassName="h-full w-full"
                                    />
                                ) : (
                                    <img src={asset.url} alt={asset.name} className="relative h-full w-full object-cover" />
                                )}
                                <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/85 via-black/10 to-transparent p-2.5 opacity-0 transition-opacity group-hover:opacity-100">
                                    <span className="truncate text-xs font-medium text-white">{asset.name}</span>
                                    {asset.description && <span className="mt-0.5 truncate text-[10px] text-neutral-300">{asset.description}</span>}
                                </div>

                                {asset.category === 'Character' && asset.characterName && (
                                    <div className="pointer-events-none absolute left-1.5 top-1.5 flex max-w-[calc(100%-12px)] flex-col items-start gap-1">
                                        <span className="max-w-full truncate rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">{asset.characterName}</span>
                                        <span className={`max-w-full truncate rounded-md px-1.5 py-0.5 text-[9px] font-medium text-white backdrop-blur-sm ${asset.lookName ? 'bg-fuchsia-500/80' : 'bg-blue-500/80'}`}>{asset.lookName || '身份库'}</span>
                                    </div>
                                )}

                                {!selectOnly && deleteConfirmId === asset.id ? (
                                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/85" onClick={event => event.stopPropagation()}>
                                        <span className="text-xs font-medium text-white">确认删除？</span>
                                        <div className="flex gap-2">
                                            <button className="rounded bg-red-500 px-2 py-1 text-xs text-white hover:bg-red-600" onClick={event => {
                                                onDeleteAsset(asset.id, event);
                                                setDeleteConfirmId(null);
                                            }}>删除</button>
                                            <button className="rounded bg-neutral-700 px-2 py-1 text-xs text-white hover:bg-neutral-600" onClick={event => {
                                                event.stopPropagation();
                                                setDeleteConfirmId(null);
                                            }}>取消</button>
                                        </div>
                                    </div>
                                ) : !selectOnly ? (
                                    <button
                                        className="absolute right-1.5 top-1.5 z-10 rounded-md bg-black/65 p-1.5 text-white opacity-0 transition-opacity hover:bg-red-500/90 group-hover:opacity-100"
                                        onClick={event => {
                                            event.stopPropagation();
                                            setDeleteConfirmId(asset.id);
                                        }}
                                        title="删除素材"
                                    >
                                        <Trash2 size={13} />
                                    </button>
                                ) : null}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {(isDragging || uploadProgress) && (
                <div className={`absolute inset-2 z-30 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed backdrop-blur-md ${isDark ? 'border-blue-500/70 bg-[#0a0a0a]/90' : 'border-blue-500 bg-white/90'}`}>
                    <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-950/20">
                        {uploadProgress ? <Upload size={24} /> : <FolderUp size={24} />}
                    </span>
                    <p className={`mt-4 text-sm font-medium ${isDark ? 'text-white' : 'text-neutral-900'}`}>
                        {uploadProgress ? `正在上传 ${uploadProgress.current}/${uploadProgress.total}` : `拖到这里上传到“${selectedSubcategory || categoryLabel(selectedCategory)}”`}
                    </p>
                    {!uploadProgress && <p className="mt-1.5 text-xs text-neutral-500">支持文件和整个文件夹</p>}
                </div>
            )}
        </div>
    );
};
