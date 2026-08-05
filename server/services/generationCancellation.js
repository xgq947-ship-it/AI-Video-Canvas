/**
 * generationCancellation.js
 *
 * 主生成链路（/api/generate-image、/api/generate-video）的取消登记处。
 *
 * 背景：渲染、字幕、产品短视频、拼接都有取消端点，唯独最核心的图/视频生成没有。
 * 视频生成动辄几分钟，用户选错模型或写错提示词后只能干等，或者删掉节点——而后端
 * 任务仍在跑、配额照扣。
 *
 * 实现上并不需要新造轮子：调度器（generationRuntime/scheduler）和五个 provider
 * workflow 早就接受 `options.signal` 并逐层透传，缺的只是「谁来持有这个
 * AbortController、外部怎么找到它」。这个模块就干这件事。
 *
 * **关于配额的重要约定**：取消只能中止「我们这一侧的等待」。一旦请求越过提交边界
 * 被平台受理，取消就无法让它不计费——结果可能已经躺在平台历史里。所以这里区分
 * 两种取消结果，调用方必须如实告诉用户，不能一律显示「已取消」。这与
 * NodeContent 里「已扣费就藏掉重试按钮」是同一条原则。
 */

/** @type {Map<string, { controller: AbortController, startedAt: number, label: string, submitted: () => boolean }>} */
const inFlight = new Map();

/** 同一个画布里 nodeId 唯一；带上 workflowId 以免跨项目串号。 */
export function generationKey(workflowId, nodeId) {
    return `${workflowId || ''}::${nodeId || ''}`;
}

/**
 * 登记一次进行中的生成。
 * @param {object} options
 * @param {string} options.workflowId
 * @param {string} options.nodeId
 * @param {string} [options.label]
 * @param {() => boolean} [options.submitted] 查询「是否已越过提交边界」
 * @returns {{ signal: AbortSignal, release: () => void } | null} nodeId 缺失时返回 null
 */
export function registerGeneration({ workflowId, nodeId, label = '生成任务', submitted }) {
    if (!nodeId) return null;
    const key = generationKey(workflowId, nodeId);

    // 同一节点重复发起时，旧的那次先取消，避免登记表里留下永远不会被清理的条目。
    inFlight.get(key)?.controller.abort();

    const controller = new AbortController();
    inFlight.set(key, {
        controller,
        startedAt: Date.now(),
        label,
        submitted: typeof submitted === 'function' ? submitted : () => false
    });

    let released = false;
    return {
        signal: controller.signal,
        release() {
            if (released) return;
            released = true;
            // 只删自己那条：期间可能已经有新的一次生成把 key 占了。
            if (inFlight.get(key)?.controller === controller) inFlight.delete(key);
        }
    };
}

/**
 * 取消某个节点正在进行的生成。
 * @returns {{ cancelled: boolean, submitted: boolean, reason?: string }}
 *   cancelled=false 表示压根没有在跑的任务；
 *   submitted=true 表示请求可能已被平台受理，**本次仍可能计费**，调用方必须据实提示。
 */
export function cancelGeneration(workflowId, nodeId) {
    const key = generationKey(workflowId, nodeId);
    const entry = inFlight.get(key);
    if (!entry) return { cancelled: false, submitted: false, reason: 'not_found' };

    let submitted = false;
    try {
        submitted = Boolean(entry.submitted());
    } catch {
        // 查询提交状态本身失败时按「可能已提交」处理：宁可多提醒一次，
        // 也不能让用户以为一定没扣费。
        submitted = true;
    }

    entry.controller.abort();
    inFlight.delete(key);
    return { cancelled: true, submitted };
}

/** 当前是否有该节点的生成在跑。 */
export function isGenerationActive(workflowId, nodeId) {
    return inFlight.has(generationKey(workflowId, nodeId));
}

/** 仅供测试与诊断。 */
export function activeGenerationCount() {
    return inFlight.size;
}

/** 仅供测试：清空登记表。 */
export function resetGenerationRegistry() {
    for (const entry of inFlight.values()) entry.controller.abort();
    inFlight.clear();
}
