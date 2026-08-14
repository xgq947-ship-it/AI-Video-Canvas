import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftToLine,
  BookOpen,
  Boxes,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  Film,
  Filter,
  Folder,
  FolderMinus,
  FolderOpen,
  FolderPlus,
  Grid2X2,
  Image as ImageIcon,
  LayoutList,
  Loader2,
  LocateFixed,
  MoreHorizontal,
  Pencil,
  Search,
  Sparkles,
  Trash2,
  Volume2,
} from 'lucide-react';
import { NodeData, NodeGroup, NodeType } from '../types';
import { resolveImageNodeDisplayName } from '../utils/nodeDisplayName.js';

type SidebarTab = 'canvas' | 'assets';
type AssetScope = 'personal' | 'agent';

export const EXPANDED_SIDEBAR_WIDTH = 260;
export const COLLAPSED_SIDEBAR_WIDTH = 64;

interface SidebarAsset {
  id: string;
  name: string;
  displayName?: string;
  filename?: string;
  url: string;
  type: 'image' | 'video' | 'audio';
  category?: string;
  prompt?: string;
  characterId?: string;
  characterName?: string;
  characterAssetRole?: NodeData['characterAssetRole'];
  lookId?: string;
  lookName?: string;
}

export interface SidebarAssetPreview {
  name: string;
  url: string;
  type: 'image' | 'video';
}

interface ProjectSidebarProps {
  nodes: NodeData[];
  /** 画布分组（与画布上的 NodeGroup 是同一份数据，侧边栏只做展示/命名/成组入口） */
  groups: NodeGroup[];
  selectedNodeIds: string[];
  workflowId?: string | null;
  onSelectNode: (id: string) => void;
  /** 选中一组节点（点分组标题时选中该组全部节点） */
  onSelectNodes: (ids: string[]) => void;
  /** 把当前选中的节点成组（复用画布的成组逻辑） */
  onCreateGroup: () => void;
  onRenameGroup: (groupId: string, label: string) => void;
  onUngroup: (groupId: string) => void;
  onLocateNode: (id: string) => void;
  onAddNode: () => void;
  onOpenWorkflows: (e: React.MouseEvent) => void;
  onOpenHistory: (e: React.MouseEvent) => void;
  onOpenAssets: (e: React.MouseEvent) => void;
  onPreviewAsset: (asset: SidebarAssetPreview, anchor: HTMLElement) => void;
  onCreateProject: () => void;
  onDeleteProject: () => void;
  onRevealProject: () => void | Promise<void>;
  onRenameNode: (id: string, displayName: string, syncAsset?: boolean) => void;
  onCollapsedChange?: (collapsed: boolean) => void;
  canvasTheme?: 'dark' | 'light';
}

const typeLabel: Record<string, string> = {
  [NodeType.TEXT]: '文本',
  [NodeType.IMAGE]: '图片',
  [NodeType.VIDEO]: '视频',
  [NodeType.AUDIO]: '配音',
  [NodeType.IMAGE_EDITOR]: '图片编辑',
  [NodeType.CAMERA_ANGLE]: '镜头角度',
  [NodeType.PRODUCT_SCENE_REPLACE]: '产品短视频生成',
  [NodeType.DETAIL_PAGE_REMIX]: '商品详情复刻',
  [NodeType.VIDEO_REMIX]: '视频复刻',
  [NodeType.REFERENCE_VIDEO]: '参考视频',
  [NodeType.SCRIPT_INPUT]: '剧本输入',
  [NodeType.STICKMAN_DIRECTOR]: '火柴人视频导演',
  [NodeType.STORYBOARD]: '分镜列表',
  [NodeType.STORYBOARD_COMPARE]: '分镜对照组',
  [NodeType.FLOW_BATCH_VIDEO]: 'Flow 视频生成',
  [NodeType.VIDEO_MERGE]: '视频拼接',
  [NodeType.CINEMATIC_CAST]: '角色设定',
  [NodeType.CINEMATIC_DIRECTOR]: '电影短片导演',
  [NodeType.CINEMATIC_STORYBOARD]: '电影分镜',
  [NodeType.CINEMATIC_VIDEO_MERGE]: '电影成片拼接',
  [NodeType.SFX]: '音效',
  [NodeType.BGM]: '背景音乐',
  [NodeType.RENDER]: '成片',
};

const nodeThumbnail = (node: NodeData) => node.resultUrl || node.mediaUrl || node.lastFrame;

export const ProjectSidebar: React.FC<ProjectSidebarProps> = ({
  nodes,
  groups,
  selectedNodeIds,
  workflowId,
  onSelectNode,
  onSelectNodes,
  onCreateGroup,
  onRenameGroup,
  onUngroup,
  onLocateNode,
  onAddNode,
  onOpenWorkflows,
  onOpenHistory,
  onOpenAssets,
  onPreviewAsset,
  onCreateProject,
  onDeleteProject,
  onRevealProject,
  onRenameNode,
  onCollapsedChange,
  canvasTheme = 'dark',
}) => {
  const [activeTab, setActiveTab] = useState<SidebarTab>('canvas');
  const [assetScope, setAssetScope] = useState<AssetScope>('personal');
  const [query, setQuery] = useState('');
  const [nodeSearchOpen, setNodeSearchOpen] = useState(false);
  const [nodeFilter, setNodeFilter] = useState('all');
  const [sortNewestFirst, setSortNewestFirst] = useState(false);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(new Set());
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupLabel, setEditingGroupLabel] = useState('');
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [desktopPlatform, setDesktopPlatform] = useState('');
  const [revealingProject, setRevealingProject] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [assets, setAssets] = useState<SidebarAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetMenuId, setAssetMenuId] = useState<string | null>(null);
  const [assetMenuPosition, setAssetMenuPosition] = useState({ top: 0, left: 0 });
  const [deleteConfirmAssetId, setDeleteConfirmAssetId] = useState<string | null>(null);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  const [assetDeleteError, setAssetDeleteError] = useState<string | null>(null);
  const [editingAsset, setEditingAsset] = useState<{ key: string; asset: SidebarAsset; value: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const assetNameInputRef = useRef<HTMLInputElement>(null);
  const cancelAssetRenameRef = useRef(false);
  const assetPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDark = canvasTheme === 'dark';

  useEffect(() => onCollapsedChange?.(collapsed), [collapsed, onCollapsedChange]);

  useEffect(() => {
    let cancelled = false;
    void window.evanDesktop?.getAppInfo()
      .then(info => { if (!cancelled) setDesktopPlatform(info.platform); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!editingAsset) return;
    assetNameInputRef.current?.focus();
    assetNameInputRef.current?.select();
  }, [editingAsset?.key]);

  useEffect(() => () => {
    if (assetPreviewTimerRef.current) clearTimeout(assetPreviewTimerRef.current);
  }, []);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setProjectMenuOpen(false);
      if (!(event.target as HTMLElement).closest('[data-asset-menu]')) {
        setAssetMenuId(null);
        setDeleteConfirmAssetId(null);
      }
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
          const response = workflowId ? await fetch(`/api/projects/${encodeURIComponent(workflowId)}/assets`) : null;
          const data = response?.ok ? await response.json() : [];
          const listedAssets: SidebarAsset[] = Array.isArray(data) ? data : [];
          const nodeDisplayNames = new Map(
            nodes.flatMap(node => {
              const url = node.resultUrl || node.editorBackgroundUrl || node.lastFrame || node.mediaUrl;
              return url && node.displayName
                ? [[url.split('?')[0], node.displayName] as const]
                : [];
            })
          );
          if (!cancelled) {
            setAssets(listedAssets.map(asset => {
              const nodeName = nodeDisplayNames.get(asset.url.split('?')[0]);
              return nodeName ? { ...asset, displayName: nodeName, name: nodeName } : asset;
            }));
          }
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
  }, [activeTab, assetScope, workflowId, nodes]);

  const handleDeleteLocalImage = async (asset: SidebarAsset) => {
    if (assetScope !== 'personal' || asset.type !== 'image' || deletingAssetId) return;
    setDeletingAssetId(asset.id);
    setAssetDeleteError(null);
    try {
      const response = await fetch(`/api/assets/images/${encodeURIComponent(asset.id)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || '删除失败');
      }
      setAssets(prev => prev.filter(item => !(item.id === asset.id && item.type === asset.type)));
      setAssetMenuId(null);
      setDeleteConfirmAssetId(null);
    } catch (error) {
      console.error('Failed to delete local image:', error);
      setAssetDeleteError(error instanceof Error ? error.message : '删除失败，请稍后重试');
    } finally {
      setDeletingAssetId(null);
    }
  };

  const startAssetRename = (asset: SidebarAsset, event: React.MouseEvent) => {
    if (assetScope !== 'personal' || asset.type !== 'image' || !asset.filename) return;
    event.preventDefault();
    event.stopPropagation();
    if (assetPreviewTimerRef.current) clearTimeout(assetPreviewTimerRef.current);
    cancelAssetRenameRef.current = false;
    setEditingAsset({
      key: `${asset.type}:${asset.id}`,
      asset,
      value: asset.displayName || asset.name,
    });
  };

  const commitAssetRename = async () => {
    const editing = editingAsset;
    if (!editing) return;
    if (cancelAssetRenameRef.current) {
      cancelAssetRenameRef.current = false;
      setEditingAsset(null);
      return;
    }
    const nextName = editing.value.trim();
    if (!nextName || !workflowId || !editing.asset.filename) {
      setEditingAsset(null);
      return;
    }
    if (nextName === editing.asset.name) {
      setEditingAsset(null);
      return;
    }

    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(workflowId)}/assets/images/${encodeURIComponent(editing.asset.filename)}/display-name`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName: nextName }),
        }
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || '图片重命名失败');
      setAssets(current => current.map(asset => (
        asset.type === editing.asset.type && asset.id === editing.asset.id
          ? { ...asset, displayName: result.displayName || nextName, name: result.displayName || nextName }
          : asset
      )));
      for (const node of nodes) {
        const mediaUrl = node.resultUrl || node.editorBackgroundUrl || node.lastFrame;
        if (mediaUrl?.split('?')[0] === editing.asset.url.split('?')[0]) {
          onRenameNode(node.id, result.displayName || nextName, false);
        }
      }
      setAssetDeleteError(null);
    } catch (error) {
      setAssetDeleteError(error instanceof Error ? error.message : '图片重命名失败');
    } finally {
      setEditingAsset(null);
    }
  };

  const visibleNodes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = nodes.filter(node => {
      const matchesType = nodeFilter === 'all' || node.type === nodeFilter;
      const title = `${node.title || ''} ${typeLabel[node.type] || node.type} ${node.prompt || ''}`.toLowerCase();
      return matchesType && (!normalizedQuery || title.includes(normalizedQuery));
    });
    return sortNewestFirst ? [...filtered].reverse() : filtered;
  }, [nodes, nodeFilter, query, sortNewestFirst]);

  /**
   * 把可见节点按画布分组归类。
   * 分组数据来自画布上的 NodeGroup（同一份），侧边栏不另建概念。
   * 搜索/筛选后为空的分组不显示；没有任何分组时退化为原来的扁平列表。
   */
  const nodeSections = useMemo(() => {
    const byGroup = new Map<string, NodeData[]>();
    const ungrouped: NodeData[] = [];
    for (const node of visibleNodes) {
      if (node.groupId && groups.some(g => g.id === node.groupId)) {
        const list = byGroup.get(node.groupId) || [];
        list.push(node);
        byGroup.set(node.groupId, list);
      } else {
        ungrouped.push(node);
      }
    }
    const grouped = groups
      .map(group => ({ group, items: byGroup.get(group.id) || [] }))
      .filter(section => section.items.length > 0);
    return { grouped, ungrouped };
  }, [visibleNodes, groups]);

  const imageOrdinalById = useMemo(() => {
    const result = new Map<string, number>();
    let ordinal = 0;
    for (const node of nodes) {
      if ([NodeType.IMAGE, NodeType.IMAGE_EDITOR, NodeType.CAMERA_ANGLE].includes(node.type)) {
        ordinal += 1;
        result.set(node.id, ordinal);
      }
    }
    return result;
  }, [nodes]);

  const revealProjectLabel = desktopPlatform === 'darwin'
    ? '在 Finder 中显示'
    : desktopPlatform === 'win32'
      ? '在文件资源管理器中显示'
      : '打开文件位置';

  const handleRevealProject = async () => {
    if (!workflowId || revealingProject) return;
    setProjectMenuOpen(false);
    setRevealingProject(true);
    try {
      await onRevealProject();
    } finally {
      setRevealingProject(false);
    }
  };

  const toggleGroupCollapsed = (groupId: string) => {
    setCollapsedGroupIds(prev => {
      const next = new Set(prev);
      next.has(groupId) ? next.delete(groupId) : next.add(groupId);
      return next;
    });
  };

  const commitGroupRename = () => {
    if (editingGroupId) {
      const label = editingGroupLabel.trim();
      if (label) onRenameGroup(editingGroupId, label);
    }
    setEditingGroupId(null);
  };

  const visibleAssets = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return assets.filter(asset => `${asset.name || ''} ${asset.prompt || ''} ${asset.category || ''}`.toLowerCase().includes(normalizedQuery));
  }, [assets, query]);

  const surface = isDark ? 'bg-[#151515] border-[#343434] text-white' : 'bg-[#f7f7f7] border-neutral-300 text-neutral-900';
  const muted = isDark ? 'text-neutral-400' : 'text-neutral-500';
  const hover = isDark ? 'hover:bg-[#272727]' : 'hover:bg-neutral-200';

  if (collapsed) {
    return (
      <aside className={`fixed inset-y-0 left-0 z-30 flex w-16 flex-col items-center border-r ${surface}`}>
        <div className={`flex h-14 w-full shrink-0 items-center justify-center border-b ${
          isDark ? 'border-white/[0.07] bg-[#111214]' : 'border-neutral-200 bg-white'
        }`}>
          <button
            type="button"
            className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-all ${
              isDark
                ? 'border-white/10 bg-black/20 hover:border-white/15 hover:bg-white/[0.07]'
                : 'border-neutral-200 bg-white hover:bg-neutral-100'
            }`}
            onClick={() => setCollapsed(false)}
            title="展开侧边栏"
          >
            <img src="/TwitCanva-logo.png" alt="Evan" className="h-7 w-7 rounded-lg object-contain" />
          </button>
        </div>
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
    <aside className={`fixed inset-y-0 left-0 z-30 flex w-[260px] flex-col border-r shadow-2xl ${surface}`}>
      <div className={`flex h-14 shrink-0 items-center gap-2 border-b px-3 ${
        isDark ? 'border-white/[0.07] bg-[#111214]' : 'border-neutral-200 bg-white'
      }`}>
        <img
          src="/TwitCanva-logo.png"
          alt="Evan"
          title="Evan AI Video Canvas"
          className={`h-8 w-8 shrink-0 rounded-[10px] border object-contain shadow-sm ${
            isDark ? 'border-white/10 bg-black/20' : 'border-neutral-200 bg-white'
          }`}
        />
        <div className={`flex min-w-0 flex-1 items-center rounded-xl border p-1 ${
          isDark ? 'border-white/10 bg-black/25 shadow-inner' : 'border-neutral-200 bg-neutral-100'
        }`}>
          <TabButton active={activeTab === 'canvas'} dark={isDark} onClick={() => { setActiveTab('canvas'); setQuery(''); }}>
            <Grid2X2 size={13} />
            画布
          </TabButton>
          <TabButton active={activeTab === 'assets'} dark={isDark} onClick={() => { setActiveTab('assets'); setQuery(''); }}>
            <Boxes size={13} />
            资产
          </TabButton>
        </div>
        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setProjectMenuOpen(value => !value)}
            className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-all ${
              projectMenuOpen
                ? isDark ? 'border-white/15 bg-white/10 text-white' : 'border-neutral-300 bg-neutral-100 text-neutral-900'
                : isDark
                  ? 'border-white/10 bg-black/20 text-neutral-400 hover:border-white/15 hover:bg-white/[0.07] hover:text-white'
                  : 'border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900'
            }`}
            title="项目菜单"
            aria-label="项目菜单"
            aria-expanded={projectMenuOpen}
          >
            <BookOpen size={20} />
          </button>
          {projectMenuOpen && (
            <div className={`absolute right-0 top-12 z-50 w-[228px] overflow-hidden rounded-2xl border p-1.5 shadow-2xl ${
              isDark ? 'border-white/10 bg-[#202123]' : 'border-neutral-200 bg-white'
            }`}>
              <ProjectMenuButton dark={isDark} onClick={() => setProjectMenuOpen(false)}>回到画布</ProjectMenuButton>
              <ProjectMenuButton dark={isDark} onClick={(e) => { setProjectMenuOpen(false); onOpenWorkflows(e); }}>打开已有项目</ProjectMenuButton>
              <ProjectMenuButton dark={isDark} disabled={!workflowId || revealingProject} onClick={() => void handleRevealProject()}>
                <span className="flex items-center gap-2">
                  {revealingProject ? <Loader2 size={15} className="animate-spin" /> : <FolderOpen size={15} />}
                  {revealProjectLabel}
                </span>
              </ProjectMenuButton>
              <div className={`my-1.5 border-t ${isDark ? 'border-white/10' : 'border-neutral-200'}`} />
              <ProjectMenuButton dark={isDark} onClick={() => { setProjectMenuOpen(false); onCreateProject(); }}>创建新项目</ProjectMenuButton>
              <ProjectMenuButton dark={isDark} danger disabled={!workflowId} onClick={() => { setProjectMenuOpen(false); onDeleteProject(); }}>删除项目</ProjectMenuButton>
            </div>
          )}
        </div>
      </div>

      {activeTab === 'canvas' ? (
        <>
          <div className="flex shrink-0 items-center gap-0.5 px-2 py-4">
            {nodeSearchOpen ? (
              <div className="min-w-0 flex-1">
                <SearchBox value={query} onChange={setQuery} compact onCompactClose={() => { setNodeSearchOpen(false); setQuery(''); }} />
              </div>
            ) : (
              <>
                <span className={`min-w-0 flex-1 truncate whitespace-nowrap text-sm font-semibold ${muted}`}>画布元素</span>
                <button onClick={() => setSortNewestFirst(value => !value)} className={`shrink-0 rounded-lg p-1.5 ${muted} ${hover}`} title="切换排序"><LayoutList size={18} /></button>
                <select
                  value={nodeFilter}
                  onChange={event => setNodeFilter(event.target.value)}
                  className={`h-8 w-[50px] shrink-0 appearance-none truncate rounded-lg bg-transparent px-1 text-center text-[13px] outline-none ${muted} ${hover}`}
                  title={`节点类型：${nodeFilter === 'all' ? '全部' : (typeLabel[nodeFilter] || nodeFilter)}`}
                  aria-label="筛选节点类型"
                >
                  <option value="all">全部</option>
                  {[...new Set(nodes.map(node => node.type))].map(type => <option key={type} value={type}>{typeLabel[type] || type}</option>)}
                </select>
                <button onClick={() => setNodeSearchOpen(true)} className={`shrink-0 rounded-lg p-1.5 ${muted} ${hover}`} title="搜索节点"><Search size={20} /></button>
              </>
            )}
            <button
              onClick={onCreateGroup}
              disabled={selectedNodeIds.length < 2}
              className={`shrink-0 rounded-lg p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${hover}`}
              title={selectedNodeIds.length < 2 ? '新建分组：先在画布上选中 2 个及以上节点' : `把选中的 ${selectedNodeIds.length} 个节点组成新分组`}
            ><FolderPlus size={19} /></button>
            <button onClick={onAddNode} className={`shrink-0 rounded-lg p-1.5 ${hover}`} title="新建节点"><CirclePlus size={19} /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 sidebar-scrollbar">
            {visibleNodes.length === 0 ? (
              <EmptyState label={nodes.length === 0 ? '画布暂无节点' : '没有匹配的节点'} />
            ) : (
              <>
                {nodeSections.grouped.map(({ group, items }) => {
                  const isCollapsed = collapsedGroupIds.has(group.id);
                  const allSelected = items.every(node => selectedNodeIds.includes(node.id));
                  return (
                    <div key={group.id} className="mb-2">
                      <div className={`group/gh flex items-center gap-1 rounded-xl px-2 py-1.5 ${allSelected ? 'bg-[#292929]' : hover}`}>
                        <button
                          onClick={() => toggleGroupCollapsed(group.id)}
                          className={`rounded-md p-0.5 ${muted}`}
                          title={isCollapsed ? '展开分组' : '收起分组'}
                        >
                          {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                        </button>
                        <Folder size={15} className={muted} />
                        {editingGroupId === group.id ? (
                          <input
                            autoFocus
                            value={editingGroupLabel}
                            onChange={event => setEditingGroupLabel(event.target.value)}
                            onBlur={commitGroupRename}
                            onKeyDown={event => {
                              if (event.key === 'Enter') commitGroupRename();
                              if (event.key === 'Escape') setEditingGroupId(null);
                            }}
                            className="min-w-0 flex-1 rounded bg-[#1f1f1f] px-1.5 py-0.5 text-sm text-white outline-none ring-1 ring-neutral-600"
                          />
                        ) : (
                          <button
                            onClick={() => onSelectNodes(items.map(node => node.id))}
                            onDoubleClick={() => { setEditingGroupId(group.id); setEditingGroupLabel(group.label); }}
                            className="min-w-0 flex-1 truncate text-left text-sm font-medium"
                            title="点击选中该组全部节点，双击重命名"
                          >
                            {group.label}
                          </button>
                        )}
                        <span className={`shrink-0 text-xs ${muted}`}>{items.length}</span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={() => { setEditingGroupId(group.id); setEditingGroupLabel(group.label); }}
                          className={`rounded-md p-1 ${muted} opacity-0 transition-opacity group-hover/gh:opacity-100 ${hover}`}
                          title="重命名分组"
                        ><Pencil size={13} /></span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={() => onUngroup(group.id)}
                          className={`rounded-md p-1 ${muted} opacity-0 transition-opacity group-hover/gh:opacity-100 ${hover}`}
                          title="解散分组（不会删除节点）"
                        ><FolderMinus size={13} /></span>
                      </div>
                      {!isCollapsed && (
                        <div className="mt-1 pl-3">
                          {items.map(node => (
                            <NodeRow
                              key={node.id}
                              node={node}
                              selected={selectedNodeIds.includes(node.id)}
                              hover={hover}
                              muted={muted}
                              onSelect={onSelectNode}
                              onLocate={onLocateNode}
                              onRename={onRenameNode}
                              imageOrdinal={imageOrdinalById.get(node.id)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {nodeSections.ungrouped.length > 0 && (
                  <>
                    {nodeSections.grouped.length > 0 && (
                      <div className={`mb-1 mt-2 px-2 text-xs font-medium ${muted}`}>未分组</div>
                    )}
                    {nodeSections.ungrouped.map(node => (
                      <NodeRow
                        key={node.id}
                        node={node}
                        selected={selectedNodeIds.includes(node.id)}
                        hover={hover}
                        muted={muted}
                        onSelect={onSelectNode}
                        onLocate={onLocateNode}
                        onRename={onRenameNode}
                        imageOrdinal={imageOrdinalById.get(node.id)}
                      />
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="shrink-0 p-3">
            <div className="grid grid-cols-2 rounded-xl border border-[#333] bg-[#202020] p-1">
              <button onClick={() => setAssetScope('personal')} className={`rounded-lg py-2 text-sm ${assetScope === 'personal' ? 'bg-[#343434] text-white' : muted}`}>个人</button>
              <button onClick={() => setAssetScope('agent')} className={`rounded-lg py-2 text-sm ${assetScope === 'agent' ? 'bg-[#343434] text-white' : muted}`}>智能体</button>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <SearchBox value={query} onChange={setQuery} placeholder="请输入搜索内容" />
              <button className={`rounded-lg p-2 ${muted} ${hover}`} title="筛选"><Filter size={20} /></button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 sidebar-scrollbar">
            {assetDeleteError && (
              <div className="mx-2 mb-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {assetDeleteError}
              </div>
            )}
            {assetsLoading ? <EmptyState label="正在加载资产" /> : visibleAssets.length === 0 ? <EmptyState label="暂无资产" /> : visibleAssets.map(asset => {
              const dragType = asset.type;
              const draggable = Boolean(asset.url);
              const canDeleteLocalImage = assetScope === 'personal' && asset.type === 'image';
              const usedByCanvas = nodes.some(node => [node.resultUrl, node.mediaUrl, node.lastFrame].some(url => url === asset.url || url?.endsWith(asset.url)));
              return (
                <div
                  key={`${asset.type}-${asset.id}`}
                  role="button"
                  tabIndex={0}
                  className={`group relative mb-1 flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left ${hover} ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
                  onClick={event => {
                    if (editingAsset?.key === `${asset.type}:${asset.id}` || asset.type === 'audio') return;
                    if (assetPreviewTimerRef.current) clearTimeout(assetPreviewTimerRef.current);
                    const target = event.currentTarget;
                    const previewAsset: SidebarAssetPreview = {
                      name: asset.name,
                      url: asset.url,
                      type: asset.type,
                    };
                    assetPreviewTimerRef.current = setTimeout(
                      () => onPreviewAsset(previewAsset, target),
                      180
                    );
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      if (asset.type !== 'audio') onPreviewAsset(
                          { name: asset.name, url: asset.url, type: asset.type },
                          event.currentTarget
                        );
                    }
                  }}
                  draggable={draggable}
                  onDragStart={draggable ? (event) => {
                    event.dataTransfer.effectAllowed = 'copy';
                    event.dataTransfer.setData('application/x-twitcanva-asset', JSON.stringify({
                      url: asset.url,
                      type: dragType,
                      name: asset.name,
                      prompt: asset.prompt,
                      category: asset.category,
                      characterId: asset.characterId,
                      characterName: asset.characterName,
                      characterAssetRole: asset.characterAssetRole,
                      lookId: asset.lookId,
                      lookName: asset.lookName,
                    }));
                    const thumb = (event.currentTarget as HTMLElement).querySelector('img');
                    if (thumb) event.dataTransfer.setDragImage(thumb, 24, 24);
                  } : undefined}
                  title={draggable ? '拖到画布添加节点，或点击预览' : undefined}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-neutral-700 bg-neutral-800">
                    {asset.type === 'image'
                      ? <img src={asset.url} alt="" className="h-full w-full object-cover" draggable={false} />
                      : asset.type === 'audio' ? <Volume2 size={20} className={muted} /> : <Film size={20} className={muted} />}
                  </div>
                  {editingAsset?.key === `${asset.type}:${asset.id}` ? (
                    <input
                      ref={assetNameInputRef}
                      value={editingAsset.value}
                      onChange={event => setEditingAsset(current => current ? { ...current, value: event.target.value } : current)}
                      onClick={event => event.stopPropagation()}
                      onDoubleClick={event => event.stopPropagation()}
                      onBlur={() => void commitAssetRename()}
                      onKeyDown={event => {
                        event.stopPropagation();
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          event.currentTarget.blur();
                        } else if (event.key === 'Escape') {
                          event.preventDefault();
                          cancelAssetRenameRef.current = true;
                          setEditingAsset(null);
                        }
                      }}
                      aria-label="图片显示名称"
                      className="min-w-0 flex-1 rounded-md border border-neutral-500 bg-black/10 px-1.5 py-1 text-[13px] text-inherit outline-none focus:border-neutral-300"
                    />
                  ) : (
                    <span
                      className={`min-w-0 flex-1 line-clamp-2 break-words text-[13px] leading-[17px] ${assetScope === 'personal' && asset.type === 'image' && asset.filename ? 'cursor-text' : ''}`}
                      onDoubleClick={event => startAssetRename(asset, event)}
                      title={assetScope === 'personal' && asset.type === 'image' && asset.filename ? `${asset.name}（双击重命名）` : asset.name}
                    >
                      {asset.name}
                    </span>
                  )}
                  {canDeleteLocalImage ? (
                    <div className="relative shrink-0" data-asset-menu>
                      <button
                        type="button"
                        aria-label={`素材操作：${asset.name}`}
                        className={`rounded-lg p-1.5 ${muted} ${hover}`}
                        onClick={event => {
                          event.stopPropagation();
                          setAssetDeleteError(null);
                          setDeleteConfirmAssetId(null);
                          const rect = event.currentTarget.getBoundingClientRect();
                          setAssetMenuPosition({
                            top: Math.min(window.innerHeight - 76, rect.bottom + 4),
                            left: Math.max(12, rect.right - 210),
                          });
                          setAssetMenuId(current => current === asset.id ? null : asset.id);
                        }}
                      >
                        <MoreHorizontal size={18} />
                      </button>
                      {assetMenuId === asset.id && (
                        <div
                          className="fixed z-50 w-[210px] rounded-2xl border border-[#414141] bg-[#252525] p-2 shadow-2xl"
                          style={{
                            top: deleteConfirmAssetId === asset.id
                              ? Math.min(window.innerHeight - 174, assetMenuPosition.top)
                              : assetMenuPosition.top,
                            left: assetMenuPosition.left,
                          }}
                          data-asset-menu
                        >
                          {deleteConfirmAssetId === asset.id ? (
                            <div className="p-2">
                              <p className="text-sm font-medium text-white">确认删除本地图片？</p>
                              <p className="mt-1 text-xs leading-5 text-neutral-400">
                                图片文件和元数据会永久删除{usedByCanvas ? '，画布中的引用将失效' : ''}。
                              </p>
                              <div className="mt-3 flex justify-end gap-2">
                                <button
                                  type="button"
                                  className="rounded-lg px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700"
                                  onClick={event => { event.stopPropagation(); setDeleteConfirmAssetId(null); }}
                                >取消</button>
                                <button
                                  type="button"
                                  disabled={deletingAssetId === asset.id}
                                  className="flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-400 disabled:opacity-60"
                                  onClick={event => { event.stopPropagation(); handleDeleteLocalImage(asset); }}
                                >
                                  {deletingAssetId === asset.id && <Loader2 size={13} className="animate-spin" />}
                                  删除
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-red-300 hover:bg-red-500/10"
                              onClick={event => { event.stopPropagation(); setDeleteConfirmAssetId(asset.id); }}
                            >
                              <Trash2 size={16} />
                              删除本地图片
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ) : <MoreHorizontal size={18} className={muted} />}
                </div>
              );
            })}
          </div>
        </>
      )}

      <footer className="flex h-[60px] shrink-0 items-center border-t border-inherit px-3">
        <button onClick={() => setCollapsed(true)} className={`rounded-lg p-2 ${hover}`} title="收起侧边栏"><ArrowLeftToLine size={20} /></button>
        <span className={`ml-auto text-sm ${muted}`}>共 {nodes.length} 节点</span>
        <div className="ml-4 flex gap-1">
          <SidebarIcon title="工作流" onClick={onOpenWorkflows}><Grid2X2 size={19} /></SidebarIcon>
        </div>
      </footer>
    </aside>
  );
};

/** 侧边栏里的单个节点行（分组内与未分组共用，行为与原扁平列表一致） */
const NodeRow = ({
  node, selected, hover, muted, onSelect, onLocate, onRename, imageOrdinal,
}: {
  node: NodeData;
  selected: boolean;
  hover: string;
  muted: string;
  onSelect: (id: string) => void;
  onLocate: (id: string) => void;
  onRename: (id: string, displayName: string, syncAsset?: boolean) => void;
  imageOrdinal?: number;
}) => {
  const thumb = nodeThumbnail(node);
  const isImage = [NodeType.IMAGE, NodeType.IMAGE_EDITOR, NodeType.CAMERA_ANGLE].includes(node.type);
  const resolvedName = isImage
    ? resolveImageNodeDisplayName(node, imageOrdinal)
    : node.title || node.prompt || typeLabel[node.type] || node.type;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const selectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  useEffect(() => () => {
    if (selectTimerRef.current) clearTimeout(selectTimerRef.current);
  }, []);

  const startRename = (event: React.MouseEvent) => {
    if (!isImage) return;
    event.preventDefault();
    event.stopPropagation();
    if (selectTimerRef.current) clearTimeout(selectTimerRef.current);
    setDraft(resolvedName);
    setEditing(true);
  };

  const commitRename = () => {
    const nextName = draft.trim();
    if (nextName && nextName !== resolvedName) onRename(node.id, nextName);
    setEditing(false);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        if (editing) return;
        if (selectTimerRef.current) clearTimeout(selectTimerRef.current);
        // Wait briefly so an image-name double-click can enter rename mode
        // without also recentering/opening the canvas node.
        selectTimerRef.current = setTimeout(() => onSelect(node.id), 180);
      }}
      onKeyDown={event => {
        if (!editing && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onSelect(node.id);
        }
      }}
      className={`group mb-1 flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left transition-colors ${selected ? 'bg-[#292929]' : hover}`}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-neutral-700 bg-neutral-800">
        {thumb && node.type !== NodeType.VIDEO
          ? <img src={thumb} alt="" className="h-full w-full object-cover" />
          : node.type === NodeType.VIDEO ? <Film size={20} className={muted} />
            : node.type === NodeType.IMAGE ? <ImageIcon size={20} className={muted} />
              : <Sparkles size={20} className={muted} />}
      </div>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onClick={event => event.stopPropagation()}
          onDoubleClick={event => event.stopPropagation()}
          onBlur={commitRename}
          onKeyDown={event => {
            event.stopPropagation();
            if (event.key === 'Enter') {
              event.preventDefault();
              commitRename();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setEditing(false);
            }
          }}
          className="min-w-0 flex-1 rounded-md border border-neutral-500 bg-black/10 px-1.5 py-1 text-[13px] text-inherit outline-none focus:border-neutral-300"
          aria-label="图片显示名称"
        />
      ) : (
        <span
          className={`min-w-0 flex-1 line-clamp-2 break-words text-[13px] leading-[17px] ${isImage ? 'cursor-text' : ''}`}
          onDoubleClick={startRename}
          title={isImage ? `${resolvedName}（双击重命名）` : resolvedName}
        >
          {resolvedName}
        </span>
      )}
      <MoreHorizontal size={18} className={`${muted} opacity-0 transition-opacity group-hover:opacity-100`} />
      <span
        role="button"
        tabIndex={0}
        onClick={event => { event.stopPropagation(); onLocate(node.id); }}
        className={`rounded-lg p-1.5 ${muted} opacity-0 transition-opacity group-hover:opacity-100 ${hover}`}
        title="定位节点"
      ><LocateFixed size={18} /></span>
    </div>
  );
};

const TabButton = ({ active, dark, children, onClick }: { active: boolean; dark: boolean; children: React.ReactNode; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-all ${
      active
        ? dark ? 'bg-white/12 text-white shadow-sm' : 'bg-white text-neutral-900 shadow-sm'
        : dark ? 'text-neutral-500 hover:bg-white/5 hover:text-neutral-200' : 'text-neutral-500 hover:bg-white/70 hover:text-neutral-900'
    }`}
  >
    {children}
  </button>
);

const SidebarIcon = ({ title, children, onClick }: { title: string; children: React.ReactNode; onClick: (e: React.MouseEvent) => void }) => (
  <button onClick={onClick} className="rounded-lg p-2 text-neutral-300 transition-colors hover:bg-[#2b2b2b] hover:text-white" title={title}>{children}</button>
);

const ProjectMenuButton = ({ children, onClick, dark, danger = false, disabled = false }: { children: React.ReactNode; onClick: (e: React.MouseEvent) => void; dark: boolean; danger?: boolean; disabled?: boolean }) => (
  <button disabled={disabled} onClick={onClick} className={`w-full rounded-xl px-4 py-3 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
    danger
      ? dark ? 'text-red-300 hover:bg-red-500/10' : 'text-red-600 hover:bg-red-50'
      : dark ? 'text-white hover:bg-white/[0.07]' : 'text-neutral-700 hover:bg-neutral-100'
  }`}>{children}</button>
);

const SearchBox = ({ value, onChange, placeholder = '搜索', compact = false, onCompactClose }: { value: string; onChange: (value: string) => void; placeholder?: string; compact?: boolean; onCompactClose?: () => void }) => (
  <label className={`flex items-center rounded-xl border border-[#393939] bg-[#252525] transition-all focus-within:border-neutral-500 ${compact ? 'h-9 w-[118px] px-2' : 'h-11 flex-1 px-3'}`}>
    <input autoFocus={compact} value={value} onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') onCompactClose?.(); }} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-neutral-500" />
    <Search size={compact ? 17 : 19} className="shrink-0 text-neutral-400" />
  </label>
);

const EmptyState = ({ label }: { label: string }) => (
  <div className="flex h-60 flex-col items-center justify-center text-neutral-500">
    <FolderOpen size={56} strokeWidth={1.2} />
    <span className="mt-4 text-sm text-neutral-300">{label}</span>
  </div>
);
