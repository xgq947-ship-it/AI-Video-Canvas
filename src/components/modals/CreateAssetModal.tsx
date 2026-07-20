import React, { useState, useEffect } from 'react';
import { Check } from 'lucide-react';
import { NodeData } from '../../types';

interface CreateAssetModalProps {
    isOpen: boolean;
    onClose: () => void;
    nodeToSnapshot: NodeData | null;
    onSave: (name: string, description?: string) => Promise<void>;
}

export const CreateAssetModal: React.FC<CreateAssetModalProps> = ({
    isOpen,
    onClose,
    nodeToSnapshot,
    onSave
}) => {
    const [name, setName] = useState('我的素材');
    const [description, setDescription] = useState('');
    const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

    // Reset state when opening
    useEffect(() => {
        if (isOpen) {
            setStatus('idle');
            setName('我的素材');
            setDescription('');
        }
    }, [isOpen]);

    if (!isOpen || !nodeToSnapshot) return null;

    const handleSubmit = async () => {
        if (!name.trim()) return;

        setStatus('saving');
        try {
            await onSave(name.trim(), description.trim() || undefined);
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
                        <span className="text-white font-medium border-b-2 border-white pb-2 -mb-2.5">保存为素材</span>
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
                                placeholder="素材名称，例如：人物肯豆"
                            />
                            <p className="text-xs text-neutral-500">连线引用时会显示为 @{name.trim() || '素材名称'}</p>
                        </div>

                        {/* Description */}
                        <div className="flex flex-col gap-2">
                            <label className="text-sm font-medium text-neutral-200">说明</label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={4}
                                className="w-full resize-none bg-[#1a1a1a] border border-neutral-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                                placeholder="选填，补充说明这个素材（不影响引用标签）"
                            />
                        </div>

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
                        disabled={status === 'saving' || status === 'success' || !name.trim()}
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
