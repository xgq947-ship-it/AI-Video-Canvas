/**
 * 即梦（Seedance）视频生成适配器。
 *
 * 生成走 HTTP（webhttp/jimeng/provider.js）；原先驱动网页 DOM 的实现已删除。
 *
 * 与 Google Flow 适配器的差异：
 * - 即梦是「文字为主、参考素材可选」：节点不接图也能生成（纯文生视频）。
 * - 没有首帧概念，连进来的图一律作为参考素材（最多 12 个）。
 * - 多一个分辨率维度（720P/1080P/4K）。
 * 两个 provider 共用同一个 Evan 专属 Chrome 串行队列。
 */

import { runWithAuthRecovery, runWithExecutionMode } from './webhttp/index.js';
import { generateJimengVideoHttp } from './webhttp/jimeng/provider.js';
import { resolveProtocolModelId } from './webhttp/registry.js';
import { JIMENG_BASELINE_VIDEO_MODEL } from './webhttp/jimeng/protocol.js';

export const JIMENG_WORKFLOW_MODEL_ID = 'jimeng-seedance-2-0';
export const JIMENG_FAST_WORKFLOW_MODEL_ID = 'jimeng-seedance-2-0-fast';
export const JIMENG_MINI_WORKFLOW_MODEL_ID = 'jimeng-seedance-2-0-mini';
export const JIMENG_STANDARD_FAST_WORKFLOW_MODEL_ID = 'jimeng-seedance-2-0-fast-standard';
export const JIMENG_STANDARD_WORKFLOW_MODEL_ID = 'jimeng-seedance-2-0-standard';
export const JIMENG_DEFAULT_MODEL = '即梦 Seedance 2.0 VIP';

// 画布模型 id → 即梦页面模型下拉框里的**精确文案**（provider 按文案精确匹配选项）。
export const JIMENG_MODEL_LABELS = {
    [JIMENG_MINI_WORKFLOW_MODEL_ID]: '即梦 Seedance 2.0 mini',
    [JIMENG_FAST_WORKFLOW_MODEL_ID]: '即梦 Seedance 2.0 Fast VIP',
    [JIMENG_WORKFLOW_MODEL_ID]: '即梦 Seedance 2.0 VIP',
    [JIMENG_STANDARD_FAST_WORKFLOW_MODEL_ID]: '即梦 Seedance 2.0 Fast',
    [JIMENG_STANDARD_WORKFLOW_MODEL_ID]: '即梦 Seedance 2.0'
};

export function isJimengWorkflowModelId(videoModel) {
    return Object.prototype.hasOwnProperty.call(JIMENG_MODEL_LABELS, videoModel);
}

export function resolveJimengModelLabel(videoModel) {
    return JIMENG_MODEL_LABELS[videoModel] || JIMENG_DEFAULT_MODEL;
}
export const JIMENG_SUPPORTED_DURATIONS = [4, 5, 6, 8, 10, 15];
export const JIMENG_SUPPORTED_ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
export const JIMENG_SUPPORTED_RESOLUTIONS = ['720P', '1080P', '4K'];
export const JIMENG_MAX_REFERENCE_IMAGES = 12;

export function normalizeJimengResolution(input) {
    const value = String(input || '').trim().toUpperCase();
    if (!value || value === 'AUTO' || value === '自动') return '720P';
    if (value === '4K') return '4K';
    if (JIMENG_SUPPORTED_RESOLUTIONS.includes(value)) return value;
    throw new Error(`即梦分辨率只支持 ${JIMENG_SUPPORTED_RESOLUTIONS.join(' / ')}`);
}

export function generateJimengWorkflowVideo(options) {
    return runWithAuthRecovery({
        provider: 'jimeng',
        label: '即梦视频生成',
        metadata: { prompt: options?.prompt },
        run: () => runWithExecutionMode({
        mode: options?.executionMode,
        provider: 'jimeng',
        label: '即梦视频生成',
        http: () => generateJimengVideoHttp({
            ...options,
            // 浏览器路径按下拉文案传 model；HTTP 需要 model_req_key。
            modelId: resolveProtocolModelId(options?.videoModelId, JIMENG_BASELINE_VIDEO_MODEL)
        })
        })
    });
}
