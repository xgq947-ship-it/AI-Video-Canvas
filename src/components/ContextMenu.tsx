import React, { useEffect, useRef, useState } from 'react';
import {
  Type,
  Image as ImageIcon,
  Video,
  Film,
  Music,
  PenTool,
  Layout,
  Upload,
  Trash2,
  Plus,
  Undo2,
  Redo2,
  Clipboard,
  Copy,
  Files,
  Layers,
  ChevronRight,
  HardDrive,
  Mic,
  Volume2,
  Captions,
  Clapperboard,
  ArrowLeft,
  SlidersHorizontal,
  Scissors,
  AudioLines,
  Library,
  History,
} from 'lucide-react';
import { ContextMenuState, NodeType } from '../types';

interface ContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
  onSelectType: (type: NodeType | 'DELETE') => void;
  onUpload: (file: File) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onPaste?: () => void;
  onCopy?: () => void;
  onDuplicate?: () => void;
  onCreateAsset?: () => void;
  onAddAssets?: () => void;
  onOpenStoryboard?: () => void;
  onOpenHistory?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  canvasTheme?: 'dark' | 'light';
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  state,
  onClose,
  onSelectType,
  onUpload,
  onUndo,
  onRedo,
  onPaste,
  onCopy,
  onDuplicate,
  onCreateAsset,
  onAddAssets,
  onOpenStoryboard,
  onOpenHistory,
  canUndo = false,
  canRedo = false,
  canvasTheme = 'dark'
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<'main' | 'add-nodes'>('main');

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Reset view when menu opens or re-opens (new state)
  useEffect(() => {
    if (state.isOpen && state.type === 'global') {
      setView('main');
    }
  }, [state]);

  const handleUploadClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUpload(file);
      onClose();
    }
    // Reset value so same file can be selected again
    if (e.target) {
      e.target.value = '';
    }
  };

  const handleUndo = () => {
    if (onUndo && canUndo) {
      onUndo();
      onClose();
    }
  };

  const handleRedo = () => {
    if (onRedo && canRedo) {
      onRedo();
      onClose();
    }
  };

  const handlePaste = () => {
    if (onPaste) {
      onPaste();
      onClose();
    }
  };


  if (!state.isOpen) return null;

  const menuLeft = Math.max(12, Math.min(state.x, window.innerWidth - 312));
  const menuHeight = state.type === 'global' && view === 'main' ? 470 : 620;
  // 节点“＋”菜单以点击位置作为左上角。底部空间不足时让菜单内部滚动，
  // 不再按预估高度把整张菜单向上回推。
  const menuTop = state.type === 'node-connector'
    ? Math.max(12, state.y)
    : Math.max(68, Math.min(state.y, window.innerHeight - menuHeight));
  const connectorMenuMaxHeight = state.type === 'node-connector'
    ? Math.max(160, window.innerHeight - menuTop - 12)
    : undefined;

  // 1. Right Click on Node
  if (state.type === 'node-options') {
    return (
      <div
        ref={menuRef}
        style={{ position: 'fixed', left: menuLeft, top: Math.max(68, Math.min(state.y, window.innerHeight - 320)), zIndex: 1000 }}
        className={`w-48 border rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-100 ${canvasTheme === 'dark' ? 'bg-[#1e1e1e] border-neutral-800' : 'bg-white border-neutral-200'
          }`}
      >
        <div className="p-1.5 flex flex-col gap-0.5">
          <MenuItem
            icon={<ImageIcon size={16} />}
            label="保存到素材库"
            onClick={() => {
              if (onCreateAsset) {
                onCreateAsset();
                onClose();
              }
            }}
            active={false}
            canvasTheme={canvasTheme}
          />
          <div className={`my-1 border-t mx-1 ${canvasTheme === 'dark' ? 'border-neutral-800' : 'border-neutral-100'}`} />

          <MenuItem
            icon={<Copy size={16} />}
            label="复制"
            shortcut="⌘C"
            onClick={() => {
              if (onCopy) {
                onCopy();
                onClose();
              }
            }}
            canvasTheme={canvasTheme}
          />
          <MenuItem
            icon={<Clipboard size={16} />}
            label="粘贴"
            shortcut="⌘V"
            onClick={handlePaste}
            disabled={true} // Disabled in screenshot
            canvasTheme={canvasTheme}
          />
          <MenuItem
            icon={<Files size={16} />}
            label="创建副本"
            onClick={() => {
              if (onDuplicate) {
                onDuplicate();
                onClose();
              }
            }}
          />

          <div className="my-1 border-t border-neutral-800 mx-1" />

          <MenuItem
            icon={<Trash2 size={16} />} // Screenshot has text "Delete", icon might be different
            label="删除"
            shortcut="⌫"
            onClick={() => onSelectType('DELETE')}
            canvasTheme={canvasTheme}
          />
        </div>
      </div>
    );
  }

  // 2. Connector Drag Drop (Add Next)
  const isConnector = state.type === 'node-connector';

  // If it's the Global Menu (Right Click on Blank), we show the specific options
  if (state.type === 'global' && view === 'main') {
    return (
      <div
        ref={menuRef}
        style={{ position: 'fixed', left: menuLeft, top: menuTop, zIndex: 1000 }}
        className={`w-[292px] border rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-100 ${canvasTheme === 'dark' ? 'bg-[#171717] border-neutral-800' : 'bg-white border-neutral-200'
          }`}
      >
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept="image/*,video/*"
          onChange={handleFileChange}
        />
        <div className="p-2 flex flex-col gap-1">
          <MenuItem
            icon={<Film size={16} />}
            label="AI 生成分镜"
            onClick={() => {
              onOpenStoryboard?.();
              onClose();
            }}
            canvasTheme={canvasTheme}
          />

          <div className={`my-1 border-t mx-1 ${canvasTheme === 'dark' ? 'border-neutral-800' : 'border-neutral-100'}`} />

          <MenuItem
            icon={<Upload size={16} />}
            label="上传本地素材"
            onClick={handleUploadClick}
            canvasTheme={canvasTheme}
          />
          <MenuItem
            icon={<Layers size={16} />}
            label="从素材库选择"
            onClick={() => {
              if (onAddAssets) {
                onAddAssets();
                onClose();
              }
            }}
            canvasTheme={canvasTheme}
          />
          <MenuItem
            icon={<Plus size={16} />}
            label="单独添加节点"
            rightSlot={<ChevronRight size={14} className={canvasTheme === 'dark' ? 'text-neutral-500' : 'text-neutral-400'} />}
            onClick={() => setView('add-nodes')}
            active={false}
            canvasTheme={canvasTheme}
          />

          <div className={`my-1 border-t mx-1 ${canvasTheme === 'dark' ? 'border-neutral-800' : 'border-neutral-100'}`} />

          <MenuItem
            icon={<Undo2 size={16} />}
            label="撤销"
            shortcut="⌘Z"
            onClick={handleUndo}
            disabled={!canUndo}
            canvasTheme={canvasTheme}
          />
          <MenuItem
            icon={<Redo2 size={16} />}
            label="重做"
            shortcut="⇧⌘Z"
            onClick={handleRedo}
            disabled={!canRedo}
            canvasTheme={canvasTheme}
          />
          <div className={`my-1 border-t mx-1 ${canvasTheme === 'dark' ? 'border-neutral-800' : 'border-neutral-100'}`} />

          <MenuItem
            icon={<Clipboard size={16} />}
            label="粘贴"
            shortcut="⌘V"
            onClick={handlePaste}
            canvasTheme={canvasTheme}
          />
        </div>
      </div >
    );
  }

  // 双击画布：使用精简的快捷添加菜单，并以双击点作为左上角。
  // 纵向不再按菜单预估高度向上回推；空间不足时由菜单内部滚动承载。
  if (state.type === 'add-nodes') {
    const addMenuLeft = Math.max(12, Math.min(state.x, window.innerWidth - 284));
    const addMenuTop = Math.max(12, state.y);
    const addMenuMaxHeight = Math.max(160, window.innerHeight - addMenuTop - 12);

    return (
      <div
        ref={menuRef}
        style={{
          position: 'fixed',
          left: addMenuLeft,
          top: addMenuTop,
          maxHeight: addMenuMaxHeight,
          transformOrigin: 'top left',
          zIndex: 1000,
        }}
        className={`flex w-[272px] flex-col overflow-hidden rounded-[20px] border shadow-2xl animate-in fade-in zoom-in-95 duration-100 ${canvasTheme === 'dark'
          ? 'border-[#3a3a3a] bg-[#242424] text-white'
          : 'border-neutral-300 bg-white text-neutral-900'
          }`}
      >
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept="image/*,video/*"
          onChange={handleFileChange}
        />

        <div className="overflow-y-auto px-3 py-3">
          <div className={`mb-1 px-2 py-1 text-sm font-semibold ${canvasTheme === 'dark' ? 'text-neutral-400' : 'text-neutral-500'}`}>
            添加节点
          </div>

          <AddNodeMenuItem icon={<Type size={19} />} label="文本" onClick={() => onSelectType(NodeType.TEXT)} canvasTheme={canvasTheme} />
          <AddNodeMenuItem icon={<ImageIcon size={19} />} label="图片" onClick={() => onSelectType(NodeType.IMAGE)} canvasTheme={canvasTheme} />
          <AddNodeMenuItem icon={<Video size={19} />} label="视频" onClick={() => onSelectType(NodeType.VIDEO)} canvasTheme={canvasTheme} />
          <AddNodeMenuItem icon={<Scissors size={19} />} label="视频合成" badge="Beta" onClick={() => onSelectType(NodeType.VIDEO_EDITOR)} canvasTheme={canvasTheme} />
          <AddNodeMenuItem
            icon={<Layout size={19} />}
            label="导演台"
            badge="NEW"
            badgeTone="cyan"
            onClick={() => {
              onOpenStoryboard?.();
              onClose();
            }}
            canvasTheme={canvasTheme}
          />
          <AddNodeMenuItem icon={<AudioLines size={19} />} label="音频" onClick={() => onSelectType(NodeType.AUDIO)} canvasTheme={canvasTheme} />
          <AddNodeMenuItem icon={<Film size={19} />} label="脚本" rightSlot={<ChevronRight size={16} />} onClick={() => onSelectType(NodeType.TEXT)} canvasTheme={canvasTheme} />
          <AddNodeMenuItem
            icon={<Library size={19} />}
            label="素材库"
            badge="NEW"
            badgeTone="cyan"
            rightSlot={<ChevronRight size={16} />}
            onClick={() => {
              onAddAssets?.();
              onClose();
            }}
            canvasTheme={canvasTheme}
          />

          <div className={`mb-1 mt-2 px-2 py-1 text-sm font-semibold ${canvasTheme === 'dark' ? 'text-neutral-400' : 'text-neutral-500'}`}>
            添加资源
          </div>
          <AddNodeMenuItem icon={<Upload size={19} />} label="上传" onClick={handleUploadClick} canvasTheme={canvasTheme} />
          <AddNodeMenuItem
            icon={<History size={19} />}
            label="从生成历史选择"
            onClick={() => {
              onOpenHistory?.();
              onClose();
            }}
            canvasTheme={canvasTheme}
          />
        </div>
      </div>
    );
  }

  // 3. Add Nodes Menu (Global Submenu OR Connector Default)
  const title = isConnector ? '从当前节点继续' : '添加节点';

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: menuLeft,
        top: menuTop,
        maxHeight: connectorMenuMaxHeight,
        zIndex: 1000
      }}
      className={`w-[292px] max-h-[calc(100vh-92px)] border rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-100 ${canvasTheme === 'dark' ? 'bg-[#171717] border-neutral-800' : 'bg-white border-neutral-200'
        }`}
    >
      <div className={`flex items-center gap-2 px-3 py-3 text-sm font-medium border-b ${canvasTheme === 'dark' ? 'text-neutral-300 border-neutral-800' : 'text-neutral-600 border-neutral-100'
        }`}>
        {!isConnector && (
          <button
            type="button"
            aria-label="返回"
            onClick={() => setView('main')}
            className={`flex h-7 w-7 items-center justify-center rounded-lg ${canvasTheme === 'dark' ? 'hover:bg-neutral-800' : 'hover:bg-neutral-100'}`}
          >
            <ArrowLeft size={15} />
          </button>
        )}
        {title}
      </div>

      <div className="p-2 flex flex-col gap-1 overflow-y-auto">
        <div className={`px-2 pb-1 pt-0.5 text-[11px] font-medium ${canvasTheme === 'dark' ? 'text-neutral-500' : 'text-neutral-400'}`}>
          画面主流程
        </div>
        <MenuItem
          icon={<Type size={18} />}
          label="文字 / 剧本"
          onClick={() => onSelectType(NodeType.TEXT)}
          canvasTheme={canvasTheme}
        />
        <MenuItem
          icon={<ImageIcon size={18} />}
          label="图片 / 关键帧"
          active={false}
          onClick={() => onSelectType(NodeType.IMAGE)}
          canvasTheme={canvasTheme}
        />
        <MenuItem
          icon={<Video size={18} />}
          label="视频镜头"
          onClick={() => onSelectType(NodeType.VIDEO)}
          canvasTheme={canvasTheme}
        />

        <div className={`mx-2 my-1 border-t ${canvasTheme === 'dark' ? 'border-neutral-800' : 'border-neutral-100'}`} />
        <div className={`px-2 pb-1 pt-0.5 text-[11px] font-medium ${canvasTheme === 'dark' ? 'text-neutral-500' : 'text-neutral-400'}`}>
          声音与成片
        </div>
        <MenuItem
          icon={<Mic size={18} />}
          label="角色配音"
          onClick={() => onSelectType(NodeType.AUDIO)}
          canvasTheme={canvasTheme}
        />
        <MenuItem
          icon={<Volume2 size={18} />}
          label="音效"
          onClick={() => onSelectType(NodeType.SFX)}
          canvasTheme={canvasTheme}
        />
        <MenuItem
          icon={<Music size={18} />}
          label="背景音乐"
          onClick={() => onSelectType(NodeType.BGM)}
          canvasTheme={canvasTheme}
        />
        <MenuItem
          icon={<Captions size={18} />}
          label="字幕"
          onClick={() => onSelectType(NodeType.SUBTITLE)}
          canvasTheme={canvasTheme}
        />
        <MenuItem
          icon={<Clapperboard size={18} />}
          label="输出成片"
          onClick={() => onSelectType(NodeType.RENDER)}
          canvasTheme={canvasTheme}
        />

        {!isConnector && (
          <details className={`mt-1 rounded-xl border ${canvasTheme === 'dark' ? 'border-neutral-800' : 'border-neutral-200'}`}>
            <summary className={`flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-medium ${canvasTheme === 'dark' ? 'text-neutral-400 hover:text-white' : 'text-neutral-500 hover:text-neutral-900'}`}>
              <SlidersHorizontal size={14} />
              更多编辑与本地工具
            </summary>
            <div className={`border-t p-1 ${canvasTheme === 'dark' ? 'border-neutral-800' : 'border-neutral-100'}`}>
              <MenuItem icon={<PenTool size={16} />} label="图片编辑器" onClick={() => onSelectType(NodeType.IMAGE_EDITOR)} canvasTheme={canvasTheme} />
              <MenuItem icon={<Film size={16} />} label="视频编辑器" onClick={() => onSelectType(NodeType.VIDEO_EDITOR)} canvasTheme={canvasTheme} />
              <MenuItem icon={<HardDrive size={16} />} label="本地图片模型" onClick={() => onSelectType(NodeType.LOCAL_IMAGE_MODEL)} canvasTheme={canvasTheme} />
              <MenuItem icon={<HardDrive size={16} />} label="本地视频模型" onClick={() => onSelectType(NodeType.LOCAL_VIDEO_MODEL)} canvasTheme={canvasTheme} />
            </div>
          </details>
        )}
      </div>
    </div>
  );
};

interface AddNodeMenuItemProps {
  icon: React.ReactNode;
  label: string;
  badge?: string;
  badgeTone?: 'neutral' | 'cyan';
  rightSlot?: React.ReactNode;
  canvasTheme?: 'dark' | 'light';
  onClick: () => void;
}

const AddNodeMenuItem: React.FC<AddNodeMenuItemProps> = ({
  icon,
  label,
  badge,
  badgeTone = 'neutral',
  rightSlot,
  canvasTheme = 'dark',
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors ${canvasTheme === 'dark'
      ? 'text-neutral-100 hover:bg-white/8'
      : 'text-neutral-800 hover:bg-neutral-100'
      }`}
  >
    <span className={`flex h-6 w-6 shrink-0 items-center justify-center ${canvasTheme === 'dark' ? 'text-neutral-100' : 'text-neutral-700'}`}>
      {icon}
    </span>
    <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{label}</span>
    {badge && (
      <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold tracking-wide ${badgeTone === 'cyan'
        ? 'bg-cyan-400/20 text-cyan-300'
        : canvasTheme === 'dark'
          ? 'bg-neutral-700 text-neutral-300'
          : 'bg-neutral-200 text-neutral-600'
        }`}>
        {badge}
      </span>
    )}
    {rightSlot && <span className={canvasTheme === 'dark' ? 'text-neutral-400' : 'text-neutral-500'}>{rightSlot}</span>}
  </button>
);

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  desc?: string;
  badge?: string;
  shortcut?: string;
  active?: boolean;
  rightSlot?: React.ReactNode;
  disabled?: boolean;
  canvasTheme?: 'dark' | 'light';
  onClick: () => void;
}

const MenuItem: React.FC<MenuItemProps> = ({ icon, label, desc, badge, shortcut, active, rightSlot, disabled, canvasTheme = 'dark', onClick }) => {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`group flex items-center gap-3 w-full p-2 rounded-lg text-left transition-colors 
        ${disabled
          ? (canvasTheme === 'dark' ? 'opacity-30' : 'opacity-25')
          : active
            ? (canvasTheme === 'dark' ? 'bg-[#2a2a2a] text-white' : 'bg-neutral-100 text-neutral-900')
            : (canvasTheme === 'dark' ? 'text-neutral-300 hover:bg-[#2a2a2a] hover:text-white' : 'text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900')}
      `}
    >
      <div className={`flex items-center justify-center w-8 h-8 rounded-md transition-colors
        ${active
          ? (canvasTheme === 'dark' ? 'bg-[#3a3a3a]' : 'bg-white')
          : (canvasTheme === 'dark' ? 'bg-[#151515] group-hover:bg-[#3a3a3a]' : 'bg-neutral-100 group-hover:bg-white border border-transparent group-hover:border-neutral-200')}
        ${disabled ? 'bg-transparent' : ''}
      `}>
        {icon}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className={`font-medium text-sm truncate ${disabled && canvasTheme === 'light' ? 'text-neutral-400' : ''}`}>{label}</span>
          <div className="flex items-center gap-2">
            {badge && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${canvasTheme === 'dark' ? 'bg-neutral-800 text-neutral-400 border-neutral-700' : 'bg-neutral-100 text-neutral-500 border-neutral-200'
                }`}>
                {badge}
              </span>
            )}
            {shortcut && (
              <span className={`text-xs font-sans ${canvasTheme === 'dark' ? 'text-neutral-500' : 'text-neutral-400'
                }`}>{shortcut}</span>
            )}
            {rightSlot}
          </div>
        </div>
        {desc && (
          <p className={`text-xs mt-0.5 truncate ${canvasTheme === 'dark' ? 'text-neutral-500' : 'text-neutral-400'
            }`}>{desc}</p>
        )}
      </div>
    </button>
  );
};
