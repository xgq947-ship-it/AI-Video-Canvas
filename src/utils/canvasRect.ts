/**
 * canvasRect.ts
 *
 * 读取画布容器（#canvas-background）的位置与尺寸，供坐标换算使用。
 * 单独放在前端 utils 里，让 shared/canvasCoords.js 保持纯函数、可被 node 测试直接引用。
 */

import type { RectLike } from '@/shared/canvasCoords.js';

export const CANVAS_ELEMENT_ID = 'canvas-background';

/**
 * 画布容器的 rect。rect.left 即左侧边栏宽度——漏掉它就是历史上多次位置偏移 bug 的根因。
 * 元素尚未挂载时退化为整个视口，避免抛错。
 */
export const getCanvasRect = (): RectLike => {
    const el = typeof document !== 'undefined' ? document.getElementById(CANVAS_ELEMENT_ID) : null;
    if (!el) {
        return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    }
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
};
