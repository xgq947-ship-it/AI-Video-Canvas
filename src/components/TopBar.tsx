/**
 * TopBar.tsx
 * 
 * Top navigation bar component with canvas title, save button, and other controls.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, CircleHelp, FolderOpen, Globe2, KeyRound, Loader2, Plus, RefreshCw, Save, Settings, ShieldCheck, Trash2 } from 'lucide-react';
import { NodeData } from '../types';
import { ApiKeySettingsModal } from './modals/ApiKeySettingsModal';
import { StartupSetupGuideModal } from './modals/StartupSetupGuideModal';
import { TrashModal } from './modals/TrashModal';
import { AccountLicenseSettings } from './AccountLicenseSettings';
import { useLoginEnabled } from '../hooks/useAuth';

/**
 * 首启配置指南「本机已见过」标记。首次安装时自动弹一次登录/配置指南，
 * 之后在同一台电脑上不再自动弹出；用户仍可从右上角「设置 → 启动配置指南」手动打开。
 */
const SETUP_GUIDE_SEEN_KEY = 'evan.setupGuideSeen';

interface TopBarProps {
    // Title
    canvasTitle: string;
    isEditingTitle: boolean;
    editingTitleValue: string;
    canvasTitleInputRef: React.RefObject<HTMLInputElement | null>;
    setCanvasTitle: (title: string) => void;
    setIsEditingTitle: (editing: boolean) => void;
    setEditingTitleValue: (value: string) => void;
    // Actions
    onSave: () => void | Promise<void>;
    onRefresh: () => void | Promise<void>;
    onNew: () => void;
    onOpenExistingProject: () => void;
    hasUnsavedChanges: boolean;
    lastAutoSaveTime?: number;
    workflowId?: string | null;
    onRestoreNodes: (nodes: NodeData[]) => void;
    // Theme
    canvasTheme: 'dark' | 'light';
    onToggleTheme: () => void;
    showBrand?: boolean;
    sidebarOffset?: number;
}

export const TopBar: React.FC<TopBarProps> = ({
    canvasTitle,
    isEditingTitle,
    editingTitleValue,
    canvasTitleInputRef,
    setCanvasTitle,
    setIsEditingTitle,
    setEditingTitleValue,
    onSave,
    onRefresh,
    onNew,
    onOpenExistingProject,
    hasUnsavedChanges,
    lastAutoSaveTime,
    workflowId,
    onRestoreNodes,
    canvasTheme,
    onToggleTheme,
    showBrand = true,
    sidebarOffset = 0,
}) => {
    const [showNewConfirm, setShowNewConfirm] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [showSettingsMenu, setShowSettingsMenu] = useState(false);
    const [showApiSettings, setShowApiSettings] = useState(false);
    const [showSetupGuide, setShowSetupGuide] = useState(() => {
        // 只有本机从没见过首启指南时才自动弹出。localStorage 在 Electron 渲染进程里
        // 会持久化到磁盘、跨启动保留，正好满足「装完弹一次，之后本机不再弹」。
        try {
            return localStorage.getItem(SETUP_GUIDE_SEEN_KEY) !== '1';
        } catch {
            return true;
        }
    });
    const [showTrash, setShowTrash] = useState(false);
    const [isOpeningBrowser, setIsOpeningBrowser] = useState(false);
    const [browserOpenError, setBrowserOpenError] = useState<string | null>(null);
    const [showAccountSettings, setShowAccountSettings] = useState(false);
    const loginEnabled = useLoginEnabled();
    const settingsMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // 首启指南一旦自动弹出，就立刻标记本机已见过——即便用户直接关掉应用没点「进入画布」，
        // 下次启动也不会再自动弹。手动从设置菜单重开不受影响（那只改 state、不经过这里）。
        if (showSetupGuide) {
            try {
                localStorage.setItem(SETUP_GUIDE_SEEN_KEY, '1');
            } catch {
                /* localStorage 不可用时忽略：最坏情况是每次都弹，不影响功能 */
            }
        }
        // 只在挂载时执行一次。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            if (settingsMenuRef.current && !settingsMenuRef.current.contains(event.target as Node)) {
                setShowSettingsMenu(false);
            }
        };
        document.addEventListener('pointerdown', handlePointerDown);
        return () => document.removeEventListener('pointerdown', handlePointerDown);
    }, []);

    const handleTitleBlur = () => {
        if (editingTitleValue.trim()) {
            setCanvasTitle(editingTitleValue.trim());
        } else {
            setEditingTitleValue(canvasTitle);
        }
        setIsEditingTitle(false);
    };

    const handleTitleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            if (editingTitleValue.trim()) {
                setCanvasTitle(editingTitleValue.trim());
            }
            setIsEditingTitle(false);
        } else if (e.key === 'Escape') {
            setEditingTitleValue(canvasTitle);
            setIsEditingTitle(false);
        }
    };

    const handleTitleDoubleClick = () => {
        setEditingTitleValue(canvasTitle);
        setIsEditingTitle(true);
    };

    const handleNewClick = () => {
        if (hasUnsavedChanges) {
            setShowNewConfirm(true);
        } else {
            onNew();
        }
    };

    const handleSaveAndNew = async () => {
        try {
            setIsSaving(true);
            await onSave();
            setShowNewConfirm(false);
            onNew();
        } catch (error) {
            console.error("Failed to save and new:", error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDiscardAndNew = () => {
        setShowNewConfirm(false);
        onNew();
    };

    const handleRefreshCanvas = async () => {
        if (isRefreshing) return;
        setIsRefreshing(true);
        try {
            await onRefresh();
        } catch (error) {
            console.error('Failed to refresh current canvas:', error);
            window.alert(error instanceof Error ? error.message : '刷新当前画布失败');
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleOpenBuiltInBrowser = async () => {
        if (isOpeningBrowser) return;
        setIsOpeningBrowser(true);
        setBrowserOpenError(null);
        try {
            const response = await fetch('/api/browser/open', { method: 'POST' });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || '共享 AI 浏览器打开失败');
            setShowSettingsMenu(false);
        } catch (error) {
            setBrowserOpenError(error instanceof Error ? error.message : '共享 AI 浏览器打开失败');
        } finally {
            setIsOpeningBrowser(false);
        }
    };

    return (
        <>
            <div
                className={`fixed top-0 left-0 z-50 flex h-14 items-center justify-between border-b px-4 pointer-events-none backdrop-blur-xl transition-all duration-300 ${
                    canvasTheme === 'dark'
                        ? 'border-white/[0.07] bg-[#0d0e0f]/90 shadow-[0_8px_30px_rgba(0,0,0,0.2)]'
                        : 'border-neutral-200/90 bg-white/90 shadow-[0_8px_24px_rgba(15,23,42,0.06)]'
                }`}
                style={{
                    left: sidebarOffset,
                    width: `calc(100% - ${sidebarOffset}px)`
                }}
            >
                {/* Left: project identity and app-level workspaces */}
                <div className="flex items-center gap-3 pointer-events-auto">
                    {showBrand && <>
                      <img src="/TwitCanva-logo.png" alt="Evan Logo" className="w-8 h-8 rounded-lg object-contain bg-black/20" />
                      {isEditingTitle ? (
                        <input
                            ref={canvasTitleInputRef as React.RefObject<HTMLInputElement | null>}
                            type="text"
                            value={editingTitleValue}
                            onChange={(e) => setEditingTitleValue(e.target.value)}
                            onBlur={handleTitleBlur}
                            onKeyDown={handleTitleKeyDown}
                            className="font-semibold text-neutral-300 bg-transparent border-b border-blue-500 outline-none min-w-[100px]"
                        />
                      ) : (
                        <span
                            className={`font-semibold cursor-pointer transition-colors ${canvasTheme === 'dark' ? 'text-neutral-300 hover:text-white' : 'text-neutral-900 hover:text-neutral-600'}`}
                            onDoubleClick={handleTitleDoubleClick}
                            title="双击重命名"
                        >
                            {canvasTitle}
                        </span>
                      )}
                    </>}
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-3 pointer-events-auto">
                    {/* Auto-save notification - before save button */}
                    {lastAutoSaveTime && !hasUnsavedChanges && (
                        <div className={`text-[10px] font-medium px-2 py-1 rounded border animate-in fade-in duration-500 ${canvasTheme === 'dark'
                            ? 'text-neutral-500 border-neutral-800'
                            : 'text-neutral-400 border-neutral-100'
                            }`}>
                            已自动保存 {new Date(lastAutoSaveTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                    )}
                    <button
                        onClick={() => onSave()}
                        className={`text-sm px-5 py-2.5 rounded-full flex items-center gap-2 transition-colors font-medium border ${canvasTheme === 'dark'
                            ? 'bg-neutral-800 hover:bg-neutral-700 text-white border-neutral-600'
                            : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-900 border-neutral-300 shadow-sm'
                            }`}
                    >
                        <Save size={16} />
                        保存
                    </button>
                    <button
                        onClick={() => void handleRefreshCanvas()}
                        disabled={!workflowId || isRefreshing}
                        className={`text-sm px-4 py-2.5 rounded-full flex items-center gap-2 transition-colors font-medium border disabled:cursor-not-allowed disabled:opacity-40 ${canvasTheme === 'dark'
                            ? 'bg-neutral-800 hover:bg-neutral-700 text-white border-neutral-600'
                            : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-900 border-neutral-300 shadow-sm'
                            }`}
                        title="先保存，再从项目文件重新加载当前画布"
                    >
                        <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
                        刷新画布
                    </button>
                    <button
                        onClick={onOpenExistingProject}
                        className={`text-sm px-4 py-2.5 rounded-full flex items-center gap-2 transition-colors font-medium border ${canvasTheme === 'dark'
                            ? 'bg-neutral-800 hover:bg-neutral-700 text-white border-neutral-600'
                            : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-900 border-neutral-300 shadow-sm'
                            }`}
                        title="打开已有项目"
                    >
                        <FolderOpen size={16} />
                        打开项目
                    </button>
                    <button
                        onClick={handleNewClick}
                        className={`text-sm px-4 py-2.5 rounded-full flex items-center gap-2 transition-colors font-medium border ${canvasTheme === 'dark'
                            ? 'bg-neutral-800 hover:bg-neutral-700 text-white border-neutral-600'
                            : 'bg-neutral-200 hover:bg-neutral-300 text-neutral-900 border-neutral-300'
                            }`}
                    >
                        <Plus size={16} />
                        新建
                    </button>
                    <div className="relative" ref={settingsMenuRef}>
                        <button
                            onClick={() => setShowSettingsMenu(current => !current)}
                            className={`h-10 rounded-full px-3 flex items-center gap-1.5 transition-colors border ${canvasTheme === 'dark'
                                ? 'bg-neutral-900 border-neutral-700 text-neutral-300 hover:bg-neutral-800 hover:text-white'
                                : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50 shadow-sm'
                                }`}
                            title="设置"
                            aria-label="设置"
                            aria-expanded={showSettingsMenu}
                        >
                            <Settings size={17} />
                            <ChevronDown size={13} className={`transition-transform ${showSettingsMenu ? 'rotate-180' : ''}`} />
                        </button>
                        {showSettingsMenu && (
                            <div className={`absolute right-0 top-full mt-2 w-52 overflow-hidden rounded-xl border p-1.5 shadow-2xl ${canvasTheme === 'dark' ? 'border-neutral-700 bg-[#202020]' : 'border-neutral-200 bg-white'}`}>
                                {loginEnabled && (
                                    <button
                                        onClick={() => {
                                            setShowSettingsMenu(false);
                                            setShowAccountSettings(true);
                                        }}
                                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${canvasTheme === 'dark' ? 'text-neutral-200 hover:bg-neutral-700' : 'text-neutral-700 hover:bg-neutral-100'}`}
                                    >
                                        <ShieldCheck size={16} className="text-emerald-400" />
                                        <span>
                                            <span className="block font-medium">账号与授权</span>
                                            <span className="mt-0.5 block text-[10px] text-neutral-500">登录状态、试用与激活</span>
                                        </span>
                                    </button>
                                )}
                                <button
                                    onClick={() => {
                                        setShowSettingsMenu(false);
                                        setShowSetupGuide(true);
                                    }}
                                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${canvasTheme === 'dark' ? 'text-neutral-200 hover:bg-neutral-700' : 'text-neutral-700 hover:bg-neutral-100'}`}
                                >
                                    <CircleHelp size={16} className="text-violet-400" />
                                    <span>
                                        <span className="block font-medium">启动配置指南</span>
                                        <span className="mt-0.5 block text-[10px] text-neutral-500">登录平台与连接 AI 服务</span>
                                    </span>
                                </button>
                                <button
                                    onClick={() => {
                                        setShowSettingsMenu(false);
                                        setShowApiSettings(true);
                                    }}
                                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${canvasTheme === 'dark' ? 'text-neutral-200 hover:bg-neutral-700' : 'text-neutral-700 hover:bg-neutral-100'}`}
                                >
                                    <KeyRound size={16} className="text-blue-400" />
                                    <span>
                                        <span className="block font-medium">设置</span>
                                        <span className="mt-0.5 block text-[10px] text-neutral-500">密钥、新功能与检查更新</span>
                                    </span>
                                </button>
                                <button
                                    onClick={handleOpenBuiltInBrowser}
                                    disabled={isOpeningBrowser}
                                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-wait disabled:opacity-60 ${canvasTheme === 'dark' ? 'text-neutral-200 hover:bg-neutral-700' : 'text-neutral-700 hover:bg-neutral-100'}`}
                                >
                                    {isOpeningBrowser
                                        ? <Loader2 size={16} className="shrink-0 animate-spin text-cyan-400" />
                                        : <Globe2 size={16} className="shrink-0 text-cyan-400" />}
                                    <span>
                                        <span className="block font-medium">打开共享 AI 浏览器</span>
                                        <span className="mt-0.5 block text-[10px] text-neutral-500">查看即梦、Google Flow 与 Gemini 页面</span>
                                    </span>
                                </button>
                                <button
                                    onClick={() => {
                                        setShowSettingsMenu(false);
                                        setShowTrash(true);
                                    }}
                                    disabled={!workflowId}
                                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${canvasTheme === 'dark' ? 'text-neutral-200 hover:bg-neutral-700' : 'text-neutral-700 hover:bg-neutral-100'}`}
                                >
                                    <Trash2 size={16} className="shrink-0 text-amber-400" />
                                    <span>
                                        <span className="block font-medium">回收站</span>
                                        <span className="mt-0.5 block text-[10px] text-neutral-500">7 天内恢复或永久删除</span>
                                    </span>
                                </button>
                                {browserOpenError && (
                                    <div className="mx-2 mb-1 rounded-lg bg-red-500/10 px-2 py-1.5 text-[10px] leading-4 text-red-400">
                                        {browserOpenError}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <button
                        onClick={onToggleTheme}
                        className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors border ${canvasTheme === 'dark'
                            ? 'bg-neutral-900 border-neutral-700 text-yellow-400 hover:bg-neutral-800'
                            : 'bg-white border-neutral-200 text-orange-500 hover:bg-neutral-50 shadow-sm'
                            }`}
                        title={canvasTheme === 'dark' ? "切换浅色模式" : "切换深色模式"}
                        aria-label={canvasTheme === 'dark' ? "切换浅色模式" : "切换深色模式"}
                    >
                        {canvasTheme === 'dark' ? (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
                        ) : (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
                        )}
                    </button>
                </div>
            </div>

            {/* Unsaved Changes Confirmation Modal */}
            {showNewConfirm && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]">
                    <div className="bg-[#1a1a1a] border border-neutral-700 rounded-2xl p-6 w-[400px] shadow-2xl">
                        <h3 className="text-lg font-semibold text-white mb-2">当前内容尚未保存</h3>
                        <p className="text-neutral-400 text-sm mb-6">
                            新建项目会清空当前项目内容，是否先保存？
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setShowNewConfirm(false)}
                                disabled={isSaving}
                                className="px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleDiscardAndNew}
                                disabled={isSaving}
                                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                不保存
                            </button>
                            <button
                                onClick={handleSaveAndNew}
                                disabled={isSaving}
                                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isSaving ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        保存中...
                                    </>
                                ) : (
                                    '保存并新建'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ApiKeySettingsModal
                isOpen={showApiSettings}
                onClose={() => setShowApiSettings(false)}
                canvasTheme={canvasTheme}
            />
            <StartupSetupGuideModal
                isOpen={showSetupGuide}
                onClose={() => setShowSetupGuide(false)}
                onOpenSettings={() => {
                    setShowSetupGuide(false);
                    setShowApiSettings(true);
                }}
                canvasTheme={canvasTheme}
            />
            <TrashModal
                isOpen={showTrash}
                workflowId={workflowId}
                onClose={() => setShowTrash(false)}
                onRestoreNodes={onRestoreNodes}
                canvasTheme={canvasTheme}
            />
            {showAccountSettings && <AccountLicenseSettings onClose={() => setShowAccountSettings(false)} />}
        </>
    );
};
