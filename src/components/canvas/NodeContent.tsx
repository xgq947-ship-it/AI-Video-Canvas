/**
 * NodeContent.tsx
 * 
 * Displays the content area of a canvas node.
 * Handles result display (image/video) and placeholder states.
 */

import React, { useRef, useState, useEffect } from 'react';
import { Loader2, ImageIcon as ImageIcon, Film, Upload, Pencil, Video, Expand, Shrink, RotateCcw, CircleAlert } from 'lucide-react';
import { NodeData, NodeStatus, NodeType } from '../../types';
import { LazyImage } from '../LazyImage';
import { LazyVideo } from '../LazyVideo';

interface NodeContentProps {
    data: NodeData;
    inputUrl?: string;
    selected: boolean;
    isLoading: boolean;
    isSuccess: boolean;
    getAspectRatioStyle: () => { aspectRatio: string };
    onUpload?: (nodeId: string, imageDataUrl: string) => void;
    // Text node callbacks
    onWriteContent?: (nodeId: string) => void;
    onTextToVideo?: (nodeId: string) => void;
    onTextToImage?: (nodeId: string) => void;
    // Image node callbacks
    onImageToImage?: (nodeId: string) => void;
    onImageToVideo?: (nodeId: string) => void;
    onGenerate?: (nodeId: string) => void;
    onUpdate?: (nodeId: string, updates: Partial<NodeData>) => void;
}

export const NodeContent: React.FC<NodeContentProps> = ({
    data,
    inputUrl,
    selected,
    isLoading,
    isSuccess,
    getAspectRatioStyle,
    onUpload,
    onWriteContent,
    onTextToVideo,
    onTextToImage,
    onImageToImage,
    onImageToVideo,
    onGenerate,
    onUpdate,
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Local state for text node textarea to prevent lag
    const [localPrompt, setLocalPrompt] = useState(data.prompt || '');
    const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastSentPromptRef = useRef<string | undefined>(data.prompt); // Track what we sent

    const isImageType = data.type === NodeType.IMAGE;
    const isVideoType = data.type === NodeType.VIDEO;
    const displayedResultUrl = data.resultUrl && data.productSceneSourceJobId
        ? `${data.resultUrl}${data.resultUrl.includes('?') ? '&' : '?'}job=${encodeURIComponent(data.productSceneSourceJobId)}`
        : data.resultUrl;

    // Sync local state ONLY when data.prompt changes externally (not from our own update)
    useEffect(() => {
        if (data.prompt !== lastSentPromptRef.current) {
            setLocalPrompt(data.prompt || '');
            lastSentPromptRef.current = data.prompt;
        }
    }, [data.prompt]);

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (updateTimeoutRef.current) {
                clearTimeout(updateTimeoutRef.current);
            }
        };
    }, []);

    const handleTextChange = (value: string) => {
        setLocalPrompt(value); // Update local state immediately
        lastSentPromptRef.current = value; // Track that we're about to send this

        // Debounce parent update
        if (updateTimeoutRef.current) {
            clearTimeout(updateTimeoutRef.current);
        }
        updateTimeoutRef.current = setTimeout(() => {
            onUpdate?.(data.id, { prompt: value });
        }, 150);
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !onUpload) return;

        const reader = new FileReader();
        reader.onloadend = () => {
            onUpload(data.id, reader.result as string);
        };
        reader.readAsDataURL(file);
    };

    return (
        <div className={`transition-all duration-200 ${!selected ? 'p-0 rounded-2xl overflow-hidden' : 'p-1'}`}>
            {/* Hidden File Input - Always rendered for upload functionality (image types only) */}
            {isImageType && onUpload && (
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                />
            )}

            {/* Result View - Show when successful OR when regenerating (loading with existing content) */}
            {(isSuccess || isLoading) && data.resultUrl ? (
                <div
                    className={`relative w-full bg-black group/image ${!selected ? '' : 'rounded-xl overflow-hidden'}`}
                    style={getAspectRatioStyle()}
                >
                    {isVideoType ? (
                        <LazyVideo src={data.resultUrl} className="w-full h-full object-cover" />
                    ) : (
                        <LazyImage
                            key={displayedResultUrl}
                            src={displayedResultUrl || data.resultUrl!}
                            alt="Generated"
                            className="w-full h-full pointer-events-none"
                            rootMargin="1200px"
                        />
                    )}

                    {/* Regenerating Overlay - Shows when loading with existing content */}
                    {isLoading && (
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center z-20">
                            <Loader2 size={40} className="animate-spin text-blue-400" />
                            <span className="mt-3 text-sm text-white font-medium">
                                正在重新生成...
                            </span>
                        </div>
                    )}
                </div>
            ) : data.type === NodeType.TEXT ? (
                /* Text Node - Menu or Editing Mode */
                <div className={`relative w-full bg-[#1a1a1a] rounded-2xl overflow-hidden ${selected ? 'ring-1 ring-blue-500/30' : ''}`}>
                    {data.textMode === 'editing' ? (
                        /* Editing Mode - Text Area */
                        <div className="p-4">
                            <textarea
                                value={localPrompt}
                                onChange={(e) => handleTextChange(e.target.value)}
                                onPointerDown={(e) => e.stopPropagation()}
                                onWheel={(e) => e.stopPropagation()}
                                onBlur={() => {
                                    // Ensure final value is saved on blur
                                    if (updateTimeoutRef.current) {
                                        clearTimeout(updateTimeoutRef.current);
                                    }
                                    if (localPrompt !== data.prompt) {
                                        onUpdate?.(data.id, { prompt: localPrompt });
                                    }
                                }}
                                placeholder="在这里输入文本内容..."
                                className="w-full bg-transparent text-white text-sm resize-none outline-none placeholder:text-neutral-600"
                                style={{ minHeight: data.isPromptExpanded ? '300px' : '150px' }}
                                autoFocus
                            />
                            {/* Expand/Shrink Button */}
                            <div className="flex justify-end mt-2">
                                <button
                                    onClick={() => onUpdate?.(data.id, { isPromptExpanded: !data.isPromptExpanded })}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-neutral-500 hover:text-white hover:bg-neutral-700 rounded transition-colors"
                                    title={data.isPromptExpanded ? '收起文本框' : '展开文本框'}
                                >
                                    {data.isPromptExpanded ? <Shrink size={12} /> : <Expand size={12} />}
                                    <span>{data.isPromptExpanded ? '收起' : '展开'}</span>
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* Menu Mode - Show Options */
                        <div className="p-5 flex flex-col gap-4">
                            {/* Header */}
                            <div className="text-neutral-500 text-sm font-medium">
                                你可以：
                            </div>

                            {/* Menu Options */}
                            <div className="flex flex-col gap-1">
                                <TextNodeMenuItem
                                    icon={<Pencil size={16} />}
                                    label="输入文本内容"
                                    onClick={() => onWriteContent?.(data.id)}
                                />
                                <TextNodeMenuItem
                                    icon={<Video size={16} />}
                                    label="文本生成视频"
                                    onClick={() => onTextToVideo?.(data.id)}
                                />
                                <TextNodeMenuItem
                                    icon={<ImageIcon size={16} />}
                                    label="文本生成图片"
                                    onClick={() => onTextToImage?.(data.id)}
                                />
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                /* Placeholder / Empty State for Image/Video */
                <div className={`relative w-full aspect-[4/3] bg-[#141414] flex flex-col items-center justify-center gap-3 overflow-hidden
            ${isLoading ? 'animate-pulse' : ''} 
            ${!selected ? 'rounded-2xl' : 'rounded-xl border border-dashed border-neutral-800'}`
                }>
                    {/* Input Image Preview for Video Nodes */}
                    {isVideoType && inputUrl && (
                        <div className="absolute inset-0 z-0">
                            <img src={inputUrl} alt="Input Frame" className="w-full h-full object-cover opacity-30 blur-sm" />
                            <div className="absolute inset-0 bg-black/40" />
                            <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 rounded text-[10px] text-white font-medium flex items-center gap-1">
                                <ImageIcon size={10} />
                                输入画面
                            </div>
                        </div>
                    )}

                    {isLoading ? (
                        <div className="relative z-10 flex flex-col items-center gap-2">
                            <Loader2 size={32} className="animate-spin text-blue-400" />
                            <span className="text-xs text-neutral-500 font-medium">
                                {data.subtitleSourceNodeId ? '正在识别并烧录字幕...' : '正在生成...'}
                            </span>
                        </div>
                    ) : data.status === NodeStatus.ERROR ? (() => {
                        // Provider already accepted (and billed) the request: the result
                        // may sit in the platform's own history, so a naive retry spends
                        // quota again. The raw message is line-clamped and can hide its
                        // own "不要直接重新生成" notice, so warn explicitly and downplay
                        // the retry button.
                        const quotaConsumed = Boolean(
                            data.errorSubmitted || data.errorMessage?.includes('不要直接重新生成')
                        );
                        return (
                        <div className="relative z-10 flex max-w-[85%] flex-col items-center gap-3 text-center">
                            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-500/10 text-red-400">
                                <CircleAlert size={22} />
                            </div>
                            <div>
                                <div className="text-sm font-medium text-neutral-200">
                                    {data.subtitleSourceNodeId ? '字幕生成失败' : isVideoType ? '视频生成失败' : '图片生成失败'}
                                </div>
                                <div className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-500">
                                    {data.errorMessage || '生成任务未完成，请重新生成。'}
                                </div>
                            </div>
                            {quotaConsumed && (
                                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-4 text-amber-300">
                                    本次已消耗生成配额，直接重试会再次扣费。请先到对应平台历史确认是否已有结果。
                                </div>
                            )}
                            {onGenerate && !data.subtitleSourceNodeId && (
                                <button
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onGenerate(data.id);
                                    }}
                                    onPointerDown={(event) => event.stopPropagation()}
                                    className={quotaConsumed
                                        ? 'flex items-center gap-2 rounded-full border border-neutral-600 bg-transparent px-4 py-2 text-sm font-medium text-neutral-300 transition-colors hover:bg-neutral-800 active:scale-[0.98]'
                                        : 'flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-200 active:scale-[0.98]'}
                                >
                                    <RotateCcw size={15} />
                                    {quotaConsumed ? '仍要重新生成' : '重新生成'}
                                </button>
                            )}
                        </div>
                        );
                    })() : (
                        <div className="relative z-10 flex flex-col items-center gap-3">
                            {/* Upload Button for Image Nodes (including local image models) */}
                            {isImageType && onUpload && (
                                <>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={handleFileChange}
                                    />
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        className="flex items-center gap-2 px-4 py-2 bg-neutral-800/80 hover:bg-neutral-700 rounded-lg text-white text-sm font-medium transition-colors"
                                    >
                                        <Upload size={16} />
                                        上传
                                    </button>
                                </>
                            )}

                            <div className="text-neutral-700">
                                {isVideoType ? <Film size={40} /> : <ImageIcon size={40} />}
                            </div>
                            {selected && (
                                <>
                                    <div className="text-neutral-500 text-sm font-medium">
                                        {isVideoType && inputUrl
                                            ? "可以开始生成动画"
                                            : isVideoType
                                                ? "等待输入..."
                                                : "你可以："
                                        }
                                    </div>
                                    {!isVideoType && (
                                        <div className="flex flex-col gap-1 w-full px-2">
                                            <TextNodeMenuItem
                                                icon={<ImageIcon size={16} />}
                                                label="图片生成图片"
                                                onClick={() => onImageToImage?.(data.id)}
                                            />
                                            <TextNodeMenuItem
                                                icon={<Film size={16} />}
                                                label="图片生成视频"
                                                onClick={() => onImageToVideo?.(data.id)}
                                            />
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

interface TextNodeMenuItemProps {
    icon: React.ReactNode;
    label: string;
    onClick?: () => void;
}

/**
 * Menu item component for Text node options
 */
const TextNodeMenuItem: React.FC<TextNodeMenuItemProps> = ({ icon, label, onClick }) => (
    <button
        className="flex items-center gap-3 w-full p-2.5 rounded-lg text-left text-neutral-400 hover:bg-[#252525] hover:text-white transition-colors"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onClick}
    >
        <span className="text-neutral-500">{icon}</span>
        <span className="text-sm font-medium">{label}</span>
    </button>
);
