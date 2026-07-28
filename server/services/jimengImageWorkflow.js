/**
 * 即梦 图片生成入口。
 *
 * 生成走 HTTP（webhttp/jimeng/provider.js）：draft → aigc_draft/generate →
 * get_history_by_ids 轮询 → CDN 下载。原先驱动网页 DOM 的实现已删除。
 */

import { runWithAuthRecovery, runWithExecutionMode } from './webhttp/index.js';
import { generateJimengImageHttp } from './webhttp/jimeng/provider.js';
import { resolveProtocolModelId } from './webhttp/registry.js';
import { JIMENG_BASELINE_IMAGE_MODEL } from './webhttp/jimeng/protocol.js';

export const JIMENG_IMAGE_PRO_MODEL_ID = 'jimeng-image-5-0-pro';
export const JIMENG_IMAGE_LITE_MODEL_ID = 'jimeng-image-5-0-lite';
export const JIMENG_IMAGE_MODELS = Object.freeze({
    [JIMENG_IMAGE_PRO_MODEL_ID]: '图片 5.0 Pro',
    [JIMENG_IMAGE_LITE_MODEL_ID]: '图片 5.0 Lite'
});
export const JIMENG_IMAGE_SUPPORTED_ASPECT_RATIOS = Object.freeze([
    '21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'
]);
export const JIMENG_IMAGE_SUPPORTED_RESOLUTIONS = Object.freeze(['2K', '4K']);
export const JIMENG_IMAGE_PRO_SUPPORTED_RESOLUTIONS = Object.freeze(['1K', '2K', '4K']);
export const JIMENG_IMAGE_MAX_REFERENCES = 12;
export const JIMENG_IMAGE_MAX_COUNT = 8;
export const JIMENG_IMAGE_PRO_MAX_COUNT = 4;

export function isJimengImageWorkflowModel(modelId) {
    return Object.prototype.hasOwnProperty.call(JIMENG_IMAGE_MODELS, modelId);
}

export function resolveJimengImageModelLabel(modelId) {
    return JIMENG_IMAGE_MODELS[modelId] || JIMENG_IMAGE_MODELS[JIMENG_IMAGE_LITE_MODEL_ID];
}

export function jimengImageSupportedResolutions(modelId = JIMENG_IMAGE_LITE_MODEL_ID) {
    return modelId === JIMENG_IMAGE_PRO_MODEL_ID
        ? JIMENG_IMAGE_PRO_SUPPORTED_RESOLUTIONS
        : JIMENG_IMAGE_SUPPORTED_RESOLUTIONS;
}

export function normalizeJimengImageResolution(value, modelId = JIMENG_IMAGE_LITE_MODEL_ID) {
    const normalized = String(value || '').trim().toUpperCase();
    if (!normalized || normalized === 'AUTO' || normalized === '自动') return '2K';
    const supported = jimengImageSupportedResolutions(modelId);
    if (!supported.includes(normalized)) {
        throw new Error(`即梦该图片模型分辨率只支持 ${supported.join(' / ')}`);
    }
    return normalized;
}

export function jimengImageMaxCount(modelId = JIMENG_IMAGE_LITE_MODEL_ID) {
    return modelId === JIMENG_IMAGE_PRO_MODEL_ID ? JIMENG_IMAGE_PRO_MAX_COUNT : JIMENG_IMAGE_MAX_COUNT;
}

export function normalizeJimengImageCount(value, modelId = JIMENG_IMAGE_LITE_MODEL_ID) {
    const count = Number(value ?? 1);
    const maxCount = jimengImageMaxCount(modelId);
    if (!Number.isInteger(count) || count < 1 || count > maxCount) {
        throw new Error(`即梦图片生成数量只支持 1-${maxCount}`);
    }
    return count;
}

export function generateJimengWorkflowImage(options) {
    return runWithAuthRecovery({
        provider: 'jimeng',
        label: '即梦图片生成',
        metadata: { prompt: options?.prompt },
        run: () => runWithExecutionMode({
        mode: options?.executionMode,
        provider: 'jimeng',
        label: '即梦图片生成',
        http: () => generateJimengImageHttp({
            ...options,
            modelId: resolveProtocolModelId(options?.modelId, JIMENG_BASELINE_IMAGE_MODEL)
        })
        })
    });
}
