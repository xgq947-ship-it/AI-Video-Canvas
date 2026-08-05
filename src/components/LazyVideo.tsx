/**
 * LazyVideo.tsx
 *
 * 只有靠近视口时才真正挂 <video>。
 *
 * 之前每个视频节点都无条件挂一个 <video preload="metadata">，
 * 一个几十个视频节点的画布光是元数据和解码器实例就很可观，而且从不释放。
 *
 * 占位块的尺寸必须由调用方交代清楚（containerClassName / containerStyle /
 * placeholderClassName）：视频挂载前后如果高度不一致，滚动素材网格或展开节点时
 * 会看到内容跳动，反而比不做懒加载更难受。
 *
 * 注意：只有「不管用户看不看都会挂载」的场景才需要它 —— 画布上的节点、列表和
 * 网格。用户主动点开的预览弹窗、展开视图本来就是按需挂载，套上来只会多一个
 * observer 和一次空白闪烁。
 */

import React, { useRef } from 'react';
import { useLazyVisibility } from '../hooks/useLazyVisibility';

type LazyVideoProps = Omit<React.VideoHTMLAttributes<HTMLVideoElement>, 'src'> & {
    /** 没有地址时只画占位块，不会挂一个空 src 的 <video>（那会触发一次无效加载）。 */
    src?: string;
    rootMargin?: string;
    /** 外层容器的类名；默认铺满父级。 */
    containerClassName?: string;
    /** 外层容器的行内样式，用于 aspectRatio 这类占位尺寸。 */
    containerStyle?: React.CSSProperties;
    /** 未挂载时的占位块类名。 */
    placeholderClassName?: string;
};

export const LazyVideo: React.FC<LazyVideoProps> = ({
    src,
    className = '',
    rootMargin = '600px',
    containerClassName = 'w-full h-full',
    containerStyle,
    placeholderClassName = 'w-full h-full bg-neutral-900',
    // 默认值保持组件原有行为（画布视频节点依赖 controls + loop），
    // 网格/预览等不需要的地方显式传 false。
    controls = true,
    loop = true,
    preload = 'metadata',
    ...videoProps
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const shouldRender = useLazyVisibility(containerRef, { rootMargin });

    return (
        <div ref={containerRef} className={containerClassName} style={containerStyle}>
            {shouldRender && src ? (
                <video
                    src={src}
                    controls={controls}
                    loop={loop}
                    preload={preload}
                    className={className}
                    {...videoProps}
                />
            ) : (
                <div className={placeholderClassName} />
            )}
        </div>
    );
};
