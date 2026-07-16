/**
 * shared/canvasCoords.js
 *
 * 画布坐标换算（纯函数，前端与测试共用）。
 *
 * 项目里存在三套坐标，混用是历史上多次"位置偏移"bug 的根因，这里统一收口：
 *
 *  1. screen（屏幕/客户端坐标）：事件里的 e.clientX / e.clientY，原点是浏览器视口左上角。
 *  2. pane（画布面板坐标）：相对 #canvas-background 左上角。
 *     因为画布被左侧边栏右推，pane.x = screen.x - rect.left（rect.left 即侧边栏宽度）。
 *  3. canvas（世界坐标）：节点的 node.x / node.y，受 viewport 平移与缩放影响。
 *
 * 渲染关系（#canvas-background 内的变换层为 translate(viewport.x, viewport.y) scale(zoom)，
 * transformOrigin: 0 0）：
 *
 *     screen = rect.left + viewport.x + canvas * zoom
 *
 * 常见错误：把 screen 直接当成 pane 用（漏掉 rect.left），
 * 或用 window.innerWidth/2 当画布中心（同样漏掉侧边栏宽度）。
 *
 * @typedef {{ x: number, y: number, zoom: number }} Viewport
 * @typedef {{ left: number, top: number, width?: number, height?: number }} RectLike
 */

/** screen → pane：扣除画布容器自身的偏移（侧边栏宽度等） */
export const screenToPane = (screenX, screenY, rect) => ({
    x: screenX - rect.left,
    y: screenY - rect.top,
});

/** pane → canvas：扣除视口平移并按缩放还原 */
export const paneToCanvas = (paneX, paneY, viewport) => ({
    x: (paneX - viewport.x) / viewport.zoom,
    y: (paneY - viewport.y) / viewport.zoom,
});

/** canvas → pane */
export const canvasToPane = (canvasX, canvasY, viewport) => ({
    x: canvasX * viewport.zoom + viewport.x,
    y: canvasY * viewport.zoom + viewport.y,
});

/** screen → canvas：最常用。把鼠标位置直接换算成节点坐标。 */
export const screenToCanvas = (screenX, screenY, rect, viewport) => {
    const pane = screenToPane(screenX, screenY, rect);
    return paneToCanvas(pane.x, pane.y, viewport);
};

/** canvas → screen：screen = rect.left + viewport.x + canvas * zoom */
export const canvasToScreen = (canvasX, canvasY, rect, viewport) => {
    const pane = canvasToPane(canvasX, canvasY, viewport);
    return { x: pane.x + rect.left, y: pane.y + rect.top };
};

/**
 * 画布可视区中心对应的世界坐标。
 * 用它替代 (window.innerWidth / 2 - viewport.x) / zoom —— 后者漏掉了侧边栏宽度，
 * 会让"居中新建"的节点偏出视觉中心。
 */
export const canvasViewCenter = (rect, viewport) =>
    paneToCanvas((rect.width || 0) / 2, (rect.height || 0) / 2, viewport);

/** 节点卡片默认渲染宽度（见 CanvasNode 的 w-[365px]）。视频节点为 385。 */
export const DEFAULT_NODE_WIDTH = 365;
export const VIDEO_NODE_WIDTH = 385;
export const DEFAULT_NODE_HEIGHT = 300;

/**
 * 把节点放到某个世界坐标点上并居中（减去节点自身一半尺寸）。
 *
 * 注意：节点尺寸并不统一——文本/待生成为 365，视频为 385，
 * 而已出图的图片节点是 auto（随图片比例变化），渲染前无法预知。
 * 因此这里只能按传入尺寸近似居中；图片节点会有几十 px 内的偏差，属预期行为。
 *
 * @param {{x:number,y:number}} point 世界坐标
 * @param {number} [nodeWidth=DEFAULT_NODE_WIDTH]
 * @param {number} [nodeHeight=DEFAULT_NODE_HEIGHT]
 */
export const centerNodeAt = (point, nodeWidth = DEFAULT_NODE_WIDTH, nodeHeight = DEFAULT_NODE_HEIGHT) => ({
    x: point.x - nodeWidth / 2,
    y: point.y - nodeHeight / 2,
});
