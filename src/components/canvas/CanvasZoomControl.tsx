import React, { useEffect, useRef, useState } from 'react';
import { Minus, Plus, Scan } from 'lucide-react';
import { NodeData, Viewport } from '../../types';
import { canvasViewCenter } from '@/shared/canvasCoords.js';
import { clampZoom } from '@/shared/zoom.js';
import { getCanvasRect } from '../../utils/canvasRect';
import { getNodeHeight, getNodeWidth } from './ConnectionsLayer';

interface CanvasZoomControlProps {
  nodes: NodeData[];
  viewport: Viewport;
  setViewport: React.Dispatch<React.SetStateAction<Viewport>>;
  canvasTheme?: 'dark' | 'light';
}

export const CanvasZoomControl: React.FC<CanvasZoomControlProps> = ({
  nodes,
  viewport,
  setViewport,
  canvasTheme = 'dark',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(String(Math.round(viewport.zoom * 100)));
  const rootRef = useRef<HTMLDivElement>(null);
  const isDark = canvasTheme === 'dark';

  useEffect(() => {
    if (!isOpen) setInputValue(String(Math.round(viewport.zoom * 100)));
  }, [isOpen, viewport.zoom]);

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);

  const applyZoom = (nextZoom: number) => {
    const zoom = clampZoom(nextZoom);
    const rect = getCanvasRect();
    setViewport(previous => {
      const center = canvasViewCenter(rect, previous);
      return {
        zoom,
        x: (rect.width || 0) / 2 - center.x * zoom,
        y: (rect.height || 0) / 2 - center.y * zoom,
      };
    });
    setInputValue(String(Math.round(zoom * 100)));
    setIsOpen(false);
  };

  const fitCanvas = () => {
    if (nodes.length === 0) {
      setViewport({ x: 0, y: 0, zoom: 1 });
      setIsOpen(false);
      return;
    }

    const rect = getCanvasRect();
    const bounds = nodes.map(node => {
      const parent = node.parentIds?.length ? nodes.find(item => item.id === node.parentIds?.[0]) : undefined;
      return {
        x: node.x,
        y: node.y,
        width: getNodeWidth(node, parent),
        height: getNodeHeight(node, parent),
      };
    });
    const minX = Math.min(...bounds.map(node => node.x));
    const minY = Math.min(...bounds.map(node => node.y));
    const maxX = Math.max(...bounds.map(node => node.x + node.width));
    const maxY = Math.max(...bounds.map(node => node.y + node.height));
    const contentWidth = Math.max(1, maxX - minX);
    const contentHeight = Math.max(1, maxY - minY);
    const padding = 80;
    const zoom = clampZoom(Math.min(
      1,
      Math.max(0.1, Math.min(
        Math.max(1, (rect.width || 0) - padding * 2) / contentWidth,
        Math.max(1, (rect.height || 0) - padding * 2) / contentHeight,
      )),
    ));

    setViewport({
      zoom,
      x: ((rect.width || 0) - contentWidth * zoom) / 2 - minX * zoom,
      y: ((rect.height || 0) - contentHeight * zoom) / 2 - minY * zoom,
    });
    setIsOpen(false);
  };

  const commitInput = () => {
    const percent = Number(inputValue);
    if (Number.isFinite(percent)) applyZoom(percent / 100);
    else setInputValue(String(Math.round(viewport.zoom * 100)));
  };

  return (
    <div ref={rootRef} className="relative">
      {isOpen && (
        <div className={`absolute bottom-full left-1/2 mb-3 w-56 -translate-x-1/2 overflow-hidden rounded-2xl border p-2 shadow-2xl ${isDark
          ? 'border-neutral-700 bg-[#292929] text-neutral-100'
          : 'border-neutral-200 bg-white text-neutral-800'
          }`}>
          <div className={`mb-1 flex items-center rounded-xl px-3 py-2 ${isDark ? 'bg-neutral-700' : 'bg-neutral-100'}`}>
            <input
              aria-label="缩放百分比"
              type="number"
              min="10"
              max="200"
              value={inputValue}
              onChange={event => setInputValue(event.target.value)}
              onBlur={commitInput}
              onKeyDown={event => {
                if (event.key === 'Enter') commitInput();
                if (event.key === 'Escape') setIsOpen(false);
              }}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
            <span className={isDark ? 'text-neutral-400' : 'text-neutral-500'}>%</span>
          </div>

          <ZoomMenuButton label="放大" shortcut="⌘ +" icon={<Plus size={15} />} onClick={() => applyZoom(viewport.zoom * 1.2)} isDark={isDark} />
          <ZoomMenuButton label="缩小" shortcut="⌘ −" icon={<Minus size={15} />} onClick={() => applyZoom(viewport.zoom / 1.2)} isDark={isDark} />
          <ZoomMenuButton label="适合屏幕" shortcut="⌘ 0" icon={<Scan size={15} />} onClick={fitCanvas} isDark={isDark} />
          <div className={`my-1 border-t ${isDark ? 'border-neutral-700' : 'border-neutral-200'}`} />
          <ZoomMenuButton label="缩放至50%" onClick={() => applyZoom(0.5)} isDark={isDark} />
          <ZoomMenuButton label="缩放至100%" onClick={() => applyZoom(1)} isDark={isDark} />
          <ZoomMenuButton label="缩放至200%" onClick={() => applyZoom(2)} isDark={isDark} />
        </div>
      )}

      <button
        type="button"
        aria-label="缩放设置"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(open => !open)}
        className={`flex h-9 min-w-14 items-center justify-center rounded-xl px-2 text-sm font-medium transition-colors ${isOpen
          ? isDark ? 'bg-neutral-700 text-white' : 'bg-neutral-200 text-neutral-900'
          : isDark ? 'text-neutral-200 hover:bg-neutral-800' : 'text-neutral-700 hover:bg-neutral-100'
          }`}
      >
        {Math.round(viewport.zoom * 100)}%
      </button>
    </div>
  );
};

interface ZoomMenuButtonProps {
  label: string;
  shortcut?: string;
  icon?: React.ReactNode;
  onClick: () => void;
  isDark: boolean;
}

const ZoomMenuButton: React.FC<ZoomMenuButtonProps> = ({ label, shortcut, icon, onClick, isDark }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${isDark ? 'hover:bg-neutral-700' : 'hover:bg-neutral-100'}`}
  >
    {icon && <span className={isDark ? 'text-neutral-400' : 'text-neutral-500'}>{icon}</span>}
    <span className="flex-1">{label}</span>
    {shortcut && <span className={isDark ? 'text-neutral-500' : 'text-neutral-400'}>{shortcut}</span>}
  </button>
);
