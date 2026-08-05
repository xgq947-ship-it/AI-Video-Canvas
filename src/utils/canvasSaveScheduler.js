/**
 * canvasSaveScheduler.js
 *
 * 「画布出现了需要尽快落盘的变化」的合并调度器，刻意与 React 解耦，方便回归测试。
 *
 * 背景：以前有**两条**互相独立的立即保存路径：
 *   1. 媒体产物出现时，用 `setTimeout(..., 0)` 去抖 —— 0ms 只能合并同一个 tick
 *      内的变化，跨秒到达的产物一个也合并不掉；
 *   2. LOADING 节点数增加时，直接同步调用保存 —— 连去抖都没有。
 * 火柴人批量生成会同时命中两条：N 个分镜进入 LOADING 触发 N 次，N 个分镜产出媒体
 * 再触发 N 次，合计约 2N 次全量画布序列化 + 写盘，全在主线程上，界面明显发顿。
 *
 * 这里把两条路径合并成一个调度器。语义是**前沿排期 + 窗口内合并**，不是普通的
 * 尾沿去抖：第一次 request 就把保存排在 delayMs 之后，窗口内的后续 request 全部
 * 并入这一次。选它而不是尾沿去抖，是因为尾沿去抖在「事件持续到达」时会把保存
 * 无限往后推 —— 一个跑几分钟的批量生成可能直到全部结束才落盘，那正好丢掉了这套
 * 机制存在的意义（崩溃/断电时能恢复）。前沿排期则把最坏延迟锁死在 delayMs。
 */

/**
 * @param {object} options
 * @param {number} options.delayMs
 * @param {() => Promise<void> | void} options.save
 * @param {(error: unknown) => void} [options.onError]
 * @param {typeof setTimeout} [options.setTimer]
 * @param {typeof clearTimeout} [options.clearTimer]
 */
export function createCanvasSaveScheduler({
    delayMs,
    save,
    onError,
    setTimer = setTimeout,
    clearTimer = clearTimeout
}) {
    let timer = null;
    let stopped = false;

    const run = () => {
        timer = null;
        if (stopped) return;
        Promise.resolve()
            .then(() => save())
            .catch(error => onError?.(error));
    };

    return {
        /**
         * 请求一次保存；窗口内的重复请求合并为一次。
         * @returns {boolean} 是否真的新排了一次（false 表示并入了已有排期）
         */
        request() {
            if (stopped || timer !== null) return false;
            timer = setTimer(run, delayMs);
            return true;
        },

        /**
         * 立刻执行已排期的保存。页面卸载、切换项目、手动保存前必须调用，
         * 否则这段"已经变了但还没写盘"的窗口就真的丢了。
         * @returns {boolean} 是否有排期被提前执行
         */
        flush() {
            if (timer === null) return false;
            clearTimer(timer);
            run();
            return true;
        },

        /**
         * 丢弃已排期的保存（例如刚刚已经通过别的入口存过了）。
         * @returns {boolean} 是否有排期被丢弃
         */
        cancel() {
            if (timer === null) return false;
            clearTimer(timer);
            timer = null;
            return true;
        },

        get pending() {
            return timer !== null;
        },

        stop() {
            stopped = true;
            if (timer !== null) {
                clearTimer(timer);
                timer = null;
            }
        }
    };
}
