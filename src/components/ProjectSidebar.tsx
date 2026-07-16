import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftToLine,
  BookOpen,
  Boxes,
  ChevronDown,
  ChevronUp,
  CirclePlus,
  Film,
  Filter,
  FolderOpen,
  Grid2X2,
  Image as ImageIcon,
  LayoutList,
  LocateFixed,
  MoreHorizontal,
  Search,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { NodeData, NodeType } from '../types';

type SidebarTab = 'canvas' | 'assets';
type AssetScope = 'personal' | 'agent';

export const EXPANDED_SIDEBAR_WIDTH = 300;
export const COLLAPSED_SIDEBAR_WIDTH = 72;

interface SidebarAsset {
  id: string;
  name: string;
  url: string;
  type: 'image' | 'video';
  category?: string;
  prompt?: string;
}

interface ProjectSidebarProps {
  nodes: NodeData[];
  selectedNodeIds: string[];
  canvasTitle: string;
  workflowId?: string | null;
  onSelectNode: (id: string) => void;
  onLocateNode: (id: string) => void;
  onAddNode: () => void;
  onOpenWorkflows: (e: React.MouseEvent) => void;
  onOpenHistory: (e: React.MouseEvent) => void;
  onOpenAssets: (e: React.MouseEvent) => void;
  onOpenStoryboard: () => void;
  onCreateProject: () => void;
  onDeleteProject: () => void;
  onCollapsedChange?: (collapsed: boolean) => void;
  canvasTheme?: 'dark' | 'light';
}

const typeLabel: Record<string, string> = {
  [NodeType.TEXT]: '文本',
  [NodeType.IMAGE]: '图片',
  [NodeType.VIDEO]: '视频',
  [NodeType.AUDIO]: '配音',
  [NodeType.IMAGE_EDITOR]: '图片编辑',
  [NodeType.VIDEO_EDITOR]: '视频剪辑',
  [NodeType.STORYBOARD]: '分镜',
  [NodeType.CAMERA_ANGLE]: '镜头角度',
  [NodeType.SFX]: '音效',
  [NodeType.BGM]: '背景音乐',
  [NodeType.SUBTITLE]: '字幕',
  [NodeType.RENDER]: '成片',
};

const nodeThumbnail = (node: NodeData) => node.resultUrl || node.mediaUrl || node.lastFrame;

export const ProjectSidebar: React.FC<ProjectSidebarProps> = ({
  nodes,
  selectedNodeIds,
  canvasTitle,
  workflowId,
  onSelectNode,
  onLocateNode,
  onAddNode,
  onOpenWorkflows,
  onOpenHistory,
  onOpenAssets,
  onOpenStoryboard,
  onCreateProject,
  onDeleteProject,
  onCollapsedChange,
  canvasTheme = 'dark',
}) => {
  const [activeTab, setActiveTab] = useState<SidebarTab>('canvas');
  const [assetScope, setAssetScope] = useState<AssetScope>('personal');
  const [query, setQuery] = useState('');
  const [nodeSearchOpen, setNodeSearchOpen] = useState(false);
  const [nodeFilter, setNodeFilter] = useState('all');
  const [sortNewestFirst, setSortNewestFirst] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [assets, setAssets] = useState<SidebarAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isDark = canvasTheme === 'dark';

  useEffect(() => onCollapsedChange?.(collapsed), [collapsed, onCollapsedChange]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setProjectMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => {
    if (activeTab !== 'assets') return;
    let cancelled = false;
    const load = async () => {
      setAssetsLoading(true);
      try {
        if (assetScope === 'agent') {
          const response = await fetch('/api/library');
          const data = response.ok ? await response.json() : [];
          if (!cancelled) setAssets(Array.isArray(data) ? data : []);
        } else {
          const [imagesResponse, videosResponse] = await Promise.all([
            fetch('/api/assets/images'),
            fetch('/api/assets/videos'),
          ]);
          const images = imagesResponse.ok ? await imagesResponse.json() : [];
          const videos = videosResponse.ok ? await videosResponse.json() : [];
          const normalized = [
            ...(Array.isArray(images) ? images : []).map((asset: any) => ({
              ...asset,
              name: asset.prompt || asset.filename || '图片素材',
              type: 'image' as const,
            })),
            ...(Array.isArray(videos) ? videos : []).map((asset: any) => ({
              ...asset,
              name: asset.prompt || asset.filename || '视频素材',
              type: 'video' as const,
            })),
          ];
          if (!cancelled) setAssets(normalized);
        }
      } catch (error) {
        console.error('Failed to load sidebar assets:', error);
        if (!cancelled) setAssets([]);
      } finally {
        if (!cancelled) setAssetsLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeTab, assetScope]);

  const visibleNodes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = nodes.filter(node => {
      const matchesType = nodeFilter === 'all' || node.type === nodeFilter;
      const title = `${node.title || ''} ${typeLabel[node.type] || node.type} ${node.prompt || ''}`.toLowerCase();
      return matchesType && (!normalizedQuery || title.includes(normalizedQuery));
    });
    return sortNewestFirst ? [...filtered].reverse() : filtered;
  }, [nodes, nodeFilter, query, sortNewestFirst]);

  const visibleAssets = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return assets.filter(asset => `${asset.name || ''} ${asset.prompt || ''} ${asset.category || ''}`.toLowerCase().includes(normalizedQuery));
  }, [assets, query]);

  const surface = isDark ? 'bg-[#151515] border-[#343434] text-white' : 'bg-[#f7f7f7] border-neutral-300 text-neutral-900';
  const muted = isDark ? 'text-neutral-400' : 'text-neutral-500';
  const hover = isDark ? 'hover:bg-[#272727]' : 'hover:bg-neutral-200';

  if (collapsed) {
    return (
      <aside className={`fixed inset-y-0 left-0 z-30 flex w-[72px] flex-col items-center border-r ${surface}`}>
        <button className={`mt-4 rounded-2xl p-3 ${hover}`} onClick={() => setCollapsed(false)} title="展开侧边栏">
          <img src="/TwitCanva-logo.png" alt="TwitCanva" className="h-8 w-8 rounded-lg object-contain" />
        </button>
        <div className="mt-auto mb-5 flex flex-col gap-2">
          <SidebarIcon title="工作流" onClick={onOpenWorkflows}><Grid2X2 size={20} /></SidebarIcon>
          <SidebarIcon title="生成记录" onClick={onOpenHistory}><LocateFixed size={20} /></SidebarIcon>
          <SidebarIcon title="素材库" onClick={onOpenAssets}><Boxes size={20} /></SidebarIcon>
          <SidebarIcon title="展开侧边栏" onClick={() => setCollapsed(false)}><ArrowLeftToLine className="rotate-180" size={20} /></SidebarIcon>
        </div>
      </aside>
    );
  }

  return (
    <aside className={`fixed inset-y-0 left-0 z-30 flex w-[300px] flex-col border-r shadow-2xl ${surface}`}>
      <header className="shrink-0 border-b border-inherit px-4 pb-4 pt-4">
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setProjectMenuOpen(value => !value)}
            className={`flex items-center gap-2 rounded-xl p-2 transition-colors ${projectMenuOpen ? 'bg-[#2b2b2b]' : hover}`}
            aria-label="项目菜单"
          >
            <img src="/TwitCanva-logo.png" alt="TwitCanva" className="h-9 w-9 rounded-lg object-contain" />
            {projectMenuOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          {projectMenuOpen && (
            <div className="absolute left-0 top-14 z-50 w-[310px] overflow-hidden rounded-3xl border border-[#404040] bg-[#262626] p-2 shadow-2xl">
              <ProjectMenuButton onClick={() => setProjectMenuOpen(false)}>回到画布</ProjectMenuButton>
              <ProjectMenuButton onClick={(e) => { setProjectMenuOpen(false); onOpenWorkflows(e); }}>全部项目</ProjectMenuButton>
              <div className="my-2 border-t border-[#3c3c3c]" />
              <ProjectMenuButton onClick={() => { setProjectMenuOpen(false); onCreateProject(); }}>创建新项目</ProjectMenuButton>
              <ProjectMenuButton danger disabled={!workflowId} onClick={() => { setProjectMenuOpen(false); onDeleteProject(); }}>删除项目</ProjectMenuButton>
            </div>
          )}
        </div>
        <div className="mt-4 flex min-w-0 items-center gap-3 px-2 text-sm">
          <span className="max-w-[145px] truncate font-medium">{canvasTitle}</span>
          <span className={`h-4 w-px ${isDark ? 'bg-neutral-700' : 'bg-neutral-300'}`} />
          <span className={`min-w-0 flex-1 truncate ${muted}`}>{workflowId ? '已保存到本地' : '未保存项目'}</span>
          <ChevronDown size={14} className={muted} />
        </div>
      </header>

      <div className="flex shrink-0 items-center border-b border-inherit px-4 py-4">
        <div className="flex gap-2">
          <TabButton active={activeTab === 'canvas'} onClick={() => { setActiveTab('canvas'); setQuery(''); }}>画布</TabButton>
          <TabButton active={activeTab === 'assets'} onClick={() => { setActiveTab('assets'); setQuery(''); }}>资产</TabButton>
        </div>
        <button className={`ml-auto rounded-lg p-2 ${muted} ${hover}`} title="使用说明"><BookOpen size={22} /></button>
      </div>

      {activeTab === 'canvas' ? (
        <>
          <div className="flex shrink-0 items-center gap-3 px-5 py-5">
            {nodeSearchOpen ? (
              <SearchBox value={query} onChange={setQuery} compact onCompactClose={() => { setNodeSearchOpen(false); setQuery(''); }} />
            ) : (
              <>
                <span className={`text-sm font-semibold ${muted}`}>画布元素</span>
                <button onClick={() => setSortNewestFirst(value => !value)} className={`rounded-lg p-1.5 ${muted} ${hover}`} title="切换排序"><LayoutList size={18} /></button>
                <select
                  value={nodeFilter}
                  onChange={event => setNodeFilter(event.target.value)}
                  className="ml-auto bg-transparent text-sm outline-none"
                >
                  <option value="all">全部</option>
                  {[...new Set(nodes.map(node => node.type))].map(type => <option key={type} value={type}>{typeLabel[type] || type}</option>)}
                </select>
                <button onClick={() => setNodeSearchOpen(true)} className={`rounded-lg p-1.5 ${muted} ${hover}`} title="搜索节点"><Search size={21} /></button>
              </>
            )}
            <button onClick={onAddNode} className={`rounded-lg p-1.5 ${hover}`} title="新建节点"><CirclePlus size={20} /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 sidebar-scrollbar">
            {visibleNodes.length === 0 ? (
              <EmptyState label={nodes.length === 0 ? '画布暂无节点' : '没有匹配的节点'} />
            ) : visibleNodes.map(node => {
              const thumb = nodeThumbnail(node);
              const selected = selectedNodeIds.includes(node.id);
              return (
                <button
                  key={node.id}
                  onClick={() => onSelectNode(node.id)}
                  className={`group mb-1 flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors ${selected ? 'bg-[#292929]' : hover}`}
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-neutral-700 bg-neutral-800">
                    {thumb && node.type !== NodeType.VIDEO ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : node.type === NodeType.VIDEO ? <Film size={20} className={muted} /> : node.type === NodeType.IMAGE ? <ImageIcon size={20} className={muted} /> : <Sparkles size={20} className={muted} />}
                  </div>
                  <span className="min-w-0 flex-1 truncate text-[15px]">{node.title || node.prompt || typeLabel[node.type] || node.type}</span>
                  <MoreHorizontal size={18} className={`${muted} opacity-0 transition-opacity group-hover:opacity-100`} />
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={event => { event.stopPropagation(); onLocateNode(node.id); }}
                    className={`rounded-lg p-1.5 ${muted} opacity-0 transition-opacity group-hover:opacity-100 ${hover}`}
                    title="定位节点"
                  ><LocateFixed size={18} /></span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="shrink-0 p-3">
            <div className="grid grid-cols-2 rounded-xl border border-[#333] bg-[#202020] p-1">
              <button onClick={() => setAssetScope('personal')} className={`rounded-lg py-2 text-sm ${assetScope === 'personal' ? 'bg-[#343434] text-white' : muted}`}>个人</button>
              <button onClick={() => setAssetScope('agent')} className={`rounded-lg py-2 text-sm ${assetScope === 'agent' ? 'bg-[#343434] text-white' : muted}`}>Agent</button>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <SearchBox value={query} onChange={setQuery} placeholder="请输入搜索内容" />
              <button className={`rounded-lg p-2 ${muted} ${hover}`} title="筛选"><Filter size={20} /></button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 sidebar-scrollbar">
            {assetsLoading ? <EmptyState label="正在加载资产" /> : visibleAssets.length === 0 ? <EmptyState label="暂无资产" /> : visibleAssets.map(asset => {
              const dragType = asset.type === 'video' ? 'video' : 'image';
              const draggable = Boolean(asset.url);
              return (
                <button
                  key={`${asset.type}-${asset.id}`}
                  className={`group mb-1 flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left ${hover} ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
                  onClick={onOpenAssets}
                  draggable={draggable}
                  onDragStart={draggable ? (event) => {
                    event.dataTransfer.effectAllowed = 'copy';
                    event.dataTransfer.setData('application/x-twitcanva-asset', JSON.stringify({
                      url: asset.url,
                      type: dragType,
                      name: asset.name,
                      prompt: asset.prompt,
                    }));
                    const thumb = (event.currentTarget as HTMLElement).querySelector('img');
                    if (thumb) event.dataTransfer.setDragImage(thumb, 24, 24);
                  } : undefined}
                  title={draggable ? '拖到画布添加节点，或点击打开素材库' : undefined}
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-neutral-700 bg-neutral-800">
                    {asset.type === 'image' ? <img src={asset.url} alt="" className="h-full w-full object-cover" draggable={false} /> : <Film size={20} className={muted} />}
                  </div>
                  <span className="min-w-0 flex-1 truncate text-sm">{asset.name}</span>
                  <MoreHorizontal size={18} className={muted} />
                </button>
              );
            })}
          </div>
        </>
      )}

      <footer className="flex h-[70px] shrink-0 items-center border-t border-inherit px-5">
        <button onClick={() => setCollapsed(true)} className={`rounded-lg p-2 ${hover}`} title="收起侧边栏"><ArrowLeftToLine size={20} /></button>
        <span className={`ml-auto text-sm ${muted}`}>共 {nodes.length} 节点</span>
        <div className="ml-4 flex gap-1">
          <SidebarIcon title="工作流" onClick={onOpenWorkflows}><Grid2X2 size={19} /></SidebarIcon>
          <SidebarIcon title="AI 分镜" onClick={onOpenStoryboard}><SlidersHorizontal size={19} /></SidebarIcon>
        </div>
      </footer>
    </aside>
  );
};

const TabButton = ({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) => (
  <button onClick={onClick} className={`rounded-xl px-4 py-2 text-sm transition-colors ${active ? 'bg-[#3a3a3a] text-white' : 'text-neutral-400 hover:text-white'}`}>{children}</button>
);

const SidebarIcon = ({ title, children, onClick }: { title: string; children: React.ReactNode; onClick: (e: React.MouseEvent) => void }) => (
  <button onClick={onClick} className="rounded-lg p-2 text-neutral-300 transition-colors hover:bg-[#2b2b2b] hover:text-white" title={title}>{children}</button>
);

const ProjectMenuButton = ({ children, onClick, danger = false, disabled = false }: { children: React.ReactNode; onClick: (e: React.MouseEvent) => void; danger?: boolean; disabled?: boolean }) => (
  <button disabled={disabled} onClick={onClick} className={`w-full rounded-xl px-6 py-4 text-left text-base font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${danger ? 'text-red-300 hover:bg-red-500/10' : 'text-white hover:bg-[#333]'}`}>{children}</button>
);

const SearchBox = ({ value, onChange, placeholder = '搜索', compact = false, onCompactClose }: { value: string; onChange: (value: string) => void; placeholder?: string; compact?: boolean; onCompactClose?: () => void }) => (
  <label className={`flex items-center rounded-xl border border-[#393939] bg-[#252525] transition-all focus-within:border-neutral-500 ${compact ? 'h-9 w-[118px] px-2' : 'h-11 flex-1 px-3'}`}>
    <input autoFocus={compact} value={value} onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') onCompactClose?.(); }} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-neutral-500" />
    <Search size={compact ? 17 : 19} className="shrink-0 text-neutral-400" />
  </label>
);

const EmptyState = ({ label }: { label: string }) => (
  <div className="flex h-72 flex-col items-center justify-center text-neutral-500">
    <FolderOpen size={72} strokeWidth={1.2} />
    <span className="mt-5 text-sm text-neutral-300">{label}</span>
  </div>
);
