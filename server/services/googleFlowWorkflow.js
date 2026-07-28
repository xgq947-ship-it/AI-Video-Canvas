/**
 * Google Flow workflow 适配器。
 *
 * 生成走 HTTP（webhttp/flow/provider.js）；原先驱动网页 DOM 的实现已删除。
 * 这里仍保留素材路径解析工具，其它模块（即梦适配器等）在用。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runWithAuthRecovery, runWithExecutionMode } from './webhttp/index.js';
import { generateFlowVideoHttp } from './webhttp/flow/provider.js';
import { resolveProtocolModelId } from './webhttp/registry.js';
import { FLOW_BASELINE_VIDEO_MODEL } from './webhttp/flow/protocol.js';

export const GOOGLE_FLOW_WORKFLOW_MODEL_ID = 'google-flow-omni-flash';
export const GOOGLE_FLOW_VEO_3_1_LITE_WORKFLOW_MODEL_ID = 'google-flow-veo-3-1-lite';
export const GOOGLE_FLOW_VEO_3_1_FAST_WORKFLOW_MODEL_ID = 'google-flow-veo-3-1-fast';
export const GOOGLE_FLOW_VEO_3_1_QUALITY_WORKFLOW_MODEL_ID = 'google-flow-veo-3-1-quality';
export const GOOGLE_FLOW_WORKFLOW_MODELS = {
    [GOOGLE_FLOW_WORKFLOW_MODEL_ID]: 'Omni Flash',
    [GOOGLE_FLOW_VEO_3_1_LITE_WORKFLOW_MODEL_ID]: 'Veo 3.1 - Lite',
    [GOOGLE_FLOW_VEO_3_1_FAST_WORKFLOW_MODEL_ID]: 'Veo 3.1 - Fast',
    [GOOGLE_FLOW_VEO_3_1_QUALITY_WORKFLOW_MODEL_ID]: 'Veo 3.1 - Quality'
};
export const GOOGLE_FLOW_SUPPORTED_DURATIONS = [4, 6, 8, 10];
// 部分 Flow 模型（如 Veo 3.1 - Lite）不提供时长选择，前端也就不会传 duration。
// CLI 仍要求 --duration 是合法值，这里给个占位——Python 侧发现该模型没有时长
// tab 时会跳过设置，所以这个值对这类模型不产生影响。
export const GOOGLE_FLOW_DEFAULT_DURATION = 8;
export const GOOGLE_FLOW_SUPPORTED_ASPECT_RATIOS = ['16:9', '9:16'];

export function isGoogleFlowWorkflowModelId(modelId) {
    return Object.prototype.hasOwnProperty.call(GOOGLE_FLOW_WORKFLOW_MODELS, modelId);
}

export function resolveGoogleFlowModelLabel(modelId) {
    return GOOGLE_FLOW_WORKFLOW_MODELS[modelId] || GOOGLE_FLOW_WORKFLOW_MODELS[GOOGLE_FLOW_WORKFLOW_MODEL_ID];
}

export function resolveLocalLibraryImage(input, libraryDir) {
    if (!input || typeof input !== 'string') return null;
    let candidate = input;
    if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
        const url = new URL(candidate);
        if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) return null;
        candidate = url.pathname;
    }
    if (!candidate.startsWith('/library/')) return null;

    const cleanPath = decodeURIComponent(candidate.split('?')[0].split('#')[0]);
    const root = path.resolve(libraryDir);
    const resolved = path.resolve(root, cleanPath.replace(/^\/library\//, ''));
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
        throw new Error('Google Flow 首帧路径超出素材库范围');
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        throw new Error(`Google Flow 首帧文件不存在：${resolved}`);
    }
    return resolved;
}

export function writeDataUrlImage(input, taskDir, basename = 'first-frame') {
    const match = String(input || '').match(/^data:image\/(png|jpeg|jpg|webp);base64,([\s\S]+)$/i);
    if (!match) return null;
    const extension = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
    const target = path.join(taskDir, `${basename}.${extension}`);
    fs.writeFileSync(target, Buffer.from(match[2], 'base64'));
    return target;
}

export function generateGoogleFlowWorkflowVideo(options) {
    return runWithAuthRecovery({
        provider: 'google-flow',
        label: 'Google Flow 视频生成',
        metadata: { prompt: options?.prompt },
        run: () => runWithExecutionMode({
        mode: options?.executionMode,
        provider: 'google-flow',
        label: 'Google Flow 视频生成',
        http: () => generateFlowVideoHttp({
            ...options,
            modelId: resolveProtocolModelId(options?.modelId, FLOW_BASELINE_VIDEO_MODEL)
        })
        })
    });
}
