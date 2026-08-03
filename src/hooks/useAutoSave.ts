/**
 * useAutoSave.ts
 *
 * Custom hook that periodically saves the canvas state to the backend
 * if there are unsaved changes and no active generations.
 *
 * 定时逻辑放在 utils/autoSaveScheduler.js，这里只负责把最新的 props 喂给它。
 * 千万不要把 `nodes` / `onSave` 加回 effect 依赖：它们每次 render 都变，
 * 会让 60 秒的计时器不断重置，自动保存就再也不会触发。
 */

import { useEffect, useRef } from 'react';
import { NodeData } from '../types';
import { createAutoSaveScheduler } from '../utils/autoSaveScheduler.js';

interface UseAutoSaveOptions {
    isDirty: boolean;
    nodes: NodeData[];
    persistableItemCount?: number;
    onSave: () => Promise<void>;
    interval?: number; // In milliseconds, default 60s
}

export const useAutoSave = ({
    isDirty,
    nodes,
    persistableItemCount = nodes.length,
    onSave,
    interval = 60000
}: UseAutoSaveOptions) => {
    const lastSaveTimeRef = useRef<number>(Date.now());
    const stateRef = useRef({ isDirty, nodes, persistableItemCount, onSave });

    // 每次 render 后刷新快照；定时器读的是 ref，所以不需要重建。
    useEffect(() => {
        stateRef.current = { isDirty, nodes, persistableItemCount, onSave };
    });

    useEffect(() => {
        const scheduler = createAutoSaveScheduler({
            intervalMs: interval,
            getState: () => ({
                isDirty: stateRef.current.isDirty,
                nodeCount: stateRef.current.persistableItemCount,
                save: stateRef.current.onSave
            }),
            onSaved: () => {
                lastSaveTimeRef.current = Date.now();
            }
        });
        return () => scheduler.stop();
    }, [interval]);

    return {
        lastSaveTime: lastSaveTimeRef.current
    };
};
