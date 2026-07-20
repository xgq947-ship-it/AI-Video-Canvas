import React, { useState, useEffect } from 'react';
import { X, Search, Filter, Trash2 } from 'lucide-react';

export interface LibraryAsset {
    id: string;
    name: string;
    category: string;
    url: string;
    type: 'image' | 'video';
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
}

// 分类的内部值保持英文（作为 library/assets/<分类>/ 的文件夹名与存储值），
// 仅显示中文标签，避免中文文件夹名带来的兼容问题，也让新旧数据一致。
const CATEGORIES: { value: string; label: string }[] = [
    { value: 'All', label: '全部' },
    { value: 'Character', label: '角色' },
    { value: 'Scene', label: '场景' },
    { value: 'Item', label: '道具' },
    { value: 'Style', label: '风格' },
    { value: 'Sound Effect', label: '音效' },
    { value: 'Others', label: '其他' },
];

export const AssetLibraryPanel: React.FC<AssetLibraryPanelProps> = ({
    isOpen,
    onClose,
    onSelectAsset,
    panelY = 100,
    panelLeft = 80,
    variant = 'panel',
    canvasTheme = 'dark',
    previewAsset = null
}) => {
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [assets, setAssets] = useState<LibraryAsset[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen && !previewAsset) {
            fetchLibrary();
        }
    }, [isOpen, previewAsset]);

    const fetchLibrary = async () => {
        setLoading(true);
        try {
            const res = await fetch('http://localhost:3001/api/library'); // Adjust port if needed, relative path preferred in helper
            if (res.ok) {
                setAssets(await res.json());
            }
        } catch (error) {
            console.error("Failed to load library:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteAsset = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent selection
        // Confirmation is now handled in the UI before this is called

        try {
            const res = await fetch(`http://localhost:3001/api/library/${id}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                setAssets(prev => prev.filter(a => a.id !== id));
            } else {
                console.error("Failed to delete asset");
            }
        } catch (error) {
            console.error("Delete error:", error);
        }
    };

    if (!isOpen) return null;

    // Theme helper
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

    if (variant === 'modal') {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                <div
                    className={`flex flex-col w-[800px] h-[600px] border rounded-2xl shadow-2xl overflow-hidden transition-colors duration-300 ${isDark ? 'bg-[#0a0a0a] border-neutral-800' : 'bg-white border-neutral-200'}`}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className={`flex items-center justify-between p-4 border-b ${isDark ? 'border-neutral-800' : 'border-neutral-200'}`}>
                        <h2 className={`text-lg font-medium pl-2 ${isDark ? 'text-white' : 'text-neutral-900'}`}>素材库</h2>
                        <button onClick={onClose} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-neutral-800 text-neutral-400 hover:text-white' : 'hover:bg-neutral-100 text-neutral-500 hover:text-neutral-900'}`}>
                            <X size={20} />
                        </button>
                    </div>
                    {/* Reuse internal content logic */}
                    <AssetLibraryContent
                        selectedCategory={selectedCategory}
                        setSelectedCategory={setSelectedCategory}
                        assets={assets}
                        loading={loading}
                        onSelectAsset={onSelectAsset}
                        onDeleteAsset={handleDeleteAsset}
                        variant={variant}
                        canvasTheme={canvasTheme}
                    />
                </div>
                {/* Click outside to close */}
                <div className="absolute inset-0 -z-10" onClick={onClose} />
            </div>
        );
    }

    return (
        <div
            className={`fixed z-40 backdrop-blur-xl border rounded-2xl shadow-2xl flex flex-col max-h-[500px] overflow-hidden animate-in slide-in-from-left-4 duration-200 transition-colors ${isDark ? 'bg-[#0a0a0a]/95 border-neutral-800' : 'bg-white/95 border-neutral-200'}`}
            style={{
                left: panelLeft,
                width: Math.max(320, Math.min(700, window.innerWidth - panelLeft - 24)),
                top: Math.min(Math.max(72, window.innerHeight - 520), Math.max(72, panelY))
            }}
        >
            <AssetLibraryContent
                selectedCategory={selectedCategory}
                setSelectedCategory={setSelectedCategory}
                assets={assets}
                loading={loading}
                onSelectAsset={onSelectAsset}
                onDeleteAsset={handleDeleteAsset}
                variant={variant}
                canvasTheme={canvasTheme}
            />
        </div>
    );
};

// Extracted Internal Component for reuse
const AssetLibraryContent = ({
    selectedCategory, setSelectedCategory,
    assets, loading, onSelectAsset, onDeleteAsset, variant, canvasTheme = 'dark'
}: any) => {
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [characterFilter, setCharacterFilter] = useState('All');
    const [lookFilter, setLookFilter] = useState('All');
    const isDark = canvasTheme === 'dark';

    // 显式标注 Set<string>：assets 为 any，否则 Set 会被推断成 Set<unknown>，导致 localeCompare 报错
    const characterNames = [...new Set<string>(
        assets.filter((asset: LibraryAsset) => asset.category === 'Character' && asset.characterName)
            .map((asset: LibraryAsset) => asset.characterName as string)
    )].sort((a, b) => a.localeCompare(b, 'zh-CN'));

    const lookNames = [...new Set<string>(
        assets.filter((asset: LibraryAsset) =>
            asset.category === 'Character' &&
            asset.lookName &&
            (characterFilter === 'All' || asset.characterName === characterFilter)
        ).map((asset: LibraryAsset) => asset.lookName as string)
    )].sort((a, b) => a.localeCompare(b, 'zh-CN'));

    const filteredAssets = assets.filter((asset: LibraryAsset) =>
        (selectedCategory === 'All' || asset.category === selectedCategory) &&
        (selectedCategory !== 'Character' || characterFilter === 'All' || asset.characterName === characterFilter) &&
        (selectedCategory !== 'Character' || lookFilter === 'All' || (lookFilter === 'identity' ? !asset.lookName : asset.lookName === lookFilter))
    ).sort((a: LibraryAsset, b: LibraryAsset) => {
        if (selectedCategory !== 'Character') return 0;
        return `${a.characterName || ''}|${a.lookName || '身份库'}|${a.name}`
            .localeCompare(`${b.characterName || ''}|${b.lookName || '身份库'}|${b.name}`, 'zh-CN');
    });

    const handleDeleteClick = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setDeleteConfirmId(id);
    };

    const handleConfirmDelete = (e: React.MouseEvent, id: string) => {
        onDeleteAsset(id, e);
        setDeleteConfirmId(null);
    };

    const handleCancelDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        setDeleteConfirmId(null);
    };

    return (
        <>

            <div className="p-4 flex flex-col gap-4 h-full overflow-hidden">
                {/* Filters */}
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide shrink-0">
                    {CATEGORIES.map(cat => (
                        <button
                            key={cat.value}
                            onClick={() => setSelectedCategory(cat.value)}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border ${selectedCategory === cat.value
                                ? isDark ? 'bg-neutral-100 text-black border-white' : 'bg-neutral-900 text-white border-neutral-900'
                                : isDark ? 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:border-neutral-600' : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
                                }`}
                        >
                            {cat.label}
                        </button>
                    ))}
                </div>

                {selectedCategory === 'Character' && (
                    <div className="grid grid-cols-2 gap-2">
                        <select
                            value={characterFilter}
                            onChange={(event) => {
                                setCharacterFilter(event.target.value);
                                setLookFilter('All');
                            }}
                            className={`rounded-lg border px-2.5 py-2 text-xs outline-none ${isDark ? 'border-neutral-700 bg-[#1a1a1a] text-neutral-200' : 'border-neutral-200 bg-white text-neutral-700'}`}
                        >
                            <option value="All">全部角色</option>
                            {characterNames.map(name => <option key={name} value={name}>{name}</option>)}
                        </select>
                        <select
                            value={lookFilter}
                            onChange={(event) => setLookFilter(event.target.value)}
                            className={`rounded-lg border px-2.5 py-2 text-xs outline-none ${isDark ? 'border-neutral-700 bg-[#1a1a1a] text-neutral-200' : 'border-neutral-200 bg-white text-neutral-700'}`}
                        >
                            <option value="All">全部造型</option>
                            <option value="identity">身份库</option>
                            {lookNames.map(name => <option key={name} value={name}>{name}</option>)}
                        </select>
                    </div>
                )}

                {/* Content */}
                <div
                    className="flex-1 overflow-y-auto pr-2 grid gap-3 pb-4 content-start grid-cols-4"
                    style={{
                        scrollbarWidth: 'thin',
                        scrollbarColor: isDark ? '#525252 #171717' : '#d4d4d4 #fafafa'
                    }}
                >
                    {loading ? (
                        <div className="col-span-full text-center py-10 text-neutral-500">加载中...</div>
                    ) : filteredAssets.length === 0 ? (
                        <div className="col-span-full text-center py-10 text-neutral-500 text-sm">
                            该分类下暂无素材
                        </div>
                    ) : (
                        filteredAssets.map((asset: LibraryAsset) => (
                            <div
                                key={asset.id}
                                className="group relative aspect-square bg-neutral-900 rounded-lg overflow-hidden border border-neutral-800 hover:border-neutral-600 cursor-pointer"
                                onClick={() => onSelectAsset(asset)}
                            >
                                <img
                                    src={asset.url}
                                    alt={asset.name}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                        const target = e.target as HTMLImageElement;
                                        target.onerror = null; // Prevent infinite loop
                                        target.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMzMzMiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cmVjdCB4PSIzIiB5PSIzIiB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHJ4PSIyIiByeT0iMiI+PC9yZWN0PjxjaXJjbGUgY3g9IjguNSIgY3k9IjguNSIgcj0iMS41Ij48L2NpcmNsZT48cG9seWxpbmUgcG9pbnRzPSIyMSAxNSAxNiAxMCA1IDIxIj48LcG9lyxpbmU+PC9zdmc+';
                                        target.classList.add('p-8', 'opacity-50');
                                    }}
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2 pointer-events-none">
                                    <span className="text-white text-xs font-medium truncate">{asset.name}</span>
                                </div>

                                {asset.category === 'Character' && asset.characterName && (
                                    <div className="pointer-events-none absolute left-1.5 top-1.5 flex max-w-[calc(100%-12px)] flex-col items-start gap-1">
                                        <span className="max-w-full truncate rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                                            {asset.characterName}
                                        </span>
                                        <span className={`max-w-full truncate rounded-md px-1.5 py-0.5 text-[9px] font-medium backdrop-blur-sm ${asset.lookName ? 'bg-fuchsia-500/80 text-white' : 'bg-blue-500/80 text-white'}`}>
                                            {asset.lookName || '身份库'}
                                        </span>
                                    </div>
                                )}

                                {/* Delete Button or Confirmation */}
                                {deleteConfirmId === asset.id ? (
                                    <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-2 z-20 animate-in fade-in duration-200" onClick={(e) => e.stopPropagation()}>
                                        <span className="text-white text-xs font-medium">确认删除？</span>
                                        <div className="flex gap-2">
                                            <button
                                                className="px-2 py-1 bg-red-500 hover:bg-red-600 text-white text-xs rounded transition-colors"
                                                onClick={(e) => handleConfirmDelete(e, asset.id)}
                                            >
                                                删除
                                            </button>
                                            <button
                                                className="px-2 py-1 bg-neutral-700 hover:bg-neutral-600 text-white text-xs rounded transition-colors"
                                                onClick={handleCancelDelete}
                                            >
                                                取消
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <button
                                        className="absolute top-1 right-1 p-1.5 bg-black/60 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80 z-10"
                                        onClick={(e) => handleDeleteClick(e, asset.id)}
                                        title="删除素材"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </>
    );
};
