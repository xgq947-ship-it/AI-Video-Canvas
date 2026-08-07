import React, { useEffect, useState } from 'react';
import type { LicenseState } from '../hooks/useLicense';

export interface TrialBannerProps {
  state: LicenseState;
  /** 打开授权码激活弹窗（P4 接入前可不传，届时按钮隐藏）。 */
  onActivate?: () => void;
}

type Tone = 'neutral' | 'amber' | 'orange' | 'red';

function toneFor(days: number, expired: boolean): Tone {
  if (expired) return 'red';
  if (days <= 1) return 'orange';
  if (days <= 3) return 'amber';
  return 'neutral';
}

/**
 * 顶部试用状态提示。刻意做成居中悬浮胶囊，避开既有 TopBar 的左右两簇，
 * 不侵入 App.tsx。仅在 trial/expired 时出现；licensed/unknown/blocked 隐藏。
 * 颜色随剩余时间升级（文档 §14.2）。不反复弹窗。
 */
export const TrialBanner: React.FC<TrialBannerProps> = ({ state, onActivate }) => {
  const [, tick] = useState(0);

  // 每分钟刷新一次倒计时文案。
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  if (state.status !== 'trial' && state.status !== 'expired') return null;

  const now = Date.now();
  const remainMs = (state.trialExpiresAt ?? 0) - now;
  const expired = state.status === 'expired' || remainMs <= 0;
  const days = Math.max(0, Math.floor(remainMs / 86_400_000));
  const hours = Math.max(0, Math.floor((remainMs % 86_400_000) / 3_600_000));
  const tone = toneFor(days, expired);

  const label = expired
    ? '试用已结束 · 高级节点已锁定'
    : days >= 1
      ? `试用期还剩 ${days} 天`
      : `试用期还剩 ${hours} 小时`;

  return (
    <div className="tb-wrap" data-tone={tone} role="status" aria-live="polite">
      <TrialBannerStyles />
      <div className="tb-pill">
        <span className="tb-dot" aria-hidden="true" />
        <span className="tb-label">{label}</span>
        {onActivate ? (
          <button type="button" className="tb-cta" onClick={onActivate}>
            输入授权码
          </button>
        ) : null}
      </div>
    </div>
  );
};

const TrialBannerStyles: React.FC = () => (
  <style>{`
.tb-wrap{ position:fixed; top:11px; left:50%; transform:translateX(-50%); z-index:60;
  pointer-events:none; font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",system-ui,sans-serif; }
.tb-pill{ pointer-events:auto; display:flex; align-items:center; gap:9px; height:32px; padding:0 6px 0 13px;
  border-radius:999px; background:rgba(16,19,27,0.72); border:1px solid rgba(255,255,255,0.09);
  backdrop-filter:blur(18px) saturate(120%); -webkit-backdrop-filter:blur(18px) saturate(120%);
  box-shadow:0 10px 30px -12px rgba(0,0,0,0.65); color:#E8ECF4; font-size:12.5px; letter-spacing:0.02em;
  animation:tb-in .5s ease both; }
@keyframes tb-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
.tb-dot{ width:6px; height:6px; border-radius:50%; }
.tb-label{ line-height:1; white-space:nowrap; }
.tb-cta{ pointer-events:auto; margin-left:2px; height:24px; padding:0 12px; border-radius:999px; cursor:pointer;
  font-size:12px; font-weight:500; letter-spacing:0.02em; color:#12141b; border:none;
  background:linear-gradient(180deg,#F1D6A6,#E7C08B); transition:filter .15s ease, transform .15s ease; }
.tb-cta:hover{ filter:brightness(1.05); transform:translateY(-0.5px); }
.tb-cta:focus-visible{ outline:none; box-shadow:0 0 0 2px #0B0E14, 0 0 0 4px #E7C08B; }

/* 颜色随紧迫度升级 */
.tb-wrap[data-tone="neutral"] .tb-dot{ background:#9AA3B2; box-shadow:0 0 8px 1px rgba(154,163,178,0.35); }
.tb-wrap[data-tone="neutral"] .tb-label{ color:#B7BECC; }
.tb-wrap[data-tone="amber"] .tb-dot{ background:#F2C265; box-shadow:0 0 9px 1px rgba(242,194,101,0.5); }
.tb-wrap[data-tone="amber"] .tb-label{ color:#F1D9A6; }
.tb-wrap[data-tone="orange"] .tb-dot{ background:#F59E5B; box-shadow:0 0 10px 1px rgba(245,158,91,0.55); }
.tb-wrap[data-tone="orange"] .tb-label{ color:#F7C79A; }
.tb-wrap[data-tone="red"]{ }
.tb-wrap[data-tone="red"] .tb-pill{ border-color:rgba(240,120,96,0.4); }
.tb-wrap[data-tone="red"] .tb-dot{ background:#F0785F; box-shadow:0 0 11px 1px rgba(240,120,96,0.6); }
.tb-wrap[data-tone="red"] .tb-label{ color:#F6B4A2; }

@media (prefers-reduced-motion:reduce){ .tb-pill{ animation:none; } }
`}</style>
);

export default TrialBanner;
