/**
 * viewportCulling.js
 *
 * 判断哪些节点需要真的渲染。
 *
 * 画布把**所有**节点无差别地渲染出来。LazyImage/LazyVideo 已经让视口外的媒体不占
 * 解码器，但节点本身的 DOM 子树仍然全部挂着——NodeControls 有一千七百行，一个
 * 屏幕外几千像素的节点照样参与 React 协调和布局。节点上百之后这是最大的一块开销。
 *
 * 两条必须守住的例外，否则会制造比性能更糟的 bug：
 *
 * 1. **选中的节点永不剔除。** 拖拽依赖 setPointerCapture，捕获挂在节点的 DOM 元素
 *    上。把正在拖的节点卸载掉，指针捕获随之失效，拖拽会直接断在半路。拖拽一定先
 *    选中（handleNodePointerDown 会调 onSelect），所以「选中即保留」正好覆盖它。
 * 2. **连线拖拽的起点节点永不剔除。** 同样是指针捕获的问题，而连线起点不一定被选中。
 *
 * 剔除边界额外留一整屏（margin = 1 个视口），滚动时不会看到节点在边缘闪进闪出。
 */

/** 节点世界尺寸的保守估计。留白够大，不需要精确值。 */
const ASSUMED_NODE_WIDTH = 400;
const ASSUMED_NODE_HEIGHT = 620;

/**
 * 计算当前应当渲染的节点 id 集合。
 *
 * @param {object} options
 * @param {Array<{id: string, x: number, y: number}>} options.nodes
 * @param {{x: number, y: number, zoom: number}} options.viewport
 * @param {{width: number, height: number}} options.rect 画布可视区尺寸
 * @param {Iterable<string>} [options.keepIds] 无论在不在视口内都必须保留的节点
 * @param {number} [options.marginScreens] 上下左右各多留几屏，默认 1
 * @returns {Set<string>}
 */
export function visibleNodeIds({ nodes, viewport, rect, keepIds = [], marginScreens = 1 }) {
    const result = new Set(keepIds);
    // 不要写成 `Number(...) || 1`：那会把 zoom=0 / NaN 悄悄变成 1，
    // 下面的合法性检查就永远不会触发，于是在一个无意义的比例下真去剔除节点。
    const zoom = Number(viewport?.zoom);
    const width = Number(rect?.width);
    const height = Number(rect?.height);

    // 尺寸拿不到（元素还没挂载）时不做剔除：宁可多渲染，也不能让画布空白。
    if (!(width > 0) || !(height > 0) || !Number.isFinite(zoom) || zoom <= 0) {
        for (const node of nodes) result.add(node.id);
        return result;
    }

    // 屏幕坐标 = viewport.x + 世界坐标 * zoom，反解出可视区对应的世界矩形。
    const worldWidth = width / zoom;
    const worldHeight = height / zoom;
    const marginX = worldWidth * marginScreens;
    const marginY = worldHeight * marginScreens;

    const minX = (-viewport.x) / zoom - marginX;
    const maxX = minX + worldWidth + marginX * 2;
    const minY = (-viewport.y) / zoom - marginY;
    const maxY = minY + worldHeight + marginY * 2;

    for (const node of nodes) {
        const left = node.x;
        const right = node.x + ASSUMED_NODE_WIDTH;
        const top = node.y;
        const bottom = node.y + ASSUMED_NODE_HEIGHT;
        if (right >= minX && left <= maxX && bottom >= minY && top <= maxY) {
            result.add(node.id);
        }
    }

    return result;
}
