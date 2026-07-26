/**
 * WhatsNewPanel.tsx
 *
 * 「新功能」页：展示当前版本的更新说明，以及历史版本。
 * 数据来自仓库根目录的 CHANGELOG.json，随包一起发布，不联网也能看。
 */

import React from 'react';
import { CheckCircle2, Plus, Sparkles, TrendingUp } from 'lucide-react';
import type { ChangelogEntry } from '../../../hooks/useAppUpdates';

interface WhatsNewPanelProps {
    entries: ChangelogEntry[];
    appVersion: string;
    isDark: boolean;
}

const GROUPS = [
    { key: 'added', label: '新增', icon: Plus, tone: 'text-blue-400' },
    { key: 'improved', label: '改进', icon: TrendingUp, tone: 'text-violet-400' },
    { key: 'fixed', label: '修复', icon: CheckCircle2, tone: 'text-emerald-400' }
] as const;

const EntryBody: React.FC<{ entry: ChangelogEntry; isDark: boolean }> = ({ entry, isDark }) => (
    <>
        {entry.summary && (
            <p className={`text-sm leading-6 ${isDark ? 'text-neutral-300' : 'text-neutral-700'}`}>
                {entry.summary}
            </p>
        )}
        {GROUPS.map(group => {
            const items = entry[group.key];
            if (!items || items.length === 0) return null;
            const Icon = group.icon;
            return (
                <div key={group.key} className="mt-5">
                    <div className={`mb-2.5 text-[11px] font-bold tracking-[0.16em] ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                        {group.label}
                    </div>
                    <ul className="space-y-2.5">
                        {items.map((item, index) => (
                            <li key={index} className="flex gap-2.5">
                                <Icon size={15} className={`mt-0.5 shrink-0 ${group.tone}`} />
                                <span className={`text-sm leading-6 ${isDark ? 'text-neutral-300' : 'text-neutral-700'}`}>
                                    {item}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            );
        })}
    </>
);

export const WhatsNewPanel: React.FC<WhatsNewPanelProps> = ({ entries, appVersion, isDark }) => {
    if (entries.length === 0) {
        return <p className={`text-sm ${isDark ? 'text-neutral-400' : 'text-neutral-500'}`}>暂无更新记录。</p>;
    }

    // 优先显示与当前版本号匹配的条目；对不上（比如本地开发版）就显示最新一条。
    const current = entries.find(entry => entry.version === appVersion) || entries[0];
    const history = entries.filter(entry => entry !== current);
    const cardSurface = isDark ? 'border-white/[0.08] bg-white/[0.03]' : 'border-neutral-200 bg-neutral-50';

    return (
        <div>
            <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-blue-400" />
                <h3 className="text-xl font-semibold tracking-tight">此版本的新功能</h3>
            </div>
            <div className={`mt-1.5 text-xs ${isDark ? 'text-neutral-500' : 'text-neutral-500'}`}>
                v{current.version} · {current.date}
            </div>

            <div className="mt-6">
                <EntryBody entry={current} isDark={isDark} />
            </div>

            {history.length > 0 && (
                <div className="mt-10">
                    <div className={`mb-4 text-[11px] font-bold tracking-[0.16em] ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                        历史版本
                    </div>
                    <div className="space-y-4">
                        {history.map(entry => (
                            <details key={entry.version} className={`rounded-2xl border p-5 ${cardSurface}`}>
                                <summary className="cursor-pointer list-none text-sm font-medium">
                                    v{entry.version}
                                    <span className={`ml-2 text-xs font-normal ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                                        {entry.date}
                                    </span>
                                </summary>
                                <div className="mt-4">
                                    <EntryBody entry={entry} isDark={isDark} />
                                </div>
                            </details>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
