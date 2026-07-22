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

export const GOOGLE_FLOW_IMAGE_WORKFLOW_MODEL_ID = 'google-flow-nano-banana-2';
// 画布模型 id → Ops-Cli text_to_image --model 值（Flow Image 模式下拉里的模型名）。
export const GOOGLE_FLOW_IMAGE_WORKFLOW_MODELS = {
    'google-flow-nano-banana-2': 'Nano Banana 2',
    'google-flow-nano-banana-pro': 'Nano Banana Pro'
};
export const GOOGLE_FLOW_IMAGE_SUPPORTED_ASPECT_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16'];

export function isGoogleFlowImageWorkflowModel(modelId) {
    return Object.prototype.hasOwnProperty.call(GOOGLE_FLOW_IMAGE_WORKFLOW_MODELS, modelId);
}

export function resolveGoogleFlowImageModelName(modelId) {
    return GOOGLE_FLOW_IMAGE_WORKFLOW_MODELS[modelId] || 'Nano Banana 2';
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

function resolveLocalLibraryImage(input, libraryDir) {
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
        throw new Error('Google Flow 参考图路径超出素材库范围');
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        throw new Error(`Google Flow 参考图文件不存在：${resolved}`);
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

async function downloadRemoteImage(input, taskDir, index) {
    if (!/^https?:\/\//.test(String(input || ''))) return null;
    const url = new URL(input);
    if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) return null;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Google Flow 参考图下载失败：HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('image/')) {
        throw new Error('Google Flow 参考图下载结果不是图片');
    }
    const extension = inferImageExtension(url.pathname, contentType);
    const target = path.join(taskDir, `reference-${index + 1}.${extension}`);
    fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
    return target;
}

export async function resolveGoogleFlowReferenceImages(inputs, libraryDir, taskDir) {
    const references = [];
    for (const [index, input] of (inputs || []).entries()) {
        const localPath = resolveLocalLibraryImage(input, libraryDir);
        if (localPath) {
            references.push(localPath);
            continue;
        }
        const dataPath = writeDataUrlImage(input, taskDir, index);
        if (dataPath) {
            references.push(dataPath);
            continue;
        }
        const remotePath = await downloadRemoteImage(input, taskDir, index);
        if (remotePath) {
            references.push(remotePath);
            continue;
        }
        throw new Error(`Google Flow 无法读取第 ${index + 1} 张参考图`);
    }
    return references;
}

export async function loadGoogleFlowImageResult(outputs) {
    const image = Array.isArray(outputs?.images) ? outputs.images[0] : null;
    const imagePath = image?.path || (Array.isArray(outputs?.image_paths) ? outputs.image_paths[0] : null);
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
        throw new Error('Google Flow 文生图 workflow 完成，但没有可用的图片文件或下载地址');
    }
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Google Flow 图片下载失败：HTTP ${response.status}`);
    return {
        buffer: Buffer.from(await response.arrayBuffer()),
        extension: inferImageExtension(imageUrl, response.headers.get('content-type') || ''),
        source: 'workflow-url'
    };
}

export function buildGoogleFlowImageWorkflowArgs({
    prompt,
    aspectRatio,
    referenceImages = [],
    outputDir,
    timeoutMinutes,
    flowModel = 'Nano Banana 2'
}) {
    const args = [
        '--prompt', String(prompt).trim(),
        '--aspect-ratio', aspectRatio,
        '--count', '1',
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
    modelId
}) {
    if (!String(prompt || '').trim()) throw new Error('Google Flow 图片提示词不能为空');
    if (!GOOGLE_FLOW_IMAGE_SUPPORTED_ASPECT_RATIOS.includes(aspectRatio)) {
        throw new Error('Google Flow 文生图画面比例只支持 16:9、4:3、1:1、3:4 或 9:16');
    }

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
                    flowModel: resolveGoogleFlowImageModelName(modelId)
                })
            ]
        });
        const result = await loadGoogleFlowImageResult(data);
        return { ...result, runId };
    } finally {
        fs.rmSync(taskDir, { recursive: true, force: true });
    }
}

export function generateGoogleFlowWorkflowImage(options) {
    return enqueueGoogleFlowWorkflow(() => executeGoogleFlowImageWorkflow(options));
}
