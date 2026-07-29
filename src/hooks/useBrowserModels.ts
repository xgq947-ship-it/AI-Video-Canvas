/**
 * useBrowserModels.ts
 *
 * 探测「网页 HTTP 模型」（Google Flow / 即梦 / Gemini）是否可用。
 *
 * 生成请求走 HTTP；AI Browser Hub 的共享 Profile 只提供登录态、签名和验证令牌。
 * 源码开发需要先跑 `npm run setup:automation-runtime`，安装包已自带 Python 运行时。
 * 未安装时不应让用户点了才报错，而是直接在模型列表里置灰。
 *
 * 结果进程内缓存：能力在运行期不会变，多个下拉框共用一次请求。
 */

import { useEffect, useState } from 'react';

interface BrowserModelsState {
    /** Python 运行时是否已安装就绪 */
    ready: boolean;
    /** 依赖该运行时的模型 id */
    models: string[];
    /** 未就绪时给用户看的引导文案 */
    hint: string;
    /** 首次探测是否还在进行中（加载期间不置灰，避免闪烁） */
    loading: boolean;
}

const FALLBACK_MODELS = [
    'google-flow-omni-flash',
    'google-flow-veo-3-1-lite',
    'google-flow-veo-3-1-fast',
    'google-flow-veo-3-1-quality',
    'google-flow-nano-banana-pro',
    'google-flow-nano-banana-2',
    'google-flow-nano-banana-2-lite',
    'jimeng-image-5-0-pro',
    'jimeng-image-5-0-lite',
    'jimeng-seedance-2-0-mini',
    'jimeng-seedance-2-0-fast-standard',
    'jimeng-seedance-2-0-standard',
    'jimeng-seedance-2-0',
    'jimeng-seedance-2-0-fast',
    'gemini-web-image',
    'gemini-web-video'
];

const DEFAULT_HINT = '请安装或更新 Google Chrome，并登录对应账号';

// 模块级缓存：整个会话只请求一次。
let cache: BrowserModelsState | null = null;
let inflight: Promise<BrowserModelsState> | null = null;

function fetchCapabilities(): Promise<BrowserModelsState> {
    if (cache) return Promise.resolve(cache);
    if (inflight) return inflight;

    inflight = fetch('/api/capabilities')
        .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then(data => {
            const browserModels = data?.browserModels || {};
            const state: BrowserModelsState = {
                ready: Boolean(browserModels.ready),
                models: Array.isArray(browserModels.models) && browserModels.models.length
                    ? browserModels.models
                    : FALLBACK_MODELS,
                hint: browserModels.hint || DEFAULT_HINT,
                loading: false
            };
            cache = state;
            return state;
        })
        .catch(() => {
            // 探测失败时按「可用」处理：宁可让用户点了收到明确报错，
            // 也不要因为一次网络抖动就把本来能用的模型全禁掉。
            const state: BrowserModelsState = {
                ready: true,
                models: FALLBACK_MODELS,
                hint: DEFAULT_HINT,
                loading: false
            };
            cache = state;
            return state;
        })
        .finally(() => { inflight = null; });

    return inflight;
}

export function useBrowserModels() {
    const [state, setState] = useState<BrowserModelsState>(
        () => cache || { ready: true, models: FALLBACK_MODELS, hint: DEFAULT_HINT, loading: true }
    );

    useEffect(() => {
        let alive = true;
        fetchCapabilities().then(next => { if (alive) setState(next); });
        return () => { alive = false; };
    }, []);

    /** 该模型当前是否不可用（需要本地配置但尚未配置好）。 */
    const isModelUnavailable = (modelId: string) =>
        !state.loading && !state.ready && state.models.includes(modelId);

    return {
        browserModelsReady: state.ready,
        browserModelsHint: state.hint,
        isModelUnavailable
    };
}
