/**
 * useToasts.ts
 *
 * 应用内轻量提示。
 *
 * 为什么不用 window.alert：Electron 里原生模态会冻住整个渲染进程，
 * 用户必须先点掉才能继续操作画布，批量导入这种"可能连弹好几次"的场景尤其难受。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type ToastTone = 'info' | 'error';

export interface Toast {
    id: string;
    message: string;
    tone: ToastTone;
}

const DEFAULT_DURATION_MS = 4200;

export const useToasts = () => {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

    const dismissToast = useCallback((id: string) => {
        const timer = timersRef.current.get(id);
        if (timer) {
            clearTimeout(timer);
            timersRef.current.delete(id);
        }
        setToasts(previous => previous.filter(toast => toast.id !== id));
    }, []);

    const showToast = useCallback((
        message: string,
        { tone = 'info', duration = DEFAULT_DURATION_MS }: { tone?: ToastTone; duration?: number } = {}
    ) => {
        const text = String(message || '').trim();
        if (!text) return '';

        const id = crypto.randomUUID();
        // 最多同时显示 4 条，超出的丢最旧的，避免刷屏盖住画布。
        setToasts(previous => [...previous, { id, message: text, tone }].slice(-4));

        const timer = setTimeout(() => {
            timersRef.current.delete(id);
            setToasts(previous => previous.filter(toast => toast.id !== id));
        }, duration);
        timersRef.current.set(id, timer);
        return id;
    }, []);

    useEffect(() => {
        const timers = timersRef.current;
        return () => {
            for (const timer of timers.values()) clearTimeout(timer);
            timers.clear();
        };
    }, []);

    return { toasts, showToast, dismissToast };
};
