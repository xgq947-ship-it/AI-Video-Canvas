/**
 * 本地页面 workflow 共用串行队列。
 *
 * Google Flow 文生图/图生视频、即梦视频生成都操作同一个 Evan 专属 Chrome，
 * 必须**跨 provider 串行**执行，否则两个任务会互相切换页面、抢焦点并污染生成结果。
 */

import { operationCancelledError } from './operationCancelled.js';

let workflowQueue = Promise.resolve();
// 已入队但还没跑完的任务，按入队顺序排列；队头就是当前占用 Chrome 的那个。
const inFlight = [];

export const browserWorkflowCancelledError = (label = '浏览器任务') => operationCancelledError(label);

export function enqueueGoogleFlowWorkflow(task, {
    label = '浏览器任务',
    signal
} = {}) {
    if (signal?.aborted) {
        return Promise.reject(browserWorkflowCancelledError(label));
    }
    const entry = { label };
    inFlight.push(entry);
    const release = () => {
        const index = inFlight.indexOf(entry);
        if (index >= 0) inFlight.splice(index, 1);
    };

    // scheduled 始终留在内部串行链上。若任务还在排队时被取消，对调用方立即 reject，
    // 等前序任务结束后 scheduled 只做一次 aborted 检查，不会再启动浏览器进程。
    const scheduled = workflowQueue.then(() => {
        if (signal?.aborted) throw browserWorkflowCancelledError(label);
        return task();
    });
    workflowQueue = scheduled.catch(() => undefined);

    // release 只跟随任务本身的生命周期，**不能**跟随调用方的取消。
    // 取消只表示「不再等这次结果」：task() 里的 ops_cli 子进程还在收尾，Chrome 仍被占用。
    // 若在 abort 时就 release，browserWorkflowBusyLabel() 会提前报空闲，
    // assertBrowserWorkflowIdle 随即放行「打开专属 Chrome / 检查登录」——
    // 而这两个动作会 stop_chrome，正好打断还没退干净的那个任务。
    scheduled.then(release, release);

    if (!signal) return scheduled;

    return new Promise((resolve, reject) => {
        let settled = false;
        const settle = (handler, value) => {
            if (settled) return;
            settled = true;
            signal.removeEventListener('abort', onAbort);
            handler(value);
        };
        const onAbort = () => settle(reject, browserWorkflowCancelledError(label));
        signal.addEventListener('abort', onAbort, { once: true });
        scheduled.then(
            value => settle(resolve, value),
            error => settle(reject, error)
        );
    });
}

// 语义化别名：队列锁定同一个 Evan 专属 Chrome，不是 Google Flow 专属。
export const enqueueBrowserWorkflow = enqueueGoogleFlowWorkflow;

/** 当前占用 Chrome 的任务名；空闲时返回空串。 */
export function browserWorkflowBusyLabel() {
    return inFlight.length ? inFlight[0].label : '';
}

/**
 * 界面主动触发的浏览器操作（打开窗口、登录、检查登录态）在生成进行中必须**立刻拒绝**。
 *
 * 不能只是排队等：这些操作都会重启 Chrome（open 切到有头、check-login 在实例不可复用时
 * 走 stop_chrome），排在生成后面等于用户点完按钮干转几分钟，排在前面则直接打断生成。
 * 而且队列没有等待超时 —— runOpsCli 的 timeoutMs 只从任务真正开始执行才计时，
 * 所以生成期间点一次「打开 Evan 专属 Chrome」会一直转到整个生成结束。
 */
export function assertBrowserWorkflowIdle(action) {
    const label = browserWorkflowBusyLabel();
    if (!label) return;
    const error = new Error(`Evan 专属 Chrome 正在执行「${label}」，现在${action}会中断当前生成。请等它完成后再试。`);
    error.code = 'BROWSER_WORKFLOW_BUSY';
    error.status = 409;
    throw error;
}
