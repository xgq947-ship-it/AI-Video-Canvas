/**
 * Gemini Web 生成入口。
 *
 * 生成链路已全部改为 HTTP（见 webhttp/gemini/provider.js）：bootstrap →
 * StreamGenerate → 解析 → HTTP 下载。原先「找输入框 / 填提示词 / 点生成 /
 * 等页面出图 / 点下载」那套 DOM 自动化已整体删除，浏览器只保留登录与会话上下文。
 */

import { runWithAuthRecovery, runWithExecutionMode } from './webhttp/index.js';
import {
    generateGeminiImageHttp,
    generateGeminiVideoHttp,
    runGeminiTextTaskHttp
} from './webhttp/gemini/provider.js';

export const GEMINI_WEB_IMAGE_MODEL_ID = 'gemini-web-image';
export const GEMINI_WEB_VIDEO_MODEL_ID = 'gemini-web-video';

export const isGeminiWebImageModel = modelId => modelId === GEMINI_WEB_IMAGE_MODEL_ID;
export const isGeminiWebVideoModel = modelId => modelId === GEMINI_WEB_VIDEO_MODEL_ID;

export const generateGeminiWebImage = options => runWithAuthRecovery({
    provider: 'gemini-web',
    label: 'Gemini Web 图片生成',
    metadata: { prompt: options?.prompt },
    run: () => runWithExecutionMode({
        mode: options?.executionMode,
        provider: 'gemini-web',
        label: 'Gemini Web 图片生成',
        http: () => generateGeminiImageHttp(options)
    })
});

export const generateGeminiWebVideo = options => runWithAuthRecovery({
    provider: 'gemini-web',
    label: 'Gemini Web 视频生成',
    metadata: { prompt: options?.prompt },
    run: () => runWithExecutionMode({
        mode: options?.executionMode,
        provider: 'gemini-web',
        label: 'Gemini Web 视频生成',
        http: () => generateGeminiVideoHttp(options)
    })
});

/** 识图 / 提示词优化：同样走 StreamGenerate，返回纯文本以保持旧调用方契约。 */
export const runGeminiWebTextTask = options => runWithAuthRecovery({
    provider: 'gemini-web',
    label: 'Gemini Web 识图',
    metadata: { prompt: options?.prompt },
    run: () => runWithExecutionMode({
        mode: options?.executionMode,
        provider: 'gemini-web',
        label: 'Gemini Web 识图',
        http: async () => (await runGeminiTextTaskHttp(options)).text
    })
});
