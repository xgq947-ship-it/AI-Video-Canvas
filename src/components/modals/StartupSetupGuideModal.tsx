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
const GEMINI_LOGIN_URL = 'https://gemini.google.com/app';

type BrowserProvider = 'jimeng' | 'google-flow' | 'gemini-web';
type Theme = 'dark' | 'light';

interface BrowserSession {
    state?: string;
    message?: string;
    /** 只有真正跑完探针仍拿不到结论时才有值；重启后的「本次未验证」是 null。 */
    errorCode?: string | null;
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
        <span className={`inline-flex w-[68px] shrink-0 items-center justify-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${
            complete
                ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-400'
                : 'border-amber-400/25 bg-amber-400/10 text-amber-400'
        }`}>
            {complete ? <CheckCircle2 size={11} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
            {label}
        </span>
    );
}

/** 三个浏览器登录平台只有图标配色和文案不同，行结构完全一致。 */
const BROWSER_ROWS: Array<{
    id: BrowserProvider; name: string; hint: string; url: string; icon: React.ReactNode; iconClass: string;
}> = [
    {
        id: 'jimeng', name: '即梦 Dreamina', hint: '图片与视频生成',
        url: JIMENG_LOGIN_URL, icon: <LogIn size={16} />, iconClass: 'bg-cyan-400/10 text-cyan-400'
    },
    {
        id: 'google-flow', name: 'Google Flow', hint: 'Nano Banana 与 Veo',
        url: FLOW_LOGIN_URL, icon: <LogIn size={16} />, iconClass: 'bg-blue-400/10 text-blue-400'
    },
    {
        id: 'gemini-web', name: 'Gemini Web', hint: '图片、视频、识图与提示词优化',
        url: GEMINI_LOGIN_URL, icon: <Sparkles size={16} />, iconClass: 'bg-fuchsia-400/10 text-fuchsia-400'
    }
];

/**
 * 状态说明。检查完仍没结论时必须把原因摆出来 —— 只显示「无法确认」而不给理由，
 * 用户既不知道该重登还是重试，也没法把问题描述清楚。
 */
function sessionDetail(session?: BrowserSession) {
    if (!session?.message) return '';
    if (session.state === 'authenticated') return '';
    return session.message;
}

function sessionLabel(session?: BrowserSession) {
    if (session?.state === 'authenticated') return '已验证';
    if (session?.state === 'expired') return '未登录';
    if (session?.state === 'checking' || session?.state === 'reauthenticating') return '检查中';
    // 不能用「有没有 message」来判断。应用重启时会把历史「已验证」重置成 unknown，
    // 并写入一句说明（'等待本次启动重新验证登录状态'）——那是「还没验证」，
    // 却因为 message 非空被显示成「无法确认」，看起来像验证失败。
    // 真正跑完探针仍无结论时才会带 errorCode，用它区分。
    return session?.errorCode ? '无法确认' : '待验证';
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
                        'google-flow': { state: 'checking' },
                        'gemini-web': { state: 'checking' }
                    }
                }));
                const probeResponse = await fetch('/api/browser-sessions/check', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ providers: ['jimeng', 'google-flow', 'gemini-web'] })
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
            // 读取失败时必须把乐观写入的「检查中」收回来：否则三个平台会永远停在
            // 检查中，看起来像探针卡死。同时不要把 fetch 的英文异常原样丢给用户
            //（后端还没起来时是 "Unexpected end of JSON input"，读不懂也没法处理）。
            setStatus(previous => ({ ...previous, sessions: {} }));
            const raw = error instanceof Error ? error.message : '';
            setMessage(raw.includes('JSON') || !raw
                ? '后台服务还没准备好，请点右下角「重新检查」重试。'
                : raw);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (!isOpen) return;
        // 一律只读缓存，永远不自动探测。
        //
        // 三平台 HTTP 登录检测要唤醒专属 Chrome 并逐个发请求，好几秒起步；放在
        // 「刚进画布」这个时刻，用户什么都还没做就先被卡住，而登录态绝大多数时候
        // 和上次一样。需要最新状态时由用户点「重新检查」或单平台的「检查登录状态」，
        // 那时等待是他自己要的。
        void loadStatus(false);
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
        status.sessions['gemini-web']?.state === 'authenticated',
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
                body: JSON.stringify({ providers: [provider], force: true })
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
    const rowSurface = isDark ? 'border-white/[0.07] bg-white/[0.03]' : 'border-neutral-200 bg-neutral-50';
    const muted = isDark ? 'text-neutral-400' : 'text-neutral-500';
    const divider = isDark ? 'border-white/[0.08]' : 'border-neutral-200';
    const primaryAction = 'flex h-8 items-center justify-center gap-1.5 rounded-lg bg-blue-500 px-3 text-[11px] font-semibold text-white transition-colors hover:bg-blue-400 disabled:opacity-40';
    const secondaryAction = `flex h-8 items-center justify-center gap-1.5 rounded-lg border px-3 text-[11px] font-medium transition-colors disabled:opacity-40 ${
        isDark ? 'border-white/10 text-neutral-300 hover:bg-white/10' : 'border-neutral-300 text-neutral-700 hover:bg-neutral-100'
    }`;
    const actionsBusy = Boolean(busyProvider) || isLoading;

    /** 所有条目共用同一条行结构：图标 · 名称/说明 · 状态 · 操作。说明位在有异常时换成原因。 */
    const row = (
        key: string,
        icon: React.ReactNode,
        iconClass: string,
        name: string,
        hint: string,
        detail: string,
        badge: React.ReactNode,
        actions: React.ReactNode,
        title?: string
    ) => (
        // 窄窗口下让操作区整体换行，而不是把平台名压成「即梦 Dre…」——
        // 名字和状态是这一屏唯一需要一眼看懂的东西。
        <div key={key} className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3.5 py-2.5 ${rowSurface}`} title={title}>
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>{icon}</div>
            <div className="min-w-[168px] flex-1">
                <p className="truncate text-[13px] font-semibold leading-tight">{name}</p>
                <p className={`mt-1 truncate text-[11px] leading-tight ${detail ? 'text-amber-400' : muted}`}>{detail || hint}</p>
            </div>
            {badge}
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
        </div>
    );

    return (
        <div
            className="fixed inset-0 z-[140] flex items-center justify-center bg-black/75 px-5 py-6 backdrop-blur-xl"
            onMouseDown={event => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div className={`relative flex max-h-[92vh] w-full max-w-[820px] flex-col overflow-hidden rounded-2xl border shadow-[0_30px_90px_rgba(0,0,0,0.6)] ${panel}`}>
                <header className={`flex items-center gap-3 border-b px-5 py-3.5 ${divider}`}>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-400/20 bg-blue-500/15 text-blue-300">
                        <Sparkles size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h2 className="text-[15px] font-semibold leading-tight">连接你的 AI 创作服务</h2>
                        <p className={`mt-1 truncate text-[11px] leading-tight ${muted}`}>
                            前三项用 Evan 专属 Chrome 登录；后两项是提示词优化后端，二选一即可。
                        </p>
                    </div>
                    <div className="hidden shrink-0 items-center gap-2 sm:flex">
                        <div className={`h-1.5 w-24 overflow-hidden rounded-full ${isDark ? 'bg-white/10' : 'bg-neutral-200'}`}>
                            <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${completedCount / 4 * 100}%` }} />
                        </div>
                        <span className={`whitespace-nowrap text-[11px] font-medium ${muted}`}>{completedCount} / 4 已就绪</span>
                    </div>
                    <button
                        onClick={onClose}
                        className={`shrink-0 rounded-lg border p-2 transition-colors ${isDark ? 'border-white/10 text-neutral-400 hover:bg-white/10 hover:text-white' : 'border-neutral-200 text-neutral-500 hover:bg-neutral-100'}`}
                        aria-label="关闭启动配置指南"
                    >
                        <X size={16} />
                    </button>
                </header>

                <main className="flex flex-col gap-2 overflow-y-auto px-5 py-4">
                    {BROWSER_ROWS.map(item => row(
                        item.id,
                        item.icon,
                        item.iconClass,
                        item.name,
                        item.hint,
                        sessionDetail(status.sessions[item.id]),
                        <StatusBadge complete={status.sessions[item.id]?.state === 'authenticated'} label={sessionLabel(status.sessions[item.id])} />,
                        <>
                            <button
                                onClick={() => void openProviderLogin(item.id)}
                                disabled={actionsBusy}
                                className={primaryAction}
                            >
                                {busyProvider === item.id && busyAction === 'open' ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />}打开登录页
                            </button>
                            <button
                                onClick={() => void checkProviderLogin(item.id)}
                                disabled={actionsBusy}
                                className={secondaryAction}
                            >
                                {busyProvider === item.id && busyAction === 'check' ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}检查登录状态
                            </button>
                        </>,
                        item.url
                    ))}

                    {row(
                        'deepseek',
                        <KeyRound size={16} />,
                        'bg-violet-400/10 text-violet-400',
                        'DeepSeek API Key',
                        '高速提示词优化（可选）',
                        '',
                        <StatusBadge complete={status.deepseekConfigured} label={status.deepseekConfigured ? '已配置' : '可选'} />,
                        <>
                            <button onClick={() => void openDeepSeek()} className={secondaryAction}>
                                <ExternalLink size={13} />获取 API Key
                            </button>
                            <button onClick={onOpenSettings} className={primaryAction}>
                                <KeyRound size={13} />前往配置
                            </button>
                        </>,
                        DEEPSEEK_API_KEYS_URL
                    )}

                    {row(
                        'codex',
                        <Bot size={16} />,
                        'bg-emerald-400/10 text-emerald-400',
                        'ChatGPT / Codex',
                        '无需 API Key 的可选连接，Evan 会自动检测',
                        '',
                        <StatusBadge complete={status.codexAuthenticated} label={status.codexAuthenticated ? '已连接' : status.codexAvailable ? '待登录' : '未检测到'} />,
                        <button onClick={onOpenSettings} className={secondaryAction}>
                            <Bot size={13} />打开设置<ArrowRight size={13} />
                        </button>,
                        '路径：右上角「设置 → 配置 API 密钥 → Codex 服务」。未找到时点击「选择 Codex」，再登录 ChatGPT。'
                    )}

                    {message && (
                        <div className={`rounded-xl border px-3.5 py-2.5 text-[11px] leading-5 ${
                            message.includes('失败') || message.includes('无法')
                                ? 'border-red-400/20 bg-red-400/10 text-red-400'
                                : 'border-blue-400/20 bg-blue-400/10 text-blue-400'
                        }`}>{message}</div>
                    )}
                </main>

                <footer className={`flex items-center gap-3 border-t px-5 py-3 ${divider}`}>
                    <ShieldCheck size={15} className="shrink-0 text-emerald-400" />
                    <p className={`min-w-0 flex-1 truncate text-[11px] ${muted}`}>
                        密钥与登录资料只保存在本机。关闭窗口不影响使用，之后可从右上角设置再次打开。
                    </p>
                    <button
                        onClick={() => void loadStatus(true)}
                        disabled={isLoading}
                        className={secondaryAction}
                    >
                        <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />重新检查
                    </button>
                    <button
                        onClick={onClose}
                        // 浅色主题下不能用白底：白底白面板等于没有按钮。
                        className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-4 text-[11px] font-bold transition-colors ${
                            isDark ? 'bg-white text-black hover:bg-neutral-200' : 'bg-neutral-900 text-white hover:bg-neutral-700'
                        }`}
                    >
                        <Check size={14} />进入画布
                    </button>
                </footer>
            </div>
        </div>
    );
};
