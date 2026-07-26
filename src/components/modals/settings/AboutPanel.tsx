/**
 * AboutPanel.tsx
 *
 * 「关于」页：版本号 + 检查更新。
 *
 * 平台差异完全由主进程给的 canInstallInApp 决定，这里不自己判断 platform：
 * - Windows：下载 → 安装并重启，全在应用内完成。
 * - macOS：包未签名，Squirrel.Mac 会拒绝安装，所以只提示新版本并跳转下载页。
 */

import React from 'react';
import { ArrowUpCircle, CheckCircle2, Download, ExternalLink, Info, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import type { UpdateState } from '../../../types/electron';

interface AboutPanelProps {
    appVersion: string;
    update: UpdateState;
    isDesktop: boolean;
    isDark: boolean;
    onCheck: () => void;
    onDownload: () => void;
    onInstall: () => void;
    onOpenDownloadPage: () => void;
}

export const AboutPanel: React.FC<AboutPanelProps> = ({
    appVersion,
    update,
    isDesktop,
    isDark,
    onCheck,
    onDownload,
    onInstall,
    onOpenDownloadPage
}) => {
    const cardSurface = isDark ? 'border-white/[0.08] bg-white/[0.03]' : 'border-neutral-200 bg-neutral-50';
    const muted = isDark ? 'text-neutral-400' : 'text-neutral-500';
    const primaryButton = 'flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-950/20 transition-all hover:from-blue-500 hover:to-indigo-400 disabled:cursor-not-allowed disabled:opacity-35';
    const ghostButton = `flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition-colors ${isDark ? 'border-white/10 bg-white/[0.04] text-neutral-300 hover:bg-white/10' : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-100'}`;

    const isBusy = update.status === 'checking' || update.status === 'downloading';

    const statusLine = () => {
        switch (update.status) {
            case 'checking':
                return <span className="flex items-center gap-2 text-blue-400"><Loader2 size={14} className="animate-spin" />正在检查更新…</span>;
            case 'available':
                return <span className="flex items-center gap-2 text-blue-400"><ArrowUpCircle size={14} />发现新版本 v{update.version}</span>;
            case 'downloading':
                return <span className="flex items-center gap-2 text-blue-400"><Loader2 size={14} className="animate-spin" />正在下载 {update.percent}%</span>;
            case 'ready':
                return <span className="flex items-center gap-2 text-emerald-400"><CheckCircle2 size={14} />v{update.version} 已下载，重启即可完成安装</span>;
            case 'current':
                return <span className="flex items-center gap-2 text-emerald-400"><CheckCircle2 size={14} />已是最新版本</span>;
            case 'error':
                return <span className="flex items-center gap-2 text-red-400"><TriangleAlert size={14} />{update.message || '检查更新失败'}</span>;
            case 'unsupported':
                return <span className={muted}>{update.message || '当前环境不支持应用内更新'}</span>;
            default:
                return <span className={muted}>还没有检查过更新</span>;
        }
    };

    const actions = () => {
        // macOS：能查到新版，但装不了，只能引导去下载页。
        if (!update.canInstallInApp) {
            const hasNewVersion = update.status === 'available';
            return (
                <div className="flex flex-wrap gap-2">
                    <button onClick={onCheck} disabled={isBusy || !isDesktop} className={ghostButton}>
                        <RefreshCw size={14} className={update.status === 'checking' ? 'animate-spin' : ''} />
                        检查更新
                    </button>
                    <button onClick={onOpenDownloadPage} className={hasNewVersion ? primaryButton : ghostButton}>
                        <ExternalLink size={14} />
                        {hasNewVersion ? `前往下载 v${update.version}` : '打开下载页'}
                    </button>
                </div>
            );
        }

        // Windows：全流程都在应用内。
        return (
            <div className="flex flex-wrap gap-2">
                {update.status === 'ready' ? (
                    <button onClick={onInstall} className={primaryButton}>
                        <ArrowUpCircle size={14} />
                        重启并安装 v{update.version}
                    </button>
                ) : update.status === 'available' ? (
                    <button onClick={onDownload} className={primaryButton}>
                        <Download size={14} />
                        下载 v{update.version}
                    </button>
                ) : null}
                <button onClick={onCheck} disabled={isBusy} className={ghostButton}>
                    <RefreshCw size={14} className={update.status === 'checking' ? 'animate-spin' : ''} />
                    检查更新
                </button>
            </div>
        );
    };

    return (
        <div>
            <div className="flex items-center gap-2">
                <Info size={18} className="text-blue-400" />
                <h3 className="text-xl font-semibold tracking-tight">关于</h3>
            </div>

            <div className={`mt-6 rounded-2xl border p-6 ${cardSurface}`}>
                <div className="text-lg font-semibold">Evan AI Video Canvas</div>
                <div className={`mt-1 text-sm ${muted}`}>版本 {appVersion}</div>
                <p className={`mt-4 text-sm leading-6 ${muted}`}>
                    本地优先的 AI 图片、视频与漫剧生产桌面应用。画布、项目、素材、浏览器登录资料和本地渲染都保存在你自己的电脑上。
                </p>
            </div>

            <div className={`mt-4 rounded-2xl border p-6 ${cardSurface}`}>
                <div className="flex items-center justify-between gap-3">
                    <h4 className="text-sm font-medium">软件更新</h4>
                    {update.checkedAt && (
                        <span className={`text-[11px] ${muted}`}>
                            上次检查 {new Date(update.checkedAt).toLocaleString('zh-CN', { hour12: false })}
                        </span>
                    )}
                </div>

                <div className="mt-3 text-xs">{statusLine()}</div>

                {update.status === 'downloading' && (
                    <div className={`mt-3 h-1.5 w-full overflow-hidden rounded-full ${isDark ? 'bg-white/10' : 'bg-neutral-200'}`}>
                        <div
                            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-400 transition-[width] duration-300"
                            style={{ width: `${Math.min(100, Math.max(0, update.percent))}%` }}
                        />
                    </div>
                )}

                <div className="mt-5">{actions()}</div>

                {!update.canInstallInApp && isDesktop && (
                    <p className={`mt-4 text-[11px] leading-5 ${muted}`}>
                        macOS 版本暂未做代码签名，系统不允许应用自行替换自己，所以更新需要你手动下载新版安装包覆盖安装。你的项目、素材和登录状态都保存在应用之外，覆盖安装不会丢失。
                    </p>
                )}
            </div>
        </div>
    );
};
