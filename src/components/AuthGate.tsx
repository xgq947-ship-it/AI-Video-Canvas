import React, { useState } from 'react';
import { useAuth, useLoginEnabled } from '../hooks/useAuth';
import { useLicense } from '../hooks/useLicense';
import { LoginPage } from './LoginPage';
import { TrialBanner } from './TrialBanner';
import { LicenseDialog } from './LicenseDialog';

/**
 * 登录门。仅当主进程的 GOOGLE_LOGIN_ENABLED 为开时生效（经 useLoginEnabled 问主进程，
 * 不用构建期 VITE_ 常量——见该 hook 顶部注释，两套独立开关会互相锁死）；未启用时
 * 完全透明，保证现有用户升级后行为不变、也不影响 web 预览。
 *
 * 放在入口包住整个 App，避免改动 183KB 的 App.tsx；未登录时不挂载 App，
 * 顺带把后端请求推迟到登录之后。
 */
const APP_VERSION = import.meta.env.VITE_APP_VERSION as string | undefined;

export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const loginEnabled = useLoginEnabled();
  const { state, signIn } = useAuth();
  const { state: license, activate } = useLicense();
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [showLicenseDialog, setShowLicenseDialog] = useState(false);

  // 尚未问到主进程开关状态：不假设任何一边，先不渲染，避免任何一个方向的闪烁。
  // 这是主进程已经启动、preload 桥已就绪之后的一次本地 IPC 往返，通常几毫秒内完成。
  if (loginEnabled === null) return null;

  if (!loginEnabled) return <>{children}</>;

  // 已登录，或有本地会话但暂时离线（文档 §3.1：网络不可用仍可进入）→ 放行，并叠加试用提示条。
  if (state.status === 'authenticated' || state.status === 'offline') {
    return (
      <>
        {children}
        <TrialBanner state={license} onActivate={() => setShowLicenseDialog(true)} />
        {showLicenseDialog ? (
          <LicenseDialog onActivate={activate} onClose={() => setShowLicenseDialog(false)} />
        ) : null}
      </>
    );
  }

  return (
    <LoginPage
      status={state.status}
      error={state.error}
      keepSignedIn={keepSignedIn}
      onToggleKeepSignedIn={setKeepSignedIn}
      onSignIn={signIn}
      appVersion={APP_VERSION}
    />
  );
};

export default AuthGate;
