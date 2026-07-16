import React, { useState, useEffect } from 'react';
import { X, ChevronDown, Check } from 'lucide-react';
import { NodeData } from '../../types';

interface CreateAssetModalProps {
    isOpen: boolean;
    onClose: () => void;
    nodeToSnapshot: NodeData | null;
    onSave: (name: string, category: string, meta?: Record<string, string | undefined>) => Promise<void>;
}

type CharacterAssetRole = 'identity-face' | 'identity-fullbody' | 'identity-expression' | 'identity-board' | 'look-fullbody' | 'look-board';

const CHARACTER_ROLES: { value: CharacterAssetRole; label: string }[] = [
    { value: 'identity-face', label: '身份库 · 面部特写' },
    { value: 'identity-fullbody', label: '身份库 · 基础全身' },
    { value: 'identity-expression', label: '身份库 · 表情九宫格' },
    { value: 'identity-board', label: '身份库 · 人物呈现板' },
    { value: 'look-fullbody', label: '造型包 · 全身定妆' },
    { value: 'look-board', label: '造型包 · 人物呈现板' },
];

// 分类内部值保持英文（与 AssetLibraryPanel、library/assets/<分类>/ 文件夹一致），仅显示中文标签
const CATEGORIES: { value: string; label: string }[] = [
    { value: 'Character', label: '角色' },
    { value: 'Scene', label: '场景' },
    { value: 'Item', label: '道具' },
    { value: 'Style', label: '风格' },
    { value: 'Sound Effect', label: '音效' },
    { value: 'Others', label: '其他' },
];

export const CreateAssetModal: React.FC<CreateAssetModalProps> = ({
    isOpen,
    onClose,
    nodeToSnapshot,
    onSave
}) => {
    const [name, setName] = useState('我的素材');
    const [category, setCategory] = useState(CATEGORIES[0].value);
    const [characterName, setCharacterName] = useState('');
    const [characterAssetRole, setCharacterAssetRole] = useState<CharacterAssetRole>('identity-face');
    const [lookName, setLookName] = useState('');
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

    // Reset state when opening
    useEffect(() => {
        if (isOpen) {
            setStatus('idle');
            setName('我的素材');
            setCategory(CATEGORIES[0].value);
            setCharacterName('');
            setCharacterAssetRole('identity-face');
            setLookName('');
        }
    }, [isOpen]);

    if (!isOpen || !nodeToSnapshot) return null;

    const handleSubmit = async () => {
        if (!name.trim()) return;
        const isCharacter = category === 'Character';
        const isLookAsset = characterAssetRole.startsWith('look-');
        if (isCharacter && !characterName.trim()) return;
        if (isCharacter && isLookAsset && !lookName.trim()) return;

        setStatus('saving');
        try {
            await onSave(name, category, isCharacter ? {
                characterName: characterName.trim(),
                characterAssetRole,
                lookName: isLookAsset ? lookName.trim() : undefined
            } : undefined);
            setStatus('success');
            setTimeout(() => {
                onClose();
            }, 1000);
        } catch (e) {
            setStatus('error');
            setTimeout(() => setStatus('idle'), 2000);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="flex max-h-[90vh] w-[680px] flex-col overflow-hidden rounded-2xl border border-neutral-800 bg-[#121212] shadow-2xl">

                {/* Header */}
                <div className="px-6 pt-6 pb-2">
                    <div className="flex items-center gap-6 border-b border-neutral-700 pb-2">
                        <button className="text-white font-medium border-b-2 border-white pb-2 -mb-2.5">新建素材</button>
                        <button className="text-neutral-500 font-medium pb-2 hover:text-neutral-300 transition-colors">加入已有</button>
                    </div>
                </div>

                <div className="flex gap-6 overflow-y-auto p-6">
                    {/* Left: Cover Image */}
                    <div className="w-1/2 flex flex-col gap-2">
                        <label className="text-sm font-medium text-neutral-200">封面 <span className="text-red-400">*</span></label>
                        <div className="aspect-[3/4] rounded-lg overflow-hidden border border-neutral-800 bg-neutral-900 relative group">
                            <img
                                src={nodeToSnapshot.resultUrl || ''}
                                alt="Cover"
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                    (e.target as HTMLImageElement).src = 'https://placehold.co/400x600/1a1a1a/FFF?text=Error';
                                }}
                            />
                        </div>
                    </div>

                    {/* Right: Form */}
                    <div className="flex w-1/2 flex-col gap-4">

                        {/* Name Input */}
                        <div className="flex flex-col gap-2">
                            <label className="text-sm font-medium text-neutral-200">名称 <span className="text-red-400">*</span></label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full bg-[#1a1a1a] border border-neutral-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                                placeholder="素材名称"
                            />
                        </div>

                        {/* Category Dropdown */}
                        <div className="flex flex-col gap-2 relative">
                            <label className="text-sm font-medium text-neutral-200">分类 <span className="text-red-400">*</span></label>
                            <button
                                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                                className="w-full bg-[#1a1a1a] border border-neutral-700 rounded-lg px-3 py-2 text-white focus:outline-none flex items-center justify-between hover:bg-[#252525] transition-colors"
                            >
                                <span>{CATEGORIES.find(c => c.value === category)?.label ?? category}</span>
                                <ChevronDown size={16} className="text-neutral-400" />
                            </button>

                            {isDropdownOpen && (
                                <div className="absolute top-[70px] left-0 right-0 bg-[#1a1a1a] border border-neutral-700 rounded-lg shadow-xl z-10 py-1">
                                    {CATEGORIES.map(cat => (
                                        <button
                                            key={cat.value}
                                            onClick={() => {
                                                setCategory(cat.value);
                                                setIsDropdownOpen(false);
                                            }}
                                            className="w-full px-3 py-2 text-left hover:bg-[#252525] flex items-center justify-between group"
                                        >
                                            <span className="text-neutral-300 group-hover:text-white">{cat.label}</span>
                                            {category === cat.value && <Check size={14} className="text-white" />}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {category === 'Character' && (
                            <>
                                <div className="flex flex-col gap-2">
                                    <label className="text-sm font-medium text-neutral-200">角色名称 <span className="text-red-400">*</span></label>
                                    <input
                                        type="text"
                                        value={characterName}
                                        onChange={(e) => setCharacterName(e.target.value)}
                                        className="w-full rounded-lg border border-neutral-700 bg-[#1a1a1a] px-3 py-2 text-white outline-none transition-colors focus:border-blue-500"
                                        placeholder="例如：林默"
                                    />
                                </div>

                                <div className="flex flex-col gap-2">
                                    <label className="text-sm font-medium text-neutral-200">素材用途</label>
                                    <select
                                        value={characterAssetRole}
                                        onChange={(e) => setCharacterAssetRole(e.target.value as CharacterAssetRole)}
                                        className="w-full rounded-lg border border-neutral-700 bg-[#1a1a1a] px-3 py-2 text-white outline-none transition-colors focus:border-blue-500"
                                    >
                                        {CHARACTER_ROLES.map(role => (
                                            <option key={role.value} value={role.value}>{role.label}</option>
                                        ))}
                                    </select>
                                </div>

                                {characterAssetRole.startsWith('look-') && (
                                    <div className="flex flex-col gap-2">
                                        <label className="text-sm font-medium text-neutral-200">造型名称 <span className="text-red-400">*</span></label>
                                        <input
                                            type="text"
                                            value={lookName}
                                            onChange={(e) => setLookName(e.target.value)}
                                            className="w-full rounded-lg border border-neutral-700 bg-[#1a1a1a] px-3 py-2 text-white outline-none transition-colors focus:border-blue-500"
                                            placeholder="例如：LOOK_B · 晚宴西装裙"
                                        />
                                    </div>
                                )}
                            </>
                        )}

                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-neutral-800 flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-neutral-400 hover:text-white transition-colors"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={status === 'saving' || status === 'success' || !name.trim() || (category === 'Character' && (!characterName.trim() || (characterAssetRole.startsWith('look-') && !lookName.trim())))}
                        className={`flex items-center gap-2 px-6 py-2 rounded-lg font-medium transition-all duration-200 ${status === 'success' ? 'bg-green-600 text-white' :
                                status === 'error' ? 'bg-red-600 text-white' :
                                    status === 'saving' ? 'bg-neutral-700 text-neutral-300' :
                                        'bg-[#2a9d8f] hover:bg-[#21867a] text-white'
                            }`}
                    >
                        {status === 'saving' && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                        {status === 'success' && <Check size={16} />}
                        {status === 'idle' && '创建'}
                        {status === 'saving' && '保存中...'}
                        {status === 'success' && '已保存！'}
                        {status === 'error' && '失败'}
                    </button>
                </div>

            </div>
        </div>
    );
};
