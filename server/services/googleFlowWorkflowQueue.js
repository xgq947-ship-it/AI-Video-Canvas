/**
 * Google Flow 本地 workflow 共用串行队列。
 *
 * 文生图和图生视频都会操作同一个 9222 Chrome，必须串行执行，
 * 否则两个任务会互相切换页面并污染生成结果。
 */

let workflowQueue = Promise.resolve();

export function enqueueGoogleFlowWorkflow(task) {
    const result = workflowQueue.then(task);
    workflowQueue = result.catch(() => undefined);
    return result;
}
