import { app, shell } from 'electron';
import updaterPackage from 'electron-updater';

const { autoUpdater } = updaterPackage;

export const RELEASES_PAGE_URL = 'https://github.com/xgq947-ship-it/AI-Video-Canvas/releases/latest';

/**
 * 能否在应用内直接装更新。
 *
 * macOS 的安装步骤走原生 Squirrel.Mac，它会校验运行中应用的代码签名。我们的 mac
 * 包是未签名的（CI 里 CSC_IDENTITY_AUTO_DISCOVERY=false），所以下载能成功、安装
 * 必定失败。因此 mac 上只做「检查 + 跳转 GitHub 下载页」，绝不调用
 * downloadUpdate() / quitAndInstall()。
 *
 * 检查这一步是安全的：electron-updater 的 checkForUpdates() 只是用 HTTP 拉
 * latest-mac.yml 比版本号（MacUpdater 要到 doDownloadUpdate 才会碰原生 updater），
 * 未签名的包一样能检查。
 */
export const supportsInAppInstall = () => process.platform === 'win32';

/**
 * 更新控制器。
 *
 * 更新源由 electron-builder 的 publish 配置写进 app-update.yml（打包时生成），
 * electron-updater 会自动读取它，不需要任何额外的配置文件。
 */
export function createUpdateController({ getWindow }) {
    let state = {
        // idle | checking | available | downloading | ready | current | error | unsupported
        status: 'idle',
        version: null,
        currentVersion: app.getVersion(),
        percent: 0,
        message: '',
        canInstallInApp: supportsInAppInstall(),
        releasesUrl: RELEASES_PAGE_URL,
        checkedAt: null
    };

    const publish = (patch) => {
        state = { ...state, ...patch };
        const window = getWindow();
        if (window && !window.isDestroyed()) {
            window.webContents.send('desktop:update-status', state);
        }
    };

    if (app.isPackaged) {
        // mac 上永远不自动下载：下载完也装不上，白占用户带宽和磁盘。
        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = supportsInAppInstall();

        autoUpdater.on('checking-for-update', () => publish({ status: 'checking', message: '' }));
        autoUpdater.on('update-available', info => publish({
            status: 'available',
            version: info.version,
            message: '',
            checkedAt: new Date().toISOString()
        }));
        autoUpdater.on('update-not-available', info => publish({
            status: 'current',
            version: info.version,
            message: '',
            checkedAt: new Date().toISOString()
        }));
        autoUpdater.on('download-progress', progress => publish({
            status: 'downloading',
            percent: Math.round(progress.percent || 0)
        }));
        autoUpdater.on('update-downloaded', info => publish({
            status: 'ready',
            version: info.version,
            percent: 100
        }));
        autoUpdater.on('error', error => {
            console.error(`[updates] ${error?.message || error}`);
            publish({ status: 'error', message: error?.message || '更新失败' });
        });
    }

    const check = async ({ silent = false } = {}) => {
        if (!app.isPackaged) {
            // 开发模式没有 app-update.yml，检查必然失败，直接如实说明。
            publish({ status: 'unsupported', message: '开发模式不检查更新' });
            return state;
        }
        try {
            await autoUpdater.checkForUpdates();
        } catch (error) {
            const message = error?.message || '检查更新失败';
            console.error(`[updates] 检查失败：${message}`);
            if (!silent) publish({ status: 'error', message });
        }
        return state;
    };

    const download = async () => {
        if (!supportsInAppInstall()) {
            // 不给 mac 留这条路：装不上的下载只会变成一个更难解释的失败。
            await shell.openExternal(RELEASES_PAGE_URL);
            return state;
        }
        try {
            publish({ status: 'downloading', percent: 0 });
            await autoUpdater.downloadUpdate();
        } catch (error) {
            publish({ status: 'error', message: error?.message || '下载更新失败' });
        }
        return state;
    };

    const install = () => {
        if (!supportsInAppInstall()) {
            void shell.openExternal(RELEASES_PAGE_URL);
            return state;
        }
        // 让当前 IPC 调用先返回，再交给 Squirrel 接管安装。
        setImmediate(() => autoUpdater.quitAndInstall(false, true));
        return state;
    };

    const openDownloadPage = async () => {
        await shell.openExternal(RELEASES_PAGE_URL);
        return state;
    };

    const getState = () => state;

    /** 启动后延迟一次静默检查：有新版就在设置里亮个小红点，不打断用户。 */
    const scheduleStartupCheck = () => {
        if (!app.isPackaged) return;
        const timer = setTimeout(() => { void check({ silent: true }); }, 10_000);
        timer.unref?.();
    };

    return { getState, check, download, install, openDownloadPage, scheduleStartupCheck };
}
