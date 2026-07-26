import React, { useEffect, useMemo, useState } from 'react';
import {
    ArrowRight,
    Bot,
    Check,
    CheckCircle2,
    ExternalLink,
    KeyRound,
    Loader2,
    LogIn,
    RefreshCw,
    ShieldCheck,
    Sparkles,
    X
} from 'lucide-react';

const DEEPSEEK_API_KEYS_URL = 'https://platform.deepseek.com/api_keys';
const JIMENG_LOGIN_URL = 'https://jimeng.jianying.com/ai-tool/generate?type=image';
const FLOW_LOGIN_URL = 'https://labs.google/fx/tools/flow';

type BrowserProvider = 'jimeng' | 'google-flow';
type Theme = 'dark' | 'light';

interface BrowserSession {
    state?: string;
    message?: string;
}

interface GuideStatus {
    sessions: Partial<Record<BrowserProvider, BrowserSession>>;
    deepseekConfigured: boolean;
    codexAvailable: boolean;
    codexAuthenticated: boolean;
}

interface StartupSetupGuideModalProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenSettings: () => void;
    canvasTheme: Theme;
}

const EMPTY_STATUS: GuideStatus = {
    sessions: {},
    deepseekConfigured: false,
    codexAvailable: false,
    codexAuthenticated: false
};

function StatusBadge({ complete, label }: { complete: boolean; label: string }) {
    return (
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${
            complete
                ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-400'
                : 'border-amber-400/25 bg-amber-400/10 text-amber-400'
        }`}>
            {complete ? <CheckCircle2 size={11} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
            {label}
        </span>
    );
}

function sessionLabel(session?: BrowserSession) {
    if (session?.state === 'authenticated') return '已验证';
    if (session?.state === 'expired') return '未登录';
    if (session?.state === 'checking' || session?.state === 'reauthenticating') return '检查中';
    return session?.message ? '无法确认' : '待验证';
}

function friendlyBrowserError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || '');
    if (message.includes('Browser.setDownloadBehavior') || message.includes('connect_over_cdp')) {
        return 'Evan 专属 Chrome 连接没有准备好，正在重新初始化。请关闭该窗口后再点一次。';
    }
    return message || '登录页面打开失败';
}

export const StartupSetupGuideModal: React.FC<StartupSetupGuideModalProps> = ({
    isOpen,
    onClose,
    onOpenSettings,
    canvasTheme
}) => {
    const [status, setStatus] = useState<GuideStatus>(EMPTY_STATUS);
    const [isLoading, setIsLoading] = useState(false);
    const [busyProvider, setBusyProvider] = useState<BrowserProvider | null>(null);
    const [busyAction, setBusyAction] = useState<'open' | 'check' | null>(null);
    const [message, setMessage] = useState('');
    const isDark = canvasTheme === 'dark';

    const loadStatus = async (verifyBrowsers = false) => {
        setIsLoading(true);
        setMessage('');
        let probeError = '';
        try {
            if (verifyBrowsers) {
                setStatus(previous => ({
                    ...previous,
                    sessions: {
                        jimeng: { state: 'checking' },
                        'google-flow': { state: 'checking' }
                    }
                }));
                const probeResponse = await fetch('/api/browser-sessions/check', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ providers: ['jimeng', 'google-flow'] })
                });
                const probe = await probeResponse.json().catch(() => ({}));
                if (!probeResponse.ok) probeError = probe.error || '浏览器登录状态检查失败';
            }
            const [capabilitiesResponse, keysResponse, codexResponse] = await Promise.all([
                fetch('/api/capabilities', { cache: 'no-store' }),
                fetch('/api/settings/api-keys', { cache: 'no-store' }),
                fetch('/api/settings/codex', { cache: 'no-store' })
            ]);
            const [capabilities, keys, codex] = await Promise.all([
                capabilitiesResponse.json(),
                keysResponse.json(),
                codexResponse.json()
            ]);
            if (!capabilitiesResponse.ok || !keysResponse.ok || !codexResponse.ok) {
                throw new Error('部分配置状态读取失败');
            }
            const deepseekField = (keys.fields || []).find((field: { name?: string }) => field.name === 'DEEPSEEK_API_KEY');
            setStatus({
                sessions: capabilities.browserModels?.sessions || {},
                deepseekConfigured: Boolean(deepseekField?.configured),
                codexAvailable: Boolean(codex.available),
                codexAuthenticated: Boolean(codex.authenticated)
            });
            if (probeError) setMessage(probeError);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : '配置状态读取失败');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (!isOpen) return;
        void loadStatus(true);
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    const completedCount = useMemo(() => [
        status.sessions.jimeng?.state === 'authenticated',
        status.sessions['google-flow']?.state === 'authenticated',
        status.deepseekConfigured || status.codexAuthenticated
    ].filter(Boolean).length, [status]);

    const openProviderLogin = async (provider: BrowserProvider) => {
        if (busyProvider) return;
        setBusyProvider(provider);
        setBusyAction('open');
        setMessage('');
        try {
            const response = await fetch(`/api/browser-sessions/${provider}/reauthenticate`, { method: 'POST' });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || '登录页面打开失败');
            await loadStatus();
            setMessage('登录页已打开。完成登录后，请点击“检查登录状态”。');
        } catch (error) {
            setMessage(friendlyBrowserError(error));
        } finally {
            setBusyProvider(null);
            setBusyAction(null);
        }
    };

    const checkProviderLogin = async (provider: BrowserProvider) => {
        if (busyProvider) return;
        setBusyProvider(provider);
        setBusyAction('check');
        setMessage('');
        try {
            const response = await fetch('/api/browser-sessions/check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ providers: [provider] })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || '登录状态检查失败');
            await loadStatus();
            const session = result.sessions?.[provider];
            setMessage(session?.state === 'authenticated'
                ? (session.message || '已确认登录')
                : (session?.message || '没有获得真实登录证据，当前不会显示“已验证”'));
        } catch (error) {
            setMessage(friendlyBrowserError(error));
        } finally {
            setBusyProvider(null);
            setBusyAction(null);
        }
    };

    const openDeepSeek = async () => {
        try {
            if (!window.evanDesktop?.openExternal) throw new Error('请在桌面应用中打开此链接');
            await window.evanDesktop.openExternal(DEEPSEEK_API_KEYS_URL);
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'DeepSeek 网站打开失败');
        }
    };

    if (!isOpen) return null;

    const panel = isDark
        ? 'border-white/10 bg-[#111318] text-white'
        : 'border-neutral-200 bg-white text-neutral-950';
    const card = isDark
        ? 'border-white/[0.08] bg-white/[0.035] hover:border-white/15'
        : 'border-neutral-200 bg-neutral-50 hover:border-neutral-300';
    const muted = isDark ? 'text-neutral-400' : 'text-neutral-500';

    return (
        <div
            className="fixed inset-0 z-[140] flex items-center justify-center bg-black/75 px-5 py-6 backdrop-blur-xl"
            onMouseDown={event => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div className={`relative max-h-[92vh] w-full max-w-[980px] overflow-hidden rounded-[28px] border shadow-[0_40px_120px_rgba(0,0,0,0.65)] ${panel}`}>
                <div className="pointer-events-none absolute -left-24 -top-28 h-80 w-80 rounded-full bg-blue-500/20 blur-[90px]" />
                <div className="pointer-events-none absolute right-0 top-12 h-72 w-72 rounded-full bg-violet-500/15 blur-[100px]" />

                <div className="relative max-h-[92vh] overflow-y-auto">
                    <header className={`border-b px-7 pb-6 pt-7 md:px-9 ${isDark ? 'border-white/[0.08]' : 'border-neutral-200'}`}>
                        <div className="flex items-start justify-between gap-5">
                            <div className="flex min-w-0 items-start gap-4">
                                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-blue-400/20 bg-gradient-to-br from-blue-500/25 to-violet-500/20 text-blue-300 shadow-lg shadow-blue-950/30">
                                    <Sparkles size={23} />
                                </div>
                                <div>
                                    <div className="mb-2 flex flex-wrap items-center gap-2">
                                        <span className="rounded-full border border-blue-400/20 bg-blue-400/10 px-2.5 py-1 text-[10px] font-bold tracking-[0.18em] text-blue-400">START HERE</span>
                                        <span className={`text-xs ${muted}`}>启动前 1 分钟配置</span>
                                    </div>
                                    <h2 className="text-2xl font-semibold tracking-tight md:text-[28px]">连接你的 AI 创作服务</h2>
                                    <p className={`mt-2 max-w-2xl text-sm leading-6 ${muted}`}>
                                        即梦和 Google Flow 需要在 Evan 专属 Chrome 登录；提示词优化可选择 DeepSeek API Key，或连接已登录 ChatGPT 的 Codex。
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                className={`shrink-0 rounded-xl border p-2.5 transition-colors ${isDark ? 'border-white/10 text-neutral-400 hover:bg-white/10 hover:text-white' : 'border-neutral-200 text-neutral-500 hover:bg-neutral-100'}`}
                                aria-label="关闭启动配置指南"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="mt-5 flex items-center gap-3">
                            <div className={`h-1.5 flex-1 overflow-hidden rounded-full ${isDark ? 'bg-white/10' : 'bg-neutral-200'}`}>
                                <div className="h-full rounded-full bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400 transition-all" style={{ width: `${completedCount / 3 * 100}%` }} />
                            </div>
                            <span className={`whitespace-nowrap text-xs font-medium ${muted}`}>{completedCount} / 3 已就绪</span>
                        </div>
                    </header>

                    <main className="relative px-7 py-6 md:px-9">
                        <div className="grid gap-4 md:grid-cols-2">
                            <section className={`group rounded-2xl border p-5 transition-colors ${card}`}>
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-400"><LogIn size={19} /></div>
                                        <div><p className="text-sm font-semibold">即梦 Dreamina</p><p className={`mt-0.5 text-[11px] ${muted}`}>图片与视频生成</p></div>
                                    </div>
                                    <StatusBadge complete={status.sessions.jimeng?.state === 'authenticated'} label={sessionLabel(status.sessions.jimeng)} />
                                </div>
                                <p className={`mt-4 text-xs leading-5 ${muted}`}>登录态保存在 Evan 专用 browser-profile；不会读取日常 Chrome 数据，状态由真实任务验证。</p>
                                <div className={`mt-3 truncate rounded-lg border px-3 py-2 font-mono text-[10px] ${isDark ? 'border-white/[0.08] bg-black/20 text-neutral-500' : 'border-neutral-200 bg-white text-neutral-500'}`} title={JIMENG_LOGIN_URL}>{JIMENG_LOGIN_URL}</div>
                                <div className="mt-4 grid grid-cols-2 gap-2">
                                    <button onClick={() => void openProviderLogin('jimeng')} disabled={Boolean(busyProvider) || isLoading} className="flex items-center justify-center gap-2 rounded-xl bg-cyan-500 px-3 py-2.5 text-xs font-semibold text-black transition-colors hover:bg-cyan-400 disabled:opacity-50">
                                        {busyProvider === 'jimeng' && busyAction === 'open' ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}打开登录页
                                    </button>
                                    <button onClick={() => void checkProviderLogin('jimeng')} disabled={Boolean(busyProvider) || isLoading} className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors disabled:opacity-50 ${isDark ? 'border-cyan-400/25 text-cyan-300 hover:bg-cyan-400/10' : 'border-cyan-300 text-cyan-700 hover:bg-cyan-50'}`}>
                                        {busyProvider === 'jimeng' && busyAction === 'check' ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}检查登录状态
                                    </button>
                                </div>
                            </section>

                            <section className={`group rounded-2xl border p-5 transition-colors ${card}`}>
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-400/10 text-blue-400"><LogIn size={19} /></div>
                                        <div><p className="text-sm font-semibold">Google Flow</p><p className={`mt-0.5 text-[11px] ${muted}`}>Nano Banana 与 Veo</p></div>
                                    </div>
                                    <StatusBadge complete={status.sessions['google-flow']?.state === 'authenticated'} label={sessionLabel(status.sessions['google-flow'])} />
                                </div>
                                <p className={`mt-4 text-xs leading-5 ${muted}`}>请使用可访问 Flow 的 Google 账号完成登录；登录完成后回到 Evan 重试任务。</p>
                                <div className={`mt-3 truncate rounded-lg border px-3 py-2 font-mono text-[10px] ${isDark ? 'border-white/[0.08] bg-black/20 text-neutral-500' : 'border-neutral-200 bg-white text-neutral-500'}`} title={FLOW_LOGIN_URL}>{FLOW_LOGIN_URL}</div>
                                <div className="mt-4 grid grid-cols-2 gap-2">
                                    <button onClick={() => void openProviderLogin('google-flow')} disabled={Boolean(busyProvider) || isLoading} className="flex items-center justify-center gap-2 rounded-xl bg-blue-500 px-3 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-blue-400 disabled:opacity-50">
                                        {busyProvider === 'google-flow' && busyAction === 'open' ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}打开登录页
                                    </button>
                                    <button onClick={() => void checkProviderLogin('google-flow')} disabled={Boolean(busyProvider) || isLoading} className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors disabled:opacity-50 ${isDark ? 'border-blue-400/25 text-blue-300 hover:bg-blue-400/10' : 'border-blue-300 text-blue-700 hover:bg-blue-50'}`}>
                                        {busyProvider === 'google-flow' && busyAction === 'check' ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}检查登录状态
                                    </button>
                                </div>
                            </section>

                            <section className={`rounded-2xl border p-5 transition-colors ${card}`}>
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-400/10 text-violet-400"><KeyRound size={19} /></div>
                                        <div><p className="text-sm font-semibold">DeepSeek API Key</p><p className={`mt-0.5 text-[11px] ${muted}`}>高速提示词优化</p></div>
                                    </div>
                                    <StatusBadge complete={status.deepseekConfigured} label={status.deepseekConfigured ? '已配置' : '可选'} />
                                </div>
                                <p className={`mt-4 text-xs leading-5 ${muted}`}>先在 DeepSeek 开放平台创建密钥，再到「右上角设置 → 配置 API 密钥 → DeepSeek」粘贴并保存。</p>
                                <div className="mt-4 flex gap-2">
                                    <button onClick={() => void openDeepSeek()} className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-medium transition-colors ${isDark ? 'border-white/10 hover:bg-white/10' : 'border-neutral-300 hover:bg-neutral-100'}`}><ExternalLink size={14} />获取 API Key</button>
                                    <button onClick={onOpenSettings} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-violet-500 px-3 py-2.5 text-xs font-semibold text-white hover:bg-violet-400"><KeyRound size={14} />前往配置</button>
                                </div>
                            </section>

                            <section className={`rounded-2xl border p-5 transition-colors ${card}`}>
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-400"><Bot size={19} /></div>
                                        <div><p className="text-sm font-semibold">ChatGPT / Codex</p><p className={`mt-0.5 text-[11px] ${muted}`}>无需 API Key 的可选连接</p></div>
                                    </div>
                                    <StatusBadge complete={status.codexAuthenticated} label={status.codexAuthenticated ? '已连接' : status.codexAvailable ? '待登录' : '未检测到'} />
                                </div>
                                <p className={`mt-4 text-xs leading-5 ${muted}`}>路径：右上角「设置 → 配置 API 密钥 → Codex 服务」。Evan 会自动检测；未找到时点击「选择 Codex」，再登录 ChatGPT。</p>
                                <button onClick={onOpenSettings} className={`mt-4 flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold transition-colors ${isDark ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/15' : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}><Bot size={14} />打开 Codex 服务设置<ArrowRight size={14} /></button>
                            </section>
                        </div>

                        <div className={`mt-5 flex flex-col gap-3 rounded-2xl border px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${isDark ? 'border-white/[0.08] bg-black/20' : 'border-neutral-200 bg-neutral-50'}`}>
                            <div className="flex items-start gap-3">
                                <ShieldCheck size={18} className="mt-0.5 shrink-0 text-emerald-400" />
                                <p className={`text-xs leading-5 ${muted}`}>密钥、登录资料和浏览器配置只保存在本机。关闭此窗口不会阻止使用，之后可从右上角设置再次打开。</p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                <button onClick={() => void loadStatus(true)} disabled={isLoading} className={`rounded-xl border p-2.5 transition-colors disabled:opacity-50 ${isDark ? 'border-white/10 text-neutral-400 hover:bg-white/10' : 'border-neutral-200 text-neutral-500 hover:bg-white'}`} title="重新检查真实登录状态"><RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} /></button>
                                <button onClick={onClose} className="flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-xs font-bold text-black transition-transform hover:scale-[1.02]"><Check size={15} />进入画布</button>
                            </div>
                        </div>
                        {message && <div className={`mt-3 rounded-xl border px-4 py-3 text-xs ${message.includes('失败') || message.includes('无法') ? 'border-red-400/20 bg-red-400/10 text-red-400' : 'border-blue-400/20 bg-blue-400/10 text-blue-400'}`}>{message}</div>}
                    </main>
                </div>
            </div>
        </div>
    );
};
