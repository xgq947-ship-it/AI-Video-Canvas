/**
 * GenerationElapsed.tsx
 *
 * 生成中节点的已用时长。
 *
 * 视频生成动辄几分钟，而此前 LOADING 态只有一个转圈，用户没法判断"还在跑"还是
 * "已经卡死"。`generationStartTime` 早就写进了 NodeData（见 types.ts），只是一直
 * 没有任何 UI 读它。
 *
 * 刻意做成独立的叶子组件：它每秒 setState 一次，如果直接写在 NodeContent 里，
 * 每个生成中的节点每秒都会重渲染整棵节点子树，把 CanvasNode 的 memo 白白抵消掉。
 * 拆出来之后每秒重渲染的只有这一个 <span>。
 */

import React, { useEffect, useState } from 'react';

interface GenerationElapsedProps {
    startedAt?: number;
    queuedAt?: number;
    finishedAt?: number;
    elapsedMs?: number;
    label?: string;
    className?: string;
}

/** 秒数格式化为 m:ss；超过一小时补上小时段。仅本组件使用。 */
const formatElapsed = (totalSeconds: number): string => {
    const safe = Math.max(0, Math.floor(totalSeconds));
    const seconds = safe % 60;
    const minutes = Math.floor(safe / 60) % 60;
    const hours = Math.floor(safe / 3600);
    const pad = (value: number) => String(value).padStart(2, '0');
    return hours > 0
        ? `${hours}:${pad(minutes)}:${pad(seconds)}`
        : `${minutes}:${pad(seconds)}`;
};

export const GenerationElapsed: React.FC<GenerationElapsedProps> = ({
    startedAt,
    queuedAt,
    finishedAt,
    elapsedMs,
    label,
    className = '',
}) => {
    const [now, setNow] = useState(() => Date.now());
    const anchor = startedAt || queuedAt;
    const isLive = Boolean(anchor && elapsedMs === undefined && !finishedAt);

    useEffect(() => {
        if (!isLive) return;
        // 立刻对齐一次，避免组件挂载时显示上一次残留的时间。
        setNow(Date.now());
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [isLive]);

    // 没有起始时间或已保存的耗时就什么都不显示，绝不退化成从 0 开始的假计时。
    if (!anchor && elapsedMs === undefined) return null;

    const durationMs = elapsedMs !== undefined
        ? Math.max(0, elapsedMs)
        : Math.max(0, (finishedAt || now) - (anchor || now));
    const defaultLabel = startedAt ? (finishedAt ? '耗时' : '已用') : '等待';

    return (
        <span className={`tabular-nums ${className}`}>
            {label || defaultLabel} {formatElapsed(durationMs / 1000)}
        </span>
    );
};
