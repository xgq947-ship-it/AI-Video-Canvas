/**
 * LazyImage.tsx
 *
 * A lazy-loading image component that shows a skeleton placeholder
 * and only loads the actual image when it enters the viewport.
 * Uses Intersection Observer for efficient lazy loading.
 *
 * 划远之后会把 <img> 卸载掉，释放解码后的位图 —— 见 useLazyVisibility。
 */

import React, { useState, useRef, useEffect } from 'react';
import { useLazyVisibility } from '../hooks/useLazyVisibility';

interface LazyImageProps {
    src: string;
    alt: string;
    className?: string;
    placeholderClassName?: string;
    /** Threshold for intersection observer (0-1) */
    threshold?: number;
    /** Root margin for preloading before visible */
    rootMargin?: string;
}

export const LazyImage: React.FC<LazyImageProps> = ({
    src,
    alt,
    className = '',
    placeholderClassName = '',
    threshold = 0.1,
    rootMargin = '50px'
}) => {
    const [isLoaded, setIsLoaded] = useState(false);
    const [hasError, setHasError] = useState(false);
    const imgRef = useRef<HTMLDivElement>(null);
    const isInView = useLazyVisibility(imgRef, { threshold, rootMargin });

    // 节点异步生成完成后 src 会原地更新。重置上一张图的加载/错误状态，
    // 否则 React 复用组件时可能继续显示旧图或旧错误占位。
    useEffect(() => {
        setIsLoaded(false);
        setHasError(false);
    }, [src]);

    // 卸载后重新进入视口要重新走一遍加载流程，否则会停在"已加载"的空状态。
    useEffect(() => {
        if (!isInView) setIsLoaded(false);
    }, [isInView]);

    const handleLoad = () => {
        setIsLoaded(true);
    };

    const handleError = () => {
        setHasError(true);
        setIsLoaded(true);
    };

    return (
        <div ref={imgRef} className={`relative ${className}`}>
            {/* Skeleton placeholder - shown until image loads */}
            {!isLoaded && (
                <div
                    className={`absolute inset-0 bg-neutral-800 animate-pulse ${placeholderClassName}`}
                />
            )}

            {/* Error state */}
            {hasError && (
                <div className="absolute inset-0 bg-neutral-800 flex items-center justify-center">
                    <span className="text-neutral-500 text-xs">Failed to load</span>
                </div>
            )}

            {/* Actual image - only rendered when in view */}
            {isInView && !hasError && (
                <img
                    key={src}
                    src={src}
                    alt={alt}
                    decoding="async"
                    onLoad={handleLoad}
                    onError={handleError}
                    className={`w-full h-full object-cover transition-opacity duration-150 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
                    style={{ willChange: 'opacity' }}
                />
            )}
        </div>
    );
};
