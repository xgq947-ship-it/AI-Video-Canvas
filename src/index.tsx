import './index.css';
import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { LoginPage } from './components/LoginPage';
import { AuthGate } from './components/AuthGate';
import { TrialBanner } from './components/TrialBanner';
import { LockedNodeOverlay } from './components/LockedNodeOverlay';
import { LicenseDialog } from './components/LicenseDialog';
import { AccountLicenseSettings } from './components/AccountLicenseSettings';
import type { LicenseState, ActivateResult } from './hooks/useLicense';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

// 开发期可用 ?preview=login 单独预览登录页，无需启动后端。
const previewTarget = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('preview')
  : null;

const LoginPreview: React.FC = () => {
  const [keep, setKeep] = useState(true);
  const [status, setStatus] = useState<'login_required' | 'authenticating' | 'error'>('login_required');
  return (
    <LoginPage
      status={status}
      error={status === 'error' ? '网络连接失败，请稍后重试' : null}
      keepSignedIn={keep}
      onToggleKeepSignedIn={setKeep}
      onSignIn={() => {
        setStatus('authenticating');
        setTimeout(() => setStatus('login_required'), 6000);
      }}
      appVersion={'0.2.15'}
    />
  );
};

const day = 86_400_000;
const mkLicense = (over: Partial<LicenseState>): LicenseState => ({
  status: 'trial',
  trialStartedAt: Date.now(),
  trialExpiresAt: Date.now() + 5 * day,
  licensedAt: null,
  features: ['director_workflow'],
  stale: false,
  ...over,
});

const BannerPreview: React.FC = () => (
  <div
    className="banner-preview"
    style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 20,
      background: 'radial-gradient(120% 90% at 50% -10%, #121826, #0B0E14 42%, #06080D)',
    }}
  >
    {/* 预览下取消 TrialBanner 的 fixed 定位，改为纵向排开对比四档 */}
    <style>{`.banner-preview .tb-wrap{ position:static; transform:none; }`}</style>
    <TrialBanner state={mkLicense({ trialExpiresAt: Date.now() + 5 * day })} onActivate={() => {}} />
    <TrialBanner state={mkLicense({ trialExpiresAt: Date.now() + 3 * day })} onActivate={() => {}} />
    <TrialBanner state={mkLicense({ trialExpiresAt: Date.now() + 1 * day - 1000 })} onActivate={() => {}} />
    <TrialBanner state={mkLicense({ status: 'expired', trialExpiresAt: Date.now() - day })} onActivate={() => {}} />
  </div>
);

const LockedNodePreview: React.FC = () => (
  <div
    style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 24,
      background: 'radial-gradient(120% 90% at 50% -10%, #121826, #0B0E14 42%, #06080D)',
      padding: 40,
    }}
  >
    {/* 模拟节点卡片宽度（CINEMATIC_NODE_WIDTH=430），对比深/浅两种主题 */}
    <div style={{ width: 350, borderRadius: 16, background: '#15181f', border: '1px solid rgba(255,255,255,0.08)', padding: 16 }}>
      <LockedNodeOverlay dark />
    </div>
    <div style={{ width: 350, borderRadius: 16, background: '#f5f5f5', border: '1px solid rgba(0,0,0,0.08)', padding: 16 }}>
      <LockedNodeOverlay dark={false} />
    </div>
  </div>
);

// 模拟激活：以 OK 开头 → 成功；以 BAD 开头 → LICENSE_INVALID；其余 → LICENSE_ALREADY_USED。
// 真实带一点延迟，方便观察 activating 态。
const LicenseDialogPreview: React.FC = () => {
  const [open, setOpen] = useState(true);
  const onActivate = async (code: string): Promise<ActivateResult> => {
    await new Promise((r) => setTimeout(r, 900));
    if (code.startsWith('OK')) return { success: true };
    if (code.startsWith('BAD')) return { success: false, code: 'LICENSE_INVALID' };
    return { success: false, code: 'LICENSE_ALREADY_USED' };
  };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(120% 90% at 50% -10%, #121826, #0B0E14 42%, #06080D)' }}>
      {open ? (
        <LicenseDialog onActivate={onActivate} onClose={() => setOpen(false)} />
      ) : (
        <button style={{ margin: 40 }} onClick={() => setOpen(true)}>
          重新打开
        </button>
      )}
    </div>
  );
};

// ?preview=account&status=trial|licensed|expired —— 挂一个假的 evanDesktop 桥
// 让 AccountLicenseSettings 能在纯浏览器预览下渲染。同步赋值（不用 useEffect）：
// 子组件的 effect 先于父组件执行，异步设置会有一次读到 undefined 的时序问题。
if (previewTarget === 'account') {
  const statusParam = (new URLSearchParams(window.location.search).get('status') || 'trial') as
    | 'trial'
    | 'licensed'
    | 'expired';
  const previewLicenseState: LicenseState =
    statusParam === 'licensed'
      ? { status: 'licensed', trialStartedAt: null, trialExpiresAt: null, licensedAt: Date.now() - 10 * day, features: ['director_workflow'], stale: false }
      : mkLicense({ status: statusParam, trialExpiresAt: statusParam === 'expired' ? Date.now() - day : Date.now() + 5 * day });

  (window as unknown as { evanDesktop: unknown }).evanDesktop = {
    auth: {
      getConfig: async () => ({ loginEnabled: true }),
      getState: async () => ({ status: 'authenticated', user: { id: 'demo', email: 'demo@example.com', display_name: 'Demo User' }, error: null }),
      signIn: async () => ({ status: 'authenticated', user: null, error: null }),
      signOut: async () => ({ status: 'login_required', user: null, error: null }),
      onState: () => () => {},
    },
    license: {
      getState: async () => previewLicenseState,
      refresh: async () => previewLicenseState,
      activate: async () => ({ success: true }),
      onState: () => () => {},
    },
    device: {
      getInfo: async () => ({ deviceHash: 'a1b2c3d4e5f60000000000000000000000000000000000000000000090ab' }),
    },
  };
}

const AccountPreview: React.FC = () => (
  <div style={{ position: 'fixed', inset: 0, background: 'radial-gradient(120% 90% at 50% -10%, #121826, #0B0E14 42%, #06080D)' }}>
    <AccountLicenseSettings onClose={() => {}} />
  </div>
);

root.render(
  previewTarget === 'account' ? (
    <AccountPreview />
  ) : previewTarget === 'login' ? (
    <LoginPreview />
  ) : previewTarget === 'banner' ? (
    <BannerPreview />
  ) : previewTarget === 'locked' ? (
    <LockedNodePreview />
  ) : previewTarget === 'license' ? (
    <LicenseDialogPreview />
  ) : (
    <React.StrictMode>
      <AuthGate>
        <App />
      </AuthGate>
    </React.StrictMode>
  )
);
