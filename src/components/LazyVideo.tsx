/**
 * LazyVideo.tsx
 *
 * 只有靠近视口时才真正挂 <video>。
 *
 * 之前每个视频节点都无条件挂一个 <video preload="metadata">，
 * 一个几十个视频节点的画布光是元数据和解码器实例就很可观，而且从不释放。
 */

import React, { useRef } from 'react';
import { useLazyVisibility } from '../hooks/useLazyVisibility';

interface LazyVideoProps {
    src: string;
    className?: string;
    rootMargin?: string;
}

export const LazyVideo: React.FC<LazyVideoProps> = ({
    src,
    className = '',
    rootMargin = '600px'
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const shouldRender = useLazyVisibility(containerRef, { rootMargin });

    return (
        <div ref={containerRef} className="w-full h-full">
            {shouldRender ? (
                <video src={src} controls loop preload="metadata" className={className} />
            ) : (
                <div className="w-full h-full bg-neutral-900" />
            )}
        </div>
    );
};
