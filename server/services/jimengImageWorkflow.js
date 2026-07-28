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
export const JIMENG_IMAGE_MAX_REFERENCES = 12;
export const JIMENG_IMAGE_MAX_COUNT = 4;

export function isJimengImageWorkflowModel(modelId) {
    return Object.prototype.hasOwnProperty.call(JIMENG_IMAGE_MODELS, modelId);
}

export function resolveJimengImageModelLabel(modelId) {
    return JIMENG_IMAGE_MODELS[modelId] || JIMENG_IMAGE_MODELS[JIMENG_IMAGE_LITE_MODEL_ID];
}

export function normalizeJimengImageResolution(value) {
    const normalized = String(value || '').trim().toUpperCase();
    if (!normalized || normalized === 'AUTO' || normalized === '自动') return '2K';
    if (!JIMENG_IMAGE_SUPPORTED_RESOLUTIONS.includes(normalized)) {
        throw new Error('即梦图片分辨率只支持 2K 或 4K');
    }
    return normalized;
}

export function normalizeJimengImageCount(value) {
    const count = Number(value ?? 1);
    if (!Number.isInteger(count) || count < 1 || count > JIMENG_IMAGE_MAX_COUNT) {
        throw new Error(`即梦图片生成数量只支持 1-${JIMENG_IMAGE_MAX_COUNT}`);
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
