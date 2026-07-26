import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, FolderOpen, Info, KeyRound, Loader2, LogIn, RefreshCw, ShieldCheck, Sparkles, TerminalSquare, Trash2, Wand2, X } from 'lucide-react';
import { notifyCodexStatusChanged } from '../../hooks/useCodexService';
import { useAppUpdates } from '../../hooks/useAppUpdates';
import { AboutPanel } from './settings/AboutPanel';
import { WhatsNewPanel } from './settings/WhatsNewPanel';

type SettingsPage = 'connections' | 'whatsNew' | 'about';

const SETTINGS_PAGES = [
    { id: 'connections' as const, label: 'AI 服务与密钥', icon: KeyRound },
    { id: 'whatsNew' as const, label: '新功能', icon: Sparkles },
    { id: 'about' as const, label: '关于', icon: Info }
];

interface ApiKeyField {
    name: string;
    provider: string;
    label: string;
    secret: boolean;
    configured: boolean;
    source: 'manual' | 'environment' | 'none';
    maskedValue: string;
}

interface OptimizerProvider {
    id: string;
    label: string;
    apiKeyField: string | null;
    defaultModel: string;
    defaultEffort: string;
    keyConfigured: boolean;
    available?: boolean;
    unavailableHint?: string;
}

interface CodexStatus {
    available: boolean;
    authenticated: boolean;
    configuredPath: string;
    resolvedPath: string;
    version: string;
    codexHome: string;
    skillInstalled: boolean;
    queueBridgeReady: boolean;
    error: string;
    login: {
        running: boolean;
        startedAt: string | null;
        lastError: string | null;
    };
}

interface ApiKeySettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    canvasTheme: 'dark' | 'light';
}

export const ApiKeySettingsModal: React.FC<ApiKeySettingsModalProps> = ({ isOpen, onClose, canvasTheme }) => {
    const [activePage, setActivePage] = useState<SettingsPage>('connections');
    const {
        appVersion,
        update,
        hasPendingUpdate,
        changelog,
        isDesktop,
        check: checkForUpdates,
        download: downloadUpdate,
        install: installUpdate,
        openDownloadPage
    } = useAppUpdates();
    const [fields, setFields] = useState<ApiKeyField[]>([]);
    const [values, setValues] = useState<Record<string, string>>({});
    const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set());
    const [clearFields, setClearFields] = useState<Set<string>>(new Set());
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    const [optimizerProviders, setOptimizerProviders] = useState<OptimizerProvider[]>([]);
    const [optimizerProvider, setOptimizerProvider] = useState('deepseek');
    // 模型覆盖按后端各自记忆：{ 后端id: 模型字符串 }
    const [optimizerModels, setOptimizerModels] = useState<Record<string, string>>({});
    const [initialOptimizer, setInitialOptimizer] = useState<{ provider: string; models: Record<string, string> }>({ provider: 'deepseek', models: {} });
    const [codexStatus, setCodexStatus] = useState<CodexStatus | null>(null);
    const [isCodexBusy, setIsCodexBusy] = useState(false);

    const applyCodexStatus = (status: CodexStatus) => {
        setCodexStatus(status);
        notifyCodexStatusChanged();
    };

    const loadCodexStatus = async (refresh = false) => {
        const response = await fetch(`/api/settings/codex${refresh ? '?refresh=1' : ''}`, {
            cache: 'no-store'
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '读取 Codex 状态失败');
        applyCodexStatus(result);
        return result as CodexStatus;
    };

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        setIsLoading(true);
        setError('');
        setSaved(false);
        setValues({});
        setClearFields(new Set());

        Promise.all([
            fetch('/api/settings/api-keys').then(async response => {
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || '读取 API 配置失败');
                if (!cancelled) setFields(result.fields || []);
            }),
            fetch('/api/settings/optimizer').then(async response => {
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || '读取优化后端配置失败');
                if (!cancelled) {
                    setOptimizerProviders(result.providers || []);
                    const current = result.current || { provider: 'deepseek', models: {} };
                    const models = current.models || {};
                    setOptimizerProvider(current.provider);
                    setOptimizerModels(models);
                    setInitialOptimizer({ provider: current.provider, models });
                }
            }),
            loadCodexStatus()
        ])
            .catch(fetchError => {
                if (!cancelled) setError(fetchError.message || '读取配置失败');
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => { cancelled = true; };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen || !codexStatus?.login?.running) return;
        const timer = window.setInterval(() => {
            loadCodexStatus(true).catch(fetchError => {
                setError(fetchError.message || '刷新 Codex 登录状态失败');
            });
        }, 2_000);
        return () => window.clearInterval(timer);
    }, [isOpen, codexStatus?.login?.running]);

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    const groups = useMemo(() => {
        const grouped = new Map<string, ApiKeyField[]>();
        fields.forEach(field => {
            const current = grouped.get(field.provider) || [];
            current.push(field);
            grouped.set(field.provider, current);
        });
        return Array.from(grouped.entries());
    }, [fields]);

    // 当前后端的模型覆盖值（各后端独立记忆，切换后端时自动显示各自的值）
    const optimizerModel = optimizerModels[optimizerProvider] || '';
    const apiKeyDirty = Object.values(values).some(value => value.trim()) || clearFields.size > 0;
    const optimizerDirty = optimizerProvider !== initialOptimizer.provider
        || optimizerModel.trim() !== (initialOptimizer.models[optimizerProvider] || '');
    const hasChanges = apiKeyDirty || optimizerDirty;
    const selectedOptimizer = optimizerProviders.find(provider => provider.id === optimizerProvider);
    const isDark = canvasTheme === 'dark';
    const configuredKeyCount = fields.filter(field => field.configured).length;
    const sectionSurface = isDark
        ? 'border-white/[0.08] bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]'
        : 'border-neutral-200 bg-neutral-50/80 shadow-sm';

    const handleValueChange = (name: string, value: string) => {
        setValues(current => ({ ...current, [name]: value }));
        setClearFields(current => {
            const next = new Set(current);
            next.delete(name);
            return next;
        });
        setSaved(false);
    };

    const toggleClear = (name: string) => {
        setClearFields(current => {
            const next = new Set(current);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
        });
        setValues(current => ({ ...current, [name]: '' }));
        setSaved(false);
    };

    const handleSave = async () => {
        if (!hasChanges || isSaving) return;
        setIsSaving(true);
        setError('');
        setSaved(false);

        try {
            if (apiKeyDirty) {
                const changedValues = Object.fromEntries(
                    Object.entries(values).filter(([, value]) => value.trim())
                );
                const response = await fetch('/api/settings/api-keys', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ values: changedValues, clear: Array.from(clearFields) })
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'API 密钥保存失败');
                setFields(result.fields || []);
                setValues({});
                setClearFields(new Set());
            }

            if (optimizerDirty) {
                const response = await fetch('/api/settings/optimizer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ provider: optimizerProvider, model: optimizerModel.trim() })
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || '优化后端保存失败');
                const current = result.current || { provider: optimizerProvider, models: optimizerModels };
                const models = current.models || {};
                setOptimizerProvider(current.provider);
                setOptimizerModels(models);
                setInitialOptimizer({ provider: current.provider, models });
            }

            setSaved(true);
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : '保存失败');
        } finally {
            setIsSaving(false);
        }
    };

    const saveCodexPath = async (cliPath: string) => {
        setIsCodexBusy(true);
        setError('');
        try {
            const response = await fetch('/api/settings/codex', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cliPath })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || '保存 Codex 路径失败');
            applyCodexStatus(result);
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : '保存 Codex 路径失败');
        } finally {
            setIsCodexBusy(false);
        }
    };

    const handleSelectCodex = async () => {
        if (!window.evanDesktop?.selectCodexCli) {
            setError('当前不是桌面应用，无法打开 Codex 文件选择器');
            return;
        }
        const selected = await window.evanDesktop.selectCodexCli();
        if ('path' in selected) await saveCodexPath(selected.path);
    };

    const handleCodexLogin = async () => {
        setIsCodexBusy(true);
        setError('');
        try {
            const response = await fetch('/api/settings/codex/login', { method: 'POST' });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || '启动 Codex 登录失败');
            applyCodexStatus(result);
        } catch (loginError) {
            setError(loginError instanceof Error ? loginError.message : '启动 Codex 登录失败');
        } finally {
            setIsCodexBusy(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 px-5 py-6 backdrop-blur-xl"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div className={`relative flex max-h-[90vh] w-full max-w-[1040px] flex-col overflow-hidden rounded-[28px] border shadow-[0_40px_120px_rgba(0,0,0,0.65)] ${isDark ? 'border-white/10 bg-[#111318] text-white' : 'border-neutral-200 bg-white text-neutral-900'}`}>
                <div className="pointer-events-none absolute -left-24 -top-28 h-72 w-72 rounded-full bg-blue-500/20 blur-[90px]" />
                <div className="pointer-events-none absolute right-0 top-0 h-64 w-64 rounded-full bg-violet-500/15 blur-[100px]" />
                <div className={`relative flex shrink-0 items-start justify-between border-b px-8 py-7 ${isDark ? 'border-white/[0.08]' : 'border-neutral-200'}`}>
                    <div className="flex items-start gap-4">
                        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${isDark ? 'border-blue-400/20 bg-gradient-to-br from-blue-500/25 to-violet-500/20 text-blue-300' : 'border-blue-100 bg-gradient-to-br from-blue-50 to-violet-50 text-blue-600'}`}>
                            <KeyRound size={22} />
                        </div>
                        <div>
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-blue-400/20 bg-blue-400/10 px-2.5 py-1 text-[10px] font-bold tracking-[0.16em] text-blue-400">SETTINGS</span>
                                <span className={`text-[11px] ${isDark ? 'text-neutral-500' : 'text-neutral-500'}`}>v{appVersion}</span>
                            </div>
                            <h2 className="text-2xl font-semibold tracking-tight">设置</h2>
                            <p className={`mt-1.5 text-xs leading-5 ${isDark ? 'text-neutral-400' : 'text-neutral-500'}`}>
                                {activePage === 'connections'
                                    ? '统一管理 Codex、提示词后端和云端 API；密钥不会写入项目文件。'
                                    : activePage === 'whatsNew'
                                        ? '每次更新带来的新增、改进与修复。'
                                        : '版本信息与软件更新。'}
                            </p>
                            {activePage === 'connections' && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <span className={`rounded-full border px-2.5 py-1 text-[10px] ${codexStatus?.authenticated ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-400' : 'border-white/10 text-neutral-500'}`}>
                                        Codex {codexStatus?.authenticated ? '已连接' : '未连接'}
                                    </span>
                                    <span className={`rounded-full border px-2.5 py-1 text-[10px] ${configuredKeyCount ? 'border-blue-400/25 bg-blue-400/10 text-blue-400' : 'border-white/10 text-neutral-500'}`}>
                                        {configuredKeyCount} 项 API 密钥已配置
                                    </span>
                                    {hasPendingUpdate && (
                                        <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-[10px] text-amber-400">
                                            有新版本 v{update.version}
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                    <button onClick={onClose} className={`rounded-xl border p-2.5 transition-colors ${isDark ? 'border-white/10 text-neutral-500 hover:bg-white/10 hover:text-white' : 'border-neutral-200 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900'}`} aria-label="关闭 API 配置">
                        <X size={18} />
                    </button>
                </div>

                <div className="relative flex min-h-0 flex-1">
                    {/* 左侧分栏导航 */}
                    <nav className={`hidden w-52 shrink-0 overflow-y-auto border-r px-3 py-5 sm:block ${isDark ? 'border-white/[0.08]' : 'border-neutral-200'}`}>
                        {SETTINGS_PAGES.map(page => {
                            const Icon = page.icon;
                            const isActive = activePage === page.id;
                            return (
                                <button
                                    key={page.id}
                                    type="button"
                                    onClick={() => setActivePage(page.id)}
                                    aria-current={isActive ? 'page' : undefined}
                                    className={`mb-1 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${isActive
                                        ? 'bg-blue-600 font-medium text-white'
                                        : isDark
                                            ? 'text-neutral-300 hover:bg-white/[0.06]'
                                            : 'text-neutral-700 hover:bg-neutral-100'
                                        }`}
                                >
                                    <Icon size={16} className="shrink-0" />
                                    <span className="flex-1 truncate">{page.label}</span>
                                    {page.id === 'about' && hasPendingUpdate && (
                                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? 'bg-white' : 'bg-amber-400'}`} />
                                    )}
                                </button>
                            );
                        })}
                    </nav>

                    {/* 小屏退化成横向标签，避免侧栏挤掉内容 */}
                    <div className="flex min-w-0 flex-1 flex-col">
                        <div className={`flex shrink-0 gap-1 overflow-x-auto border-b px-4 py-2 sm:hidden ${isDark ? 'border-white/[0.08]' : 'border-neutral-200'}`}>
                            {SETTINGS_PAGES.map(page => (
                                <button
                                    key={page.id}
                                    type="button"
                                    onClick={() => setActivePage(page.id)}
                                    className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs transition-colors ${activePage === page.id
                                        ? 'bg-blue-600 font-medium text-white'
                                        : isDark ? 'text-neutral-400' : 'text-neutral-600'
                                        }`}
                                >
                                    {page.label}
                                </button>
                            ))}
                        </div>

                        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
                {activePage === 'whatsNew' ? (
                    <WhatsNewPanel entries={changelog} appVersion={appVersion} isDark={isDark} />
                ) : activePage === 'about' ? (
                    <AboutPanel
                        appVersion={appVersion}
                        update={update}
                        isDesktop={isDesktop}
                        isDark={isDark}
                        onCheck={checkForUpdates}
                        onDownload={downloadUpdate}
                        onInstall={installUpdate}
                        onOpenDownloadPage={openDownloadPage}
                    />
                ) : isLoading ? (
                        <div className="flex h-48 items-center justify-center gap-2 text-sm text-neutral-500"><Loader2 size={18} className="animate-spin" />正在读取配置</div>
                    ) : (
                        <div className="space-y-4">
                            <section className={`rounded-2xl border p-5 transition-colors ${sectionSurface}`}>
                                <div className="mb-1 flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2">
                                        <TerminalSquare size={14} className={isDark ? 'text-blue-400' : 'text-blue-600'} />
                                        <h3 className="text-sm font-medium">Codex 服务</h3>
                                    </div>
                                    <span className={`text-[11px] ${codexStatus?.authenticated
                                        ? 'text-emerald-400'
                                        : codexStatus?.available
                                            ? 'text-amber-400'
                                            : 'text-neutral-500'
                                        }`}>
                                        {codexStatus?.authenticated
                                            ? '已连接'
                                            : codexStatus?.available
                                                ? (codexStatus.login?.running ? '等待登录' : '需要登录')
                                                : '未检测到'}
                                    </span>
                                </div>
                                <p className={`mb-3 text-[11px] ${isDark ? 'text-neutral-400' : 'text-neutral-500'}`}>
                                    Evan 使用电脑上持续更新的 Codex CLI，不内置固定版本。登录资料和项目 Skill 保存在 Evan 专用目录。
                                </p>
                                <div className={`rounded-xl border px-4 py-3 text-[11px] ${isDark ? 'border-white/[0.08] bg-black/20' : 'border-neutral-200 bg-white'}`}>
                                    <div className="truncate" title={codexStatus?.resolvedPath || ''}>
                                        路径：{codexStatus?.resolvedPath || '正在检测…'}
                                    </div>
                                    {codexStatus?.version && <div className="mt-1 truncate text-neutral-500">版本：{codexStatus.version}</div>}
                                    {codexStatus?.error && !codexStatus.authenticated && (
                                        <div className="mt-1 text-amber-400">{codexStatus.login?.lastError || codexStatus.error}</div>
                                    )}
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={handleSelectCodex}
                                        disabled={isCodexBusy}
                                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors ${isDark ? 'border-neutral-700 hover:bg-neutral-700' : 'border-neutral-300 hover:bg-neutral-100'}`}
                                    >
                                        <FolderOpen size={13} />选择 Codex
                                    </button>
                                    {codexStatus?.configuredPath && (
                                        <button
                                            type="button"
                                            onClick={() => saveCodexPath('')}
                                            disabled={isCodexBusy}
                                            className={`rounded-lg border px-3 py-2 text-xs transition-colors ${isDark ? 'border-neutral-700 hover:bg-neutral-700' : 'border-neutral-300 hover:bg-neutral-100'}`}
                                        >
                                            恢复自动检测
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => loadCodexStatus(true).catch(refreshError => setError(refreshError.message))}
                                        disabled={isCodexBusy}
                                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors ${isDark ? 'border-neutral-700 hover:bg-neutral-700' : 'border-neutral-300 hover:bg-neutral-100'}`}
                                    >
                                        <RefreshCw size={13} />刷新
                                    </button>
                                    {codexStatus?.available && !codexStatus.authenticated && (
                                        <button
                                            type="button"
                                            onClick={handleCodexLogin}
                                            disabled={isCodexBusy || codexStatus.login?.running}
                                            className="flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-2 text-xs text-white transition-colors hover:bg-blue-400 disabled:opacity-50"
                                        >
                                            {codexStatus.login?.running ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />}
                                            {codexStatus.login?.running ? '请在浏览器完成登录' : '登录 ChatGPT'}
                                        </button>
                                    )}
                                </div>
                            </section>

                            {/* 提示词优化后端选择 */}
                            <section className={`rounded-2xl border p-5 transition-colors ${sectionSurface}`}>
                                <div className="mb-1 flex items-center gap-2">
                                    <Wand2 size={14} className={isDark ? 'text-purple-400' : 'text-purple-600'} />
                                    <h3 className="text-sm font-medium">提示词优化后端</h3>
                                </div>
                                <p className={`mb-3 text-[11px] ${isDark ? 'text-neutral-400' : 'text-neutral-500'}`}>
                                    图片 / 视频节点“优化提示词”用哪个模型生成。CLI 后端用本机已登录的工具、无需密钥，但速度慢于云端 API。
                                </p>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label htmlFor="optimizer-provider" className={`mb-1.5 block text-xs ${isDark ? 'text-neutral-300' : 'text-neutral-600'}`}>后端</label>
                                        <select
                                            id="optimizer-provider"
                                            value={optimizerProvider}
                                            onChange={event => { setOptimizerProvider(event.target.value); setSaved(false); }}
                                            className={`h-11 w-full rounded-xl border bg-transparent px-3 text-sm outline-none transition-colors ${isDark ? 'border-white/10 text-white focus:border-blue-500 focus:bg-white/[0.03]' : 'border-neutral-300 text-neutral-900 focus:border-blue-500'}`}
                                        >
                                            {optimizerProviders.map(provider => (
                                                <option
                                                    key={provider.id}
                                                    value={provider.id}
                                                    disabled={provider.available === false && provider.id !== optimizerProvider}
                                                    className={isDark ? 'bg-[#202020]' : ''}
                                                >
                                                    {provider.label}{provider.available === false ? '（未连接）' : ''}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label htmlFor="optimizer-model" className={`mb-1.5 block text-xs ${isDark ? 'text-neutral-300' : 'text-neutral-600'}`}>模型（可选）</label>
                                        <input
                                            id="optimizer-model"
                                            type="text"
                                            value={optimizerModel}
                                            onChange={event => {
                                                const next = event.target.value;
                                                setOptimizerModels(current => ({ ...current, [optimizerProvider]: next }));
                                                setSaved(false);
                                            }}
                                            autoComplete="off"
                                            spellCheck={false}
                                            placeholder={selectedOptimizer?.defaultModel ? `默认：${selectedOptimizer.defaultModel}` : '留空用后端默认'}
                                            className={`h-11 w-full rounded-xl border bg-transparent px-3 text-sm outline-none transition-colors ${isDark ? 'border-white/10 text-white placeholder-neutral-600 focus:border-blue-500 focus:bg-white/[0.03]' : 'border-neutral-300 text-neutral-900 placeholder-neutral-400 focus:border-blue-500'}`}
                                        />
                                    </div>
                                </div>
                                {selectedOptimizer?.defaultEffort && (
                                    <p className={`mt-2 text-[11px] ${isDark ? 'text-neutral-500' : 'text-neutral-500'}`}>推理强度：{selectedOptimizer.defaultEffort}（该后端固定）</p>
                                )}
                                {selectedOptimizer && !selectedOptimizer.keyConfigured && (
                                    <p className="mt-2 text-[11px] text-amber-400">该后端需要在下方填写 {selectedOptimizer.apiKeyField} 才能使用。</p>
                                )}
                                {selectedOptimizer?.available === false && (
                                    <p className="mt-2 text-[11px] text-amber-400">{selectedOptimizer.unavailableHint || '该 CLI 后端尚未连接。'}</p>
                                )}
                            </section>

                            {groups.map(([provider, providerFields]) => (
                                <section key={provider} className={`rounded-2xl border p-5 transition-colors ${sectionSurface}`}>
                                    <div className="mb-3 flex items-center justify-between">
                                        <h3 className="text-sm font-medium">{provider}</h3>
                                        {providerFields.every(field => field.configured) && (
                                            <span className="flex items-center gap-1 text-[11px] text-emerald-400"><CheckCircle2 size={12} />已配置</span>
                                        )}
                                    </div>
                                    <div className="space-y-3">
                                        {providerFields.map(field => {
                                            const markedForClear = clearFields.has(field.name);
                                            return (
                                                <div key={field.name}>
                                                    <div className="mb-1.5 flex items-center justify-between gap-3">
                                                        <label htmlFor={`api-key-${field.name}`} className={`text-xs ${isDark ? 'text-neutral-300' : 'text-neutral-600'}`}>{field.label}</label>
                                                        <div className="flex items-center gap-2">
                                                            {field.configured && !markedForClear && (
                                                                <span className={`text-[10px] ${field.source === 'manual' ? 'text-blue-400' : 'text-neutral-500'}`}>{field.source === 'manual' ? '手动配置' : '.env 配置'} · {field.maskedValue}</span>
                                                            )}
                                                            {field.source === 'manual' && (
                                                                <button type="button" onClick={() => toggleClear(field.name)} className={`rounded p-1 transition-colors ${markedForClear ? 'bg-red-500/15 text-red-400' : 'text-neutral-500 hover:bg-neutral-700 hover:text-red-400'}`} title={markedForClear ? '取消清除' : '清除手动配置'}>
                                                                    <Trash2 size={13} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="relative">
                                                        <input
                                                            id={`api-key-${field.name}`}
                                                            type={field.secret && !visibleFields.has(field.name) ? 'password' : 'text'}
                                                            value={values[field.name] || ''}
                                                            onChange={event => handleValueChange(field.name, event.target.value)}
                                                            disabled={markedForClear}
                                                            autoComplete="off"
                                                            spellCheck={false}
                                                            placeholder={markedForClear ? '保存后清除手动配置' : field.configured ? '输入新值以替换当前配置' : '请输入密钥'}
                                                            className={`h-11 w-full rounded-xl border bg-transparent px-3 pr-10 text-sm outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${isDark ? 'border-white/10 text-white placeholder-neutral-600 focus:border-blue-500 focus:bg-white/[0.03]' : 'border-neutral-300 text-neutral-900 placeholder-neutral-400 focus:border-blue-500'}`}
                                                        />
                                                        {field.secret && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setVisibleFields(current => {
                                                                    const next = new Set(current);
                                                                    if (next.has(field.name)) next.delete(field.name);
                                                                    else next.add(field.name);
                                                                    return next;
                                                                })}
                                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
                                                                aria-label={visibleFields.has(field.name) ? '隐藏密钥' : '显示密钥'}
                                                            >
                                                                {visibleFields.has(field.name) ? <EyeOff size={15} /> : <Eye size={15} />}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </section>
                            ))}
                        </div>
                    )}
                        </div>
                    </div>
                </div>

                <div className={`relative flex shrink-0 items-center justify-between border-t px-8 py-4 backdrop-blur-xl ${isDark ? 'border-white/[0.08] bg-[#111318]/95' : 'border-neutral-200 bg-neutral-50/95'}`}>
                    <div className="min-h-5 text-xs">
                        {error && <span className="text-red-400">{error}</span>}
                        {saved && <span className="flex items-center gap-1 text-emerald-400"><ShieldCheck size={14} />已保存并立即生效</span>}
                    </div>
                    <div className="flex gap-2">
                        <button onClick={onClose} className={`rounded-xl border px-4 py-2.5 text-sm transition-colors ${isDark ? 'border-white/10 bg-white/[0.04] text-neutral-300 hover:bg-white/10' : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-100'}`}>关闭</button>
                        {/* 只有密钥页有可保存的内容；「新功能」「关于」是只读页面。 */}
                        {activePage === 'connections' && (
                            <button onClick={handleSave} disabled={!hasChanges || isSaving} className="flex min-w-28 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-950/20 transition-all hover:from-blue-500 hover:to-indigo-400 disabled:cursor-not-allowed disabled:opacity-35">
                                {isSaving && <Loader2 size={14} className="animate-spin" />}
                                {isSaving ? '保存中' : '保存修改'}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
