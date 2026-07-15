import React from 'react';
import { Clapperboard, Film, FolderOpen, Sparkles } from 'lucide-react';

interface MangaStartPanelProps {
  canvasTheme: 'dark' | 'light';
  onCreateWorkflow: () => void;
  onOpenStoryboard: () => void;
  onOpenAssets: (e: React.MouseEvent) => void;
}

const steps = ['故事', '分镜', '图片', '视频', '声音', '字幕', '成片'];

export const MangaStartPanel: React.FC<MangaStartPanelProps> = ({
  canvasTheme,
  onCreateWorkflow,
  onOpenStoryboard,
  onOpenAssets,
}) => {
  const isDark = canvasTheme === 'dark';

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center pointer-events-none px-6">
      <section
        className={`pointer-events-auto w-full max-w-[620px] rounded-3xl border p-7 shadow-2xl backdrop-blur-xl ${
          isDark
            ? 'border-neutral-800 bg-[#101010]/95 text-white'
            : 'border-neutral-200 bg-white/95 text-neutral-900'
        }`}
      >
        <div className="flex items-start gap-4">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${isDark ? 'bg-blue-500/15 text-blue-300' : 'bg-blue-50 text-blue-600'}`}>
            <Clapperboard size={22} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">开始一部 AI 漫剧</h1>
            <p className={`mt-1.5 text-sm leading-6 ${isDark ? 'text-neutral-400' : 'text-neutral-500'}`}>
              一键搭好完整节点，再按顺序填入故事、画面和声音。
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-1.5" aria-label="AI漫剧制作步骤">
          {steps.map((step, index) => (
            <React.Fragment key={step}>
              <span className={`rounded-full px-2.5 py-1 text-xs ${isDark ? 'bg-neutral-900 text-neutral-300' : 'bg-neutral-100 text-neutral-600'}`}>
                {step}
              </span>
              {index < steps.length - 1 && <span className={isDark ? 'text-neutral-700' : 'text-neutral-300'}>›</span>}
            </React.Fragment>
          ))}
        </div>

        <button
          type="button"
          onClick={onCreateWorkflow}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
        >
          <Sparkles size={16} />
          创建完整工作流
        </button>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onOpenStoryboard}
            className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
              isDark
                ? 'border-neutral-700 bg-neutral-900 text-neutral-200 hover:bg-neutral-800'
                : 'border-neutral-200 bg-neutral-50 text-neutral-700 hover:bg-neutral-100'
            }`}
          >
            <Film size={15} />
            AI 生成分镜
          </button>
          <button
            type="button"
            onClick={onOpenAssets}
            className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
              isDark
                ? 'border-neutral-700 bg-neutral-900 text-neutral-200 hover:bg-neutral-800'
                : 'border-neutral-200 bg-neutral-50 text-neutral-700 hover:bg-neutral-100'
            }`}
          >
            <FolderOpen size={15} />
            导入已有素材
          </button>
        </div>

        <p className={`mt-4 text-center text-xs ${isDark ? 'text-neutral-600' : 'text-neutral-400'}`}>
          也可以双击空白处，单独添加任意节点
        </p>
      </section>
    </div>
  );
};
