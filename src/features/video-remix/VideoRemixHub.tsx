import React from 'react';
import {
  Check,
  Film,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Video,
} from 'lucide-react';

import {
  VIDEO_REMIX_STAGE_LABELS,
  createVideoRemixState,
  summarizeVideoRemixState,
} from '../../../shared/videoRemix.js';
import {
  videoRemixProjectAsNode,
  type VideoRemixProject,
} from '../../../shared/videoRemixProjects.js';
import { NodeData } from '../../types';
import { VideoRemixWorkspace } from './VideoRemixWorkspace';

type FinalOutput = {
  nodeId: string;
  url: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  aspectRatio: string;
};

export const VideoRemixHub: React.FC<{
  projects: VideoRemixProject[];
  activeProjectId: string | null;
  workflowId?: string;
  projectTitle: string;
  canvasTheme?: 'dark' | 'light';
  onSelectProject: (id: string) => void;
  onCreateProject: () => void;
  onCreateWorkflow: () => void;
  onOpenWorkflows: (event: React.MouseEvent) => void;
  onRenameProject: (id: string, title: string) => void;
  onDeleteProject: (id: string) => void;
  onUpdateProject: (id: string, updates: Partial<NodeData>) => void;
  onFinalOutput: (id: string, output: FinalOutput) => void;
  onSendFinalToCanvas: (id: string, output: FinalOutput) => void;
}> = ({
  projects,
  activeProjectId,
  workflowId,
  projectTitle,
  canvasTheme = 'dark',
  onSelectProject,
  onCreateProject,
  onCreateWorkflow,
  onOpenWorkflows,
  onRenameProject,
  onDeleteProject,
  onUpdateProject,
  onFinalOutput,
  onSendFinalToCanvas,
}) => {
  const dark = canvasTheme === 'dark';
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renamingValue, setRenamingValue] = React.useState('');
  const activeProject = projects.find(project => project.id === activeProjectId)
    || projects[0]
    || null;

  React.useEffect(() => {
    if (!activeProject || activeProject.id === activeProjectId) return;
    onSelectProject(activeProject.id);
  }, [activeProject, activeProjectId, onSelectProject]);

  const commitRename = () => {
    const value = renamingValue.trim();
    if (renamingId && value) onRenameProject(renamingId, value);
    setRenamingId(null);
  };

  return (
    <div className={`flex h-full min-h-0 w-full ${dark ? 'bg-[#090a0b] text-white' : 'bg-[#f4f4f5] text-neutral-900'}`}>
      <aside className={`flex w-[260px] shrink-0 flex-col border-r ${dark ? 'border-white/8 bg-[#121315]' : 'border-neutral-200 bg-white'}`}>
        <div className={`border-b px-4 pb-4 pt-4 ${dark ? 'border-white/8' : 'border-neutral-200'}`}>
          <div className="flex items-center gap-3 px-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400/25 to-blue-500/20 text-cyan-300">
              <Film size={20} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold">短视频复刻</div>
              <div className={`truncate text-[10px] ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                {workflowId ? projectTitle : '尚未打开项目'}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={workflowId ? onCreateProject : onCreateWorkflow}
            className={`mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl text-xs font-medium ${
              dark ? 'bg-cyan-400 text-neutral-950 hover:bg-cyan-300' : 'bg-cyan-600 text-white hover:bg-cyan-500'
            }`}
          >
            <Plus size={15} />
            {workflowId ? '新建复刻任务' : '先创建项目'}
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className={`px-5 pb-2 pt-4 text-[10px] font-medium uppercase tracking-[0.16em] ${dark ? 'text-neutral-600' : 'text-neutral-400'}`}>
            复刻任务 {projects.length > 0 ? projects.length : ''}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            {projects.length === 0 ? (
              <div className={`mx-2 mt-3 rounded-2xl border border-dashed px-4 py-8 text-center ${dark ? 'border-white/10 text-neutral-600' : 'border-neutral-300 text-neutral-400'}`}>
                <Video size={23} className="mx-auto" />
                <div className="mt-3 text-xs">还没有复刻任务</div>
              </div>
            ) : projects.map(project => (
              <RemixProjectRow
                key={project.id}
                project={project}
                active={project.id === activeProject?.id}
                dark={dark}
                renaming={renamingId === project.id}
                renamingValue={renamingValue}
                onRenamingValue={setRenamingValue}
                onCommitRename={commitRename}
                onCancelRename={() => setRenamingId(null)}
                onSelect={() => onSelectProject(project.id)}
                onStartRename={() => {
                  setRenamingId(project.id);
                  setRenamingValue(project.title);
                }}
                onDelete={() => onDeleteProject(project.id)}
              />
            ))}
          </div>
        </div>

        <div className={`border-t p-3 ${dark ? 'border-white/8' : 'border-neutral-200'}`}>
          <button
            type="button"
            onClick={onOpenWorkflows}
            className={`flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-xs ${dark ? 'text-neutral-400 hover:bg-white/5 hover:text-white' : 'text-neutral-500 hover:bg-neutral-100'}`}
          >
            <FolderOpen size={15} />
            全部项目
          </button>
        </div>
      </aside>

      <section className="min-w-0 flex-1" aria-label="当前短视频复刻任务">
        {!workflowId ? (
          <HubEmptyState
            dark={dark}
            title="先创建或打开一个项目"
            description="AI 画布和短视频复刻共用同一个项目、素材库和自动保存。"
            action="创建项目"
            onAction={onCreateWorkflow}
          />
        ) : !activeProject ? (
          <HubEmptyState
            dark={dark}
            title="创建你的第一个短视频复刻"
            description="导入参考视频后，AI 会自动拆镜、分析人物与场景，并带你用三步完成复刻。"
            action="新建复刻任务"
            onAction={onCreateProject}
          />
        ) : (
          <VideoRemixWorkspace
            key={activeProject.id}
            node={videoRemixProjectAsNode(activeProject)}
            workflowId={workflowId}
            canvasTheme={canvasTheme}
            onUpdateNode={onUpdateProject}
            onFinalOutput={output => onFinalOutput(activeProject.id, output)}
            onSendFinalToCanvas={output => onSendFinalToCanvas(activeProject.id, output)}
            embedded
          />
        )}
      </section>
    </div>
  );
};

const RemixProjectRow: React.FC<{
  project: VideoRemixProject;
  active: boolean;
  dark: boolean;
  renaming: boolean;
  renamingValue: string;
  onRenamingValue: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onSelect: () => void;
  onStartRename: () => void;
  onDelete: () => void;
}> = ({
  project,
  active,
  dark,
  renaming,
  renamingValue,
  onRenamingValue,
  onCommitRename,
  onCancelRename,
  onSelect,
  onStartRename,
  onDelete,
}) => {
  const state = createVideoRemixState(project.state);
  const summary = summarizeVideoRemixState(state);
  const previewUrl = state.source?.previewUrl || state.source?.localUrl;
  const busy = ['preprocessing', 'analyzing', 'keyframes_generating', 'videos_generating', 'rendering'].includes(state.stage);
  return (
    <div
      className={`group mb-1 flex items-center gap-3 rounded-2xl p-2.5 transition-colors ${
        active
          ? dark ? 'bg-white/10' : 'bg-neutral-100'
          : dark ? 'hover:bg-white/5' : 'hover:bg-neutral-50'
      }`}
    >
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className={`relative flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl ${dark ? 'bg-black/45' : 'bg-neutral-200'}`}>
          {previewUrl
            ? <video src={previewUrl} muted preload="metadata" className="h-full w-full object-cover" />
            : <Film size={18} className={dark ? 'text-neutral-700' : 'text-neutral-400'} />}
          {state.stage === 'completed' && (
            <span className="absolute right-1 top-1 rounded-full bg-emerald-500 p-0.5 text-white"><Check size={9} /></span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              autoFocus
              value={renamingValue}
              onChange={event => onRenamingValue(event.target.value)}
              onClick={event => event.stopPropagation()}
              onBlur={onCommitRename}
              onKeyDown={event => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') onCancelRename();
              }}
              className={`w-full rounded-md border bg-transparent px-1.5 py-1 text-xs outline-none ${dark ? 'border-neutral-600 text-white' : 'border-neutral-300 text-neutral-900'}`}
            />
          ) : (
            <div className="truncate text-xs font-medium">{project.title}</div>
          )}
          <div className={`mt-1 flex items-center gap-1.5 text-[9px] ${dark ? 'text-neutral-600' : 'text-neutral-400'}`}>
            {busy && <Loader2 size={9} className="animate-spin text-cyan-400" />}
            <span className="truncate">{VIDEO_REMIX_STAGE_LABELS[state.stage] || state.stage}</span>
            {summary.shots > 0 && <span>· {summary.shots} 镜头</span>}
          </div>
        </div>
      </button>
      {!renaming && (
        <div className="flex shrink-0 flex-col opacity-0 transition-opacity group-hover:opacity-100">
          <button type="button" onClick={onStartRename} className={`rounded-md p-1 ${dark ? 'text-neutral-500 hover:bg-white/8 hover:text-white' : 'text-neutral-400 hover:bg-neutral-200'}`} aria-label="重命名复刻任务">
            <Pencil size={12} />
          </button>
          <button type="button" onClick={onDelete} className={`rounded-md p-1 ${dark ? 'text-neutral-600 hover:bg-red-500/10 hover:text-red-300' : 'text-neutral-400 hover:bg-red-50 hover:text-red-600'}`} aria-label="删除复刻任务">
            <Trash2 size={12} />
          </button>
        </div>
      )}
    </div>
  );
};

const HubEmptyState: React.FC<{
  dark: boolean;
  title: string;
  description: string;
  action: string;
  onAction: () => void;
}> = ({ dark, title, description, action, onAction }) => (
  <div className="flex h-full items-center justify-center px-8">
    <div className={`w-full max-w-xl rounded-[32px] border border-dashed p-12 text-center ${dark ? 'border-white/12 bg-white/[0.025]' : 'border-neutral-300 bg-white'}`}>
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-400">
        <Film size={26} />
      </div>
      <h1 className="mt-6 text-2xl font-semibold">{title}</h1>
      <p className={`mx-auto mt-3 max-w-md text-sm leading-6 ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>{description}</p>
      <button type="button" onClick={onAction} className={`mt-7 rounded-xl px-6 py-3 text-sm font-medium ${dark ? 'bg-white text-neutral-950' : 'bg-neutral-900 text-white'}`}>
        {action}
      </button>
    </div>
  </div>
);
