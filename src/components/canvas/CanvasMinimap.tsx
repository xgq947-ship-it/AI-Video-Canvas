import React, { useMemo } from 'react';
import { NodeData, Viewport } from '../../types';
import { getNodeHeight, getNodeWidth } from './ConnectionsLayer';

interface CanvasMinimapProps {
  nodes: NodeData[];
  viewport: Viewport;
  setViewport: React.Dispatch<React.SetStateAction<Viewport>>;
  canvasWidth: number;
  canvasHeight: number;
  canvasTheme?: 'dark' | 'light';
}

const MAP_WIDTH = 280;
const MAP_HEIGHT = 180;
const MAP_PADDING = 14;

export const CanvasMinimap: React.FC<CanvasMinimapProps> = ({
  nodes,
  viewport,
  setViewport,
  canvasWidth,
  canvasHeight,
  canvasTheme = 'dark',
}) => {
  const layout = useMemo(() => {
    const visibleLeft = -viewport.x / viewport.zoom;
    const visibleTop = -viewport.y / viewport.zoom;
    const visibleWidth = canvasWidth / viewport.zoom;
    const visibleHeight = canvasHeight / viewport.zoom;

    const nodeRects = nodes.map(node => {
      const parent = node.parentIds?.length ? nodes.find(item => item.id === node.parentIds?.[0]) : undefined;
      return {
        id: node.id,
        x: node.x,
        y: node.y,
        width: getNodeWidth(node, parent),
        height: getNodeHeight(node, parent),
      };
    });

    const minNodeX = nodeRects.length ? Math.min(...nodeRects.map(node => node.x)) : visibleLeft;
    const minNodeY = nodeRects.length ? Math.min(...nodeRects.map(node => node.y)) : visibleTop;
    const maxNodeX = nodeRects.length ? Math.max(...nodeRects.map(node => node.x + node.width)) : visibleLeft + visibleWidth;
    const maxNodeY = nodeRects.length ? Math.max(...nodeRects.map(node => node.y + node.height)) : visibleTop + visibleHeight;
    const contentMinX = Math.min(minNodeX, visibleLeft);
    const contentMinY = Math.min(minNodeY, visibleTop);
    const contentMaxX = Math.max(maxNodeX, visibleLeft + visibleWidth);
    const contentMaxY = Math.max(maxNodeY, visibleTop + visibleHeight);
    const worldPadding = Math.max(100, Math.max(contentMaxX - contentMinX, contentMaxY - contentMinY) * 0.06);
    const minX = contentMinX - worldPadding;
    const minY = contentMinY - worldPadding;
    const maxX = contentMaxX + worldPadding;
    const maxY = contentMaxY + worldPadding;
    const worldWidth = Math.max(1, maxX - minX);
    const worldHeight = Math.max(1, maxY - minY);
    const scale = Math.min(
      (MAP_WIDTH - MAP_PADDING * 2) / worldWidth,
      (MAP_HEIGHT - MAP_PADDING * 2) / worldHeight
    );
    const offsetX = (MAP_WIDTH - worldWidth * scale) / 2 - minX * scale;
    const offsetY = (MAP_HEIGHT - worldHeight * scale) / 2 - minY * scale;

    return {
      nodeRects,
      scale,
      offsetX,
      offsetY,
      visibleLeft,
      visibleTop,
      visibleWidth,
      visibleHeight,
    };
  }, [canvasHeight, canvasWidth, nodes, viewport]);

  const moveViewport = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const mapX = (event.clientX - rect.left) * (MAP_WIDTH / rect.width);
    const mapY = (event.clientY - rect.top) * (MAP_HEIGHT / rect.height);
    const worldX = (mapX - layout.offsetX) / layout.scale;
    const worldY = (mapY - layout.offsetY) / layout.scale;
    setViewport(previous => ({
      ...previous,
      x: canvasWidth / 2 - worldX * previous.zoom,
      y: canvasHeight / 2 - worldY * previous.zoom,
    }));
  };

  const isDark = canvasTheme === 'dark';

  return (
    <div className={`overflow-hidden rounded-2xl border p-2 shadow-2xl backdrop-blur-xl ${isDark ? 'border-neutral-700 bg-[#242424]/95' : 'border-neutral-300 bg-white/95'}`}>
      <svg
        width={MAP_WIDTH}
        height={MAP_HEIGHT}
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        className="block cursor-crosshair touch-none rounded-xl"
        onPointerDown={event => {
          event.currentTarget.setPointerCapture(event.pointerId);
          moveViewport(event);
        }}
        onPointerMove={event => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) moveViewport(event);
        }}
        onPointerUp={event => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        aria-label="画布小地图，点击或拖动可移动画布"
      >
        <rect width={MAP_WIDTH} height={MAP_HEIGHT} rx="12" fill={isDark ? '#292929' : '#eeeeee'} />
        {layout.nodeRects.map(node => (
          <rect
            key={node.id}
            x={node.x * layout.scale + layout.offsetX}
            y={node.y * layout.scale + layout.offsetY}
            width={Math.max(3, node.width * layout.scale)}
            height={Math.max(3, node.height * layout.scale)}
            rx="1.5"
            fill={isDark ? '#777777' : '#8a8a8a'}
            opacity="0.9"
          />
        ))}
        <rect
          x={layout.visibleLeft * layout.scale + layout.offsetX}
          y={layout.visibleTop * layout.scale + layout.offsetY}
          width={layout.visibleWidth * layout.scale}
          height={layout.visibleHeight * layout.scale}
          rx="3"
          fill="rgba(255,255,255,0.04)"
          stroke={isDark ? '#d4d4d4' : '#404040'}
          strokeWidth="1.5"
        />
      </svg>
    </div>
  );
};
