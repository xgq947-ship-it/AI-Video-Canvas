/**
 * promptOptimizerProviders.js
 *
 * 提示词优化的可插拔 LLM 后端。系统指令（Seedance 分镜方法论）是与模型无关的纯文本，
 * 存放在 shared/promptOptimizationProfiles.js；这里只负责“把指令送给哪个模型、怎么送”。
 *
 * 由 app.locals.PROMPT_OPTIMIZER_PROVIDER 选择后端（默认 deepseek），PROMPT_OPTIMIZER_MODEL 可覆盖模型。
 * 后端选择既可用环境变量，也可在“配置”弹窗的下拉里选（存到 library/config/optimizer.json）。
 * 新增后端 = 在下面注册表里加一条，路由与提示词模板都不用动。每个后端实现同一接口：
 *   async run({ systemInstruction, userPrompt, apiKey, model, temperature, maxTokens, imageDataUrl }) => string
 * 失败时抛出带 status 的 Error，供路由决定 HTTP 状态码。
 *
 * 后端分两类：
 *   - HTTP API 类（deepseek）：需要 apiKeyField 指向 app.locals 里的密钥。
 *   - 本地 CLI 类（claude-cli / codex-cli）：apiKeyField 为 null，走子进程，用本机已登录的 CLI，无需密钥。
 */

import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { resolveClaudeBin, resolveCodexBin } from './cliPaths.js';
import { decodeProcessOutput } from '../utils/processOutput.js';
import { operationCancelledError } from './operationCancelled.js';
import { runGeminiWebTextTask } from './geminiWebWorkflow.js';

const CLI_TIMEOUT_MS = 180000;
// 与 codexImageAutomation.js 一致：优先 ChatGPT.app 内置 codex，未安装再退回 PATH 里的 codex。
function upstreamError(message, httpStatus) {
    const error = new Error(message);
    error.status = httpStatus >= 500 ? 502 : httpStatus;
    return error;
}

function quoteWindowsCommandArg(value) {
    return `"${String(value).replaceAll('"', '""')}"`;
}

export function buildCliInvocation(
    bin,
    args,
    { platform = process.platform, environment = process.env } = {}
) {
    if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(bin)) {
        return { command: bin, args };
    }
    return {
        command: environment.ComSpec || environment.COMSPEC || 'cmd.exe',
        args: [
            '/d',
            '/s',
            '/c',
            [quoteWindowsCommandArg(bin), ...args.map(quoteWindowsCommandArg)].join(' ')
        ]
    };
}

// ---------------------------------------------------------------------------
// HTTP API 后端
// ---------------------------------------------------------------------------

// DeepSeek：OpenAI 兼容的 chat/completions 协议。
async function runDeepSeek({ systemInstruction, userPrompt, apiKey, model, temperature, maxTokens, signal }) {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        signal,
        body: JSON.stringify({
            model,
            thinking: { type: 'disabled' },
            temperature,
            max_tokens: maxTokens,
            messages: [
                { role: 'system', content: systemInstruction },
                { role: 'user', content: userPrompt }
            ]
        })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw upstreamError(result?.error?.message || `DeepSeek API 请求失败（${response.status}）`, response.status);
    }
    return result?.choices?.[0]?.message?.content || '';
}

// ---------------------------------------------------------------------------
// 本地 CLI 后端（子进程）
// ---------------------------------------------------------------------------

// 通用子进程执行：隔离在临时目录运行避免文件副作用；继承环境变量以复用 CLI 的本机登录；
// 立即关闭 stdin 发送 EOF —— 否则像 codex 这类会读 stdin 的 CLI 会一直卡住等待输入。
function runCli(bin, args, label, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(operationCancelledError(label));
            return;
        }
        let child;
        try {
            const invocation = buildCliInvocation(bin, args);
            child = execFile(invocation.command, invocation.args, {
                cwd: os.tmpdir(),
                timeout: CLI_TIMEOUT_MS,
                maxBuffer: 32 * 1024 * 1024,
                encoding: 'buffer',
                env: process.env,
                windowsHide: true,
                signal
            }, (error, stdout, stderr) => {
                if (error) {
                    if (signal?.aborted || error.name === 'AbortError' || error.code === 'ABORT_ERR') {
                        reject(operationCancelledError(label));
                        return;
                    }
                    if (error.code === 'ENOENT') {
                        reject(upstreamError(`未找到 ${label} 可执行文件（${bin}）。请安装并登录，或用对应的 *_CLI_PATH 环境变量指定绝对路径。`, 502));
                        return;
                    }
                    if (error.killed) {
                        reject(upstreamError(`${label} 调用超时（${Math.round(CLI_TIMEOUT_MS / 1000)}s）`, 504));
                        return;
                    }
                    const detail = (decodeProcessOutput(stderr) || error.message || '').trim();
                    reject(upstreamError(`${label} 调用失败：${detail || '未知错误'}`, 502));
                    return;
                }
                resolve(decodeProcessOutput(stdout).trim());
            });
        } catch (spawnError) {
            if (signal?.aborted || spawnError.name === 'AbortError' || spawnError.code === 'ABORT_ERR') {
                reject(operationCancelledError(label));
                return;
            }
            reject(upstreamError(`${label} 无法启动：${spawnError.message}`, 502));
            return;
        }
        // 关键：主动结束 stdin，给 CLI 一个 EOF。
        child.stdin?.end();
    });
}

// Claude Code CLI（`claude -p`）：无头文本生成，用本机已登录的 Claude 账号，无需 API key。
// 不传 --dangerously-skip-permissions 时，print 模式下任何工具调用都无法被批准，因而不会读写项目文件，
// 本调用是纯文本改写。默认从 PATH 找 claude，可用 CLAUDE_CLI_PATH 指定绝对路径。
async function runClaudeCli({ systemInstruction, userPrompt, model, effort, signal }) {
    const bin = resolveClaudeBin();
    const args = [
        '-p', userPrompt,
        '--system-prompt', systemInstruction,
        '--output-format', 'text'
    ];
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort); // low / medium / high / xhigh / max
    return runCli(bin, args, 'Claude CLI', signal);
}

// Codex CLI（`codex exec`）：无头一次性执行，用本机已登录的 ChatGPT 账号，无需 API key。
// Codex 没有独立的系统提示词参数，故把系统指令与待优化内容合并为单条 prompt。
// read-only 沙箱 + 临时目录，纯文本改写不会触碰项目；--output-last-message 把最终答复单独写到文件，
// 避免解析夹杂 agent 日志的 stdout。默认走 ChatGPT.app 内置 codex，可用 CODEX_CLI_PATH 指定绝对路径。
async function runCodexCli({ systemInstruction, userPrompt, model, effort, imageDataUrl, imageDataUrls, signal }) {
    const bin = resolveCodexBin();
    const combined = `${systemInstruction}\n\n【待优化内容】\n${userPrompt}`;
    const outFile = path.join(os.tmpdir(), `codex-optimize-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.txt`);
    const imageFiles = [];
    const args = [
        'exec',
        '--sandbox', 'read-only',
        '--skip-git-repo-check',
        '-C', os.tmpdir(),
        '--output-last-message', outFile
    ];
    if (model) args.push('--model', model);
    if (effort) args.push('-c', `model_reasoning_effort=${effort}`); // low / medium / high
    // `--image` accepts a variable number of values, so the positional prompt
    // must appear before it or Codex will consume the prompt as another filename.
    args.push(combined);

    const requestedImages = (Array.isArray(imageDataUrls) ? imageDataUrls : [imageDataUrl]).filter(Boolean);
    for (const dataUrl of requestedImages) {
        const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/s);
        if (!match) throw upstreamError('Codex CLI 收到不支持的图片格式', 400);
        const extension = match[1] === 'image/jpeg' ? 'jpg' : match[1].split('/')[1];
        const imageFile = path.join(os.tmpdir(), `codex-prompt-image-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${extension}`);
        await fs.writeFile(imageFile, Buffer.from(match[2], 'base64'), { mode: 0o600 });
        imageFiles.push(imageFile);
    }
    if (imageFiles.length > 0) {
        args.push('--image', ...imageFiles);
    }

    try {
        const stdout = await runCli(bin, args, 'Codex CLI', signal);
        const fileText = await fs.readFile(outFile, 'utf8').catch(() => '');
        // 优先用 --output-last-message 的干净结果；万一没写成功再退回 stdout。
        return (fileText || stdout).trim();
    } finally {
        fs.unlink(outFile).catch(() => {});
        imageFiles.forEach(imageFile => fs.unlink(imageFile).catch(() => {}));
    }
}

async function runGeminiWeb({
    systemInstruction,
    userPrompt,
    imageDataUrl,
    imageDataUrls,
    libraryDir,
    signal
}) {
    const references = (Array.isArray(imageDataUrls) ? imageDataUrls : [imageDataUrl]).filter(Boolean);
    return runGeminiWebTextTask({
        prompt: `${systemInstruction}\n\n【待处理内容】\n${userPrompt}`,
        referenceImageInputs: references,
        libraryDir,
        timeoutMinutes: 5,
        signal
    });
}

// ---------------------------------------------------------------------------
// 注册表
// ---------------------------------------------------------------------------

export const PROMPT_OPTIMIZER_PROVIDERS = {
    deepseek: {
        label: 'DeepSeek（云端 API）',
        supportsImage: false,
        apiKeyField: 'DEEPSEEK_API_KEY',
        defaultModel: 'deepseek-v4-pro',
        defaultEffort: '',          // v4 走 thinking:disabled，不用推理档位
        run: runDeepSeek
    },
    'claude-cli': {
        label: 'Claude CLI（本机）',
        supportsImage: false,
        apiKeyField: null,             // 走本机已登录的 CLI，无需密钥
        defaultModel: 'claude-sonnet-5',
        defaultEffort: 'high',         // --effort 档位：low/medium/high/xhigh/max
        run: runClaudeCli
    },
    'codex-cli': {
        label: 'Codex CLI（本机）',
        supportsImage: true,
        apiKeyField: null,
        defaultModel: 'gpt-5.6-sol',
        defaultEffort: 'medium',       // model_reasoning_effort：low/medium/high
        run: runCodexCli
    },
    'gemini-web': {
        label: 'Gemini Web（网页）',
        supportsImage: true,
        apiKeyField: null,
        defaultModel: 'Gemini Web',
        defaultEffort: '',
        run: runGeminiWeb
    }
};

export function getPromptOptimizerProvider(providerId = 'deepseek') {
    return PROMPT_OPTIMIZER_PROVIDERS[providerId] || null;
}

// 供设置界面下拉使用的后端清单（不含 run 函数）。
export function listPromptOptimizerProviders() {
    return Object.entries(PROMPT_OPTIMIZER_PROVIDERS).map(([id, provider]) => ({
        id,
        label: provider.label,
        apiKeyField: provider.apiKeyField,
        defaultModel: provider.defaultModel,
        defaultEffort: provider.defaultEffort || '',
        supportsImage: Boolean(provider.supportsImage)
    }));
}
