import { app, BrowserWindow, dialog, ipcMain, utilityProcess } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureAutoUpdates } from './updater.js';

const ELECTRON_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(ELECTRON_DIR, '..');

let mainWindow = null;
let backendProcess = null;
let backendOrigin = null;
let shuttingDown = false;
const desktopApiToken = randomUUID();
const selectedProjectLocations = new Map();

app.setName('Evan AI Video Canvas');
const hasSingleInstanceLock = app.requestSingleInstanceLock();

const LOADING_PAGE = `data:text/html;charset=utf-8,${encodeURIComponent(`
<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<title>Evan AI Video Canvas</title>
<style>
    html, body { height: 100%; margin: 0; }
    body {
        display: grid;
        place-items: center;
        color: #e9e9ee;
        background: #111217;
        font: 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main { text-align: center; }
    h1 { margin: 0 0 12px; font-size: 24px; font-weight: 650; }
    p { margin: 0; color: #9b9da8; }
</style>
<main>
    <h1>Evan AI Video Canvas</h1>
    <p>正在启动本地后端，请稍候…</p>
</main>
</html>
`)}`;

function runtimeEnvironment() {
    const resourcesDir = app.isPackaged ? app.getAppPath() : PROJECT_ROOT;
    const dataDir = path.join(app.getPath('userData'), 'data');
    const mediaToolsDir = app.isPackaged
        ? path.join(process.resourcesPath, 'media-tools')
        : path.join(PROJECT_ROOT, 'node_modules', 'ffmpeg-ffprobe-static');
    return {
        ...process.env,
        NODE_ENV: app.isPackaged ? 'production' : (process.env.NODE_ENV || 'development'),
        HOST: '127.0.0.1',
        PORT: '0',
        EVAN_RESOURCES_DIR: resourcesDir,
        EVAN_DATA_DIR: dataDir,
        EVAN_LOGS_DIR: path.join(dataDir, 'logs'),
        EVAN_RUNTIME_DIR: path.join(dataDir, 'runtime'),
        EVAN_BROWSER_PROFILE_DIR: path.join(dataDir, 'browser-profile'),
        EVAN_FFMPEG_PATH: path.join(
            mediaToolsDir,
            process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
        ),
        EVAN_FFPROBE_PATH: path.join(
            mediaToolsDir,
            process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
        ),
        EVAN_DESKTOP: '1',
        EVAN_ELECTRON_EXECUTABLE: process.execPath,
        EVAN_ELECTRON_RUN_AS_NODE: '1',
        SESSIONHUB_CDP_PORT: '19222',
        PLAYWRIGHT_BROWSERS_PATH: app.isPackaged
            ? path.join(process.resourcesPath, 'playwright-browsers')
            : path.join(PROJECT_ROOT, 'server', 'python', '.browsers'),
        EVAN_OPS_EXECUTABLE: app.isPackaged
            ? path.join(
                process.resourcesPath,
                'runtime',
                'ops-cli',
                process.platform === 'win32' ? 'evan-ops-cli.exe' : 'evan-ops-cli'
            )
            : '',
        EVAN_DESKTOP_TOKEN: desktopApiToken,
        EVAN_PYTHON_ROOT: app.isPackaged
            ? path.join(process.resourcesPath, 'app.asar.unpacked', 'server', 'python')
            : path.join(PROJECT_ROOT, 'server', 'python')
    };
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 960,
        minWidth: 1080,
        minHeight: 720,
        show: true,
        backgroundColor: '#111111',
        title: 'Evan AI Video Canvas',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            preload: path.join(ELECTRON_DIR, 'preload.cjs')
        }
    });
    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
        mainWindow?.focus();
    });
    mainWindow.on('closed', () => { mainWindow = null; });
    mainWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
        if (!isMainFrame || url === LOADING_PAGE) return;
        dialog.showErrorBox(
            'Evan 页面加载失败',
            `无法打开本地页面（${code}: ${description}）。\n${url}`
        );
    });
    void mainWindow.loadURL(backendOrigin || LOADING_PAGE);
    return mainWindow;
}

function pruneExpiredProjectLocations() {
    const now = Date.now();
    for (const [id, location] of selectedProjectLocations) {
        if (now - location.selectedAt > 30 * 60 * 1000) {
            selectedProjectLocations.delete(id);
        }
    }
}

ipcMain.handle('project:select-location', async () => {
    pruneExpiredProjectLocations();
    const options = {
        title: '选择项目存放位置',
        buttonLabel: '选择此文件夹',
        defaultPath: app.getPath('desktop'),
        properties: ['openDirectory', 'createDirectory']
    };
    const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return { canceled: true };

    const locationId = randomUUID();
    const selectedPath = path.resolve(result.filePaths[0]);
    selectedProjectLocations.set(locationId, {
        path: selectedPath,
        selectedAt: Date.now()
    });
    return {
        canceled: false,
        locationId,
        path: selectedPath
    };
});

ipcMain.handle('project:create', async (_event, { title, locationId } = {}) => {
    try {
        if (!backendOrigin) return { ok: false, error: '本地后端尚未启动，请稍后重试' };
        pruneExpiredProjectLocations();

        const location = locationId ? selectedProjectLocations.get(locationId) : null;
        if (locationId && !location) {
            return { ok: false, error: '所选项目位置已失效，请重新选择文件夹' };
        }

        const response = await fetch(`${backendOrigin}/api/projects`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Evan-Desktop-Token': desktopApiToken
            },
            body: JSON.stringify({
                title,
                parentDirectory: location?.path || null
            })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) return { ok: false, error: data.error || '项目创建失败' };
        if (locationId) selectedProjectLocations.delete(locationId);
        return { ok: true, data };
    } catch (error) {
        return { ok: false, error: error.message || '项目创建失败' };
    }
});

ipcMain.handle('codex:select-cli', async () => {
    const options = {
        title: '选择 Codex CLI',
        buttonLabel: '选择此文件',
        properties: ['openFile'],
        filters: process.platform === 'win32'
            ? [{ name: 'Codex CLI', extensions: ['exe', 'cmd', 'bat'] }]
            : []
    };
    const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return { canceled: false, path: path.resolve(result.filePaths[0]) };
});

function startBackend() {
    const entryPath = path.join(
        app.isPackaged ? app.getAppPath() : PROJECT_ROOT,
        'server',
        'desktop-entry.js'
    );
    backendProcess = utilityProcess.fork(entryPath, [], {
        env: runtimeEnvironment(),
        serviceName: 'Evan Backend',
        stdio: 'pipe'
    });

    backendProcess.stdout?.on('data', chunk => process.stdout.write(chunk));
    backendProcess.stderr?.on('data', chunk => process.stderr.write(chunk));
    backendProcess.on('exit', code => {
        backendProcess = null;
        if (!shuttingDown && code !== 0) {
            dialog.showErrorBox('Evan 后端已停止', `本地后端异常退出（代码 ${code}）。`);
        }
    });
    return backendProcess;
}

if (!hasSingleInstanceLock) {
    // Another Evan process owns the project/profile. Electron notifies that
    // process through `second-instance`; this process must exit before it can
    // create a second window or local backend.
    app.quit();
} else {
    app.on('second-instance', () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        app.focus({ steal: true });
    });

    app.whenReady().then(() => {
        const window = createWindow();
        app.focus({ steal: true });
        const backend = startBackend();
        backend.on('message', message => {
            if (message?.type !== 'backend-ready') return;
            backendOrigin = message.origin;
            void window.loadURL(message.origin).then(() => {
                window.show();
                window.focus();
                app.focus({ steal: true });
                configureAutoUpdates(window);
            }).catch(error => {
                dialog.showErrorBox('Evan 启动失败', `本地页面无法加载：${error.message}`);
            });
        });

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0 && mainWindow === null) {
                createWindow();
            }
        });
    });

    app.on('before-quit', event => {
        if (!backendProcess || shuttingDown) return;
        event.preventDefault();
        shuttingDown = true;
        backendProcess.postMessage({ type: 'shutdown' });
        setTimeout(() => app.quit(), 5_500).unref();
        backendProcess.once('exit', () => app.quit());
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit();
    });
}
