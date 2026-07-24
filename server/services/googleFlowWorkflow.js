/**
 * Google Flow workflow 适配器。
 *
 * 调用内置的 server/python/ops_cli（image-to-video google-flow generate）
 * 驱动 Evan 内置 Chromium，不在 Node 层复制任何 Google Flow 页面自动化逻辑。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enqueueGoogleFlowWorkflow } from './googleFlowWorkflowQueue.js';
import { runOpsCli } from './opsCliRunner.js';

export const GOOGLE_FLOW_WORKFLOW_MODEL_ID = 'google-flow-omni-flash';
export const GOOGLE_FLOW_VEO_3_1_LITE_WORKFLOW_MODEL_ID = 'google-flow-veo-3-1-lite';
export const GOOGLE_FLOW_WORKFLOW_MODELS = {
    [GOOGLE_FLOW_WORKFLOW_MODEL_ID]: 'Omni Flash',
    [GOOGLE_FLOW_VEO_3_1_LITE_WORKFLOW_MODEL_ID]: 'Veo 3.1 - Lite'
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

function resolveFirstFrame(input, libraryDir, taskDir) {
    const localPath = resolveLocalLibraryImage(input, libraryDir);
    if (localPath) return localPath;
    const dataPath = writeDataUrlImage(input, taskDir);
    if (dataPath) return dataPath;
    throw new Error('Google Flow workflow 需要连接一张本地首帧图片');
}

function resolveReferenceImages(inputs, libraryDir, taskDir) {
    // Ingredients 多参考图：逐张解析为本地文件（素材库路径或 data URL），保持顺序。
    return (Array.isArray(inputs) ? inputs : []).map((input, index) => {
        const localPath = resolveLocalLibraryImage(input, libraryDir);
        if (localPath) return localPath;
        const dataPath = writeDataUrlImage(input, taskDir, `ingredient-${index}`);
        if (dataPath) return dataPath;
        throw new Error(`Google Flow workflow 参考图无法解析（第 ${index + 1} 张，需素材库图片或本地图片）`);
    });
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
        throw new Error('Google Flow workflow 完成，但没有可用的视频文件或下载地址');
    }
    const response = await fetch(videoUrl);
    if (!response.ok) throw new Error(`Google Flow 视频下载失败：HTTP ${response.status}`);
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const extension = contentType.includes('webm') ? 'webm' : 'mp4';
    return {
        buffer: Buffer.from(await response.arrayBuffer()),
        extension,
        source: 'workflow-url'
    };
}

async function executeGoogleFlowWorkflow({
    prompt,
    firstFrameInput,
    referenceImageInputs = [],
    aspectRatio,
    duration,
    modelId = GOOGLE_FLOW_WORKFLOW_MODEL_ID,
    libraryDir,
    timeoutMinutes = 15
}) {
    if (!String(prompt || '').trim()) throw new Error('Google Flow 视频提示词不能为空');
    if (!GOOGLE_FLOW_SUPPORTED_ASPECT_RATIOS.includes(aspectRatio)) {
        throw new Error('Google Flow 画面比例只支持 16:9 或 9:16');
    }
    // 未传时长 = 该模型不提供时长选择，用占位值；显式传了非法值才算用户错误。
    const effectiveDuration = duration === undefined || duration === null || duration === ''
        ? GOOGLE_FLOW_DEFAULT_DURATION
        : Number(duration);
    if (!GOOGLE_FLOW_SUPPORTED_DURATIONS.includes(effectiveDuration)) {
        throw new Error('Google Flow 视频时长只支持 4、6、8、10 秒');
    }

    const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-google-flow-'));
    try {
        // 连 2 张以上 → Ingredients 多参考图；否则单张首帧。
        const useIngredients = Array.isArray(referenceImageInputs) && referenceImageInputs.length >= 2;
        const firstFrame = useIngredients ? null : resolveFirstFrame(firstFrameInput, libraryDir, taskDir);
        const referenceImages = useIngredients
            ? resolveReferenceImages(referenceImageInputs, libraryDir, taskDir)
            : [];
        const outputDir = path.join(taskDir, 'output');
        const { data, runId } = await runOpsCli({
            label: 'Google Flow 视频生成',
            timeoutMs: (timeoutMinutes + 2) * 60 * 1000,
            args: [
                'image-to-video', 'google-flow', 'generate',
                ...buildGoogleFlowWorkflowArgs({
                    prompt,
                    firstFrame,
                    referenceImages,
                    duration: effectiveDuration,
                    model: resolveGoogleFlowModelLabel(modelId),
                    aspectRatio,
                    outputDir,
                    timeoutMinutes
                })
            ]
        });
        const result = await loadVideoResult(data);
        return { ...result, runId };
    } finally {
        fs.rmSync(taskDir, { recursive: true, force: true });
    }
}

export function buildGoogleFlowWorkflowArgs({
    prompt,
    firstFrame,
    referenceImages = [],
    duration,
    model = 'Omni Flash',
    aspectRatio,
    outputDir,
    timeoutMinutes
}) {
    const args = ['--prompt', String(prompt).trim()];
    // 传了多参考图 → Ingredients（--reference-image ×N）；否则单张 --first-frame。
    if (Array.isArray(referenceImages) && referenceImages.length > 0) {
        for (const ref of referenceImages) {
            args.push('--reference-image', ref);
        }
    } else {
        args.push('--first-frame', firstFrame);
    }
    args.push(
        '--duration', String(duration),
        '--aspect-ratio', aspectRatio,
        '--model', model,
        '--output-dir', outputDir,
        '--timeout-minutes', String(timeoutMinutes),
        '--execute'
    );
    return args;
}

export function generateGoogleFlowWorkflowVideo(options) {
    return enqueueGoogleFlowWorkflow(() => executeGoogleFlowWorkflow(options));
}
