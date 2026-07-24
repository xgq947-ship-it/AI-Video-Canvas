import { app } from 'electron';
import updaterPackage from 'electron-updater';
import fs from 'node:fs';
import path from 'node:path';

const { autoUpdater } = updaterPackage;

function configuredUpdateUrl() {
    const environmentUrl = String(process.env.EVAN_UPDATE_URL || '').trim();
    if (environmentUrl) return environmentUrl;

    const configPath = path.join(process.resourcesPath, 'update-config.json');
    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return String(config.url || '').trim();
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.warn(`[updates] 无法读取 ${configPath}: ${error.message}`);
        }
        return '';
    }
}

/**
 * Enable signed in-place updates when a release feed has been configured.
 *
 * Development builds and unconfigured private builds stay offline. Production
 * packaging writes update-config.json (or injects EVAN_UPDATE_URL), while user
 * projects, browser profiles and task state remain outside the app bundle.
 */
export function configureAutoUpdates(window) {
    if (!app.isPackaged) return { enabled: false, reason: 'development' };
    const url = configuredUpdateUrl();
    if (!url) {
        console.warn('[updates] 未配置更新源，跳过自动更新检查');
        return { enabled: false, reason: 'not_configured' };
    }

    autoUpdater.setFeedURL({ provider: 'generic', url });
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    const sendStatus = (state, detail = {}) => {
        if (!window.isDestroyed()) {
            window.webContents.send('desktop:update-status', { state, ...detail });
        }
    };
    autoUpdater.on('checking-for-update', () => sendStatus('checking'));
    autoUpdater.on('update-available', info => sendStatus('available', { version: info.version }));
    autoUpdater.on('update-not-available', info => sendStatus('current', { version: info.version }));
    autoUpdater.on('download-progress', progress => {
        sendStatus('downloading', { percent: Math.round(progress.percent) });
    });
    autoUpdater.on('update-downloaded', info => sendStatus('ready', { version: info.version }));
    autoUpdater.on('error', error => {
        console.error(`[updates] ${error.message}`);
        sendStatus('error', { message: error.message });
    });

    setTimeout(() => {
        void autoUpdater.checkForUpdates().catch(error => {
            console.error(`[updates] 检查失败：${error.message}`);
        });
    }, 10_000).unref();
    return { enabled: true, url };
}
