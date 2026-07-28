/**
 * 「用户主动取消」的统一错误形状。
 *
 * 取消会穿过四层：生成调度器/bridge 队列 → runOpsCli 的重试循环 → 各 provider →
 * 产品短视频任务编排。之前每一层各造一个形状略有出入的错误对象（有的不设
 * `submitted`，有的消息里多一个空格），而下游是**按字段**判定的：
 * - `shouldRetryOpsFailure` 看 `submitted`，漏设会让取消走进自动重试；
 * - 视频任务的 `retryBlocked` 也看 `submitted`，漏设会把取消标成「已提交、状态未知」，
 *   于是界面提示用户去平台历史记录里找一个根本没提交的任务。
 * 集中在这里，保证四层拿到的字段完全一致。
 */

export const OPERATION_CANCELLED = 'OPERATION_CANCELLED';

export function operationCancelledError(label = '当前任务') {
    const error = new Error(`${label}已取消`);
    error.code = OPERATION_CANCELLED;
    error.cancelled = true;
    // 取消只发生在「不再等待」这一侧，永远不代表请求已经提交出去。
    error.submitted = false;
    // 取消不等于登录失效：runOpsCli 会据此保留 provider 原来的登录状态。
    error.sessionState = 'unknown';
    return error;
}

export function isOperationCancelled(error) {
    return Boolean(error?.cancelled) || error?.code === OPERATION_CANCELLED;
}
