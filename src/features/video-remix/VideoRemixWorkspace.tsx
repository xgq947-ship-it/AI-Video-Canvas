import React from 'react';
import {
  Boxes,
  Check,
  ChevronRight,
  Film,
  Images,
  LayoutDashboard,
  Lock,
  Package,
  Play,
  ScanSearch,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import {
  VIDEO_REMIX_WORKSPACE_TABS,
  createVideoRemixState,
  summarizeVideoRemixState,
  workspaceTabForStage,
  type VideoRemixWorkspaceTab,
} from '../../../shared/videoRemix.js';
import { NodeData } from '../../types';

interface VideoRemixWorkspaceProps {
  node: NodeData;
  canvasTheme?: 'dark' | 'light';
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
  canvasTheme = 'dark',
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
}> = ({ activeTab, state, summary, dark }) => {
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
        <div className="mt-7 grid gap-5 lg:grid-cols-[1.45fr_0.85fr]">
          <section className={`min-h-[380px] rounded-[26px] border p-5 ${
            dark ? 'border-white/8 bg-[#111214]' : 'border-neutral-200 bg-white'
          }`}>
            <div className={`flex min-h-[300px] items-center justify-center rounded-[20px] border border-dashed ${
              dark ? 'border-white/10 bg-black/30' : 'border-neutral-200 bg-neutral-50'
            }`}>
              {state.source ? (
                <video src={state.source.localUrl} controls className="max-h-[300px] max-w-full rounded-xl" />
              ) : (
                <div className="max-w-sm text-center">
                  <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl ${
                    dark ? 'bg-white/6 text-neutral-400' : 'bg-white text-neutral-500 shadow-sm'
                  }`}>
                    <Film size={25} />
                  </div>
                  <div className="mt-4 text-sm font-medium">尚未导入参考视频</div>
                  <p className={`mt-2 text-xs leading-5 ${dark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                    本地视频、画布已有视频和分享 URL 将在 Reference Video 阶段接入。
                  </p>
                </div>
              )}
            </div>
          </section>
          <OverviewCards summary={summary} dark={dark} />
        </div>
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
