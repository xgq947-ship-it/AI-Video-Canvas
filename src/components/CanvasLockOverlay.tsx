import React, { useEffect, useState } from 'react';
import type { LicenseState } from '../hooks/useLicense';

export interface CanvasLockOverlayProps {
  state: LicenseState;
  onActivate: () => void;
}

/**
 * 试用结束后盖住整块画布的硬锁。
 *
 * 只负责「拦住手」，不负责「拦住请求」——渲染进程的任何遮罩在本地 Electron 里
 * 一开 devtools 就能撤掉，真正的闸门在 server/services/licenseGuard.js 的
 * blockWhenCanvasLocked。两层是刻意的：这层给人看，那层给程序守。
 *
 * 刻意保留的出口：已经生成的成果不被扣作人质。用户随时能打开成果文件夹把图
 * 全部取走，这既是基本的体面，也避免把「续费」变成一次带胁迫的交易。
 */
export const CanvasLockOverlay: React.FC<CanvasLockOverlayProps> = ({ state, onActivate }) => {
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState('');

  // 遮罩存在期间锁住 body 滚动，避免背后的画布还能被滚动窥探/误操作。
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  const blocked = state.status === 'blocked';

  const openResults = async () => {
    setRevealError('');
    setRevealing(true);
    try {
      const bridge = (window as unknown as {
        evanDesktop?: { revealLibrary?: () => Promise<{ ok: boolean; error?: string }> };
      }).evanDesktop;
      if (!bridge?.revealLibrary) {
        setRevealError('请在 Evan 桌面应用中操作');
        return;
      }
      const result = await bridge.revealLibrary();
      if (!result?.ok) setRevealError(result?.error || '无法打开成果文件夹');
    } catch (error) {
      setRevealError(error instanceof Error ? error.message : '无法打开成果文件夹');
    } finally {
      setRevealing(false);
    }
  };

  // z-10000 必须严格高于应用内最高层（ImageEditorModal 与 ToastStack 都是 9999）。
  // 同级时只靠 DOM 顺序取胜，太脆弱——锁不该依赖渲染次序。
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={blocked ? '设备已被停用' : '试用已结束'}
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div className="mx-4 w-full max-w-md rounded-2xl border border-neutral-700 bg-[#141414] p-6 text-neutral-100 shadow-2xl">
        <h2 className="text-lg font-semibold">
          {blocked ? '该设备已被停用' : '试用已结束'}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-400">
          {blocked
            ? '当前设备的授权已被停用，画布已锁定。如有疑问请联系我们处理。'
            : '试用期已经用完，画布已锁定，暂时无法新建、编辑或生成。'}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-emerald-400">
          你已经生成的所有成果都完整保留在本机，随时可以取走。
        </p>

        <div className="mt-5 space-y-2">
          {!blocked && (
            <button
              type="button"
              onClick={onActivate}
              className="w-full rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500"
            >
              输入授权码解锁
            </button>
          )}
          <button
            type="button"
            disabled={revealing}
            onClick={() => void openResults()}
            className="w-full rounded-xl border border-neutral-600 px-4 py-2.5 text-sm font-medium text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
          >
            {revealing ? '正在打开…' : '打开成果文件夹'}
          </button>
        </div>

        {revealError && (
          <p className="mt-3 text-xs leading-relaxed text-amber-400">{revealError}</p>
        )}
      </div>
    </div>
  );
};

export default CanvasLockOverlay;
