/**
 * 本地页面 workflow 共用串行队列。
 *
 * Google Flow 文生图/图生视频、即梦视频生成都操作同一个 9222 Chrome，
 * 必须**跨 provider 串行**执行，否则两个任务会互相切换页面、抢焦点并污染生成结果。
 */

let workflowQueue = Promise.resolve();

export function enqueueGoogleFlowWorkflow(task) {
    const result = workflowQueue.then(task);
    workflowQueue = result.catch(() => undefined);
    return result;
}

// 语义化别名：队列是「同一个 9222 浏览器」的锁，不是 Google Flow 专属。
export const enqueueBrowserWorkflow = enqueueGoogleFlowWorkflow;
