/**
 * useGenerationModelRegistry
 *
 * 把后端运行时发现的模型能力叠加到 shared/generationProviders 的静态基线上。
 *
 * 为什么不是「替换」：静态表要在离线、未登录、发现失败时兜底，也要保证旧项目文件
 * 里存着的 model id 永远能解析出名字和参数。运行时注册表只负责把平台**真正开放**
 * 的能力补上（新比例、1080p、新时长、新模型），这样平台加模型时前端不用改代码。
 *
 * 结果在模块级缓存：整个会话只请求一次，多个下拉共用；设置页可以强制刷新。
 */

import { useCallback, useEffect, useState } from 'react';
import {
    applyDiscoveredModelRegistry,
    resetDiscoveredModelRegistry,
    type DiscoveredModelRegistry
} from '@/shared/generationProviders.js';

interface RegistryState {
    /** 叠加完成后自增，供依赖它的组件重新计算下拉选项。 */
    revision: number;
    updatedAt: string | null;
    loading: boolean;
    /** 至少有一个平台真的返回了模型列表（而不是只用了基线）。 */
    discovered: boolean;
}

let cache: RegistryState | null = null;
let inflight: Promise<RegistryState> | null = null;
let revision = 0;
const listeners = new Set<(state: RegistryState) => void>();

function publish(state: RegistryState) {
    cache = state;
    listeners.forEach(listener => listener(state));
}

async function load(refresh: boolean): Promise<RegistryState> {
    if (!refresh && cache && !cache.loading) return cache;
    if (!refresh && inflight) return inflight;

    inflight = fetch(`/api/settings/models${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' })
        .then(async response => {
            if (!response.ok) throw new Error(String(response.status));
            return (await response.json()) as DiscoveredModelRegistry;
        })
        .then(registry => {
            if (refresh) resetDiscoveredModelRegistry();
            applyDiscoveredModelRegistry(registry);
            revision += 1;
            const state: RegistryState = {
                revision,
                updatedAt: registry?.updatedAt || null,
                loading: false,
                discovered: Object.values(registry?.providers || {}).some(entry => entry.discovered)
            };
            publish(state);
            return state;
        })
        .catch(() => {
            // 发现失败不是错误状态：基线本来就够用，静默沿用即可，
            // 绝不能因为一次网络抖动把模型下拉清空。
            const state: RegistryState = { revision, updatedAt: null, loading: false, discovered: false };
            publish(state);
            return state;
        })
        .finally(() => { inflight = null; });

    return inflight;
}

export function useGenerationModelRegistry() {
    const [state, setState] = useState<RegistryState>(
        () => cache || { revision, updatedAt: null, loading: true, discovered: false }
    );

    useEffect(() => {
        listeners.add(setState);
        void load(false);
        return () => { listeners.delete(setState); };
    }, []);

    const refresh = useCallback(() => load(true), []);

    return { ...state, refresh };
}
