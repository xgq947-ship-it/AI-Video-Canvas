/**
 * Evan 专属 Chrome 自动化 CLI（server/python 下的 ops_cli）的统一调用层。
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
import { probeSystemChromeCompatibility } from '../runtime/browserExecutable.js';
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

export function browserRuntimeStatus() {
    const executable = resolveOpsExecutable();
    const opsReady = executable ? fs.existsSync(executable) : fs.existsSync(resolveOpsPython());
    const chrome = probeSystemChromeCompatibility(process.env);
    return {
        ...chrome,
        ready: opsReady && chrome.ready,
        opsReady,
        message: !opsReady
            ? 'Evan 自动化运行时缺失，请重新安装 Evan。'
            : chrome.message
    };
}

/** 浏览器自动化环境是否已就绪（未就绪时相关模型应置灰而非报 500）。 */
export function isBrowserModelsReady() {
    return browserRuntimeStatus().ready;
}

export const BROWSER_MODELS_SETUP_HINT =
    '未找到兼容的 Google Chrome。请先安装或更新 Chrome，然后重新打开 Evan。';

// 空闲多久关掉常驻浏览器。
//
// 这里是「内存占用」和「冷启动」的取舍点。原来是 120 秒 —— 用户生成一张图、看三
// 分钟、再生成一张，浏览器已经被关了，第二次要完整重吃一遍冷启动（Chromium 启动
// + 即梦/Flow 前端拉 chunk + 编辑器挂载），也就是 EDITOR_NOT_READY 最常见的来源。
// 这不是首次运行才有的问题，是每次隔几分钟再操作都会复现。
//
// 放宽到 10 分钟：连续创作期间不再反复冷启动，代价是这段时间里 Chromium 常驻。
// 上限是可控的 —— 退出 Evan 时会主动关掉（见 closeBrowserForShutdown）。
const BROWSER_IDLE_CLOSE_MS = Number(process.env.EVAN_BROWSER_IDLE_CLOSE_MS) || 10 * 60_000;
const BROWSER_LOGIN_IDLE_CLOSE_MS =
    Number(process.env.EVAN_BROWSER_LOGIN_IDLE_CLOSE_MS) || 15 * 60_000;

let activeBrowserOperations = 0;
let browserIdleTimer = null;

export function opsEnvironment() {
    const chrome = probeSystemChromeCompatibility(process.env);
    return {
        ...withUtf8PythonEnvironment(process.env),
        PYTHONUNBUFFERED: '1',
        PYTHONPATH: [PYTHON_ROOT, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
        EVAN_DATA_DIR: RUNTIME_PATHS.dataDir,
        EVAN_RUNTIME_DIR: RUNTIME_PATHS.runtimeDir,
        EVAN_BROWSER_PROFILE_DIR: RUNTIME_PATHS.browserProfileDir,
        EVAN_CHROME_EXECUTABLE: chrome.executable || '',
        EVAN_BROWSER_EXECUTABLE: chrome.executable || '',
        SESSIONHUB_CHROME_PROFILE: RUNTIME_PATHS.browserProfileDir,
        SESSIONHUB_CDP_PORT: process.env.SESSIONHUB_CDP_PORT || '19222',
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
    // 任何缺少自动化运行时的机器上，后端都会在启动 120 秒后猝死。
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
 * 退出前回收使用 Evan 专属 Profile 的 Chrome。
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
        // 这个定时器刻意不 unref：调用方正在 await 这个 Promise，如果事件循环
        // 因为没有别的句柄而直接排空，超时就永远不会触发，Promise 也就永不落定。
        // 退出流程的最终兜底是 desktop-entry.js 里那个 4.5 秒的硬退出。
        const timer = setTimeout(() => {
            try { child?.kill('SIGKILL'); } catch { /* ignore */ }
            settle({ closed: false, reason: 'timeout' });
        }, timeoutMs);

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
 * 允许自动重试的失败码。
 *
 * 刻意用白名单而不是 Python 给的 retryable 字段：retryable 的语义太宽，
 * AUTH_REQUIRED 也是 retryable=true，但重试它毫无意义（用户不去登录，重试一百次
 * 也一样），只会让「请先登录」这条提示晚三分钟才到用户眼前。
 *
 * 这里的两个码都只可能在**提交之前**产生：
 * - EDITOR_NOT_READY：编辑器没挂载，多为冷启动慢。
 * - PAGE_NAVIGATION_FAILED：打开页面失败。
 * 但 PAGE_NAVIGATION_FAILED 同时也是 provider 兜底 except 的标签，提交之后崩了
 * 也叫这个名字，所以**必须**再叠一层 submitted 判断，见 shouldRetryOpsFailure。
 */
const RETRYABLE_ERROR_CODES = new Set(['EDITOR_NOT_READY', 'PAGE_NAVIGATION_FAILED']);

const MAX_OPS_ATTEMPTS = Math.max(1, Number(process.env.EVAN_OPS_MAX_ATTEMPTS) || 3);
/** 第 N 次重试前等待多久。冷启动需要时间预热，退避比立刻重试有效得多。 */
const RETRY_BACKOFF_MS = [4_000, 12_000];

/**
 * 这次失败能不能安全地自动重试。
 *
 * submitted 是硬闸门：生成请求一旦提交出去，平台就已经开始扣配额了。这时重试
 * 等于二次提交 —— 用户被扣两次费、拿到两份结果，比直接报错还糟。
 */
export function shouldRetryOpsFailure(error, { attempt, maxAttempts }) {
    if (attempt >= maxAttempts) return false;
    if (error?.submitted === true) return false;
    return RETRYABLE_ERROR_CODES.has(error?.code);
}

// 不 unref：调用方正在 await 这个退避，unref 之后事件循环一空就再也不会被唤醒。
const delay = (ms) => new Promise(resolve => { setTimeout(resolve, ms); });

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
    sessionStateStore = browserSessionState,
    // 可注入，让测试不必真的等完整退避。
    retryBackoffMs = RETRY_BACKOFF_MS,
    maxAttempts = MAX_OPS_ATTEMPTS
}) {
    const provider = inferBrowserProvider(args);
    const tracksBrowser = Boolean(provider) || args[0] === 'browser';
    // ensureReady() 检查的是本机 venv/可执行文件是否存在，只对真实 spawn 有意义。
    // 调用方注入自己的 spawnProcess 时（测试替身）不该被本机环境左右，否则
    // 干净 checkout 上的 `npm test` 会因为没跑 setup:automation-runtime 而失败。
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

    // 一次尝试。刻意不在这里做 begin/finishBrowserOperation，也不写 session 状态：
    // 那些只能由 runOpsCli 在整轮重试的首尾各做一次。
    const runAttempt = (attempt) => new Promise((resolve, reject) => {
        const child = spawnProcess(command, commandArgs, {
            cwd: PYTHON_ROOT,
            env: {
                ...opsEnvironment(),
                // 第一次用默认等待窗口，让真正的故障尽快报出来；重试时才放宽，
                // 给冷启动更多时间。这样「慢」和「坏」不会被同一个超时糊在一起。
                EVAN_EDITOR_READY_TIMEOUT_S: attempt === 1 ? '' : '180'
            },
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
            error.sessionState = 'unknown';
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
            wrapped.sessionState = 'browser_unavailable';
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
                wrapped.code = 'INVALID_CLI_RESPONSE';
                wrapped.sessionState = 'unknown';
                reject(wrapped);
                return;
            }

            const data = payload?.data || {};
            if (code !== 0 || payload?.success !== true) {
                // Python 侧已把登录失效等归类成结构化 error_code + recovery_hint，
                // 这里原样透出，让用户打开 Evan 专属 Chrome 登录，而不是看到一串堆栈。
                const parts = [data.error || stderr.trim() || `进程退出码 ${code}`];
                if (data.recovery_hint) parts.push(data.recovery_hint);
                const error = new Error(`${label}失败：${parts.join('　')}`);
                if (data.error_code) error.code = data.error_code;
                // 提交阶段决定能不能重试；Python 拿不准时会给 true，这里从严处理。
                error.submitted = data.submitted !== false;
                error.sessionState = browserStateForError(error) || 'unknown';
                reject(error);
                return;
            }

            resolve({ data, runId: deriveRunId(data) });
        });
    });

    // 整轮重试共用一次 begin/finish。若把重试放在 runOpsCli 之外，第一次尝试的
    // finish 会 arm 空闲关闭定时器，退避期间浏览器可能被关掉，第二次尝试就要再吃
    // 一次冷启动——正好是这里要修的问题。
    if (tracksBrowser) beginBrowserOperation();
    if (provider && trackSessionState) sessionStateStore.transition(provider, initialSessionState);

    const finalize = (state, detail) => {
        if (provider && trackSessionState) sessionStateStore.transition(provider, state, detail);
        if (tracksBrowser) finishBrowserOperation(idleDelayMs);
    };

    return (async () => {
        let lastError;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                const result = await runAttempt(attempt);
                finalize(successSessionState);
                return result;
            } catch (error) {
                lastError = error;
                if (!shouldRetryOpsFailure(error, { attempt, maxAttempts })) break;
                // 重试途中不写失败态，否则画布会闪一下「登录失效」之类的错误提示。
                console.warn(
                    `[ops-cli] ${label} 第 ${attempt} 次失败（${error.code}），准备重试：${error.message}`
                );
                await delay(retryBackoffMs[attempt - 1] ?? retryBackoffMs[retryBackoffMs.length - 1] ?? 0);
            }
        }

        finalize(lastError?.sessionState || 'unknown', {
            errorCode: lastError?.code || 'OPS_FAILED',
            message: lastError?.message
        });
        throw lastError;
    })();
}

// If the previous app session was interrupted while the dedicated browser was
// still open, reclaim it after the normal idle window unless a new task starts.
browserIdleTimer = setTimeout(() => {
    browserIdleTimer = null;
    closeIdleBrowser();
}, BROWSER_IDLE_CLOSE_MS);
browserIdleTimer.unref();
