export function visibleNodeIds(options: {
    nodes: Array<{ id: string; x: number; y: number }>;
    viewport: { x: number; y: number; zoom: number };
    /** 尺寸缺失时不做剔除（宁可多渲染，也不能让画布空白）。 */
    rect: { width?: number; height?: number };
    keepIds?: Iterable<string>;
    marginScreens?: number;
}): Set<string>;
