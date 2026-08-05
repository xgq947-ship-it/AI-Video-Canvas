/**
 * ToastStack.tsx
 *
 * 画布底部中间的提示条，替代会冻住渲染进程的 window.alert。
 */

import React from 'react';
import { X } from 'lucide-react';
import type { Toast } from '../hooks/useToasts';

interface ToastStackProps {
    toasts: Toast[];
    onDismiss: (id: string) => void;
    canvasTheme?: 'dark' | 'light';
}

export const ToastStack: React.FC<ToastStackProps> = ({ toasts, onDismiss, canvasTheme = 'dark' }) => {
    if (toasts.length === 0) return null;

    const isDark = canvasTheme === 'dark';

    return (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-2 pointer-events-none">
            {toasts.map(toast => (
                <div
                    key={toast.id}
                    role="status"
                    className={`pointer-events-auto flex items-center gap-3 max-w-[520px] rounded-lg px-4 py-2.5 text-sm shadow-lg border backdrop-blur ${
                        toast.tone === 'error'
                            ? 'bg-red-500/15 border-red-500/40 text-red-200'
                            : isDark
                                ? 'bg-neutral-900/85 border-neutral-700 text-neutral-100'
                                : 'bg-white/95 border-neutral-300 text-neutral-800'
                    }`}
                >
                    <span className="flex-1 break-words">{toast.message}</span>
                    {toast.action && (
                        <button
                            type="button"
                            onClick={() => {
                                // 先关掉再执行：重试通常会立刻再弹一条新提示，
                                // 留着旧的会让用户以为没反应。
                                onDismiss(toast.id);
                                toast.action!.onClick();
                            }}
                            className={`shrink-0 rounded px-2 py-1 text-xs font-medium transition-colors ${
                                toast.tone === 'error'
                                    ? 'bg-red-500/20 text-red-100 hover:bg-red-500/35'
                                    : isDark
                                        ? 'bg-neutral-700 text-neutral-100 hover:bg-neutral-600'
                                        : 'bg-neutral-200 text-neutral-800 hover:bg-neutral-300'
                            }`}
                        >
                            {toast.action.label}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => onDismiss(toast.id)}
                        aria-label="关闭提示"
                        className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                    >
                        <X size={14} />
                    </button>
                </div>
            ))}
        </div>
    );
};
