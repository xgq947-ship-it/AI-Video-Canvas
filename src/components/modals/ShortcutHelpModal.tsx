/**
 * ShortcutHelpModal.tsx
 *
 * `?` 键唤出的快捷键速查表。
 *
 * 快捷键覆盖面本来就不错（复制/粘贴/副本/成组/连线/生成/排列/缩放/平移都有），
 * 但应用里一直没有任何入口告诉用户它们存在，等于白做。
 *
 * 内容全部来自 utils/shortcutRegistry.js，那份清单同时被回归测试拿去跟
 * useKeyboardShortcuts 的实现对账，避免说明书和实际绑定慢慢对不上。
 */

import React from 'react';
import { X } from 'lucide-react';
import { SHORTCUT_GROUPS, renderKey } from '../../utils/shortcutRegistry.js';

interface ShortcutHelpModalProps {
    isOpen: boolean;
    onClose: () => void;
    canvasTheme?: 'dark' | 'light';
}

const isMacPlatform = () => typeof navigator !== 'undefined'
    && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '');

export const ShortcutHelpModal: React.FC<ShortcutHelpModalProps> = ({ isOpen, onClose, canvasTheme = 'dark' }) => {
    // Esc 关闭。画布的全局 Esc（取消选择）也会照常触发，二者不冲突：
    // 面板开着的时候顺手清掉选择没有副作用。
    React.useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const isDark = canvasTheme === 'dark';
    const isMac = isMacPlatform();

    return (
        <div
            className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label="键盘快捷键"
        >
            <div
                onClick={event => event.stopPropagation()}
                className={`max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl border shadow-2xl ${
                    isDark ? 'border-neutral-800 bg-[#111] text-neutral-100' : 'border-neutral-200 bg-white text-neutral-900'
                }`}
            >
                <div className={`flex items-center justify-between border-b px-5 py-4 ${isDark ? 'border-neutral-800' : 'border-neutral-200'}`}>
                    <div>
                        <h2 className="text-base font-semibold">键盘快捷键</h2>
                        <p className={`mt-0.5 text-xs ${isDark ? 'text-neutral-500' : 'text-neutral-500'}`}>
                            按 <kbd className="font-sans">?</kbd> 可随时打开或关闭本面板
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="关闭"
                        className={`rounded-lg p-1.5 transition-colors ${isDark ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100'}`}
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="grid gap-6 px-5 py-5 sm:grid-cols-2">
                    {SHORTCUT_GROUPS.map(group => (
                        <section key={group.title}>
                            <h3 className={`mb-2 text-[11px] font-semibold uppercase tracking-wide ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                                {group.title}
                            </h3>
                            <ul className="flex flex-col gap-1.5">
                                {group.items.map(item => (
                                    <li key={`${group.title}-${item.keys.join('+')}-${item.label}`} className="flex items-center justify-between gap-3">
                                        <span className="text-xs">{item.label}</span>
                                        <span className="flex shrink-0 items-center gap-1">
                                            {item.keys.map((key, index) => (
                                                <React.Fragment key={`${key}-${index}`}>
                                                    {index > 0 && <span className={`text-[10px] ${isDark ? 'text-neutral-600' : 'text-neutral-400'}`}>+</span>}
                                                    <kbd className={`rounded-md border px-1.5 py-0.5 font-sans text-[10px] ${
                                                        isDark
                                                            ? 'border-neutral-700 bg-neutral-800 text-neutral-200'
                                                            : 'border-neutral-300 bg-neutral-100 text-neutral-700'
                                                    }`}>
                                                        {renderKey(key, isMac)}
                                                    </kbd>
                                                </React.Fragment>
                                            ))}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ))}
                </div>
            </div>
        </div>
    );
};
