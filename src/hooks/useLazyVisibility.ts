/**
 * useLazyVisibility.ts
 *
 * "该不该把这块媒体挂在 DOM 上" 的判断。
 *
 * 之前 LazyImage 是进入视口就 observer.disconnect()，标记位再也不会回落 ——
 * 也就是说画布上划过的每一张图都会永久留在 DOM 里，解码后的位图一直不释放。
 * 视频更直接，每个视频节点无条件挂一个 <video>。
 *
 * 这里用两个观察器：
 * - 加载观察器用较小的 rootMargin，快进视口时提前一点点开始加载；
 * - 卸载观察器用大得多的 rootMargin，只有真的划远了才卸载，
 *   并且还要再等一小会儿，避免来回滚动时反复加载/卸载。
 */

import { useEffect, useRef, useState } from 'react';

interface UseLazyVisibilityOptions {
    /** 提前多少距离开始加载 */
    rootMargin?: string;
    /** 离开多远之后才算"可以卸载了"；默认由 rootMargin 推导，保证有足够的迟滞区间 */
    unloadRootMargin?: string;
    /** 离开后延迟多久卸载 */
    unloadDelayMs?: number;
    threshold?: number;
}

/**
 * 卸载边界必须显著大于加载边界，否则两条线重合，来回滚动时会疯狂加载/卸载。
 */
const deriveUnloadMargin = (rootMargin: string) => {
    const px = Number.parseFloat(rootMargin);
    if (!Number.isFinite(px)) return '1200px';
    return `${Math.max(px * 2, 1200)}px`;
};

export const useLazyVisibility = <T extends Element>(
    ref: React.RefObject<T | null>,
    {
        rootMargin = '50px',
        unloadRootMargin,
        unloadDelayMs = 5000,
        threshold = 0.01
    }: UseLazyVisibilityOptions = {}
) => {
    const resolvedUnloadMargin = unloadRootMargin || deriveUnloadMargin(rootMargin);
    const [shouldRender, setShouldRender] = useState(false);
    const unloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const element = ref.current;
        if (!element) return;
        if (typeof IntersectionObserver === 'undefined') {
            // 环境不支持就退化成"一直挂载"，宁可多占内存也不能不显示。
            setShouldRender(true);
            return;
        }

        const cancelUnload = () => {
            if (unloadTimerRef.current === null) return;
            clearTimeout(unloadTimerRef.current);
            unloadTimerRef.current = null;
        };

        const loadObserver = new IntersectionObserver(entries => {
            if (!entries.some(entry => entry.isIntersecting)) return;
            cancelUnload();
            setShouldRender(true);
        }, { rootMargin, threshold });

        const unloadObserver = new IntersectionObserver(entries => {
            const stillNearby = entries.some(entry => entry.isIntersecting);
            if (stillNearby) {
                cancelUnload();
                return;
            }
            if (unloadTimerRef.current !== null) return;
            unloadTimerRef.current = setTimeout(() => {
                unloadTimerRef.current = null;
                setShouldRender(false);
            }, unloadDelayMs);
        }, { rootMargin: resolvedUnloadMargin, threshold: 0 });

        loadObserver.observe(element);
        unloadObserver.observe(element);

        return () => {
            cancelUnload();
            loadObserver.disconnect();
            unloadObserver.disconnect();
        };
    }, [ref, rootMargin, resolvedUnloadMargin, unloadDelayMs, threshold]);

    return shouldRender;
};
