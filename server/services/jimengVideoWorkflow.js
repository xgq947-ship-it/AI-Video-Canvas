/**
 * 即梦（Seedance）视频生成适配器。
 *
 * 调用内置的 server/python/ops_cli（image-to-video jimeng generate）
 * 驱动 Evan 专属 Chrome，不在 Node 层复制任何即梦页面自动化逻辑。
 *
 * 与 Google Flow 适配器的差异：
 * - 即梦是「文字为主、参考素材可选」：节点不接图也能生成（纯文生视频）。
 * - 没有首帧概念，连进来的图一律作为参考素材（最多 12 个）。
 * - 多一个分辨率维度（720P/1080P/4K）。
 * 两个 provider 共用同一个 Evan 专属 Chrome 串行队列。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enqueueBrowserWorkflow } from './googleFlowWorkflowQueue.js';
import { runOpsCli } from './opsCliRunner.js';
import {
    resolveLocalLibraryImage,
    writeDataUrlImage
} from './googleFlowWorkflow.js';
import { fetchWorkflowMedia } from '../utils/workflowMedia.js';

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

function resolveReferenceImages(inputs, libraryDir, taskDir) {
    return (Array.isArray(inputs) ? inputs : []).filter(Boolean).map((input, index) => {
        const localPath = resolveLocalLibraryImage(input, libraryDir);
        if (localPath) return localPath;
        const dataPath = writeDataUrlImage(input, taskDir, `jimeng-ref-${index}`);
        if (dataPath) return dataPath;
        throw new Error(`即梦参考素材无法解析（第 ${index + 1} 张，需素材库图片或本地图片）`);
    });
}

export function buildJimengWorkflowArgs({
    prompt,
    referenceImages = [],
    referenceLabels = [],
    duration,
    aspectRatio,
    resolution,
    model = JIMENG_DEFAULT_MODEL,
    outputDir,
    timeoutMinutes
}) {
    const args = ['--prompt', String(prompt).trim()];
    // 即梦没有首帧概念：连进来的图全部作为参考素材；一张都没有就是纯文生视频。
    // 每张都带上它在画布里的名字（参考图1 / 素材名），即梦会用这个名字当素材标签，
    // 提示词里的 @xxx 才能精确指到这张图，而不是靠上传顺序猜。
    referenceImages.forEach((ref, index) => {
        args.push('--reference-image', ref);
        const label = referenceLabels[index];
        if (label) args.push('--reference-name', String(label));
    });
    args.push(
        '--duration', String(duration),
        '--aspect-ratio', aspectRatio,
        '--resolution', resolution,
        '--count', '1',
        '--model', model,
        '--output-dir', outputDir,
        '--timeout-minutes', String(timeoutMinutes),
        '--execute'
    );
    return args;
}

async function loadVideoResult(outputs) {
    const videoPath = outputs?.video_path ? path.resolve(outputs.video_path) : null;
    if (videoPath && fs.existsSync(videoPath) && fs.statSync(videoPath).isFile()) {
        return {
            buffer: fs.readFileSync(videoPath),
            extension: path.extname(videoPath).slice(1).toLowerCase() || 'mp4',
            source: 'workflow-file'
        };
    }

    const videoUrl = outputs?.video_url;
    if (!videoUrl || !/^https?:\/\//.test(videoUrl)) {
        throw new Error(
            '即梦已生成视频，但没有可用的视频文件或下载地址。'
            + '请先到即梦历史会话中下载结果，不要直接重新生成。'
        );
    }
    const downloaded = await fetchWorkflowMedia(videoUrl, {
        providerName: '即梦',
        expectedType: 'video',
        recoveryHint: '请先到即梦历史会话中下载本次结果，不要直接重新生成。'
    });
    const contentType = downloaded.contentType;
    const extension = contentType.includes('webm') ? 'webm' : 'mp4';
    return {
        buffer: downloaded.buffer,
        extension,
        source: 'workflow-url'
    };
}

async function executeJimengWorkflow({
    prompt,
    referenceImageInputs = [],
    referenceLabels = [],
    aspectRatio,
    duration,
    resolution,
    model = JIMENG_DEFAULT_MODEL,
    libraryDir,
    timeoutMinutes = 15,
    signal
}) {
    if (!String(prompt || '').trim()) throw new Error('即梦视频提示词不能为空');
    if (!JIMENG_SUPPORTED_ASPECT_RATIOS.includes(aspectRatio)) {
        throw new Error(`即梦画面比例只支持 ${JIMENG_SUPPORTED_ASPECT_RATIOS.join(' / ')}`);
    }
    if (!JIMENG_SUPPORTED_DURATIONS.includes(Number(duration))) {
        throw new Error(`即梦视频时长只支持 ${JIMENG_SUPPORTED_DURATIONS.join('、')} 秒`);
    }
    const normalizedResolution = normalizeJimengResolution(resolution);
    // 先按同一条索引过滤图与名字，避免过滤后两边错位（错位 = 提示词指错素材）。
    const paired = (Array.isArray(referenceImageInputs) ? referenceImageInputs : [])
        .map((input, index) => ({ input, label: referenceLabels[index] }))
        .filter(item => Boolean(item.input));
    const inputs = paired.map(item => item.input);
    const labels = paired.map(item => item.label);
    if (inputs.length > JIMENG_MAX_REFERENCE_IMAGES) {
        throw new Error(`即梦最多支持 ${JIMENG_MAX_REFERENCE_IMAGES} 个参考素材，当前 ${inputs.length} 个`);
    }

    const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-jimeng-'));
    try {
        const referenceImages = resolveReferenceImages(inputs, libraryDir, taskDir);
        const outputDir = path.join(taskDir, 'output');
        const { data, runId } = await runOpsCli({
            label: '即梦视频生成',
            signal,
            timeoutMs: (timeoutMinutes + 2) * 60 * 1000,
            args: [
                'image-to-video', 'jimeng', 'generate',
                ...buildJimengWorkflowArgs({
                    prompt,
                    referenceImages,
                    referenceLabels: labels,
                    duration,
                    aspectRatio,
                    resolution: normalizedResolution,
                    model,
                    outputDir,
                    timeoutMinutes
                })
            ]
        });
        const result = await loadVideoResult(data);
        return { ...result, runId };
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

export function generateJimengWorkflowVideo(options) {
    return enqueueBrowserWorkflow(
        () => executeJimengWorkflow(options),
        { label: '即梦视频生成', signal: options?.signal }
    );
}
