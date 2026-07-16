import React from 'react';
import { NodeData } from '../../types';

const GRID_SPLIT_OPTIONS = [
  { label: '4宫格 (2×2)', cols: 2, rows: 2 },
  { label: '9宫格 (3×3)', cols: 3, rows: 3 },
  { label: '16宫格 (4×4)', cols: 4, rows: 4 },
  { label: '25宫格 (5×5)', cols: 5, rows: 5 },
];

export type NodeHoverToolbarAction =
  | 'changeAngle'
  | 'gridSplit'
  | 'upload'
  | 'separator'
  | 'expand'
  | 'postToX'
  | 'postToTikTok'
  | 'download'
  | 'dragToChat';

interface NodeHoverToolbarProps {
  data: NodeData;
  localScale: number;
  topClassName: '-top-12' | '-top-20';
  mediaType: 'image' | 'video';
  actions: NodeHoverToolbarAction[];
  onUpdate: (id: string, updates: Partial<NodeData>) => void;
  onUpload?: (nodeId: string, imageDataUrl: string) => void;
  onExpand?: (imageUrl: string) => void;
  onGridSplit?: (nodeId: string, cols: number, rows: number) => void;
  onPostToX?: (nodeId: string, mediaUrl: string, mediaType: 'image' | 'video') => void;
  onPostToTikTok?: (nodeId: string, mediaUrl: string) => void;
  onDragStart?: (nodeId: string, hasContent: boolean) => void;
  onDragEnd?: () => void;
}

const GridSplitMenu: React.FC<{ onSplit: (cols: number, rows: number) => void }> = ({ onSplit }) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(event) => { event.stopPropagation(); setOpen(value => !value); }}
        onPointerDown={(event) => event.stopPropagation()}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${open ? 'bg-blue-500 text-white' : 'text-neutral-300 hover:bg-neutral-700 hover:text-white'}`}
        title="把整图等分切成多张独立图片"
      >
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
          <line x1="15" y1="3" x2="15" y2="21" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="3" y1="15" x2="21" y2="15" />
        </svg>
        宫格切分
      </button>
      {open && (
        <div
          className="absolute top-full mt-2 left-1/2 -translate-x-1/2 w-40 rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl py-1 z-30"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {GRID_SPLIT_OPTIONS.map(option => (
            <button
              key={option.label}
              onClick={(event) => {
                event.stopPropagation();
                onSplit(option.cols, option.rows);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-800 hover:text-white transition-colors"
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const downloadMedia = (resultUrl: string, nodeId: string, mediaType: 'image' | 'video') => {
  const filename = `${mediaType}_${nodeId}.${mediaType === 'image' ? 'png' : 'mp4'}`;
  const cleanUrl = resultUrl.split('?')[0];

  if (mediaType === 'image' && resultUrl.startsWith('data:')) {
    const link = document.createElement('a');
    link.href = resultUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return;
  }

  fetch(cleanUrl, { cache: 'no-store' })
    .then(response => response.blob())
    .then(blob => {
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    })
    .catch(() => {
      const link = document.createElement('a');
      link.href = cleanUrl;
      link.download = filename;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
};

export const NodeHoverToolbar: React.FC<NodeHoverToolbarProps> = ({
  data,
  localScale,
  topClassName,
  mediaType,
  actions,
  onUpdate,
  onUpload,
  onExpand,
  onGridSplit,
  onPostToX,
  onPostToTikTok,
  onDragStart,
  onDragEnd,
}) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const resultUrl = data.resultUrl!;

  return (
    <div
      className={`absolute ${topClassName} left-0 right-0 flex justify-center opacity-0 group-hover/nodecard:opacity-100 transition-opacity z-20`}
      style={{
        transform: `scale(${localScale})`,
        transformOrigin: 'bottom center',
      }}
    >
      <div className="flex items-center gap-1 px-2 py-1.5 bg-neutral-900/95 rounded-full border border-neutral-700 shadow-xl backdrop-blur-md">
        {actions.map((action, index) => {
          switch (action) {
            case 'changeAngle':
              return (
                <button
                  key={`${action}-${index}`}
                  onClick={() => onUpdate(data.id, {
                    angleMode: !data.angleMode,
                    angleSettings: data.angleSettings || { rotation: 0, tilt: 0, scale: 0, wideAngle: false },
                  })}
                  onPointerDown={(event) => event.stopPropagation()}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${data.angleMode
                    ? 'bg-blue-500 text-white'
                    : 'text-neutral-300 hover:bg-neutral-700 hover:text-white'
                    }`}
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                    <line x1="12" y1="22.08" x2="12" y2="12" />
                  </svg>
                  调整角度
                </button>
              );
            case 'gridSplit':
              return onGridSplit ? (
                <GridSplitMenu
                  key={`${action}-${index}`}
                  onSplit={(cols, rows) => onGridSplit(data.id, cols, rows)}
                />
              ) : null;
            case 'upload':
              return (
                <React.Fragment key={`${action}-${index}`}>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    onPointerDown={(event) => event.stopPropagation()}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-neutral-300 hover:bg-neutral-700 hover:text-white rounded-full transition-colors"
                    title="上传图片"
                  >
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    上传
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file && onUpload) {
                        const reader = new FileReader();
                        reader.onload = (readerEvent) => {
                          onUpload(data.id, readerEvent.target?.result as string);
                        };
                        reader.readAsDataURL(file);
                      }
                      event.target.value = '';
                    }}
                  />
                </React.Fragment>
              );
            case 'separator':
              return <div key={`${action}-${index}`} className="w-px h-4 bg-neutral-600 mx-1" />;
            case 'expand':
              return (
                <button
                  key={`${action}-${index}`}
                  onClick={() => onExpand?.(resultUrl)}
                  onPointerDown={(event) => event.stopPropagation()}
                  className="p-1.5 text-neutral-300 hover:bg-neutral-700 hover:text-white rounded-full transition-colors"
                  title="查看原图"
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="15 3 21 3 21 9" />
                    <polyline points="9 21 3 21 3 15" />
                    <line x1="21" y1="3" x2="14" y2="10" />
                    <line x1="3" y1="21" x2="10" y2="14" />
                  </svg>
                </button>
              );
            case 'postToX':
              return (
                <button
                  key={`${action}-${index}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onPostToX?.(data.id, resultUrl, mediaType);
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  className="p-1.5 text-neutral-300 hover:bg-neutral-700 hover:text-white rounded-full transition-colors"
                  title="发布到 X"
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                </button>
              );
            case 'postToTikTok':
              return (
                <button
                  key={`${action}-${index}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onPostToTikTok?.(data.id, resultUrl);
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  className="p-1.5 text-neutral-300 hover:bg-neutral-700 hover:text-white rounded-full transition-colors"
                  title="发布到 TikTok"
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor">
                    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
                  </svg>
                </button>
              );
            case 'download':
              return (
                <button
                  key={`${action}-${index}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    downloadMedia(resultUrl, data.id, mediaType);
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  className="p-1.5 text-neutral-300 hover:bg-neutral-700 hover:text-white rounded-full transition-colors"
                  title="下载"
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </button>
              );
            case 'dragToChat':
              return (
                <div
                  key={`${action}-${index}`}
                  draggable
                  onPointerDown={(event) => event.stopPropagation()}
                  onDragStart={(event) => {
                    event.dataTransfer.setData('application/json', JSON.stringify({
                      nodeId: data.id,
                      url: resultUrl,
                      type: mediaType,
                    }));
                    event.dataTransfer.effectAllowed = 'copy';
                    onDragStart?.(data.id, true);
                  }}
                  onDragEnd={() => onDragEnd?.()}
                  className="p-1.5 bg-cyan-500/80 hover:bg-cyan-400 rounded-full text-white cursor-grab active:cursor-grabbing"
                  title="拖到聊天窗口"
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="9" cy="5" r="1" fill="currentColor" />
                    <circle cx="9" cy="12" r="1" fill="currentColor" />
                    <circle cx="9" cy="19" r="1" fill="currentColor" />
                    <circle cx="15" cy="5" r="1" fill="currentColor" />
                    <circle cx="15" cy="12" r="1" fill="currentColor" />
                    <circle cx="15" cy="19" r="1" fill="currentColor" />
                  </svg>
                </div>
              );
          }
        })}
      </div>
    </div>
  );
};
