import React from 'react';
import {
  AlertCircle,
  BrainCircuit,
  Boxes,
  Check,
  ChevronRight,
  CloudDownload,
  FileVideo,
  Film,
  Images,
  LayoutDashboard,
  Link2,
  LogIn,
  Loader2,
  Lock,
  Package,
  Play,
  Plus,
  RotateCcw,
  RefreshCw,
  Save,
  ScanSearch,
  Scissors,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  VIDEO_REMIX_WORKSPACE_TABS,
  applyVideoRemixGlobalAnalysis,
  applyVideoRemixShotAnalysis,
  beginVideoRemixPreprocessing,
  beginVideoRemixAnalysis,
  completeVideoRemixPreprocessing,
  createVideoRemixState,
  normalizeVideoRemixCutPoints,
  replaceVideoRemixSource,
  restoreVideoRemixAnalysis as restoreVideoRemixAnalysisState,
  setVideoRemixGlobalAnalysisError,
  setVideoRemixPreprocessingError,
  setVideoRemixShotAnalysisError,
  setVideoRemixSourceError,
  summarizeVideoRemixState,
  workspaceTabForStage,
  type EditableField,
  type ShotAnalysisFramePosition,
  type VideoRemixWorkspaceTab,
} from '../../../shared/videoRemix.js';
import { NodeData } from '../../types';
import {
  VideoRemixRequestError,
  analyzeVideoRemixGlobal,
  analyzeVideoRemixShot,
  importLocalReferenceVideo,
  openGeminiLogin,
  preprocessReferenceVideo,
  resolveUrlReferenceVideo,
  restoreVideoRemixAnalysis,
  updateVideoRemixShotTimeline,
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
              onSelectTab={setActiveTab}
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
  onSelectTab: (tab: VideoRemixWorkspaceTab) => void;
}> = ({ activeTab, state, summary, dark, node, workflowId, onUpdateNode, onSelectTab }) => {
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
          onSelectShots={() => onSelectTab('shots')}
          dark={dark}
        />
      ) : activeTab === 'analysis' ? (
        <AnalysisWorkspace
          node={node}
          state={state}
          workflowId={workflowId}
          onUpdateNode={onUpdateNode}
          onSelectShots={() => onSelectTab('shots')}
          dark={dark}
        />
      ) : activeTab === 'shots' ? (
        <ShotsWorkspace
          node={node}
          state={state}
          workflowId={workflowId}
          onUpdateNode={onUpdateNode}
          onSelectSource={() => onSelectTab('source')}
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
  onSelectShots: () => void;
  dark: boolean;
}> = ({ node, state, summary, workflowId, onUpdateNode, onSelectShots, dark }) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [urlInput, setUrlInput] = React.useState('');
  const [sceneThreshold, setSceneThreshold] = React.useState(0.3);
  const [busy, setBusy] = React.useState<'local' | 'url' | 'preprocess' | null>(null);
  const [localError, setLocalError] = React.useState('');
  const sourceError = busy
    ? ''
    : localError
      || state.errors.find(item => ['source', 'preprocessing'].includes(item.scope))?.message
      || '';

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

  const handlePreprocess = async () => {
    if (busy) return;
    if (!state.source) {
      storeFailure(new Error('请先导入参考视频'));
      return;
    }
    setBusy('preprocess');
    setLocalError('');
    onUpdateNode(node.id, {
      videoRemix: beginVideoRemixPreprocessing(state),
    });
    try {
      const result = await preprocessReferenceVideo({
        workflowId: requireProject(),
        remixId: state.remixId,
        source: state.source,
        threshold: sceneThreshold,
      });
      onUpdateNode(node.id, {
        videoRemix: completeVideoRemixPreprocessing(state, result),
      });
      onSelectShots();
    } catch (error) {
      const message = error instanceof Error ? error.message : '视频预处理失败';
      setLocalError(message);
      onUpdateNode(node.id, {
        videoRemix: setVideoRemixPreprocessingError(state, message),
      });
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

        <div className={`mt-4 rounded-2xl border p-4 ${
          dark ? 'border-cyan-400/15 bg-cyan-400/[0.035]' : 'border-cyan-100 bg-cyan-50/60'
        }`}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                <ScanSearch size={16} className="text-cyan-400" />
                本地自动拆镜
              </div>
              <div className={`mt-1 text-[11px] leading-5 ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>
                生成 720p / 15fps H.264 分析代理，通过 FFmpeg 场景分数确定切点，并为每个镜头抽取五帧。
              </div>
            </div>
            <label className={`min-w-[180px] text-[11px] ${dark ? 'text-neutral-400' : 'text-neutral-600'}`}>
              切镜阈值 {sceneThreshold.toFixed(2)}
              <input
                type="range"
                min="0.1"
                max="0.7"
                step="0.05"
                value={sceneThreshold}
                disabled={Boolean(busy)}
                onChange={event => setSceneThreshold(Number(event.target.value))}
                className="mt-2 block w-full accent-cyan-400"
              />
            </label>
          </div>
          <button
            type="button"
            disabled={Boolean(busy) || !state.source}
            onClick={() => void handlePreprocess()}
            className={`mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium disabled:cursor-not-allowed disabled:opacity-45 ${
              dark ? 'bg-cyan-400 text-neutral-950 hover:bg-cyan-300' : 'bg-cyan-600 text-white hover:bg-cyan-500'
            }`}
          >
            {busy === 'preprocess' ? <Loader2 size={16} className="animate-spin" /> : <Scissors size={16} />}
            {busy === 'preprocess' ? '正在生成代理、检测切点并抽帧…' : state.shots.length ? '重新自动拆镜' : '生成分析代理并自动拆镜'}
          </button>
        </div>

        <div className={`mt-4 text-[11px] leading-5 ${dark ? 'text-neutral-600' : 'text-neutral-400'}`}>
          导入与自动拆镜只使用公开媒体解析接口及 Evan 内置 FFmpeg / FFprobe，不调用 Gemini。
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

type VideoAnalysisMode = 'fast' | 'deep';
type EditableShotPath =
  | 'storyBeat'
  | 'frameBlueprint.shotSize'
  | 'frameBlueprint.cameraAngle'
  | 'cameraBlueprint.angle'
  | 'audioBlueprint.environment';

const AnalysisWorkspace: React.FC<{
  node: NodeData;
  state: ReturnType<typeof createVideoRemixState>;
  workflowId?: string;
  onUpdateNode: (nodeId: string, updates: Partial<NodeData>) => void;
  onSelectShots: () => void;
  dark: boolean;
}> = ({ node, state, workflowId, onUpdateNode, onSelectShots, dark }) => {
  const [mode, setMode] = React.useState<VideoAnalysisMode>(
    state.analysisRun?.mode === 'deep' ? 'deep' : 'fast'
  );
  const [busy, setBusy] = React.useState<'global' | 'login' | string | null>(null);
  const [localError, setLocalError] = React.useState('');
  const [authRequired, setAuthRequired] = React.useState(
    state.errors.some(item => item.scope === 'analysis' && item.code === 'AUTH_EXPIRED')
  );
  const recoveryKeyRef = React.useRef('');
  const running = Boolean(busy);
  const completedShots = state.shots.filter(shot => shot.analysisStatus === 'ready').length;
  const hasGlobal = state.analysisRun?.globalStatus === 'ready' && Boolean(state.story);
  const pendingShotIds = state.shots
    .filter(shot => shot.analysisStatus !== 'ready')
    .map(shot => shot.shotId);

  const errorDetails = (error: unknown) => ({
    message: error instanceof Error ? error.message : 'Gemini 分析失败',
    code: error instanceof VideoRemixRequestError ? error.code : undefined,
    retryable: error instanceof VideoRemixRequestError ? error.retryable : true,
    authRequired: error instanceof VideoRemixRequestError ? error.authRequired : false,
  });

  React.useEffect(() => {
    if (
      busy
      || !workflowId
      || !state.source?.proxyUrl
      || state.shots.length === 0
    ) return;
    const recoveryKey = JSON.stringify({
      source: state.source.sourceHash || state.source.id,
      shots: state.shots.map(shot => [shot.shotId, shot.start, shot.end]),
      mode: state.analysisRun?.mode || mode,
      analysisKey: state.analysisRun?.analysisKey || '',
    });
    if (recoveryKeyRef.current === recoveryKey) return;
    recoveryKeyRef.current = recoveryKey;
    void restoreVideoRemixAnalysis({
      workflowId,
      remixId: state.remixId,
      source: state.source,
      shots: state.shots,
      mode: state.analysisRun?.mode === 'deep' ? 'deep' : mode,
      analysisKey: state.analysisRun?.analysisKey,
    }).then(snapshot => {
      const restored = restoreVideoRemixAnalysisState(state, snapshot);
      if (
        !state.story
        || restored.analysisRun.analysisKey !== state.analysisRun?.analysisKey
        || restored.analysisRun.completedShots > completedShots
      ) {
        onUpdateNode(node.id, { videoRemix: restored });
      }
    }).catch(error => {
      if (
        error instanceof VideoRemixRequestError
        && ['ANALYSIS_RESULT_NOT_FOUND', 'ANALYSIS_STALE'].includes(error.code)
      ) return;
    });
  }, [
    busy,
    completedShots,
    mode,
    node.id,
    onUpdateNode,
    state,
    workflowId,
  ]);

  const persist = (nextState: ReturnType<typeof createVideoRemixState>) => {
    onUpdateNode(node.id, { videoRemix: nextState });
  };

  const analyzeShotIds = async (
    initialState: ReturnType<typeof createVideoRemixState>,
    shotIds: string[]
  ) => {
    let working = initialState;
    for (const shotId of shotIds) {
      if (!working.source || !working.analysisRun?.analysisKey) break;
      const activeSource = working.source;
      const activeAnalysisKey = working.analysisRun.analysisKey;
      setBusy(shotId);
      working = {
        ...working,
        stage: 'analyzing',
        shots: working.shots.map(shot => (
          shot.shotId === shotId
            ? { ...shot, analysisStatus: 'analyzing', analysisError: undefined }
            : shot
        )),
        updatedAt: new Date().toISOString(),
      };
      persist(working);
      try {
        const result = await analyzeVideoRemixShot({
          workflowId: workflowId!,
          remixId: working.remixId,
          source: activeSource,
          shots: working.shots,
          shotId,
          mode: working.analysisRun.mode,
          analysisKey: activeAnalysisKey,
        });
        working = applyVideoRemixShotAnalysis(working, result.shot);
        persist(working);
      } catch (error) {
        const details = errorDetails(error);
        working = setVideoRemixShotAnalysisError(
          working,
          shotId,
          details.message,
          details
        );
        persist(working);
        setLocalError(details.message);
        if (details.authRequired) {
          setAuthRequired(true);
          break;
        }
      }
    }
    setBusy(null);
    return working;
  };

  const runFullAnalysis = async () => {
    if (running) return;
    if (!workflowId || !state.source) {
      setLocalError('请先保存项目，并完成参考视频导入与自动拆镜');
      return;
    }
    setLocalError('');
    setAuthRequired(false);
    setBusy('global');
    let working = beginVideoRemixAnalysis(state, mode);
    persist(working);
    try {
      const global = await analyzeVideoRemixGlobal({
        workflowId,
        remixId: working.remixId,
        source: working.source!,
        shots: working.shots,
        mode,
      });
      working = applyVideoRemixGlobalAnalysis(working, global);
      persist(working);
      await analyzeShotIds(working, working.shots.map(shot => shot.shotId));
    } catch (error) {
      const details = errorDetails(error);
      working = setVideoRemixGlobalAnalysisError(working, details.message, details);
      persist(working);
      setLocalError(details.message);
      setAuthRequired(details.authRequired);
      setBusy(null);
    }
  };

  const retryPendingShots = async () => {
    if (running) return;
    if (!workflowId || !state.source || !state.analysisRun?.analysisKey || !hasGlobal) {
      await runFullAnalysis();
      return;
    }
    setLocalError('');
    setAuthRequired(false);
    await analyzeShotIds(state, pendingShotIds);
  };

  const retryOneShot = async (shotId: string) => {
    if (running || !workflowId || !state.source || !state.analysisRun?.analysisKey) return;
    setLocalError('');
    setAuthRequired(false);
    await analyzeShotIds(state, [shotId]);
  };

  const handleLogin = async () => {
    if (running) return;
    setBusy('login');
    setLocalError('');
    try {
      await openGeminiLogin();
      setLocalError('登录窗口已打开。完成 Google 登录后，回到这里点击“重试未完成 Shot”。');
    } catch (error) {
      setLocalError(errorDetails(error).message);
    } finally {
      setBusy(null);
    }
  };

  const updateEditableField = (
    shotId: string,
    path: EditableShotPath,
    value: string,
    locked: boolean
  ) => {
    if (running) return;
    const shots = state.shots.map(shot => {
      if (shot.shotId !== shotId) return shot;
      const next = structuredClone(shot);
      const field: EditableField<string> = {
        value,
        source: 'user',
        locked,
      };
      if (path === 'storyBeat') next.storyBeat = field;
      if (path === 'frameBlueprint.shotSize') next.frameBlueprint.shotSize = field;
      if (path === 'frameBlueprint.cameraAngle') next.frameBlueprint.cameraAngle = field;
      if (path === 'cameraBlueprint.angle') next.cameraBlueprint.angle = field;
      if (path === 'audioBlueprint.environment') next.audioBlueprint.environment = field;
      return next;
    });
    persist({
      ...state,
      shots,
      updatedAt: new Date().toISOString(),
    });
  };

  if (!state.source?.proxyUrl || state.shots.length === 0) {
    return (
      <div className={`mt-7 flex min-h-[360px] items-center justify-center rounded-[26px] border ${
        dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
      }`}>
        <div className="max-w-sm text-center">
          <BrainCircuit size={28} className="mx-auto text-cyan-400" />
          <div className="mt-4 text-sm font-medium">需要先确认 Shot 时间线</div>
          <p className={`mt-2 text-xs leading-5 ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
            Gemini 分析使用本地拆镜结果；未生成代理时不会上传原视频。
          </p>
          <button
            type="button"
            onClick={onSelectShots}
            className={`mt-5 rounded-xl px-5 py-2.5 text-xs font-medium ${
              dark ? 'bg-white text-neutral-950' : 'bg-neutral-900 text-white'
            }`}
          >
            前往镜头页
          </button>
        </div>
      </div>
    );
  }

  const progress = state.shots.length > 0
    ? Math.round((completedShots / state.shots.length) * 100)
    : 0;

  return (
    <div className="mt-7 space-y-5">
      <section className={`rounded-[26px] border p-5 ${
        dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
      }`}>
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-sm font-medium">
              <BrainCircuit size={17} className="text-cyan-400" />
              结构化视频分析
            </div>
            <p className={`mt-2 text-xs leading-5 ${dark ? 'text-neutral-500' : 'text-neutral-500'}`}>
              完整代理视频只在全片阶段上传一次；随后 Simple Shot 使用三帧、Medium 使用五帧、
              Complex 使用本地裁出的完整镜头。每个 Shot 独立保存并可单独重试。
            </p>
          </div>
          <div className={`flex rounded-xl p-1 ${dark ? 'bg-black/35' : 'bg-neutral-100'}`}>
            {([
              ['fast', '快速'],
              ['deep', '深度'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                disabled={running}
                onClick={() => setMode(id)}
                className={`rounded-lg px-4 py-2 text-xs font-medium transition-colors ${
                  mode === id
                    ? dark ? 'bg-white text-neutral-950' : 'bg-white text-neutral-900 shadow-sm'
                    : dark ? 'text-neutral-500' : 'text-neutral-500'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <div className={`h-2 overflow-hidden rounded-full ${dark ? 'bg-white/6' : 'bg-neutral-100'}`}>
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className={`mt-2 flex justify-between text-[11px] ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
            <span>全片：{state.analysisRun?.globalStatus || 'idle'}</span>
            <span>Shot {completedShots}/{state.shots.length}</span>
          </div>
        </div>

        {(authRequired || state.errors.some(item => (
          item.scope === 'analysis' && ['AUTH_EXPIRED', 'RECAPTCHA_REQUIRED'].includes(item.code || '')
        ))) && (
          <div className={`mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 ${
            dark ? 'border-amber-400/20 bg-amber-400/[0.06]' : 'border-amber-200 bg-amber-50'
          }`}>
            <div>
              <div className={`text-xs font-medium ${dark ? 'text-amber-200' : 'text-amber-800'}`}>
                Gemini 尚未登录或登录已失效
              </div>
              <div className={`mt-1 text-[11px] ${dark ? 'text-amber-300/60' : 'text-amber-700/70'}`}>
                本地导入、拆镜和编辑不受影响；登录后只重试未完成的分析。
              </div>
            </div>
            <button
              type="button"
              disabled={running}
              onClick={() => void handleLogin()}
              className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium disabled:opacity-50 ${
                dark ? 'bg-amber-300 text-neutral-950' : 'bg-amber-600 text-white'
              }`}
            >
              {busy === 'login' ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
              打开 Gemini 登录
            </button>
          </div>
        )}

        {localError && (
          <div className={`mt-4 flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs ${
            authRequired
              ? dark ? 'bg-amber-400/8 text-amber-200' : 'bg-amber-50 text-amber-800'
              : dark ? 'bg-red-500/8 text-red-300' : 'bg-red-50 text-red-700'
          }`}>
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            {localError}
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          {!hasGlobal ? (
            <button
              type="button"
              disabled={running}
              onClick={() => void runFullAnalysis()}
              className={`flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-medium disabled:opacity-50 ${
                dark ? 'bg-cyan-400 text-neutral-950' : 'bg-cyan-600 text-white'
              }`}
            >
              {busy === 'global' ? <Loader2 size={15} className="animate-spin" /> : <BrainCircuit size={15} />}
              {busy === 'global' ? '正在上传一次代理并分析全片…' : '开始全片分析'}
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={running || pendingShotIds.length === 0}
                onClick={() => void retryPendingShots()}
                className={`flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-medium disabled:opacity-40 ${
                  dark ? 'bg-cyan-400 text-neutral-950' : 'bg-cyan-600 text-white'
                }`}
              >
                {running && busy !== 'login' ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                {running && busy !== 'login' ? `正在分析 ${busy}…` : `重试未完成 Shot（${pendingShotIds.length}）`}
              </button>
              <button
                type="button"
                disabled={running}
                onClick={() => void runFullAnalysis()}
                className={`flex h-11 items-center gap-2 rounded-xl px-4 text-xs disabled:opacity-40 ${
                  dark ? 'bg-white/6 text-neutral-300' : 'bg-neutral-100 text-neutral-600'
                }`}
              >
                <RotateCcw size={14} />
                重新分析全片
              </button>
            </>
          )}
        </div>
      </section>

      {state.story && (
        <section className={`rounded-[26px] border p-5 ${
          dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
        }`}>
          <div className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
            <div>
              <div className="text-sm font-medium">全片故事</div>
              <p className={`mt-3 text-sm leading-7 ${dark ? 'text-neutral-300' : 'text-neutral-700'}`}>
                {state.story.summary}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {state.story.structure.map((beat, index) => (
                  <span key={index} className={`rounded-full px-3 py-1 text-[10px] ${
                    dark ? 'bg-white/6 text-neutral-400' : 'bg-neutral-100 text-neutral-600'
                  }`}>
                    {index + 1}. {beat}
                  </span>
                ))}
              </div>
              {state.story.style && (
                <div className={`mt-4 rounded-xl p-3 text-xs leading-5 ${
                  dark ? 'bg-black/25 text-neutral-400' : 'bg-neutral-50 text-neutral-600'
                }`}>
                  视觉风格：{state.story.style}
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <SummaryCard icon={<Users size={16} />} label="人物" value={state.assets.characters.length} dark={dark} />
              <SummaryCard icon={<Images size={16} />} label="场景" value={state.assets.scenes.length} dark={dark} />
              <SummaryCard icon={<Package size={16} />} label="道具" value={state.assets.props.length} dark={dark} />
            </div>
          </div>
        </section>
      )}

      <section className={`rounded-[26px] border p-5 ${
        dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
      }`}>
        <div>
          <div className="text-sm font-medium">逐 Shot Blueprint</div>
          <div className={`mt-1 text-[11px] ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
            修改字段会标记为 user + locked，后续重新分析不会覆盖；可手动解除锁定。
          </div>
        </div>
        <div className="mt-5 space-y-4">
          {state.shots.map((shot, index) => {
            const shotBusy = busy === shot.shotId;
            const status = shot.analysisStatus || 'pending';
            const statusStyle = status === 'ready'
              ? dark ? 'bg-emerald-400/10 text-emerald-300' : 'bg-emerald-50 text-emerald-700'
              : status === 'failed'
                ? dark ? 'bg-red-400/10 text-red-300' : 'bg-red-50 text-red-700'
                : dark ? 'bg-white/6 text-neutral-400' : 'bg-neutral-100 text-neutral-500';
            return (
              <article key={shot.shotId} className={`rounded-2xl border p-4 ${
                dark ? 'border-white/8 bg-black/20' : 'border-neutral-200 bg-neutral-50'
              }`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="text-xs font-medium">Shot {String(index + 1).padStart(2, '0')}</div>
                    <span className={`rounded-full px-2.5 py-1 text-[9px] ${statusStyle}`}>
                      {shotBusy ? '分析中' : status === 'ready' ? '已完成' : status === 'failed' ? '失败' : '待分析'}
                    </span>
                    <span className={`text-[10px] ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                      {shot.motionComplexity} · {shot.motionComplexityConfidence === undefined
                        ? '待分类'
                        : `${Math.round(shot.motionComplexityConfidence * 100)}%`}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-[10px] ${dark ? 'text-neutral-600' : 'text-neutral-400'}`}>
                      {formatDuration(shot.start)} – {formatDuration(shot.end)}
                    </span>
                    {status === 'failed' && (
                      <button
                        type="button"
                        disabled={running || !hasGlobal}
                        onClick={() => void retryOneShot(shot.shotId)}
                        className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] disabled:opacity-40 ${
                          dark ? 'bg-white/8 text-neutral-300' : 'bg-white text-neutral-600 shadow-sm'
                        }`}
                      >
                        <RefreshCw size={11} />
                        单独重试
                      </button>
                    )}
                  </div>
                </div>

                {shot.analysisError && (
                  <div className={`mt-3 rounded-lg px-3 py-2 text-[10px] ${
                    dark ? 'bg-red-500/8 text-red-300' : 'bg-red-50 text-red-700'
                  }`}>
                    {shot.analysisError}
                  </div>
                )}

                {status === 'ready' && (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <EditableAnalysisField
                      label="Story Beat"
                      field={shot.storyBeat}
                      disabled={running}
                      dark={dark}
                      onChange={(value, locked) => updateEditableField(shot.shotId, 'storyBeat', value, locked)}
                    />
                    <EditableAnalysisField
                      label="景别"
                      field={shot.frameBlueprint.shotSize}
                      disabled={running}
                      dark={dark}
                      onChange={(value, locked) => updateEditableField(shot.shotId, 'frameBlueprint.shotSize', value, locked)}
                    />
                    <EditableAnalysisField
                      label="构图角度"
                      field={shot.frameBlueprint.cameraAngle}
                      disabled={running}
                      dark={dark}
                      onChange={(value, locked) => updateEditableField(shot.shotId, 'frameBlueprint.cameraAngle', value, locked)}
                    />
                    <EditableAnalysisField
                      label="运镜角度"
                      field={shot.cameraBlueprint.angle}
                      disabled={running}
                      dark={dark}
                      onChange={(value, locked) => updateEditableField(shot.shotId, 'cameraBlueprint.angle', value, locked)}
                    />
                    <div className="md:col-span-2">
                      <EditableAnalysisField
                        label="环境声音"
                        field={shot.audioBlueprint.environment}
                        disabled={running}
                        dark={dark}
                        onChange={(value, locked) => updateEditableField(shot.shotId, 'audioBlueprint.environment', value, locked)}
                      />
                    </div>
                    <div className={`md:col-span-2 grid gap-3 rounded-xl p-3 text-[10px] sm:grid-cols-3 ${
                      dark ? 'bg-white/[0.025] text-neutral-500' : 'bg-white text-neutral-500'
                    }`}>
                      <div>人物：{shot.characters.map(item => item.characterId).join('、') || '无'}</div>
                      <div>场景：{shot.scene.sceneId || '未识别'}</div>
                      <div>道具：{shot.props.map(item => item.propId).join('、') || '无'}</div>
                      <div>动作段：{shot.motionBlueprint.subjects.reduce((sum, item) => sum + item.actionSequence.length, 0)}</div>
                      <div>运镜段：{shot.cameraBlueprint.movement.length}</div>
                      <div>对白：{shot.audioBlueprint.dialogue.length}</div>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
};

const EditableAnalysisField: React.FC<{
  label: string;
  field: EditableField<string>;
  disabled: boolean;
  dark: boolean;
  onChange: (value: string, locked: boolean) => void;
}> = ({ label, field, disabled, dark, onChange }) => (
  <label className={`block rounded-xl border p-3 ${
    dark ? 'border-white/8 bg-black/20' : 'border-neutral-200 bg-white'
  }`}>
    <span className="flex items-center justify-between gap-2">
      <span className={`text-[10px] font-medium ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
        {label}
      </span>
      <button
        type="button"
        disabled={disabled || field.source !== 'user'}
        onClick={event => {
          event.preventDefault();
          onChange(field.value, !field.locked);
        }}
        className={`rounded-full px-2 py-0.5 text-[9px] disabled:opacity-60 ${
          field.source === 'user' && field.locked
            ? dark ? 'bg-cyan-400/12 text-cyan-300' : 'bg-cyan-50 text-cyan-700'
            : dark ? 'bg-white/5 text-neutral-600' : 'bg-neutral-100 text-neutral-400'
        }`}
      >
        {field.source === 'user' ? field.locked ? '用户 · 已锁定' : '用户 · 未锁定' : `AI · ${Math.round((field.confidence || 0) * 100)}%`}
      </button>
    </span>
    <textarea
      value={field.value}
      disabled={disabled}
      onChange={event => onChange(event.target.value, true)}
      rows={2}
      className={`mt-2 w-full resize-none bg-transparent text-xs leading-5 outline-none disabled:opacity-60 ${
        dark ? 'text-neutral-200' : 'text-neutral-700'
      }`}
    />
  </label>
);

const FRAME_LABELS: Record<ShotAnalysisFramePosition, string> = {
  start: 'Start',
  quarter: '25%',
  middle: '50%',
  three_quarter: '75%',
  end: 'End',
};

const ShotsWorkspace: React.FC<{
  node: NodeData;
  state: ReturnType<typeof createVideoRemixState>;
  workflowId?: string;
  onUpdateNode: (nodeId: string, updates: Partial<NodeData>) => void;
  onSelectSource: () => void;
  dark: boolean;
}> = ({ node, state, workflowId, onUpdateNode, onSelectSource, dark }) => {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const duration = Math.max(0, Number(state.source?.duration) || 0);
  const savedCuts = React.useMemo(
    () => state.shots.slice(0, -1).map(shot => Number(shot.end)),
    [state.shots]
  );
  const [draftCuts, setDraftCuts] = React.useState<number[]>(savedCuts);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [localError, setLocalError] = React.useState('');

  React.useEffect(() => {
    setDraftCuts(savedCuts);
  }, [savedCuts]);

  const normalizedDraftCuts = React.useMemo(
    () => normalizeVideoRemixCutPoints(duration, draftCuts).slice(1, -1),
    [draftCuts, duration]
  );
  const dirty = JSON.stringify(normalizedDraftCuts) !== JSON.stringify(savedCuts);
  const boundaries = [0, ...normalizedDraftCuts, duration];

  const seekTo = (time: number) => {
    const safeTime = Math.min(duration, Math.max(0, time));
    setCurrentTime(safeTime);
    if (videoRef.current) videoRef.current.currentTime = safeTime;
  };

  const moveCut = (index: number, value: number) => {
    setDraftCuts(current => {
      const next = [...current];
      const previousBoundary = index === 0 ? 0 : next[index - 1];
      const nextBoundary = index === next.length - 1 ? duration : next[index + 1];
      next[index] = Math.round(
        Math.min(nextBoundary - 0.35, Math.max(previousBoundary + 0.35, value)) * 1000
      ) / 1000;
      return next;
    });
  };

  const splitAtCurrentTime = () => {
    const candidate = Math.round(
      Math.min(duration, Math.max(0, videoRef.current?.currentTime ?? currentTime)) * 1000
    ) / 1000;
    const allBoundaries = [0, ...normalizedDraftCuts, duration];
    if (allBoundaries.some(value => Math.abs(value - candidate) < 0.35)) {
      setLocalError('新切点需与相邻切点至少间隔 0.35 秒');
      return;
    }
    setLocalError('');
    setDraftCuts(current => [...current, candidate].sort((left, right) => left - right));
  };

  const saveTimeline = async () => {
    if (busy || !state.source) return;
    if (!workflowId) {
      setLocalError('请先把当前画布保存为项目');
      return;
    }
    setBusy(true);
    setLocalError('');
    onUpdateNode(node.id, {
      videoRemix: beginVideoRemixPreprocessing(state),
    });
    try {
      const result = await updateVideoRemixShotTimeline({
        workflowId,
        remixId: state.remixId,
        source: state.source,
        cutPoints: normalizedDraftCuts,
        previousShots: state.shots,
      });
      onUpdateNode(node.id, {
        videoRemix: completeVideoRemixPreprocessing(state, result),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '镜头时间线保存失败';
      setLocalError(message);
      onUpdateNode(node.id, {
        videoRemix: setVideoRemixPreprocessingError(state, message),
      });
    } finally {
      setBusy(false);
    }
  };

  if (!state.source?.proxyUrl || state.shots.length === 0) {
    return (
      <div className={`mt-7 flex min-h-[360px] items-center justify-center rounded-[26px] border ${
        dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
      }`}>
        <div className="max-w-sm text-center">
          <Scissors size={28} className="mx-auto text-cyan-400" />
          <div className="mt-4 text-sm font-medium">尚未生成镜头时间线</div>
          <p className={`mt-2 text-xs leading-5 ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
            先在源视频页生成分析代理并执行本地自动拆镜。
          </p>
          <button
            type="button"
            onClick={onSelectSource}
            className={`mt-5 rounded-xl px-5 py-2.5 text-xs font-medium ${
              dark ? 'bg-white text-neutral-950' : 'bg-neutral-900 text-white'
            }`}
          >
            返回源视频
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-7 space-y-5">
      <section className={`rounded-[26px] border p-5 ${
        dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
      }`}>
        <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <video
              ref={videoRef}
              src={state.source.proxyUrl}
              controls
              preload="metadata"
              onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)}
              className={`aspect-video max-h-[420px] w-full rounded-2xl object-contain ${
                dark ? 'bg-black' : 'bg-neutral-100'
              }`}
            />
            <button
              type="button"
              onClick={event => {
                const bounds = event.currentTarget.getBoundingClientRect();
                seekTo(((event.clientX - bounds.left) / bounds.width) * duration);
              }}
              className={`mt-4 flex h-12 w-full overflow-hidden rounded-xl ${
                dark ? 'bg-black/40' : 'bg-neutral-100'
              }`}
              aria-label="镜头时间线，点击可定位播放头"
            >
              {boundaries.slice(0, -1).map((start, index) => {
                const end = boundaries[index + 1];
                return (
                  <span
                    key={`${start}-${end}`}
                    className={`flex min-w-[2px] items-center justify-center border-r text-[10px] font-medium ${
                      index % 2 === 0
                        ? dark ? 'border-black/40 bg-cyan-400/25 text-cyan-100' : 'border-white bg-cyan-100 text-cyan-800'
                        : dark ? 'border-black/40 bg-blue-400/20 text-blue-100' : 'border-white bg-blue-100 text-blue-800'
                    }`}
                    style={{ width: `${((end - start) / duration) * 100}%` }}
                  >
                    {index + 1}
                  </span>
                );
              })}
            </button>
            <div className={`mt-2 flex justify-between text-[10px] ${dark ? 'text-neutral-600' : 'text-neutral-400'}`}>
              <span>00:00.0</span>
              <span>播放头 {formatDuration(currentTime)}</span>
              <span>{formatDuration(duration)}</span>
            </div>
          </div>

          <div className={`rounded-2xl border p-4 ${
            dark ? 'border-white/8 bg-white/[0.025]' : 'border-neutral-200 bg-neutral-50'
          }`}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">切点编辑</div>
                <div className={`mt-1 text-[11px] ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                  {boundaries.length - 1} 个镜头 · 最短 0.35 秒
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={splitAtCurrentTime}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs disabled:opacity-50 ${
                  dark ? 'bg-white/8 text-neutral-200 hover:bg-white/12' : 'bg-white text-neutral-700 shadow-sm'
                }`}
              >
                <Plus size={13} />
                在播放头拆分
              </button>
            </div>

            <div className="mt-4 max-h-[230px] space-y-3 overflow-y-auto pr-1">
              {normalizedDraftCuts.length === 0 ? (
                <div className={`rounded-xl border border-dashed px-3 py-5 text-center text-xs ${
                  dark ? 'border-white/8 text-neutral-600' : 'border-neutral-200 text-neutral-400'
                }`}>
                  当前只有一个镜头，可播放到目标位置后新增切点
                </div>
              ) : normalizedDraftCuts.map((cut, index) => {
                const previousBoundary = index === 0 ? 0 : normalizedDraftCuts[index - 1];
                const nextBoundary = index === normalizedDraftCuts.length - 1
                  ? duration
                  : normalizedDraftCuts[index + 1];
                return (
                  <div key={index} className={`rounded-xl border px-3 py-2.5 ${
                    dark ? 'border-white/8 bg-black/20' : 'border-neutral-200 bg-white'
                  }`}>
                    <div className="flex items-center justify-between text-[11px]">
                      <span>切点 {index + 1} · {formatDuration(cut)}</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setDraftCuts(current => current.filter((_, itemIndex) => itemIndex !== index))}
                        className={`flex items-center gap-1 rounded-md px-2 py-1 ${
                          dark ? 'text-neutral-500 hover:bg-red-500/10 hover:text-red-300' : 'text-neutral-400 hover:bg-red-50 hover:text-red-600'
                        }`}
                      >
                        <Trash2 size={11} />
                        合并
                      </button>
                    </div>
                    <input
                      type="range"
                      min={previousBoundary + 0.35}
                      max={nextBoundary - 0.35}
                      step="0.01"
                      value={cut}
                      disabled={busy}
                      onChange={event => moveCut(index, Number(event.target.value))}
                      className="mt-2 block w-full accent-cyan-400"
                    />
                  </div>
                );
              })}
            </div>

            {localError && (
              <div className={`mt-3 flex items-start gap-2 rounded-xl px-3 py-2 text-xs ${
                dark ? 'bg-red-500/8 text-red-300' : 'bg-red-50 text-red-700'
              }`}>
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                {localError}
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy || !dirty}
                onClick={() => {
                  setDraftCuts(savedCuts);
                  setLocalError('');
                }}
                className={`flex h-10 items-center justify-center gap-2 rounded-xl text-xs disabled:opacity-40 ${
                  dark ? 'bg-white/6 text-neutral-300' : 'bg-white text-neutral-600 shadow-sm'
                }`}
              >
                <RotateCcw size={13} />
                撤销调整
              </button>
              <button
                type="button"
                disabled={busy || !dirty}
                onClick={() => void saveTimeline()}
                className={`flex h-10 items-center justify-center gap-2 rounded-xl text-xs font-medium disabled:opacity-40 ${
                  dark ? 'bg-cyan-400 text-neutral-950' : 'bg-cyan-600 text-white'
                }`}
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                {busy ? '重建五帧中…' : '保存镜头时间线'}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className={`rounded-[26px] border p-5 ${
        dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
      }`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Shot 分析帧</div>
            <div className={`mt-1 text-[11px] ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
              每镜头固定抽取 Start / 25% / 50% / 75% / End，供下一阶段语义分析使用。
            </div>
          </div>
          {dirty && (
            <span className={`rounded-full px-3 py-1 text-[10px] ${
              dark ? 'bg-amber-400/10 text-amber-300' : 'bg-amber-50 text-amber-700'
            }`}>
              保存后刷新分析帧
            </span>
          )}
        </div>
        <div className="mt-5 space-y-4">
          {state.shots.map((shot, index) => (
            <article key={shot.shotId} className={`rounded-2xl border p-4 ${
              dark ? 'border-white/8 bg-black/20' : 'border-neutral-200 bg-neutral-50'
            }`}>
              <div className="flex items-center justify-between gap-4">
                <div className="text-xs font-medium">Shot {String(index + 1).padStart(2, '0')}</div>
                <div className={`text-[11px] ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                  {formatDuration(shot.start)} – {formatDuration(shot.end)} · {Number(shot.duration).toFixed(2)}s
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {(shot.analysisFrames || []).map(frame => (
                  <figure key={frame.position} className={`overflow-hidden rounded-xl border ${
                    dark ? 'border-white/8 bg-black' : 'border-neutral-200 bg-white'
                  }`}>
                    <img
                      src={frame.url}
                      alt={`${shot.shotId} ${FRAME_LABELS[frame.position]}`}
                      loading="lazy"
                      className="aspect-video w-full object-cover"
                    />
                    <figcaption className={`flex justify-between px-2 py-1.5 text-[9px] ${
                      dark ? 'text-neutral-500' : 'text-neutral-400'
                    }`}>
                      <span>{FRAME_LABELS[frame.position]}</span>
                      <span>{formatDuration(frame.time)}</span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
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
