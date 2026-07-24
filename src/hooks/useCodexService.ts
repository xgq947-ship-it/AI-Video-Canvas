import { useEffect, useState } from 'react';

interface CodexServiceState {
    ready: boolean;
    loading: boolean;
    hint: string;
}

const DEFAULT_HINT = '请在设置 → Codex 服务中选择并登录本机 Codex CLI';
let cache: CodexServiceState | null = null;
let inflight: Promise<CodexServiceState> | null = null;

function fetchStatus(force = false): Promise<CodexServiceState> {
    if (!force && cache) return Promise.resolve(cache);
    if (inflight) return inflight;
    inflight = fetch(`/api/settings/codex${force ? '?refresh=1' : ''}`, { cache: 'no-store' })
        .then(async response => {
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Codex 状态读取失败');
            const ready = Boolean(
                result.available &&
                result.authenticated &&
                result.skillInstalled &&
                result.queueBridgeReady
            );
            cache = {
                ready,
                loading: false,
                hint: ready ? '' : (result.error || DEFAULT_HINT)
            };
            return cache;
        })
        .catch(error => {
            cache = {
                ready: false,
                loading: false,
                hint: error instanceof Error ? error.message : DEFAULT_HINT
            };
            return cache;
        })
        .finally(() => { inflight = null; });
    return inflight;
}

export function notifyCodexStatusChanged() {
    cache = null;
    window.dispatchEvent(new Event('evan:codex-status-changed'));
}

export function useCodexService() {
    const [state, setState] = useState<CodexServiceState>(
        () => cache || { ready: false, loading: true, hint: DEFAULT_HINT }
    );

    useEffect(() => {
        let alive = true;
        const refresh = () => {
            fetchStatus(true).then(next => {
                if (alive) setState(next);
            });
        };
        fetchStatus().then(next => {
            if (alive) setState(next);
        });
        window.addEventListener('evan:codex-status-changed', refresh);
        return () => {
            alive = false;
            window.removeEventListener('evan:codex-status-changed', refresh);
        };
    }, []);

    return {
        codexReady: state.ready,
        codexLoading: state.loading,
        codexHint: state.hint || DEFAULT_HINT
    };
}
