/**
 * 内置浏览器自动化 CLI（server/python 下的 ops_cli）的统一调用层。
 *
 * 历史上 Google Flow / 即梦 要跨项目调用桌面上的「运营自动化工具」，再由它
 * 转调 Ops-Cli。现在 provider 代码已内置到 server/python，这里直接
 * `python -m ops_cli --json ...` 调用，三层塌缩成一层。
 *
 * 本模块只负责：定位解释器、拼进程、解析 JSON、把失败翻译成人话。
 * 页面自动化逻辑全部在 Python 侧，Node 不复制任何选择器。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVICES_DIR = path.dirname(fileURLToPath(import.meta.url));

/** server/python —— 内置 Python 运行时根目录。 */
export const PYTHON_ROOT = path.resolve(SERVICES_DIR, '..', 'python');

/**
 * venv 解释器路径。Windows 是 Scripts\python.exe，其余平台是 bin/python。
 * 参考 server/services/local-inference.js 的同款写法。
 */
export function resolveOpsPython() {
    return process.platform === 'win32'
        ? path.join(PYTHON_ROOT, '.venv', 'Scripts', 'python.exe')
        : path.join(PYTHON_ROOT, '.venv', 'bin', 'python');
}

/** 浏览器自动化环境是否已就绪（未就绪时相关模型应置灰而非报 500）。 */
export function isBrowserModelsReady() {
    return fs.existsSync(resolveOpsPython());
}

export const BROWSER_MODELS_SETUP_HINT =
    '浏览器自动化模型（Google Flow / 即梦）尚未配置。请先运行：npm run setup:browser-models';

function ensureReady() {
    if (!isBrowserModelsReady()) {
        const error = new Error(BROWSER_MODELS_SETUP_HINT);
        error.code = 'BROWSER_MODELS_NOT_READY';
        throw error;
    }
}

/**
 * 从 stdout 里抠出第一段完整 JSON。
 *
 * rich 在非 TTY 下输出的是干净 JSON，但 Python 侧仍可能夹带告警行，
 * 因此保留括号配对扫描，比按行 JSON.parse 稳。
 */
export function extractOpsJson(stdout) {
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
    throw new Error('未能解析浏览器自动化 CLI 的 JSON 输出');
}

/** 用 context_path 的文件名当 runId：它天然带能力名与时间戳，便于回溯。 */
function deriveRunId(data) {
    const contextPath = data?.context_path;
    if (!contextPath) return null;
    return path.basename(String(contextPath), '.json');
}

/**
 * 调用 ops_cli 并返回 { data, runId }。
 *
 * @param {string[]} params.args   `--json` 之后的完整参数，如
 *                                 ['image-to-video','jimeng','generate','--prompt',...]
 * @param {number}   params.timeoutMs
 * @param {string}   params.label  失败信息前缀，如 '即梦视频生成'
 */
export function runOpsCli({ args, timeoutMs, label }) {
    ensureReady();
    const python = resolveOpsPython();

    return new Promise((resolve, reject) => {
        const child = spawn(python, ['-m', 'ops_cli', '--json', ...args], {
            cwd: PYTHON_ROOT,
            env: {
                ...process.env,
                PYTHONUNBUFFERED: '1',
                PYTHONPATH: PYTHON_ROOT,
                // 强制 Python 用 UTF-8 读写 stdio。
                // 不设的话，Python 在管道模式下按系统 locale 编码输出，
                // 中文 Windows 是 cp936(GBK)，而下面按 UTF-8 解，
                // 报错里的中文会变成「DURATION_NOT_SUPPORTED��x��δ�s��」这种乱码。
                PYTHONIOENCODING: 'utf-8',
                // 服务端调用无 tty，Python 侧据此保持静默、不抢前台。
                NO_COLOR: '1'
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            reject(new Error(`${label}执行超时`));
        }, timeoutMs);

        child.stdout.on('data', chunk => { stdout += chunk.toString(); });
        child.stderr.on('data', chunk => { stderr += chunk.toString(); });

        child.on('error', error => {
            clearTimeout(timer);
            reject(new Error(`${label}无法启动 Python 进程：${error.message}`));
        });

        child.on('close', code => {
            clearTimeout(timer);
            if (timedOut) return;

            let payload;
            try {
                payload = extractOpsJson(stdout);
            } catch (error) {
                const detail = stderr.trim() || `进程退出码 ${code}`;
                reject(new Error(`${label}失败：${detail}`));
                return;
            }

            const data = payload?.data || {};
            if (code !== 0 || payload?.success !== true) {
                // Python 侧已把登录失效等归类成结构化 error_code + recovery_hint，
                // 这里原样透出，用户才知道该去 9222 浏览器登录，而不是看到一串堆栈。
                const parts = [data.error || stderr.trim() || `进程退出码 ${code}`];
                if (data.recovery_hint) parts.push(data.recovery_hint);
                const error = new Error(`${label}失败：${parts.join('　')}`);
                if (data.error_code) error.code = data.error_code;
                reject(error);
                return;
            }

            resolve({ data, runId: deriveRunId(data) });
        });
    });
}
