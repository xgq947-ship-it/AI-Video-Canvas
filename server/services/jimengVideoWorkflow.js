/**
 * 即梦（Seedance）视频 workflow 适配器。
 *
 * 通过运营自动化工具的 image_to_video_generate workflow（--provider jimeng）
 * 驱动可见的 9222 Chrome 页面，不在 Evan 内复制任何即梦页面自动化逻辑。
 *
 * 与 Google Flow 适配器的差异：
 * - 即梦是「文字为主、参考素材可选」：节点不接图也能生成（纯文生视频）。
 * - 没有首帧概念，连进来的图一律作为参考素材（最多 12 个）。
 * - 多一个分辨率维度（720P/1080P/4K）。
 * 共用同一个 9222 串行队列——两个 provider 抢同一个浏览器。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enqueueBrowserWorkflow } from './googleFlowWorkflowQueue.js';
import {
    extractWorkflowJson,
    resolveLocalLibraryImage,
    writeDataUrlImage
} from './googleFlowWorkflow.js';

export const JIMENG_WORKFLOW_MODEL_ID = 'jimeng-seedance-2-0';
export const JIMENG_DEFAULT_MODEL = '即梦 Seedance 2.0 VIP';
export const JIMENG_SUPPORTED_DURATIONS = [4, 5, 6, 8, 10, 15];
export const JIMENG_SUPPORTED_ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
export const JIMENG_SUPPORTED_RESOLUTIONS = ['720P', '1080P', '4K'];
export const JIMENG_MAX_REFERENCE_IMAGES = 12;

const DEFAULT_WORKFLOW_ROOT = path.join(
    os.homedir(),
    'Desktop',
    '电商Brain',
    '02-运营店铺',
    '运营自动化工具'
);

function resolveWorkflowRoot() {
    const root = path.resolve(
        process.env.JIMENG_WORKFLOW_ROOT || process.env.GOOGLE_FLOW_WORKFLOW_ROOT || DEFAULT_WORKFLOW_ROOT
    );
    const runPath = path.join(root, 'run.py');
    if (!fs.existsSync(runPath)) {
        throw new Error(`未找到即梦视频 workflow：${runPath}`);
    }
    return { root, runPath };
}

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
    duration,
    aspectRatio,
    resolution,
    model = JIMENG_DEFAULT_MODEL,
    outputDir,
    timeoutMinutes
}) {
    const args = ['--prompt', String(prompt).trim()];
    // 即梦没有首帧概念：连进来的图全部作为参考素材；一张都没有就是纯文生视频。
    for (const ref of referenceImages) {
        args.push('--reference-image', ref);
    }
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

function runWorkflowProcess({ root, runPath, args, timeoutMs }) {
    const venvPython = path.join(root, '.venv', 'bin', 'python');
    const python = fs.existsSync(venvPython) ? venvPython : 'python3';

    return new Promise((resolve, reject) => {
        const child = spawn(python, [runPath, 'workflow', 'image_to_video_generate', '--provider', 'jimeng', ...args], {
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
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            reject(new Error('即梦视频 workflow 执行超时'));
        }, timeoutMs);

        child.stdout.on('data', chunk => { stdout += chunk.toString(); });
        child.stderr.on('data', chunk => { stderr += chunk.toString(); });
        child.on('error', error => {
            clearTimeout(timer);
            reject(error);
        });
        child.on('close', code => {
            clearTimeout(timer);
            if (timedOut) return;
            let payload;
            try {
                payload = extractWorkflowJson(stdout);
            } catch (error) {
                reject(new Error(`${error.message}${stderr.trim() ? `：${stderr.trim()}` : ''}`));
                return;
            }
            if (code !== 0 || !['success', 'dry_run_success'].includes(payload.status)) {
                const detail = payload.errors?.[0] || stderr.trim() || `进程退出码 ${code}`;
                reject(new Error(`即梦视频 workflow 失败：${detail}`));
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
        throw new Error('即梦视频 workflow 完成，但没有可用的视频文件或下载地址');
    }
    const response = await fetch(videoUrl);
    if (!response.ok) throw new Error(`即梦视频下载失败：HTTP ${response.status}`);
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const extension = contentType.includes('webm') ? 'webm' : 'mp4';
    return {
        buffer: Buffer.from(await response.arrayBuffer()),
        extension,
        source: 'workflow-url'
    };
}

async function executeJimengWorkflow({
    prompt,
    referenceImageInputs = [],
    aspectRatio,
    duration,
    resolution,
    model = JIMENG_DEFAULT_MODEL,
    libraryDir,
    timeoutMinutes = 15
}) {
    if (!String(prompt || '').trim()) throw new Error('即梦视频提示词不能为空');
    if (!JIMENG_SUPPORTED_ASPECT_RATIOS.includes(aspectRatio)) {
        throw new Error(`即梦画面比例只支持 ${JIMENG_SUPPORTED_ASPECT_RATIOS.join(' / ')}`);
    }
    if (!JIMENG_SUPPORTED_DURATIONS.includes(Number(duration))) {
        throw new Error(`即梦视频时长只支持 ${JIMENG_SUPPORTED_DURATIONS.join('、')} 秒`);
    }
    const normalizedResolution = normalizeJimengResolution(resolution);
    const inputs = (Array.isArray(referenceImageInputs) ? referenceImageInputs : []).filter(Boolean);
    if (inputs.length > JIMENG_MAX_REFERENCE_IMAGES) {
        throw new Error(`即梦最多支持 ${JIMENG_MAX_REFERENCE_IMAGES} 个参考素材，当前 ${inputs.length} 个`);
    }

    const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evan-jimeng-'));
    try {
        const referenceImages = resolveReferenceImages(inputs, libraryDir, taskDir);
        const outputDir = path.join(taskDir, 'output');
        const { root, runPath } = resolveWorkflowRoot();
        const payload = await runWorkflowProcess({
            root,
            runPath,
            timeoutMs: (timeoutMinutes + 2) * 60 * 1000,
            args: buildJimengWorkflowArgs({
                prompt,
                referenceImages,
                duration,
                aspectRatio,
                resolution: normalizedResolution,
                model,
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

export function generateJimengWorkflowVideo(options) {
    return enqueueBrowserWorkflow(() => executeJimengWorkflow(options));
}
