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
    runGeminiMediaTextTaskHttp,
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
        signal: options?.signal,
        metadata: {
            kind: 'image',
            modelId: GEMINI_WEB_IMAGE_MODEL_ID,
            nodeId: options?.nodeId,
            workflowId: options?.workflowId
        },
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
        signal: options?.signal,
        metadata: {
            kind: 'video',
            modelId: GEMINI_WEB_VIDEO_MODEL_ID,
            nodeId: options?.nodeId,
            workflowId: options?.workflowId
        },
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
        signal: options?.signal,
        metadata: {
            kind: 'text',
            modelId: 'gemini-web-text',
            nodeId: options?.nodeId,
            workflowId: options?.workflowId
        },
        http: async () => (await runGeminiTextTaskHttp(options)).text
    })
});

/** 音视频语义/转写任务：自动复用 Gemini Web 登录，不要求用户额外填写 API Key。 */
export const runGeminiWebMediaTextTask = options => runWithAuthRecovery({
    provider: 'gemini-web',
    label: 'Gemini Web 音频识别',
    metadata: { prompt: options?.prompt },
    run: () => runWithExecutionMode({
        mode: options?.executionMode,
        provider: 'gemini-web',
        label: 'Gemini Web 音频识别',
        signal: options?.signal,
        metadata: {
            kind: 'text',
            modelId: 'gemini-web-audio-transcription',
            nodeId: options?.nodeId,
            workflowId: options?.workflowId
        },
        http: async () => (await runGeminiMediaTextTaskHttp(options)).text
    })
});

/**
 * Interactive structured media analysis.
 *
 * Unlike background generation jobs this returns AUTH_EXPIRED directly to the
 * workspace so it can show a login/retry action. The returned conversation
 * tuple lets schema-correction retries keep the already-uploaded media instead
 * of uploading the full video again.
 */
export const runGeminiWebStructuredMediaTask = options => runWithExecutionMode({
    mode: options?.executionMode,
    provider: 'gemini-web',
    label: options?.label || 'Gemini Web 视频结构化分析',
    signal: options?.signal,
    metadata: {
        kind: 'analysis',
        modelId: 'gemini-web-video-analysis',
        nodeId: options?.nodeId,
        workflowId: options?.workflowId
    },
    // Media is intentionally uploaded once per analysis run. Schema repair
    // happens in the same conversation above this layer; replaying this HTTP
    // closure would upload the complete proxy a second time.
    httpAttempts: 1,
    http: () => runGeminiMediaTextTaskHttp(options)
});
