/**
 * useCanvasEditLock
 *
 * 没有项目时，画布是**只读**的。
 *
 * 之前用户一进主界面就能双击空白处弹出「添加节点」菜单，然后新建文本 / 图片 /
 * 视频节点 —— 但此时没有任何项目承接这些数据：节点无处保存，生成结果也没有归属
 * 目录。表现出来就是用户建了一堆东西，一刷新全没了。
 *
 * 这是一个**项目级编辑锁**，不是某个事件的补丁。所有会修改当前画布数据的入口
 * （双击 / 右键 / 快捷键 / 拖入 / 粘贴 / 连线 / 删除 / 生成 / 导入）都要先过
 * `guard()`；被拦下时给一条一致的提示，而不是各处各写一句。
 */

import { useCallback, useMemo } from 'react';

export const CANVAS_LOCKED_MESSAGE = '请先新建项目，再开始编辑画布';

interface UseCanvasEditLockOptions {
    /** 当前项目 id；为空即表示还没有项目。 */
    workflowId: string | null;
    /** 项目已加载但仍在初始化时可传 false，避免刚创建就误判为只读。 */
    ready?: boolean;
    /** 提示通道，通常是项目里已有的 Toast。 */
    notify?: (message: string) => void;
}

export interface CanvasEditLock {
    /** 画布当前是否可编辑。 */
    canEditCanvas: boolean;
    /**
     * 编辑闸门：可编辑时返回 true；否则提示并返回 false。
     * @example if (!guard()) return;
     */
    guard: () => boolean;
    /** 包装一个回调，使其在只读状态下自动被拦截。 */
    withGuard: <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => void;
}

export function useCanvasEditLock({
    workflowId,
    ready = true,
    notify
}: UseCanvasEditLockOptions): CanvasEditLock {
    const canEditCanvas = useMemo(
        () => Boolean(workflowId) && ready,
        [workflowId, ready]
    );

    const guard = useCallback(() => {
        if (canEditCanvas) return true;
        notify?.(CANVAS_LOCKED_MESSAGE);
        return false;
    }, [canEditCanvas, notify]);

    const withGuard = useCallback(
        <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => {
            if (!guard()) return;
            fn(...args);
        },
        [guard]
    );

    return { canEditCanvas, guard, withGuard };
}
