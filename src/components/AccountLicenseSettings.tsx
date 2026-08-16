import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useLicense } from '../hooks/useLicense';
import { useDeviceInfo } from '../hooks/useDeviceInfo';
import { LicenseDialog } from './LicenseDialog';
import { TRIAL_DAYS } from '../../shared/licenseFeatures.js';

export interface AccountLicenseSettingsProps {
  onClose: () => void;
}

function formatDate(ms: number | null): string {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatRemaining(expiresAt: number | null): string {
  if (!expiresAt) return '—';
  const ms = expiresAt - Date.now();
  if (ms <= 0) return '已到期';
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  return days >= 1 ? `${days} 天 ${hours} 小时` : `${hours} 小时`;
}

function maskDeviceId(hash: string | null): string {
  if (!hash || hash.length < 8) return '—';
  return `${hash.slice(0, 4).toUpperCase()}****${hash.slice(-4).toUpperCase()}`;
}

/**
 * 设置页「账号与授权」区块（文档 §14.5）。作为居中弹窗，跟 LicenseDialog 同款
 * 视觉语言。三段：账号（邮箱+退出登录）/ 授权（状态+设备ID+激活入口）/ 隐私说明。
 */
export const AccountLicenseSettings: React.FC<AccountLicenseSettingsProps> = ({ onClose }) => {
  const { state: auth, signOut } = useAuth();
  const { state: license, activate, refresh } = useLicense();
  const { deviceHash } = useDeviceInfo();
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [showActivate, setShowActivate] = useState(false);
  const [revalidating, setRevalidating] = useState(false);

  const handleSignOut = async () => {
    if (!confirmingSignOut) {
      setConfirmingSignOut(true);
      return;
    }
    setSigningOut(true);
    try {
      await signOut();
      onClose();
    } finally {
      setSigningOut(false);
    }
  };

  const handleRevalidate = async () => {
    setRevalidating(true);
    try {
      await refresh();
    } finally {
      setRevalidating(false);
    }
  };

  return (
    <div className="als-overlay" onClick={(e) => e.target === e.currentTarget && onClose()} role="presentation">
      <AccountLicenseSettingsStyles />
      <div className="als-card" role="dialog" aria-modal="true" aria-label="账号与授权">
        <span className="als-seam" aria-hidden="true" />
        <div className="als-header">
          <h2 className="als-title">账号与授权</h2>
          <button type="button" className="als-close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <section className="als-section">
          <h3 className="als-section-title">账号</h3>
          <div className="als-row">
            <span className="als-label">邮箱</span>
            <span className="als-value">{auth.user?.email || '—'}</span>
          </div>
          <div className="als-row">
            <span className="als-label">状态</span>
            <span className="als-value">
              {auth.status === 'authenticated' ? '已登录' : auth.status === 'offline' ? '已登录（离线）' : '—'}
            </span>
          </div>
          <button
            type="button"
            className={`als-btn ${confirmingSignOut ? 'als-btn-danger' : 'als-btn-ghost'}`}
            onClick={handleSignOut}
            disabled={signingOut}
          >
            {signingOut ? '正在退出…' : confirmingSignOut ? '确认退出登录？' : '退出登录'}
          </button>
        </section>

        <section className="als-section">
          <h3 className="als-section-title">授权</h3>
          {license.status === 'licensed' ? (
            <>
              <div className="als-row">
                <span className="als-label">当前设备</span>
                <span className="als-value als-value-good">已永久授权</span>
              </div>
              <div className="als-row">
                <span className="als-label">授权类型</span>
                <span className="als-value">永久版</span>
              </div>
              <div className="als-row">
                <span className="als-label">激活时间</span>
                <span className="als-value">{formatDate(license.licensedAt)}</span>
              </div>
              <div className="als-row">
                <span className="als-label">设备 ID</span>
                <span className="als-value als-mono">{maskDeviceId(deviceHash)}</span>
              </div>
              <button type="button" className="als-btn als-btn-ghost" onClick={handleRevalidate} disabled={revalidating}>
                {revalidating ? '正在验证…' : '重新验证授权'}
              </button>
            </>
          ) : license.status === 'trial' ? (
            <>
              <div className="als-row">
                <span className="als-label">当前设备</span>
                <span className="als-value">{TRIAL_DAYS} 天试用</span>
              </div>
              <div className="als-row">
                <span className="als-label">剩余时间</span>
                <span className="als-value">{formatRemaining(license.trialExpiresAt)}</span>
              </div>
              <button type="button" className="als-btn als-btn-primary" onClick={() => setShowActivate(true)}>
                输入授权码
              </button>
            </>
          ) : license.status === 'expired' ? (
            <>
              <div className="als-row">
                <span className="als-label">当前设备</span>
                <span className="als-value als-value-warn">试用已结束</span>
              </div>
              <button type="button" className="als-btn als-btn-primary" onClick={() => setShowActivate(true)}>
                输入授权码
              </button>
            </>
          ) : license.status === 'blocked' ? (
            <div className="als-row">
              <span className="als-label">当前设备</span>
              <span className="als-value als-value-warn">已被禁用，请联系管理员</span>
            </div>
          ) : (
            <div className="als-row">
              <span className="als-label">当前设备</span>
              <span className="als-value">正在获取授权状态…</span>
            </div>
          )}
        </section>

        <section className="als-section als-section-last">
          <h3 className="als-section-title">隐私</h3>
          <div className="als-row">
            <span className="als-label">画布和素材</span>
            <span className="als-value">仅本地保存</span>
          </div>
          <div className="als-row">
            <span className="als-label">活跃统计</span>
            <span className="als-value">每日最多一次</span>
          </div>
        </section>
      </div>

      {showActivate ? <LicenseDialog onActivate={activate} onClose={() => setShowActivate(false)} /> : null}
    </div>
  );
};

const AccountLicenseSettingsStyles: React.FC = () => (
  <style>{`
.als-overlay{
  position:fixed; inset:0; z-index:9500; display:flex; align-items:center; justify-content:center;
  background:rgba(4,6,10,0.6); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
  animation:als-fade .18s ease both;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","PingFang SC","Helvetica Neue",system-ui,sans-serif;
}
@keyframes als-fade{from{opacity:0}to{opacity:1}}

.als-card{
  position:relative; width:min(90vw,400px); max-height:85vh; overflow-y:auto; padding:24px 26px 22px;
  background:rgba(18,22,31,0.9); border:1px solid rgba(255,255,255,0.09); border-radius:18px;
  backdrop-filter:blur(22px) saturate(120%); -webkit-backdrop-filter:blur(22px) saturate(120%);
  box-shadow:0 30px 80px -24px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.05);
  color:#F3F5FA; animation:als-pop .22s cubic-bezier(.2,.8,.2,1) both;
}
@keyframes als-pop{from{opacity:0;transform:scale(0.96) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}
.als-seam{ position:absolute; top:-1px; left:20%; right:20%; height:1px;
  background:linear-gradient(90deg,transparent,rgba(231,192,139,0.6),transparent); }

.als-header{ display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; }
.als-title{ margin:0; font-size:16px; font-weight:500; color:#FAFBFF; }
.als-close{ width:26px; height:26px; border-radius:8px; border:none; background:rgba(255,255,255,0.06);
  color:#98A2B3; cursor:pointer; font-size:12px; display:flex; align-items:center; justify-content:center;
  transition:background .15s ease; }
.als-close:hover{ background:rgba(255,255,255,0.12); }

.als-section{ padding:14px 0; border-top:1px solid rgba(255,255,255,0.07); }
.als-section:first-of-type{ border-top:none; padding-top:0; }
.als-section-last{ padding-bottom:0; }
.als-section-title{ margin:0 0 10px; font-size:11px; font-weight:600; letter-spacing:0.08em;
  text-transform:uppercase; color:#6B7482; }

.als-row{ display:flex; align-items:center; justify-content:space-between; gap:12px; padding:5px 0; font-size:13px; }
.als-label{ color:#8B93A1; }
.als-value{ color:#E8ECF4; font-weight:500; text-align:right; }
.als-value-good{ color:#8FD9B6; }
.als-value-warn{ color:#F1B4A0; }
.als-mono{ font-variant-numeric:tabular-nums; letter-spacing:0.03em; font-size:12px; }

.als-btn{ margin-top:10px; width:100%; height:38px; border-radius:10px; font-size:13px; font-weight:500;
  cursor:pointer; border:none; transition:filter .15s ease, background .15s ease, transform .15s ease; }
.als-btn:disabled{ opacity:0.5; cursor:default; }
.als-btn-ghost{ background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); color:#C7CDD8; }
.als-btn-ghost:hover:not(:disabled){ background:rgba(255,255,255,0.1); }
.als-btn-primary{ background:linear-gradient(180deg,#F1D6A6,#E7C08B); color:#1a1206; }
.als-btn-primary:hover:not(:disabled){ filter:brightness(1.05); transform:translateY(-0.5px); }
.als-btn-danger{ background:rgba(240,120,96,0.15); border:1px solid rgba(240,120,96,0.4); color:#F6B4A2; }
.als-btn-danger:hover:not(:disabled){ background:rgba(240,120,96,0.22); }
.als-btn:focus-visible{ outline:none; box-shadow:0 0 0 2px #0B0E14, 0 0 0 4px #E7C08B; }

@media (prefers-reduced-motion:reduce){ .als-overlay,.als-card{ animation:none !important; } }
`}</style>
);

export default AccountLicenseSettings;
