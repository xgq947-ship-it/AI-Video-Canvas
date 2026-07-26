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
import { RUNTIME_PATHS } from '../runtime/paths.js';
import {
    browserSessionState,
    browserStateForError,
    inferBrowserProvider
} from './browserSessionState.js';
import {
    decodeProcessOutput,
    withUtf8PythonEnvironment
} from '../utils/processOutput.js';

/** server/python —— 内置 Python 运行时根目录。 */
export const PYTHON_ROOT = RUNTIME_PATHS.pythonRoot;

/**
 * venv 解释器路径。Windows 是 Scripts\python.exe，其余平台是 bin/python。
 * 与项目内其它 Python 调用点保持一致的跨平台写法。
 */
export function resolveOpsPython() {
    const configured = String(process.env.EVAN_OPS_PYTHON || '').trim();
    if (configured) return path.resolve(RUNTIME_PATHS.resourcesDir, configured);
    return process.platform === 'win32'
        ? path.join(PYTHON_ROOT, '.venv', 'Scripts', 'python.exe')
        : path.join(PYTHON_ROOT, '.venv', 'bin', 'python');
}

export function resolveOpsExecutable() {
    const configured = String(process.env.EVAN_OPS_EXECUTABLE || '').trim();
    return configured ? path.resolve(RUNTIME_PATHS.resourcesDir, configured) : null;
}

/** 浏览器自动化环境是否已就绪（未就绪时相关模型应置灰而非报 500）。 */
export function isBrowserModelsReady() {
    const executable = resolveOpsExecutable();
    return executable ? fs.existsSync(executable) : fs.existsSync(resolveOpsPython());
}

export const BROWSER_MODELS_SETUP_HINT =
    '浏览器自动化模型（Google Flow / 即梦）尚未配置。请先运行：npm run setup:browser-models';

const BROWSER_IDLE_CLOSE_MS = Number(process.env.EVAN_BROWSER_IDLE_CLOSE_MS) || 120_000;
const BROWSER_LOGIN_IDLE_CLOSE_MS =
    Number(process.env.EVAN_BROWSER_LOGIN_IDLE_CLOSE_MS) || 15 * 60_000;

let activeBrowserOperations = 0;
let browserIdleTimer = null;

export function opsEnvironment() {
    return {
        ...withUtf8PythonEnvironment(process.env),
        PYTHONUNBUFFERED: '1',
        PYTHONPATH: [PYTHON_ROOT, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
        EVAN_DATA_DIR: RUNTIME_PATHS.dataDir,
        EVAN_RUNTIME_DIR: RUNTIME_PATHS.runtimeDir,
        EVAN_BROWSER_PROFILE_DIR: RUNTIME_PATHS.browserProfileDir,
        SESSIONHUB_CHROME_PROFILE: RUNTIME_PATHS.browserProfileDir,
        SESSIONHUB_CDP_PORT: process.env.SESSIONHUB_CDP_PORT || '19222',
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH
            || path.join(PYTHON_ROOT, '.browsers'),
        // Automated desktop generation must stay silent. Foreground browser
        // commands (`browser open` / `browser login`) already request a visible
        // window explicitly, so the backend must not globally force auth
        // recovery popups for every Flow/Jimeng subprocess.
        OPS_FORCE_LOGIN_POPUP: process.env.OPS_FORCE_LOGIN_POPUP,
        NO_COLOR: '1'
    };
}

function clearBrowserIdleTimer() {
    if (!browserIdleTimer) return;
    clearTimeout(browserIdleTimer);
    browserIdleTimer = null;
}

function browserCloseCommand() {
    const executable = resolveOpsExecutable();
    return {
        command: executable || resolveOpsPython(),
        commandArgs: executable
            ? ['--json', 'browser', 'close']
            : ['-m', 'ops_cli', '--json', 'browser', 'close']
    };
}

function closeIdleBrowser() {
    if (activeBrowserOperations > 0) return;
    // 运行时没装就没有浏览器需要关。这个检查同时是崩溃防线：spawn 一个不存在的
    // 可执行文件会让子进程发出 'error' 事件，而 ChildProcess 的 'error' 没有监听器时
    // 会直接把整个后端进程带走 —— 模块加载时 armed 的兜底定时器意味着，
    // 任何没跑过 setup:browser-models 的机器上，后端都会在启动 120 秒后猝死。
    if (!isBrowserModelsReady()) return;

    const { command, commandArgs } = browserCloseCommand();
    try {
        const child = spawn(command, commandArgs, {
            cwd: PYTHON_ROOT,
            env: opsEnvironment(),
            detached: true,
            stdio: 'ignore'
        });
        // detached + unref 的子进程同样需要 error 监听器，否则同上。
        child.on('error', error => {
            console.warn('[ops-cli] 关闭空闲浏览器失败：', error?.message || error);
        });
        child.unref();
    } catch (error) {
        console.warn('[ops-cli] 无法启动关闭浏览器的进程：', error?.message || error);
    }
}

/**
 * 退出前回收常驻的无头浏览器。
 *
 * Chromium 是刻意 detached 启动的（chrome_cdp.py 的 start_new_session /
 * DETACHED_PROCESS），所以后端进程退出时它不会跟着走。退出路径上不主动关掉的话，
 * 用户关掉 Evan 之后它会一直占着几百 MB —— 唯一的回收点是本模块加载时 armed 的
 * 兜底 idle 定时器，也就是要等到"下次启动 Evan 再过一个 idle 周期"。
 *
 * 关闭失败、超时、运行时没装：都只是解析成 closed:false，绝不抛错也绝不挂住，
 * 退出流程不能被这一步拖死。
 *
 * @returns {Promise<{ closed: boolean, reason?: string }>}
 */
export function closeBrowserForShutdown({
    spawnProcess = spawn,
    timeoutMs = 3_000
} = {}) {
    clearBrowserIdleTimer();

    if (spawnProcess === spawn && !isBrowserModelsReady()) {
        // 运行时都没装，自然也没有浏览器需要关。
        return Promise.resolve({ closed: false, reason: 'not-ready' });
    }

    const { command, commandArgs } = browserCloseCommand();

    return new Promise(resolve => {
        let settled = false;
        const settle = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
        };

        let child;
        const timer = setTimeout(() => {
            try { child?.kill('SIGKILL'); } catch { /* ignore */ }
            settle({ closed: false, reason: 'timeout' });
        }, timeoutMs);
        timer.unref?.();

        try {
            child = spawnProcess(command, commandArgs, {
                cwd: PYTHON_ROOT,
                env: opsEnvironment(),
                stdio: 'ignore'
            });
        } catch (error) {
            settle({ closed: false, reason: error?.message || 'spawn-failed' });
            return;
        }

        child.on('error', error => settle({ closed: false, reason: error?.message || 'spawn-failed' }));
        child.on('close', code => settle(
            code === 0 ? { closed: true } : { closed: false, reason: `exit-${code}` }
        ));
    });
}

function beginBrowserOperation() {
    clearBrowserIdleTimer();
    activeBrowserOperations += 1;
}

function finishBrowserOperation(idleDelayMs) {
    activeBrowserOperations = Math.max(0, activeBrowserOperations - 1);
    if (activeBrowserOperations > 0) return;
    clearBrowserIdleTimer();
    browserIdleTimer = setTimeout(() => {
        browserIdleTimer = null;
        closeIdleBrowser();
    }, idleDelayMs);
    browserIdleTimer.unref();
}

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
export function runOpsCli({
    args,
    timeoutMs,
    label,
    initialSessionState = 'checking',
    successSessionState = 'authenticated',
    trackSessionState = true,
    spawnProcess = spawn,
    sessionStateStore = browserSessionState
}) {
    const provider = inferBrowserProvider(args);
    const tracksBrowser = Boolean(provider) || args[0] === 'browser';
    // ensureReady() 检查的是本机 venv/可执行文件是否存在，只对真实 spawn 有意义。
    // 调用方注入自己的 spawnProcess 时（测试替身）不该被本机环境左右，否则
    // 干净 checkout 上的 `npm test` 会因为没跑 setup:browser-models 而失败。
    const usesRealProcess = spawnProcess === spawn;
    try {
        if (usesRealProcess) ensureReady();
    } catch (error) {
        const state = browserStateForError(error);
        if (provider && trackSessionState && state) {
            sessionStateStore.transition(provider, state, {
                errorCode: error.code,
                message: error.message
            });
        }
        throw error;
    }
    const executable = resolveOpsExecutable();
    const command = executable || resolveOpsPython();
    const commandArgs = executable
        ? ['--json', ...args]
        : ['-m', 'ops_cli', '--json', ...args];
    const idleDelayMs = args.includes('login') || args.includes('open')
        ? BROWSER_LOGIN_IDLE_CLOSE_MS
        : BROWSER_IDLE_CLOSE_MS;

    return new Promise((resolve, reject) => {
        if (tracksBrowser) beginBrowserOperation();
        let browserOperationFinished = false;
        const finishTrackedBrowserOperation = () => {
            if (!tracksBrowser || browserOperationFinished) return;
            browserOperationFinished = true;
            finishBrowserOperation(idleDelayMs);
        };
        if (provider && trackSessionState) sessionStateStore.transition(provider, initialSessionState);
        const child = spawnProcess(command, commandArgs, {
            cwd: PYTHON_ROOT,
            env: opsEnvironment(),
            stdio: ['ignore', 'pipe', 'pipe']
        });

        const stdoutChunks = [];
        const stderrChunks = [];
        let settled = false;

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill('SIGTERM');
            const error = new Error(`${label}执行超时`);
            error.code = 'OPS_TIMEOUT';
            if (provider && trackSessionState) {
                sessionStateStore.transition(provider, 'unknown', {
                    errorCode: error.code,
                    message: error.message
                });
            }
            finishTrackedBrowserOperation();
            reject(error);
        }, timeoutMs);

        child.stdout.on('data', chunk => { stdoutChunks.push(Buffer.from(chunk)); });
        child.stderr.on('data', chunk => { stderrChunks.push(Buffer.from(chunk)); });

        child.on('error', error => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            const wrapped = new Error(`${label}无法启动 Python 进程：${error.message}`);
            wrapped.code = 'BROWSER_MODELS_NOT_READY';
            if (provider && trackSessionState) {
                sessionStateStore.transition(provider, 'browser_unavailable', {
                    errorCode: wrapped.code,
                    message: wrapped.message
                });
            }
            finishTrackedBrowserOperation();
            reject(wrapped);
        });

        child.on('close', code => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);

            const stdout = decodeProcessOutput(stdoutChunks);
            const stderr = decodeProcessOutput(stderrChunks);
            let payload;
            try {
                payload = extractOpsJson(stdout);
            } catch (error) {
                const detail = stderr.trim() || `进程退出码 ${code}`;
                const wrapped = new Error(`${label}失败：${detail}`);
                if (provider && trackSessionState) {
                    sessionStateStore.transition(provider, 'unknown', {
                        errorCode: 'INVALID_CLI_RESPONSE',
                        message: wrapped.message
                    });
                }
                finishTrackedBrowserOperation();
                reject(wrapped);
                return;
            }

            const data = payload?.data || {};
            if (code !== 0 || payload?.success !== true) {
                // Python 侧已把登录失效等归类成结构化 error_code + recovery_hint，
                // 这里原样透出，让用户打开内置浏览器登录，而不是看到一串堆栈。
                const parts = [data.error || stderr.trim() || `进程退出码 ${code}`];
                if (data.recovery_hint) parts.push(data.recovery_hint);
                const error = new Error(`${label}失败：${parts.join('　')}`);
                if (data.error_code) error.code = data.error_code;
                const state = browserStateForError(error);
                if (provider && trackSessionState && state) {
                    sessionStateStore.transition(provider, state, {
                        errorCode: error.code,
                        message: error.message
                    });
                } else if (provider && trackSessionState) {
                    sessionStateStore.transition(provider, 'unknown', {
                        errorCode: error.code || 'OPS_FAILED',
                        message: error.message
                    });
                }
                finishTrackedBrowserOperation();
                reject(error);
                return;
            }

            if (provider && trackSessionState) sessionStateStore.transition(provider, successSessionState);
            finishTrackedBrowserOperation();
            resolve({ data, runId: deriveRunId(data) });
        });
    });
}

// If the previous app session was interrupted while the dedicated browser was
// still open, reclaim it after the normal idle window unless a new task starts.
browserIdleTimer = setTimeout(() => {
    browserIdleTimer = null;
    closeIdleBrowser();
}, BROWSER_IDLE_CLOSE_MS);
browserIdleTimer.unref();
