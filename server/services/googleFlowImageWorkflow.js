/**
 * Google Flow 文生图 workflow 适配器。
 *
 * 只负责把画布参数转成运营项目的 text_to_image_generate 参数，
 * 页面自动化、登录态恢复和产物下载继续由运营项目与 Ops-Cli 负责。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractWorkflowJson } from './googleFlowWorkflow.js';
import { enqueueGoogleFlowWorkflow } from './googleFlowWorkflowQueue.js';

export const GOOGLE_FLOW_IMAGE_WORKFLOW_MODEL_ID = 'google-flow-nano-banana-2';
export const GOOGLE_FLOW_IMAGE_SUPPORTED_ASPECT_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16'];

const DEFAULT_WORKFLOW_ROOT = path.join(
    os.homedir(),
    'Desktop',
    '电商Brain',
    '02-运营店铺',
    '运营自动化工具'
);

function resolveWorkflowRoot() {
    const root = path.resolve(process.env.GOOGLE_FLOW_WORKFLOW_ROOT || DEFAULT_WORKFLOW_ROOT);
    const runPath = path.join(root, 'run.py');
    if (!fs.existsSync(runPath)) {
        throw new Error(`未找到 Google Flow 文生图 workflow：${runPath}`);
    }
    return { root, runPath };
}

function runWorkflowProcess({ root, runPath, args, timeoutMs }) {
    const venvPython = path.join(root, '.venv', 'bin', 'python');
    const python = fs.existsSync(venvPython) ? venvPython : 'python3';

    return new Promise((resolve, reject) => {
        const child = spawn(python, [runPath, 'workflow', 'text_to_image_generate', '--provider', 'google-flow', ...args], {
            cwd: root,
            env: {
                ...process.env,
                NF_DISABLE: '1',
                PYTHONUNBUFFERED: '1'
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error('Google Flow 文生图 workflow 执行超时'));
        }, timeoutMs);

        child.stdout.on('data', chunk => { stdout += chunk.toString(); });
        child.stderr.on('data', chunk => { stderr += chunk.toString(); });
        child.on('error', error => {
            clearTimeout(timer);
            reject(error);
        });
        child.on('close', code => {
            clearTimeout(timer);
            let payload;
            try {
                payload = extractWorkflowJson(stdout);
            } catch (error) {
                reject(new Error(`${error.message}${stderr.trim() ? `：${stderr.trim()}` : ''}`));
                return;
            }
            if (code !== 0 || !['success', 'dry_run_success'].includes(payload.status)) {
                const detail = payload.errors?.[0] || stderr.trim() || `进程退出码 ${code}`;
                reject(new Error(`Google Flow 文生图 workflow 失败：${detail}`));
                return;
            }
            resolve(payload);
        });
    });
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
    timeoutMinutes
}) {
    const args = [
        '--prompt', String(prompt).trim(),
        '--aspect-ratio', aspectRatio,
        '--count', '1',
        '--model', 'Nano Banana 2',
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
    timeoutMinutes = 10
}) {
    if (!String(prompt || '').trim()) throw new Error('Google Flow 图片提示词不能为空');
    if (!GOOGLE_FLOW_IMAGE_SUPPORTED_ASPECT_RATIOS.includes(aspectRatio)) {
        throw new Error('Google Flow 文生图画面比例只支持 16:9、4:3、1:1、3:4 或 9:16');
    }

    const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-google-flow-image-'));
    try {
        const outputDir = path.join(taskDir, 'output');
        const referenceImages = await resolveGoogleFlowReferenceImages(referenceImageInputs, libraryDir, taskDir);
        const { root, runPath } = resolveWorkflowRoot();
        const payload = await runWorkflowProcess({
            root,
            runPath,
            timeoutMs: (timeoutMinutes + 2) * 60 * 1000,
            args: buildGoogleFlowImageWorkflowArgs({
                prompt,
                aspectRatio,
                referenceImages,
                outputDir,
                timeoutMinutes
            })
        });
        const result = await loadGoogleFlowImageResult(payload.outputs);
        return { ...result, runId: payload.run_id };
    } finally {
        fs.rmSync(taskDir, { recursive: true, force: true });
    }
}

export function generateGoogleFlowWorkflowImage(options) {
    return enqueueGoogleFlowWorkflow(() => executeGoogleFlowImageWorkflow(options));
}
