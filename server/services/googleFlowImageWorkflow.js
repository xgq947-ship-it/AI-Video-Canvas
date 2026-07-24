/**
 * Google Flow 文生图 workflow 适配器。
 *
 * 只负责把画布参数转成 ops_cli 的 text-to-image 参数，
 * 页面自动化、登录态恢复和产物下载由 server/python 下的 provider 负责。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runOpsCli } from './opsCliRunner.js';
import { enqueueGoogleFlowWorkflow } from './googleFlowWorkflowQueue.js';
import { fetchWorkflowMedia } from '../utils/workflowMedia.js';

export const GOOGLE_FLOW_IMAGE_WORKFLOW_MODEL_ID = 'google-flow-nano-banana-2';
// 画布模型 id → Ops-Cli text_to_image --model 值（Flow Image 模式下拉里的模型名）。
export const GOOGLE_FLOW_IMAGE_WORKFLOW_MODELS = {
    'google-flow-nano-banana-pro': 'Nano Banana Pro',
    'google-flow-nano-banana-2': 'Nano Banana 2',
    'google-flow-nano-banana-2-lite': 'Nano Banana 2 Lite'
};
export const GOOGLE_FLOW_IMAGE_SUPPORTED_ASPECT_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16'];
export const GOOGLE_FLOW_IMAGE_MAX_COUNT = 4;

export function isGoogleFlowImageWorkflowModel(modelId) {
    return Object.prototype.hasOwnProperty.call(GOOGLE_FLOW_IMAGE_WORKFLOW_MODELS, modelId);
}

export function resolveGoogleFlowImageModelName(modelId) {
    return GOOGLE_FLOW_IMAGE_WORKFLOW_MODELS[modelId] || 'Nano Banana 2';
}

export function normalizeGoogleFlowImageCount(value) {
    const count = Number(value ?? 1);
    if (!Number.isInteger(count) || count < 1 || count > GOOGLE_FLOW_IMAGE_MAX_COUNT) {
        throw new Error(`Google Flow 图片生成数量只支持 1-${GOOGLE_FLOW_IMAGE_MAX_COUNT}`);
    }
    return count;
}

function inferImageExtension(value, contentType = '') {
    const normalizedType = String(contentType).toLowerCase();
    if (normalizedType.includes('webp')) return 'webp';
    if (normalizedType.includes('jpeg') || normalizedType.includes('jpg')) return 'jpg';
    const extension = path.extname(String(value || '').split(/[?#]/)[0]).slice(1).toLowerCase();
    if (['png', 'jpg', 'jpeg', 'webp'].includes(extension)) {
        return extension === 'jpeg' ? 'jpg' : extension;
    }
    return 'png';
}

function resolveLocalLibraryImage(input, libraryDir, providerName) {
    if (!input || typeof input !== 'string') return null;
    let candidate = input;
    if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
        const url = new URL(candidate);
        if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) return null;
        candidate = url.pathname;
    }
    if (!candidate.startsWith('/library/')) return null;

    const cleanPath = decodeURIComponent(candidate.split('?')[0].split('#')[0]);
    const root = path.resolve(libraryDir || process.env.LIBRARY_DIR || path.join(process.cwd(), 'library'));
    const resolved = path.resolve(root, cleanPath.replace(/^\/library\//, ''));
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
        throw new Error(`${providerName}参考图路径超出素材库范围`);
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        throw new Error(`${providerName}参考图文件不存在：${resolved}`);
    }
    return resolved;
}

function writeDataUrlImage(input, taskDir, index) {
    const match = String(input || '').match(/^data:image\/(png|jpeg|jpg|webp);base64,([\s\S]+)$/i);
    if (!match) return null;
    const extension = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
    const target = path.join(taskDir, `reference-${index + 1}.${extension}`);
    fs.writeFileSync(target, Buffer.from(match[2], 'base64'));
    return target;
}

async function downloadRemoteImage(input, taskDir, index, providerName) {
    if (!/^https?:\/\//.test(String(input || ''))) return null;
    const url = new URL(input);
    if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) return null;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${providerName}参考图下载失败：HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('image/')) {
        throw new Error(`${providerName}参考图下载结果不是图片`);
    }
    const extension = inferImageExtension(url.pathname, contentType);
    const target = path.join(taskDir, `reference-${index + 1}.${extension}`);
    fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
    return target;
}

export async function resolveBrowserReferenceImages(
    inputs,
    libraryDir,
    taskDir,
    { providerName = '浏览器生图' } = {}
) {
    const references = [];
    for (const [index, input] of (inputs || []).entries()) {
        const localPath = resolveLocalLibraryImage(input, libraryDir, providerName);
        if (localPath) {
            references.push(localPath);
            continue;
        }
        const dataPath = writeDataUrlImage(input, taskDir, index);
        if (dataPath) {
            references.push(dataPath);
            continue;
        }
        const remotePath = await downloadRemoteImage(input, taskDir, index, providerName);
        if (remotePath) {
            references.push(remotePath);
            continue;
        }
        throw new Error(`${providerName}无法读取第 ${index + 1} 张参考图`);
    }
    return references;
}

export function resolveGoogleFlowReferenceImages(inputs, libraryDir, taskDir) {
    return resolveBrowserReferenceImages(inputs, libraryDir, taskDir, { providerName: 'Google Flow' });
}

async function loadBrowserImageEntry(image, fallbackPath, providerName) {
    const imagePath = image?.path || fallbackPath;
    if (imagePath) {
        const resolved = path.resolve(imagePath);
        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
            return {
                buffer: fs.readFileSync(resolved),
                extension: inferImageExtension(resolved),
                source: 'workflow-file'
            };
        }
    }

    const imageUrl = image?.url;
    if (!imageUrl || !/^https?:\/\//.test(imageUrl)) {
        throw new Error(
            `${providerName} 已生成结果，但没有可用的图片文件或下载地址。`
            + '请先到对应平台历史记录中下载结果，不要直接重新生成。'
        );
    }
    const downloaded = await fetchWorkflowMedia(imageUrl, {
        providerName,
        expectedType: 'image',
        recoveryHint: '请先到对应平台历史记录中下载本次结果，不要直接重新生成。'
    });
    return {
        buffer: downloaded.buffer,
        extension: inferImageExtension(imageUrl, downloaded.contentType),
        source: 'workflow-url'
    };
}

export async function loadBrowserImageResults(outputs, { providerName = '浏览器生图' } = {}) {
    const images = Array.isArray(outputs?.images) ? outputs.images : [];
    const imagePaths = Array.isArray(outputs?.image_paths) ? outputs.image_paths : [];
    const resultCount = Math.max(images.length, imagePaths.length);
    if (resultCount === 0) {
        throw new Error(
            `${providerName} 已完成生成，但没有返回可保存的图片结果。`
            + '请先到对应平台历史记录中确认并下载，不要直接重新生成。'
        );
    }

    const results = [];
    for (let index = 0; index < resultCount; index += 1) {
        results.push(await loadBrowserImageEntry(images[index], imagePaths[index], providerName));
    }
    return results;
}

export async function loadBrowserImageResult(outputs, options = {}) {
    const results = await loadBrowserImageResults(outputs, options);
    return results[0];
}

export function loadGoogleFlowImageResult(outputs) {
    return loadBrowserImageResult(outputs, { providerName: 'Google Flow 文生图' });
}

export function buildGoogleFlowImageWorkflowArgs({
    prompt,
    aspectRatio,
    referenceImages = [],
    outputDir,
    timeoutMinutes,
    flowModel = 'Nano Banana 2',
    count = 1
}) {
    const args = [
        '--prompt', String(prompt).trim(),
        '--aspect-ratio', aspectRatio,
        '--count', String(normalizeGoogleFlowImageCount(count)),
        '--model', flowModel,
        '--output-dir', outputDir,
        '--timeout-minutes', String(timeoutMinutes)
    ];
    for (const referenceImage of referenceImages) {
        args.push('--reference-image', referenceImage);
    }
    args.push('--execute');
    return args;
}

async function executeGoogleFlowImageWorkflow({
    prompt,
    aspectRatio,
    referenceImageInputs = [],
    libraryDir,
    timeoutMinutes = 10,
    modelId,
    count = 1
}) {
    if (!String(prompt || '').trim()) throw new Error('Google Flow 图片提示词不能为空');
    if (!GOOGLE_FLOW_IMAGE_SUPPORTED_ASPECT_RATIOS.includes(aspectRatio)) {
        throw new Error('Google Flow 文生图画面比例只支持 16:9、4:3、1:1、3:4 或 9:16');
    }
    const normalizedCount = normalizeGoogleFlowImageCount(count);

    const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-google-flow-image-'));
    try {
        const outputDir = path.join(taskDir, 'output');
        const referenceImages = await resolveGoogleFlowReferenceImages(referenceImageInputs, libraryDir, taskDir);
        const { data, runId } = await runOpsCli({
            label: 'Google Flow 文生图',
            timeoutMs: (timeoutMinutes + 2) * 60 * 1000,
            args: [
                'text-to-image', 'google-flow', 'generate',
                ...buildGoogleFlowImageWorkflowArgs({
                    prompt,
                    aspectRatio,
                    referenceImages,
                    outputDir,
                    timeoutMinutes,
                    flowModel: resolveGoogleFlowImageModelName(modelId),
                    count: normalizedCount
                })
            ]
        });
        const images = await loadBrowserImageResults(data, { providerName: 'Google Flow 文生图' });
        // Keep the legacy first-image fields for product-scene jobs and other
        // single-image callers while exposing the complete batch to the
        // generation route.
        return {
            images,
            buffer: images[0].buffer,
            extension: images[0].extension,
            source: images[0].source,
            runId
        };
    } finally {
        fs.rmSync(taskDir, { recursive: true, force: true });
    }
}

export function generateGoogleFlowWorkflowImage(options) {
    return enqueueGoogleFlowWorkflow(() => executeGoogleFlowImageWorkflow(options));
}
