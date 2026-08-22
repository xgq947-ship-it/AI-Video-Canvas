/**
 * ImageCropModal.tsx
 *
 * 画布图片节点的裁剪弹窗。
 *
 * 刻意做成弹窗而不是画布上的就地叠加：useImageEditorCrop 里
 * getImageCoordinatesFromEvent 用的是 getBoundingClientRect（受 transform 影响），
 * 而初始化和拖拽夹取用的是 clientWidth/clientHeight（不受 transform 影响）。
 * 放进画布那层 `transform: scale(zoom)` 里，两者会差一个缩放倍数，每一次拖拽都会错位。
 * 弹窗不缩放，这套坐标才是自洽的。
 */

import React from 'react';
import { X } from 'lucide-react';
import { useImageEditorCrop } from '../../hooks/useImageEditorCrop';

interface ImageCropModalProps {
    isOpen: boolean;
    imageUrl?: string;
    /** 落盘期间禁用按钮，避免同一张图被连点提交两次。 */
    busy?: boolean;
    onCancel: () => void;
    onApply: (croppedDataUrl: string) => void;
}

/** 弹窗里图片的显示上限，保证裁剪框和按钮在小屏也放得下。 */
const MAX_IMAGE_WIDTH = 'min(78vw, 1100px)';
const MAX_IMAGE_HEIGHT = 'min(68vh, 760px)';

export const ImageCropModal: React.FC<ImageCropModalProps> = ({
    isOpen,
    imageUrl,
    busy = false,
    onCancel,
    onApply,
}) => {
    const imageRef = React.useRef<HTMLImageElement | null>(null);
    const [imageReady, setImageReady] = React.useState(false);

    const crop = useImageEditorCrop({
        imageRef,
        // 画布的历史记录由 nodes 变化自动入栈，这里不需要再单独存档。
        saveState: () => { },
        onCropApply: onApply,
    });

    const { setIsCropMode, initializeCropRect, cancelCrop } = crop;

    // 每次打开都从干净状态开始：上一张图的裁剪框留到下一张图上毫无意义。
    React.useEffect(() => {
        if (isOpen) return;
        setImageReady(false);
        cancelCrop();
    }, [isOpen, cancelCrop]);

    React.useEffect(() => {
        setImageReady(false);
    }, [imageUrl]);

    const handleImageLoad = React.useCallback(() => {
        setImageReady(true);
        initializeCropRect();
        setIsCropMode(true);
    }, [initializeCropRect, setIsCropMode]);

    // 裁剪框是显示尺寸，成品是原图像素。给出后者，用户才知道自己裁出来多大。
    const outputSize = React.useMemo(() => {
        const img = imageRef.current;
        if (!img || !crop.cropRect || !img.clientWidth || !img.clientHeight) return null;
        return {
            width: Math.round(crop.cropRect.width * (img.naturalWidth / img.clientWidth)),
            height: Math.round(crop.cropRect.height * (img.naturalHeight / img.clientHeight)),
        };
    }, [crop.cropRect]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[120] flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="mb-3 flex w-full max-w-[1100px] items-center justify-between px-4">
                <div className="flex items-baseline gap-3">
                    <span className="text-sm font-medium text-white">裁剪图片</span>
                    <span className="text-xs text-neutral-400">
                        拖动框内移动，拖动四角改大小
                    </span>
                </div>
                <button
                    type="button"
                    onClick={onCancel}
                    className="rounded-full p-1.5 text-neutral-300 transition-colors hover:bg-white/10 hover:text-white"
                    title="关闭"
                >
                    <X size={16} />
                </button>
            </div>

            <div className="relative" style={{ lineHeight: 0 }}>
                {imageUrl ? (
                    <img
                        ref={imageRef}
                        src={imageUrl}
                        alt="待裁剪图片"
                        onLoad={handleImageLoad}
                        draggable={false}
                        style={{
                            maxWidth: MAX_IMAGE_WIDTH,
                            maxHeight: MAX_IMAGE_HEIGHT,
                            width: 'auto',
                            height: 'auto',
                        }}
                        className="select-none rounded-lg"
                    />
                ) : (
                    <div className="flex h-64 w-96 items-center justify-center rounded-lg bg-neutral-800 text-sm text-neutral-400">
                        没有可裁剪的图片
                    </div>
                )}

                {imageReady && crop.isCropMode && crop.cropRect && (
                    <div
                        className="absolute inset-0"
                        style={{ cursor: crop.isDragging ? 'grabbing' : 'default' }}
                        onMouseDown={crop.handleCropMouseDown}
                    >
                        <svg className="absolute inset-0" style={{ width: '100%', height: '100%' }}>
                            <defs>
                                <mask id="nodeCropMask">
                                    <rect width="100%" height="100%" fill="white" />
                                    <rect
                                        x={crop.cropRect.x}
                                        y={crop.cropRect.y}
                                        width={crop.cropRect.width}
                                        height={crop.cropRect.height}
                                        fill="black"
                                    />
                                </mask>
                            </defs>
                            <rect
                                width="100%"
                                height="100%"
                                fill="rgba(0, 0, 0, 0.6)"
                                mask="url(#nodeCropMask)"
                            />
                            <rect
                                x={crop.cropRect.x}
                                y={crop.cropRect.y}
                                width={crop.cropRect.width}
                                height={crop.cropRect.height}
                                fill="none"
                                stroke="white"
                                strokeWidth="2"
                                strokeDasharray="5,5"
                            />
                            {([
                                ['nw', crop.cropRect.x, crop.cropRect.y, 'nwse-resize'],
                                ['ne', crop.cropRect.x + crop.cropRect.width, crop.cropRect.y, 'nesw-resize'],
                                ['sw', crop.cropRect.x, crop.cropRect.y + crop.cropRect.height, 'nesw-resize'],
                                ['se', crop.cropRect.x + crop.cropRect.width, crop.cropRect.y + crop.cropRect.height, 'nwse-resize'],
                            ] as const).map(([handle, x, y, cursor]) => (
                                <rect
                                    key={handle}
                                    x={x - 5}
                                    y={y - 5}
                                    width="10"
                                    height="10"
                                    fill="white"
                                    stroke="#3b82f6"
                                    strokeWidth="2"
                                    style={{ cursor }}
                                />
                            ))}
                        </svg>
                    </div>
                )}
            </div>

            <div className="mt-4 flex items-center gap-3">
                <span className="min-w-[120px] text-right text-xs tabular-nums text-neutral-400">
                    {outputSize ? `${outputSize.width} × ${outputSize.height}` : ''}
                </span>
                <button
                    type="button"
                    onClick={onCancel}
                    disabled={busy}
                    className="rounded-lg bg-neutral-700 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-neutral-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    取消
                </button>
                <button
                    type="button"
                    onClick={() => crop.applyCrop()}
                    disabled={busy || !imageReady || !crop.cropRect}
                    className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {busy ? '正在保存…' : '应用裁剪'}
                </button>
            </div>
        </div>
    );
};
