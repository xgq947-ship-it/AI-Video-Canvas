/**
 * 系统共享 Chrome 自动化 CLI（server/python 下的 ops_cli）的统一调用层。
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
import { getChromeCompatibility } from '../runtime/browserExecutable.js';
import { isOperationCancelled, operationCancelledError } from './operationCancelled.js';
import {
    browserSessionState,
    browserStateForError,
    inferBrowserProvider
} from './browserSessionState.js';
import {
    decodeProcessOutput,
    withUtf8PythonEnvironment
} from '../utils/processOutput.js';
import { ensureSharedBrowserHub } from './browserHubClient.js';

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
    const chrome = getChromeCompatibility(process.env);
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

export function opsEnvironment() {
    const chrome = getChromeCompatibility(process.env);
    return {
        ...withUtf8PythonEnvironment(process.env),
        PYTHONUNBUFFERED: '1',
        PYTHONPATH: [PYTHON_ROOT, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
        EVAN_DATA_DIR: RUNTIME_PATHS.dataDir,
        EVAN_RUNTIME_DIR: RUNTIME_PATHS.runtimeDir,
        EVAN_BROWSER_PROFILE_DIR: RUNTIME_PATHS.browserProfileDir,
        EVAN_CHROME_EXECUTABLE: chrome.executable || '',
        EVAN_BROWSER_EXECUTABLE: chrome.executable || '',
        AI_BROWSER_HUB_ENABLED: '1',
        // Automated desktop generation must stay silent. Foreground browser
        // commands (`browser open` / `browser login`) already request a visible
        // window explicitly, so the backend must not globally force auth
        // recovery popups for every Flow/Jimeng subprocess.
        OPS_FORCE_LOGIN_POPUP: process.env.OPS_FORCE_LOGIN_POPUP,
        NO_COLOR: '1'
    };
}

/** App 退出不操作共享 Chrome；Hub 在所有租约释放后统一回收。 */
export function closeBrowserForShutdown() {
    return Promise.resolve({ closed: false, reason: 'shared-hub-managed' });
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
 * 给退避加 ±25% 抖动（借鉴 gflow-cli 的 jittered backoff）。
 *
 * 没有抖动时，多路任务因同一次冷启动同时失败，会在同一时刻整齐地一起重试，反而再次
 * 把刚起来的 Chrome 压垮。抖动把这些重试打散开。基准为 0 时抖动也是 0，测试注入的
 * NO_BACKOFF 不受影响。
 */
export function jitterBackoffMs(baseMs) {
    if (!(baseMs > 0)) return 0;
    return Math.max(0, Math.round(baseMs + baseMs * 0.25 * (2 * Math.random() - 1)));
}

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

function abortableDelay(ms, signal, label) {
    if (!signal) return delay(ms);
    if (signal.aborted) return Promise.reject(operationCancelledError(label));
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(operationCancelledError(label));
        };
        signal.addEventListener('abort', onAbort, { once: true });
    });
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
    signal,
    spawnProcess = spawn,
    sessionStateStore = browserSessionState,
    // 可注入，让测试不必真的等完整退避。
    retryBackoffMs = RETRY_BACKOFF_MS,
    maxAttempts = MAX_OPS_ATTEMPTS
}) {
    const provider = inferBrowserProvider(args);
    const previousProviderState = provider && trackSessionState && typeof sessionStateStore.get === 'function'
        ? sessionStateStore.get(provider)
        : null;
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
    // 一次尝试不单独写 session 状态；整轮重试只在首尾落一次最终状态。
    const runAttempt = (attempt) => new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(operationCancelledError(label));
            return;
        }
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
        const onAbort = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { child.kill('SIGTERM'); } catch { /* process already exited */ }
            reject(operationCancelledError(label));
        };

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener('abort', onAbort);
            child.kill('SIGTERM');
            const error = new Error(`${label}执行超时`);
            error.code = 'OPS_TIMEOUT';
            error.sessionState = 'unknown';
            reject(error);
        }, timeoutMs);

        signal?.addEventListener('abort', onAbort, { once: true });
        child.stdout.on('data', chunk => { stdoutChunks.push(Buffer.from(chunk)); });
        child.stderr.on('data', chunk => { stderrChunks.push(Buffer.from(chunk)); });

        child.on('error', error => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            const wrapped = new Error(`${label}无法启动 Python 进程：${error.message}`);
            wrapped.code = 'BROWSER_MODELS_NOT_READY';
            wrapped.sessionState = 'browser_unavailable';
            reject(wrapped);
        });

        child.on('close', code => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);

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
                // 这里原样透出，让用户打开系统共享 Chrome 登录，而不是看到一串堆栈。
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

    if (provider && trackSessionState) sessionStateStore.transition(provider, initialSessionState);

    const finalize = (state, detail) => {
        if (provider && trackSessionState) sessionStateStore.transition(provider, state, detail);
    };

    return (async () => {
        if (usesRealProcess) {
            try {
                await ensureSharedBrowserHub();
            } catch (error) {
                finalize(error?.sessionState || 'browser_unavailable', {
                    errorCode: error?.code || 'BROWSER_HUB_UNAVAILABLE',
                    message: error?.message
                });
                throw error;
            }
        }
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
                try {
                    await abortableDelay(
                        jitterBackoffMs(
                            retryBackoffMs[attempt - 1] ?? retryBackoffMs[retryBackoffMs.length - 1] ?? 0
                        ),
                        signal,
                        label
                    );
                } catch (delayError) {
                    lastError = delayError;
                    break;
                }
            }
        }

        // 用户主动取消只代表“不再等待这次任务”，不代表登录失效或浏览器损坏。
        // 保留 provider 原来的 authenticated 状态；子进程 finally 会释放 Hub 租约。
        if (isOperationCancelled(lastError)) {
            if (provider && trackSessionState) {
                const restoreState = previousProviderState?.state === 'checking'
                    ? 'unknown'
                    : previousProviderState?.state || successSessionState;
                sessionStateStore.transition(provider, restoreState, {
                    message: '当前任务已取消，登录状态未变'
                });
            }
            throw lastError;
        }
        finalize(lastError?.sessionState || 'unknown', {
            errorCode: lastError?.code || 'OPS_FAILED',
            message: lastError?.message
        });
        throw lastError;
    })();
}
