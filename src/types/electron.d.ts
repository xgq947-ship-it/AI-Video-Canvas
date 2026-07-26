export {};

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'current'
  | 'error'
  | 'unsupported';

export interface UpdateState {
  status: UpdateStatus;
  version: string | null;
  currentVersion: string;
  percent: number;
  message: string;
  /** Windows 可以应用内安装；macOS 未签名，只能跳转下载页。 */
  canInstallInApp: boolean;
  releasesUrl: string;
  checkedAt: string | null;
}

export interface AppInfo {
  version: string;
  platform: string;
  arch: string;
  isPackaged: boolean;
}

declare global {
  interface Window {
    evanDesktop?: {
      selectProjectLocation: () => Promise<
        | { canceled: true }
        | { canceled: false; locationId: string; path: string }
      >;
      selectCodexCli: () => Promise<
        | { canceled: true }
        | { canceled: false; path: string }
      >;
      openExternal: (url: string) => Promise<void>;
      createProject: (input: {
        title: string;
        locationId?: string | null;
      }) => Promise<{
        id: string;
        title: string;
        projectDirName?: string;
        projectPath?: string;
        nodes: unknown[];
        groups: unknown[];
        viewport: { x: number; y: number; zoom: number };
      }>;
      getAppInfo: () => Promise<AppInfo>;
      chrome: {
        getStatus: () => Promise<ChromeRuntimeStatus>;
        openDownload: () => Promise<{ ok: boolean }>;
        retry: () => Promise<ChromeRuntimeStatus>;
      };
      updates: {
        getState: () => Promise<UpdateState>;
        check: () => Promise<UpdateState>;
        download: () => Promise<UpdateState>;
        install: () => Promise<UpdateState>;
        openDownloadPage: () => Promise<UpdateState>;
        /** 返回取消订阅函数。 */
        onStatus: (callback: (state: UpdateState) => void) => () => void;
      };
    };
  }
}

export interface ChromeRuntimeStatus {
  ready: boolean;
  executable: string;
  version: string | null;
  major: number | null;
  reason: string | null;
  message: string;
  downloadUrl: string;
}
