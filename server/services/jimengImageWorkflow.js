/**
 * 即梦 图片 5.0 生图 workflow 适配器。
 *
 * 页面自动化位于 Python Ops CLI；本层只负责模型映射、参考图落盘、串行调度和结果读取。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runOpsCli } from './opsCliRunner.js';
import { enqueueBrowserWorkflow } from './googleFlowWorkflowQueue.js';
import {
    loadBrowserImageResults,
    resolveBrowserReferenceImages
} from './googleFlowImageWorkflow.js';

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

export function buildJimengImageWorkflowArgs({
    prompt,
    referenceImages = [],
    aspectRatio,
    resolution,
    outputDir,
    timeoutMinutes,
    model,
    count = 1
}) {
    const args = [
        '--prompt', String(prompt).trim(),
        '--aspect-ratio', aspectRatio,
        '--resolution', normalizeJimengImageResolution(resolution),
        '--count', String(normalizeJimengImageCount(count)),
        '--model', model,
        '--output-dir', outputDir,
        '--timeout-minutes', String(timeoutMinutes)
    ];
    for (const referenceImage of referenceImages) {
        args.push('--reference-image', referenceImage);
    }
    args.push('--execute');
    return args;
}

async function executeJimengImageWorkflow({
    prompt,
    aspectRatio,
    resolution,
    referenceImageInputs = [],
    libraryDir,
    timeoutMinutes = 10,
    modelId,
    count = 1,
    signal
}) {
    if (!String(prompt || '').trim()) throw new Error('即梦图片提示词不能为空');
    if (!JIMENG_IMAGE_SUPPORTED_ASPECT_RATIOS.includes(aspectRatio)) {
        throw new Error(`即梦图片比例只支持 ${JIMENG_IMAGE_SUPPORTED_ASPECT_RATIOS.join('、')}`);
    }
    if (referenceImageInputs.length > JIMENG_IMAGE_MAX_REFERENCES) {
        throw new Error(`即梦图片生成最多支持 ${JIMENG_IMAGE_MAX_REFERENCES} 张参考图`);
    }
    const normalizedCount = normalizeJimengImageCount(count);

    const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-jimeng-image-'));
    try {
        const outputDir = path.join(taskDir, 'output');
        const referenceImages = await resolveBrowserReferenceImages(
            referenceImageInputs,
            libraryDir,
            taskDir,
            { providerName: '即梦' }
        );
        const { data, runId } = await runOpsCli({
            label: '即梦图片生成',
            signal,
            // +4 而不是 +2：Python 侧在第 timeoutMinutes 分钟判超时后，还要留出
            // 「只读补收」的时间把已经产出的结果收回来。余量给太紧的话，兜底刚开始
            // 跑就被这里 kill 掉，用户拿到的还是「执行超时」（本机 07:13 那次实测）。
            timeoutMs: (timeoutMinutes + 4) * 60 * 1000,
            args: [
                'text-to-image', 'jimeng', 'generate',
                ...buildJimengImageWorkflowArgs({
                    prompt,
                    aspectRatio,
                    resolution,
                    referenceImages,
                    outputDir,
                    timeoutMinutes,
                    model: resolveJimengImageModelLabel(modelId),
                    count: normalizedCount
                })
            ]
        });
        const images = await loadBrowserImageResults(data, { providerName: '即梦图片生成' });
        return { images, runId };
    } finally {
        // Windows 上子进程可能还持着任务目录里的句柄，rmSync 会抛 EBUSY/EPERM。
        // 这里在 finally 里，抛出去会把真正的失败原因整个盖掉（生成配额已经花了，
        // 用户却只看到一条删临时目录的错）。清理失败不影响结果，记一条日志即可。
        try {
            fs.rmSync(taskDir, { recursive: true, force: true });
        } catch (cleanupError) {
            console.warn(`[workflow] 无法清理临时目录 ${taskDir}：${cleanupError.message}`);
        }
    }
}

export function generateJimengWorkflowImage(options) {
    return enqueueBrowserWorkflow(
        () => executeJimengImageWorkflow(options),
        { label: '即梦图片生成', signal: options?.signal }
    );
}
