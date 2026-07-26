/**
 * autoSaveScheduler.js
 *
 * 自动保存的定时逻辑，刻意与 React 解耦，方便回归测试。
 *
 * 关键约束：**定时器只能创建一次**。
 * 之前 useAutoSave 把 `nodes` 和未记忆化的 `onSave` 放进 effect 依赖数组，
 * 每次 render 都会 clearInterval + setInterval，60 秒的计时器永远从 0 重新开始。
 * 用户连续编辑画布时 App 每帧都在 render，于是自动保存实际上从不触发 ——
 * 一直到用户手动保存或进程崩溃为止。所以这里用 getState 回调读取最新状态，
 * 而不是把状态做成定时器的依赖。
 */

/**
 * @param {object} options
 * @param {number} options.intervalMs
 * @param {() => { isDirty: boolean, nodeCount: number, save: (() => Promise<void>) | null }} options.getState
 * @param {() => void} [options.onSaved]
 * @param {typeof setInterval} [options.setTimer]
 * @param {typeof clearInterval} [options.clearTimer]
 * @param {Pick<Console, 'error'> | null} [options.logger]
 */
export function createAutoSaveScheduler({
    intervalMs,
    getState,
    onSaved,
    setTimer = setInterval,
    clearTimer = clearInterval,
    logger = console
}) {
    let saving = false;
    let stopped = false;

    const tick = async () => {
        if (stopped || saving) return;

        const { isDirty, nodeCount, save } = getState();
        // 空画布不写盘：避免刚建项目还没放节点就把空状态盖回去。
        if (!isDirty || nodeCount === 0 || typeof save !== 'function') return;

        saving = true;
        try {
            await save();
            if (!stopped) onSaved?.();
        } catch (error) {
            logger?.error?.('[Auto-Save] Failed to auto-save:', error);
        } finally {
            saving = false;
        }
    };

    const timer = setTimer(tick, intervalMs);

    return {
        /** 仅供测试：立刻跑一次定时逻辑。 */
        tick,
        stop() {
            stopped = true;
            clearTimer(timer);
        }
    };
}
