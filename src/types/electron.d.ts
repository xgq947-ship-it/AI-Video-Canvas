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

export interface UninstallPlan {
  /** 只有 macOS 打包版能自己卸载自己；其余平台给系统卸载入口的指引。 */
  supported: boolean;
  hint?: string;
  targets: { path: string; label: string }[];
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
      selectLocalProject: () => Promise<
        | { canceled: true }
        | { canceled: false; importId: string; name: string }
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
      importLocalProject: (importId: string) => Promise<{
        id: string;
        title: string;
        projectDirName?: string;
        nodes: unknown[];
        groups: unknown[];
        viewport: { x: number; y: number; zoom: number };
      }>;
      revealProject: (workflowId: string) => Promise<{ ok: true; path: string }>;
      /** 打开本机成果文件夹。试用锁死后取回已生成结果的出口，失败不抛异常。 */
      revealLibrary: () => Promise<{ ok: boolean; path?: string; error?: string }>;
      exportDetailRemix: (input: {
        jobId: string;
        workflowId: string;
        /** Also export quality-failed candidates, named with a 待确认 marker. */
        includeCandidates?: boolean;
      }) => Promise<
        | { canceled: true }
        | {
          canceled: false;
          count: number;
          candidateCount?: number;
          destination: string;
          filenames: string[];
        }
      >;
      getAppInfo: () => Promise<AppInfo>;
      uninstall: {
        plan: (keepUserData: boolean) => Promise<UninstallPlan>;
        run: (keepUserData: boolean) => Promise<
          | { ok: true }
          | { ok: false; canceled?: boolean; error?: string }
        >;
      };
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
