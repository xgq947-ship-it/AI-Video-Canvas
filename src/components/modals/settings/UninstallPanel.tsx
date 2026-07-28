import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import type { UninstallPlan } from '../../../types/electron';

interface UninstallPanelProps {
    isDark: boolean;
}

export const UninstallPanel: React.FC<UninstallPanelProps> = ({ isDark }) => {
    const [keepUserData, setKeepUserData] = useState(true);
    const [plan, setPlan] = useState<UninstallPlan | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [message, setMessage] = useState('');

    const desktop = typeof window !== 'undefined' ? window.evanDesktop : undefined;

    // 勾选项一变就重算，界面上列出的路径永远和真正会被扔掉的一致。
    useEffect(() => {
        let canceled = false;
        if (!desktop?.uninstall) {
            setPlan({ supported: false, hint: '请在桌面版 Evan 里卸载；浏览器里打开的页面没有可卸载的应用。', targets: [] });
            return;
        }
        void desktop.uninstall.plan(keepUserData).then(result => {
            if (!canceled) setPlan(result);
        });
        return () => { canceled = true; };
    }, [desktop, keepUserData]);

    const handleUninstall = async () => {
        if (!desktop?.uninstall) return;
        setIsRunning(true);
        setMessage('');
        try {
            const result = await desktop.uninstall.run(keepUserData);
            // 成功时应用会直接退出，这里的分支实际只会在取消或失败时跑到。
            if (!result.ok && !result.canceled) setMessage(result.error || '卸载失败');
        } catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
        } finally {
            setIsRunning(false);
        }
    };

    const cardSurface = isDark ? 'border-white/10 bg-white/[0.03]' : 'border-neutral-200 bg-neutral-50';
    const muted = isDark ? 'text-neutral-400' : 'text-neutral-500';

    return (
        <div className="space-y-4">
            <section className={`rounded-2xl border p-5 ${isDark ? 'border-red-500/25 bg-red-500/[0.04]' : 'border-red-200 bg-red-50/60'}`}>
                <div className="mb-1 flex items-center gap-2">
                    <Trash2 size={14} className="text-red-400" />
                    <h3 className="text-sm font-medium">卸载 Evan</h3>
                </div>
                <p className={`mb-4 text-[11px] leading-5 ${muted}`}>
                    从这里直接把 Evan 移到废纸篓。所有东西都是「移到废纸篓」而不是直接删除，清空废纸篓之前都还能拖回来。
                </p>

                <label className={`mb-4 flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${cardSurface}`}>
                    <input
                        type="checkbox"
                        checked={keepUserData}
                        onChange={event => setKeepUserData(event.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
                    />
                    <span>
                        <span className="block text-xs font-medium">保留我的数据</span>
                        <span className={`mt-0.5 block text-[11px] leading-5 ${muted}`}>
                            保留项目素材、生成结果、登录态和配置，重新安装后可以直接接着用。
                            取消勾选则连数据一起移到废纸篓。
                        </span>
                    </span>
                </label>

                {plan && !plan.supported ? (
                    <div className={`flex items-start gap-2 rounded-xl border p-3 text-[11px] leading-5 ${cardSurface} ${muted}`}>
                        <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-400" />
                        <span>{plan.hint}</span>
                    </div>
                ) : (
                    <>
                        <div className={`rounded-xl border p-3 ${cardSurface}`}>
                            <div className={`mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] ${muted}`}>会被移到废纸篓</div>
                            {plan?.targets.length ? (
                                <ul className="space-y-2">
                                    {plan.targets.map(target => (
                                        <li key={target.path}>
                                            <div className="text-[11px] font-medium">{target.label}</div>
                                            <div className={`break-all font-mono text-[10px] ${muted}`}>{target.path}</div>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <div className={`text-[11px] ${muted}`}>正在计算…</div>
                            )}
                        </div>

                        <button
                            type="button"
                            onClick={() => void handleUninstall()}
                            disabled={isRunning || !plan?.targets.length}
                            className="mt-4 flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {isRunning ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                            {keepUserData ? '卸载 Evan（保留数据）' : '卸载 Evan 并删除数据'}
                        </button>
                    </>
                )}

                {message && <p className="mt-3 text-[11px] text-red-400">{message}</p>}
            </section>
        </div>
    );
};
