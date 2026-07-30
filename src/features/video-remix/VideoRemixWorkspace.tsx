import React from 'react';
import {
  AlertCircle,
  Boxes,
  Check,
  ChevronRight,
  CloudDownload,
  FileVideo,
  Film,
  Images,
  LayoutDashboard,
  Link2,
  Loader2,
  Lock,
  Package,
  Play,
  ScanSearch,
  Sparkles,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  VIDEO_REMIX_WORKSPACE_TABS,
  createVideoRemixState,
  replaceVideoRemixSource,
  setVideoRemixSourceError,
  summarizeVideoRemixState,
  workspaceTabForStage,
  type VideoRemixWorkspaceTab,
} from '../../../shared/videoRemix.js';
import { NodeData } from '../../types';
import {
  importLocalReferenceVideo,
  resolveUrlReferenceVideo,
} from './videoRemixService';

interface VideoRemixWorkspaceProps {
  node: NodeData;
  workflowId?: string;
  canvasTheme?: 'dark' | 'light';
  onUpdateNode: (nodeId: string, updates: Partial<NodeData>) => void;
  onClose: () => void;
}

const TAB_ICONS: Record<VideoRemixWorkspaceTab, React.ReactNode> = {
  source: <Play size={17} />,
  analysis: <ScanSearch size={17} />,
  assets: <Boxes size={17} />,
  shots: <LayoutDashboard size={17} />,
  keyframes: <Images size={17} />,
  videos: <Film size={17} />,
  final: <Sparkles size={17} />,
};

export const VideoRemixWorkspace: React.FC<VideoRemixWorkspaceProps> = ({
  node,
  workflowId,
  canvasTheme = 'dark',
  onUpdateNode,
  onClose,
}) => {
  const state = node.videoRemix || createVideoRemixState({ remixId: node.id });
  const [activeTab, setActiveTab] = React.useState<VideoRemixWorkspaceTab>(
    workspaceTabForStage(state.stage)
  );
  const summary = summarizeVideoRemixState(state);
  const isDark = canvasTheme === 'dark';

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className={`fixed inset-0 z-[300] flex ${isDark ? 'bg-[#090a0b] text-white' : 'bg-[#f4f4f5] text-neutral-900'}`}
      role="dialog"
      aria-modal="true"
      aria-label="Video Remix 工作台"
    >
      <aside className={`flex w-[232px] shrink-0 flex-col border-r px-3 py-4 ${
        isDark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
      }`}>
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400/25 to-blue-500/20 text-cyan-300">
            <Film size={19} />
          </div>
          <div>
            <div className="text-sm font-semibold">Video Remix</div>
            <div className={`text-[10px] ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>高复刻工作台</div>
          </div>
        </div>

        <nav className="mt-5 flex flex-col gap-1">
          {VIDEO_REMIX_WORKSPACE_TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex h-10 items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors ${
                activeTab === tab.id
                  ? isDark ? 'bg-white/10 text-white' : 'bg-neutral-900 text-white'
                  : isDark ? 'text-neutral-400 hover:bg-white/5 hover:text-white' : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900'
              }`}
            >
              {TAB_ICONS[tab.id]}
              <span className="flex-1">{tab.label}</span>
              {activeTab === tab.id && <ChevronRight size={14} />}
            </button>
          ))}
        </nav>

        <div className={`mt-auto rounded-2xl border p-3 ${
          isDark ? 'border-white/8 bg-white/[0.035]' : 'border-neutral-200 bg-neutral-50'
        }`}>
          <div className="flex items-center gap-2 text-xs font-medium">
            <Lock size={13} className="text-cyan-400" />
            高复刻锁定
          </div>
          <div className={`mt-2 text-[10px] leading-5 ${isDark ? 'text-neutral-500' : 'text-neutral-500'}`}>
            剧情、动作、构图、运镜与时长默认锁定。人物、场景、道具和风格可替换。
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden">
        <header className={`flex h-16 items-center justify-between border-b px-7 ${
          isDark ? 'border-white/8 bg-[#111214]/90' : 'border-neutral-200 bg-white/90'
        }`}>
          <div>
            <div className="text-sm font-semibold">{node.title || 'Video Remix'}</div>
            <div className={`mt-0.5 text-[11px] ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>
              所有中间状态随当前项目保存，可关闭后继续
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`rounded-full px-3 py-1 text-[11px] ${
              isDark ? 'bg-cyan-400/10 text-cyan-300' : 'bg-cyan-50 text-cyan-700'
            }`}>
              阶段式自动化
            </span>
            <button
              type="button"
              aria-label="关闭 Video Remix 工作台"
              onClick={onClose}
              className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                isDark ? 'bg-white/6 text-neutral-300 hover:bg-white/10' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              }`}
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="h-[calc(100vh-64px)] overflow-y-auto px-8 py-7">
          <div className="mx-auto max-w-[1180px]">
            <WorkspaceContent
              activeTab={activeTab}
              state={state}
              summary={summary}
              dark={isDark}
              node={node}
              workflowId={workflowId}
              onUpdateNode={onUpdateNode}
            />
          </div>
        </div>
      </main>
    </div>
  );
};

const WorkspaceContent: React.FC<{
  activeTab: VideoRemixWorkspaceTab;
  state: ReturnType<typeof createVideoRemixState>;
  summary: ReturnType<typeof summarizeVideoRemixState>;
  dark: boolean;
  node: NodeData;
  workflowId?: string;
  onUpdateNode: (nodeId: string, updates: Partial<NodeData>) => void;
}> = ({ activeTab, state, summary, dark, node, workflowId, onUpdateNode }) => {
  const title = VIDEO_REMIX_WORKSPACE_TABS.find(tab => tab.id === activeTab)?.label || 'Video Remix';
  const descriptions: Record<VideoRemixWorkspaceTab, string> = {
    source: '导入本地视频、画布视频或分享链接，并保留不可修改的原始文件。',
    analysis: '查看全片故事理解、人物关系、场景、道具和结构化分析结果。',
    assets: '统一管理人物身份与造型、场景功能区和交互道具。',
    shots: '逐镜查看并编辑动作、构图、运镜、时间和声音蓝图。',
    keyframes: '按镜头复杂度生成关键帧，确认后才允许进入视频生成。',
    videos: '批量生成镜头视频，并支持单镜头重试与时长校准。',
    final: '按原片顺序拼接镜头，配置 BGM、字幕并交给 Remotion 输出。',
  };

  return (
    <>
      <div className="flex items-end justify-between gap-6">
        <div>
          <div className={`text-xs font-medium uppercase tracking-[0.18em] ${dark ? 'text-cyan-300' : 'text-cyan-700'}`}>
            Video Remix Workspace
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
          <p className={`mt-2 max-w-2xl text-sm leading-6 ${dark ? 'text-neutral-400' : 'text-neutral-500'}`}>
            {descriptions[activeTab]}
          </p>
        </div>
        <div className={`rounded-full px-3 py-1.5 text-xs ${dark ? 'bg-white/6 text-neutral-300' : 'bg-white text-neutral-600'}`}>
          当前阶段：{state.stage}
        </div>
      </div>

      {activeTab === 'source' ? (
        <SourceWorkspace
          node={node}
          state={state}
          summary={summary}
          workflowId={workflowId}
          onUpdateNode={onUpdateNode}
          dark={dark}
        />
      ) : (
        <div className={`mt-7 rounded-[26px] border p-7 ${
          dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
        }`}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard icon={<Film size={18} />} label="镜头" value={summary.shots} dark={dark} />
            <SummaryCard icon={<Users size={18} />} label="人物" value={summary.characters} dark={dark} />
            <SummaryCard icon={<Images size={18} />} label="场景" value={summary.scenes} dark={dark} />
            <SummaryCard icon={<Package size={18} />} label="道具" value={summary.props} dark={dark} />
          </div>
          <div className={`mt-6 flex min-h-[270px] items-center justify-center rounded-[20px] border border-dashed ${
            dark ? 'border-white/10 bg-black/20 text-neutral-500' : 'border-neutral-200 bg-neutral-50 text-neutral-400'
          }`}>
            <div className="text-center">
              <Check size={24} className="mx-auto mb-3 text-cyan-400" />
              <div className="text-sm">工作台结构已就绪</div>
              <div className="mt-1 text-xs">对应阶段的数据与操作将在后续 Phase 接入。</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const SUPPORTED_VIDEO_FILE_RE = /\.(?:mp4|mov|webm)$/i;

const formatDuration = (seconds: number) => {
  const total = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(total / 60);
  const remainder = total - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`;
};

const SourceWorkspace: React.FC<{
  node: NodeData;
  state: ReturnType<typeof createVideoRemixState>;
  summary: ReturnType<typeof summarizeVideoRemixState>;
  workflowId?: string;
  onUpdateNode: (nodeId: string, updates: Partial<NodeData>) => void;
  dark: boolean;
}> = ({ node, state, summary, workflowId, onUpdateNode, dark }) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [urlInput, setUrlInput] = React.useState('');
  const [busy, setBusy] = React.useState<'local' | 'url' | null>(null);
  const [localError, setLocalError] = React.useState('');
  const sourceError = busy
    ? ''
    : localError || state.errors.find(item => item.scope === 'source')?.message || '';

  const storeFailure = React.useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : '参考视频处理失败';
    setLocalError(message);
    onUpdateNode(node.id, {
      videoRemix: setVideoRemixSourceError(state, message),
    });
  }, [node.id, onUpdateNode, state]);

  const storeSource = React.useCallback((source: NonNullable<typeof state.source>) => {
    setLocalError('');
    onUpdateNode(node.id, {
      videoRemix: replaceVideoRemixSource(state, source),
    });
  }, [node.id, onUpdateNode, state]);

  const requireProject = () => {
    if (!workflowId) throw new Error('请先把当前画布保存为项目，再导入参考视频');
    return workflowId;
  };

  const handleFile = async (file?: File) => {
    if (!file || busy) return;
    if (!SUPPORTED_VIDEO_FILE_RE.test(file.name)) {
      storeFailure(new Error('只支持 MP4、MOV 或 WebM 视频'));
      return;
    }
    setBusy('local');
    setLocalError('');
    try {
      const source = await importLocalReferenceVideo({
        workflowId: requireProject(),
        remixId: state.remixId,
        file,
      });
      storeSource(source);
    } catch (error) {
      storeFailure(error);
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleResolve = async () => {
    if (busy) return;
    if (!urlInput.trim()) {
      storeFailure(new Error('请粘贴分享链接或包含链接的整段分享文案'));
      return;
    }
    setBusy('url');
    setLocalError('');
    try {
      const source = await resolveUrlReferenceVideo({
        workflowId: requireProject(),
        remixId: state.remixId,
        input: urlInput.trim(),
      });
      storeSource(source);
    } catch (error) {
      storeFailure(error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-7 grid gap-5 lg:grid-cols-[1.45fr_0.85fr]">
      <section className={`rounded-[26px] border p-5 ${
        dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
      }`}>
        <div className={`flex min-h-[300px] items-center justify-center overflow-hidden rounded-[20px] border ${
          dark ? 'border-white/10 bg-black/40' : 'border-neutral-200 bg-neutral-50'
        }`}>
          {state.source ? (
            <video
              key={state.source.localUrl}
              src={state.source.localUrl}
              controls
              preload="metadata"
              className="max-h-[360px] max-w-full rounded-xl"
            />
          ) : (
            <div className="max-w-sm px-6 text-center">
              <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl ${
                dark ? 'bg-white/6 text-neutral-400' : 'bg-white text-neutral-500 shadow-sm'
              }`}>
                <Film size={25} />
              </div>
              <div className="mt-4 text-sm font-medium">尚未导入参考视频</div>
              <p className={`mt-2 text-xs leading-5 ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                选择本地文件、拖入视频，或粘贴抖音、小红书、快手、Bilibili、TikTok 等分享文案。
              </p>
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm"
          onChange={event => void handleFile(event.target.files?.[0])}
        />

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={event => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onDrop={event => {
              event.preventDefault();
              event.stopPropagation();
              void handleFile(event.dataTransfer.files?.[0]);
            }}
            className={`flex min-h-[132px] items-center gap-4 rounded-2xl border border-dashed p-4 text-left transition-colors disabled:cursor-wait disabled:opacity-60 ${
              dark
                ? 'border-white/12 bg-white/[0.025] hover:border-cyan-400/50 hover:bg-cyan-400/[0.04]'
                : 'border-neutral-300 bg-neutral-50 hover:border-cyan-500/50 hover:bg-cyan-50'
            }`}
          >
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
              dark ? 'bg-white/6 text-cyan-300' : 'bg-white text-cyan-700 shadow-sm'
            }`}>
              {busy === 'local' ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
            </span>
            <span>
              <span className="block text-sm font-medium">
                {busy === 'local' ? '正在复制并读取视频…' : '选择或拖入本地视频'}
              </span>
              <span className={`mt-1 block text-[11px] leading-5 ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                MP4 / MOV / WebM，原文件会独立保存且不被修改
              </span>
            </span>
          </button>

          <div className={`rounded-2xl border p-4 ${
            dark ? 'border-white/8 bg-white/[0.025]' : 'border-neutral-200 bg-neutral-50'
          }`}>
            <div className="flex items-center gap-2 text-xs font-medium">
              <Link2 size={14} className="text-cyan-400" />
              分享链接或完整分享文案
            </div>
            <textarea
              value={urlInput}
              onChange={event => setUrlInput(event.target.value)}
              onPointerDown={event => event.stopPropagation()}
              placeholder="例如：复制打开抖音…… https://v.douyin.com/xxxx/"
              className={`mt-2 h-[50px] w-full resize-none rounded-xl border px-3 py-2 text-xs outline-none ${
                dark
                  ? 'border-white/8 bg-black/30 text-white placeholder:text-neutral-600 focus:border-cyan-400/60'
                  : 'border-neutral-200 bg-white text-neutral-900 placeholder:text-neutral-400 focus:border-cyan-500'
              }`}
            />
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void handleResolve()}
              className={`mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-xl text-xs font-medium disabled:cursor-wait disabled:opacity-60 ${
                dark ? 'bg-cyan-400 text-neutral-950 hover:bg-cyan-300' : 'bg-cyan-600 text-white hover:bg-cyan-500'
              }`}
            >
              {busy === 'url' ? <Loader2 size={14} className="animate-spin" /> : <CloudDownload size={14} />}
              {busy === 'url' ? '正在解析并下载…' : '解析并保存到当前项目'}
            </button>
          </div>
        </div>

        {sourceError && (
          <div className={`mt-4 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs ${
            dark ? 'border-red-500/20 bg-red-500/8 text-red-300' : 'border-red-200 bg-red-50 text-red-700'
          }`}>
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span>{sourceError}</span>
          </div>
        )}

        <div className={`mt-4 text-[11px] leading-5 ${dark ? 'text-neutral-600' : 'text-neutral-400'}`}>
          此步骤只使用公开媒体解析接口与 Evan 内置 FFprobe，不调用 Gemini；未登录 Gemini 也能正常导入。
        </div>
      </section>

      <div className="flex flex-col gap-4">
        <section className={`rounded-[22px] border p-5 ${
          dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
        }`}>
          <div className="flex items-center gap-2 text-xs font-medium">
            <FileVideo size={15} className="text-cyan-400" />
            Reference Video
          </div>
          {state.source ? (
            <div className="mt-4 space-y-3">
              <div>
                <div className="line-clamp-2 text-sm font-medium">
                  {state.source.title || state.source.originalFilename || '参考视频'}
                </div>
                <div className={`mt-1 text-[11px] ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                  {state.source.sourceType === 'url' ? state.source.platform || '分享链接' : state.source.sourceType === 'canvas' ? '画布视频' : '本地文件'}
                </div>
              </div>
              <dl className={`grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4 text-xs ${
                dark ? 'border-white/8' : 'border-neutral-100'
              }`}>
                <SourceStat label="时长" value={formatDuration(state.source.duration)} dark={dark} />
                <SourceStat label="画面" value={`${state.source.width} × ${state.source.height}`} dark={dark} />
                <SourceStat label="帧率" value={`${state.source.fps.toFixed(2)} fps`} dark={dark} />
                <SourceStat label="声音" value={state.source.hasAudio ? state.source.audioCodec || '有音轨' : '无音轨'} dark={dark} />
                <SourceStat label="视频编码" value={state.source.codec || '未知'} dark={dark} />
                <SourceStat
                  label="方向"
                  value={state.source.orientation === 'portrait' ? '竖屏' : state.source.orientation === 'square' ? '方形' : '横屏'}
                  dark={dark}
                />
              </dl>
            </div>
          ) : (
            <div className={`mt-4 rounded-xl border border-dashed px-4 py-8 text-center text-xs ${
              dark ? 'border-white/8 text-neutral-600' : 'border-neutral-200 text-neutral-400'
            }`}>
              导入后显示时长、分辨率、帧率、编码与音轨信息
            </div>
          )}
        </section>
        <OverviewCards summary={summary} dark={dark} />
      </div>
    </div>
  );
};

const SourceStat: React.FC<{ label: string; value: string; dark: boolean }> = ({ label, value, dark }) => (
  <div>
    <dt className={dark ? 'text-neutral-600' : 'text-neutral-400'}>{label}</dt>
    <dd className={`mt-1 truncate font-medium ${dark ? 'text-neutral-300' : 'text-neutral-700'}`}>{value}</dd>
  </div>
);

const OverviewCards: React.FC<{
  summary: ReturnType<typeof summarizeVideoRemixState>;
  dark: boolean;
}> = ({ summary, dark }) => (
  <div className="grid grid-cols-2 gap-4">
    <SummaryCard icon={<Film size={18} />} label="镜头" value={summary.shots} dark={dark} />
    <SummaryCard icon={<Users size={18} />} label="人物" value={summary.characters} dark={dark} />
    <SummaryCard icon={<Images size={18} />} label="场景" value={summary.scenes} dark={dark} />
    <SummaryCard icon={<Package size={18} />} label="道具" value={summary.props} dark={dark} />
  </div>
);

const SummaryCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: number;
  dark: boolean;
}> = ({ icon, label, value, dark }) => (
  <div className={`rounded-[22px] border p-4 ${
    dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
  }`}>
    <div className={`flex items-center gap-2 text-xs ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
      {icon}
      {label}
    </div>
    <div className="mt-3 text-2xl font-semibold">{value}</div>
  </div>
);
