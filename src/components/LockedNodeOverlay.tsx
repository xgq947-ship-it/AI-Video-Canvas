import React from 'react';
import { Lock } from 'lucide-react';
import { TRIAL_DAYS } from '../../shared/licenseFeatures.js';

export interface LockedNodeOverlayProps {
  dark?: boolean;
  /** 默认文案对应文档 §14.4 的锁定态；仅在需要区分场景时覆盖。 */
  title?: string;
}

/**
 * 节点内「执行」类按钮的锁定态替换（文档 §14.4）。取代的是单个动作按钮，
 * 不是整个节点——节点其余部分（查看配置、历史结果等）保持可用，符合文档
 * 明确允许的"到期后仍可查看/移动/删除/导出"。
 *
 * 目前没有接"输入授权码"按钮：授权码激活弹窗（P4）还没做，这里放一个会话式
 * 死按钮不如不放。顶部 TrialBanner 是激活入口就位后统一挂载 CTA 的地方。
 */
export const LockedNodeOverlay: React.FC<LockedNodeOverlayProps> = ({ dark = true, title = `${TRIAL_DAYS} 天试用已结束` }) => (
  <div
    className={`flex w-full flex-col items-center gap-1 rounded-xl border px-3 py-3 text-center text-[10px] ${
      dark ? 'border-amber-400/25 bg-amber-400/[0.06] text-amber-200' : 'border-amber-300 bg-amber-50 text-amber-700'
    }`}
  >
    <Lock size={14} />
    <span className="font-medium">{title}</span>
    <span className={dark ? 'text-neutral-500' : 'text-neutral-400'}>在顶部提示条输入授权码后可继续使用</span>
  </div>
);

export default LockedNodeOverlay;
