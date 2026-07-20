/**
 * Google Flow workflow 适配器。
 *
 * 通过运营自动化工具的 image_to_video_generate workflow（--provider google-flow）
 * 调用可见的 9222 Chrome 页面，不在 Evan 内复制任何 Google Flow 页面自动化逻辑。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enqueueGoogleFlowWorkflow } from './googleFlowWorkflowQueue.js';

export const GOOGLE_FLOW_WORKFLOW_MODEL_ID = 'google-flow-omni-flash';
export const GOOGLE_FLOW_SUPPORTED_DURATIONS = [4, 6, 8, 10];
export const GOOGLE_FLOW_SUPPORTED_ASPECT_RATIOS = ['16:9', '9:16'];

const DEFAULT_WORKFLOW_ROOT = path.join(
    os.homedir(),
    'Desktop',
    '电商Brain',
    '02-运营店铺',
    '运营自动化工具'
);

export function extractWorkflowJson(stdout) {
    const source = String(stdout || '');
    for (let start = source.indexOf('{'); start >= 0; start = source.indexOf('{', start + 1)) {
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let index = start; index < source.length; index += 1) {
            const char = source[index];
            if (inString) {
                if (escaped) escaped = false;
                else if (char === '\\') escaped = true;
                else if (char === '"') inString = false;
                continue;
            }
            if (char === '"') inString = true;
            else if (char === '{') depth += 1;
            else if (char === '}') {
                depth -= 1;
                if (depth === 0) {
                    try {
                        return JSON.parse(source.slice(start, index + 1));
                    } catch {
                        break;
                    }
                }
            }
        }
    }
    throw new Error('Google Flow workflow 未返回可解析的 JSON 结果');
}

function resolveWorkflowRoot() {
    const root = path.resolve(process.env.GOOGLE_FLOW_WORKFLOW_ROOT || DEFAULT_WORKFLOW_ROOT);
    const runPath = path.join(root, 'run.py');
    if (!fs.existsSync(runPath)) {
        throw new Error(`未找到 Google Flow workflow：${runPath}`);
    }
    return { root, runPath };
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

function writeDataUrlImage(input, taskDir, basename = 'first-frame') {
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

function runWorkflowProcess({ root, runPath, args, timeoutMs }) {
    const venvPython = path.join(root, '.venv', 'bin', 'python');
    const python = fs.existsSync(venvPython) ? venvPython : 'python3';

    return new Promise((resolve, reject) => {
        const child = spawn(python, [runPath, 'workflow', 'image_to_video_generate', '--provider', 'google-flow', ...args], {
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
            reject(new Error('Google Flow workflow 执行超时'));
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
                reject(new Error(`Google Flow workflow 失败：${detail}`));
                return;
            }
            resolve(payload);
        });
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
    libraryDir,
    timeoutMinutes = 15
}) {
    if (!String(prompt || '').trim()) throw new Error('Google Flow 视频提示词不能为空');
    if (!GOOGLE_FLOW_SUPPORTED_ASPECT_RATIOS.includes(aspectRatio)) {
        throw new Error('Google Flow 画面比例只支持 16:9 或 9:16');
    }
    if (!GOOGLE_FLOW_SUPPORTED_DURATIONS.includes(Number(duration))) {
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
        const { root, runPath } = resolveWorkflowRoot();
        const payload = await runWorkflowProcess({
            root,
            runPath,
            timeoutMs: (timeoutMinutes + 2) * 60 * 1000,
            args: buildGoogleFlowWorkflowArgs({
                prompt,
                firstFrame,
                referenceImages,
                duration,
                aspectRatio,
                outputDir,
                timeoutMinutes
            })
        });
        const result = await loadVideoResult(payload.outputs);
        return { ...result, runId: payload.run_id };
    } finally {
        fs.rmSync(taskDir, { recursive: true, force: true });
    }
}

export function buildGoogleFlowWorkflowArgs({
    prompt,
    firstFrame,
    referenceImages = [],
    duration,
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
        '--model', 'Omni Flash',
        '--output-dir', outputDir,
        '--timeout-minutes', String(timeoutMinutes),
        '--execute'
    );
    return args;
}

export function generateGoogleFlowWorkflowVideo(options) {
    return enqueueGoogleFlowWorkflow(() => executeGoogleFlowWorkflow(options));
}
