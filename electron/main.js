import { app, BrowserWindow, dialog, ipcMain, shell, utilityProcess } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUpdateController } from './updater.js';
import { resolveUninstallTargets } from './uninstall.js';
import { revealProjectById } from './projectReveal.js';
import {
    browserHubPayloadPath,
    ensureBrowserHubRuntime,
    sharedBrowserHubHome
} from './browserHub.js';
import {
    CHROME_DOWNLOAD_URL,
    getChromeCompatibility
} from '../server/runtime/browserExecutable.js';

const ELECTRON_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(ELECTRON_DIR, '..');

let mainWindow = null;
let backendProcess = null;
let backendOrigin = null;
let shuttingDown = false;
let backendRestartTimer = null;
let backendCrashTimes = [];
let updateStartupCheckScheduled = false;
const updates = createUpdateController({ getWindow: () => mainWindow });
const BACKEND_RESTART_LIMIT = 3;
const BACKEND_RESTART_WINDOW_MS = 60_000;
const BACKEND_RESTART_DELAY_MS = 750;
const desktopApiToken = randomUUID();
const selectedProjectLocations = new Map();
const ALLOWED_EXTERNAL_HOSTS = new Set([
    'platform.deepseek.com'
]);

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

function chromeRequiredPage(status) {
    const message = status?.message || '未找到兼容的 Google Chrome。';
    return `data:text/html;charset=utf-8,${encodeURIComponent(`
<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<title>Evan 需要 Google Chrome</title>
<style>
    html, body { height: 100%; margin: 0; }
    body { display: grid; place-items: center; color: #f5f5f7; background: #101116; font: 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(560px, calc(100vw - 64px)); padding: 42px; border: 1px solid #2d3140; border-radius: 26px; background: #181b23; box-shadow: 0 32px 100px rgba(0,0,0,.45); }
    h1 { margin: 0 0 14px; font-size: 26px; }
    p { margin: 0; color: #b8bdc9; line-height: 1.75; }
    .reason { margin-top: 16px; color: #ffbd9d; }
    .actions { display: flex; gap: 12px; margin-top: 28px; }
    button { border: 0; border-radius: 12px; padding: 12px 18px; font: inherit; font-weight: 650; cursor: pointer; }
    #download { color: white; background: #1478ff; }
    #retry { color: #e7e9ef; background: #303543; }
    #status { min-height: 24px; margin-top: 18px; font-size: 13px; }
</style>
<main>
    <h1>需要安装 Google Chrome</h1>
    <p>Evan 使用电脑上的 Google Chrome 接入系统共享的 AI 浏览器，用于 Flow、即梦和本地成片渲染。不会读取或影响你的日常 Chrome 登录资料。</p>
    <p class="reason">${message.replace(/[<>&]/g, '')}</p>
    <div class="actions">
        <button id="download">下载 Google Chrome</button>
        <button id="retry">安装完成，重新检测</button>
    </div>
    <p id="status"></p>
</main>
<script>
    const status = document.getElementById('status');
    document.getElementById('download').addEventListener('click', async () => {
        await window.evanDesktop.chrome.openDownload();
    });
    document.getElementById('retry').addEventListener('click', async () => {
        status.textContent = '正在检测…';
        const result = await window.evanDesktop.chrome.retry();
        if (!result.ready) status.textContent = result.message || '仍未检测到 Google Chrome';
    });
</script>
</html>
`)}`;
}

/**
 * Chrome 兼容性状态。
 *
 * 探针会同步读取 Chrome 版本（Windows 不启动 Chrome，只读文件版本属性），所以默认
 * 走缓存。
 * 用户「刚装完 Chrome，点重新检测」的场景必须 force，否则那个按钮会永远读到旧结论。
 */
function currentChromeStatus({ force = false } = {}) {
    return getChromeCompatibility(process.env, { force });
}

function ensureSharedBrowserHub() {
    return ensureBrowserHubRuntime({
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        projectRoot: PROJECT_ROOT
    });
}

function runtimeEnvironment() {
    const resourcesDir = app.isPackaged ? app.getAppPath() : PROJECT_ROOT;
    const dataDir = path.join(app.getPath('userData'), 'data');
    const mediaToolsDir = app.isPackaged
        ? path.join(process.resourcesPath, 'media-tools')
        : path.join(PROJECT_ROOT, 'node_modules', 'ffmpeg-ffprobe-static');
    const chrome = currentChromeStatus();
    const browserHubHome = sharedBrowserHubHome(process.env);
    const browserHubPayload = browserHubPayloadPath({
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        projectRoot: PROJECT_ROOT
    });
    return {
        ...process.env,
        NODE_ENV: app.isPackaged ? 'production' : (process.env.NODE_ENV || 'development'),
        HOST: '127.0.0.1',
        PORT: '0',
        EVAN_RESOURCES_DIR: resourcesDir,
        EVAN_DATA_DIR: dataDir,
        EVAN_LOGS_DIR: path.join(dataDir, 'logs'),
        EVAN_RUNTIME_DIR: path.join(dataDir, 'runtime'),
        EVAN_BROWSER_PROFILE_DIR: path.join(browserHubHome, 'data', 'profile-v1'),
        EVAN_CHROME_EXECUTABLE: chrome.executable || '',
        EVAN_BROWSER_EXECUTABLE: chrome.executable || '',
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
        AI_BROWSER_HUB_ENABLED: '1',
        AI_BROWSER_HUB_HOME: browserHubHome,
        AI_BROWSER_HUB_PAYLOAD: browserHubPayload,
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

function createWindow(initialUrl = null) {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 960,
        minWidth: 1080,
        minHeight: 720,
        // show: false + ready-to-show 才是标准做法：show: true 会让窗口立刻绘制一帧
        // 空白/未样式化的内容，也让下面的 ready-to-show 处理器失去意义。
        show: false,
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
    // ready-to-show 万一没来（渲染进程异常），也不能让用户对着空气等。
    const showFallbackTimer = setTimeout(() => {
        if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
    }, 3_000);
    showFallbackTimer.unref?.();
    mainWindow.on('closed', () => {
        clearTimeout(showFallbackTimer);
        mainWindow = null;
    });
    mainWindow.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
        if (!isMainFrame || url === LOADING_PAGE) return;
        dialog.showErrorBox(
            'Evan 页面加载失败',
            `无法打开本地页面（${code}: ${description}）。\n${url}`
        );
    });
    void mainWindow.loadURL(initialUrl || backendOrigin || LOADING_PAGE);
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

ipcMain.handle('project:reveal', async (_event, workflowId) => {
    try {
        const id = String(workflowId || '').trim();
        if (!id) return { ok: false, error: '请先打开项目' };

        const dataDir = path.join(app.getPath('userData'), 'data');
        return revealProjectById(id, {
            dataDir,
            openPath: directory => shell.openPath(directory)
        });
    } catch (error) {
        return { ok: false, error: error.message || '无法打开项目目录' };
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

// ---------------------------------------------------------------------------
// 应用信息与更新
// ---------------------------------------------------------------------------

ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged
}));

const uninstallPlan = keepUserData => resolveUninstallTargets({
    userDataDir: app.getPath('userData'),
    exePath: process.execPath,
    platform: process.platform,
    isPackaged: app.isPackaged,
    keepUserData
});

// 预览：界面在按钮旁边如实列出会被扔进废纸篓的路径，用户点之前就能看到。
ipcMain.handle('app:uninstall-plan', (_event, keepUserData) => uninstallPlan(Boolean(keepUserData)));

ipcMain.handle('app:uninstall', async (_event, keepUserData) => {
    const plan = uninstallPlan(Boolean(keepUserData));
    if (!plan.supported) return { ok: false, error: plan.hint };

    // 最终确认放在主进程：不可逆动作不交给渲染进程的 confirm 把关。
    const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['取消', '移到废纸篓'],
        defaultId: 0,
        cancelId: 0,
        title: '卸载 Evan',
        message: keepUserData ? '确定卸载 Evan？（保留你的数据）' : '确定卸载 Evan 并删除全部数据？',
        detail: [
            '以下内容会被移到废纸篓：',
            ...plan.targets.map(target => `· ${target.label}\n  ${target.path}`),
            '',
            keepUserData
                ? '你的素材和登录态会保留在原处，重新安装后可以直接继续用。'
                : '素材、生成结果、登录态都会一起进废纸篓 —— 清空废纸篓前还能拖回来。'
        ].join('\n')
    });
    if (response !== 1) return { ok: false, canceled: true };

    // 先停本 App 后端并释放它持有的租约；共享 Profile/Hub 不属于 Evan，不能删除。
    if (backendProcess) {
        backendProcess.postMessage({ type: 'shutdown' });
        await new Promise(resolve => {
            const timer = setTimeout(resolve, 9_000);
            backendProcess.once('exit', () => { clearTimeout(timer); resolve(); });
        });
    }
    backendProcess = null;

    for (const target of plan.targets) {
        try {
            await shell.trashItem(target.path);
        } catch (error) {
            return { ok: false, error: `无法把「${target.label}」移到废纸篓：${error.message}` };
        }
    }

    shuttingDown = true;
    app.quit();
    return { ok: true };
});

ipcMain.handle('chrome:get-status', () => currentChromeStatus({ force: true }));
ipcMain.handle('chrome:open-download', async () => {
    await shell.openExternal(CHROME_DOWNLOAD_URL);
    return { ok: true };
});
ipcMain.handle('chrome:retry', async () => {
    // 用户刚装好 Chrome 才会点这里，必须绕开缓存重新探测。
    const status = currentChromeStatus({ force: true });
    if (!status.ready) return status;
    if (!mainWindow) createWindow(LOADING_PAGE);
    else void mainWindow.loadURL(LOADING_PAGE);
    try {
        await ensureSharedBrowserHub();
    } catch (error) {
        return { ...status, ready: false, message: `共享浏览器启动失败：${error.message}` };
    }
    if (!backendProcess) launchBackend();
    return status;
});

ipcMain.handle('update:get-state', () => updates.getState());
ipcMain.handle('update:check', () => updates.check({ silent: false }));
ipcMain.handle('update:download', () => updates.download());
ipcMain.handle('update:install', () => updates.install());
ipcMain.handle('update:open-download-page', () => updates.openDownloadPage());

ipcMain.handle('external:open', async (_event, rawUrl) => {
    try {
        const url = new URL(String(rawUrl || ''));
        if (url.protocol !== 'https:' || !ALLOWED_EXTERNAL_HOSTS.has(url.hostname)) {
            return { ok: false, error: '该链接不在 Evan 的安全外链列表中' };
        }
        await shell.openExternal(url.toString());
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error.message || '无法打开外部链接' };
    }
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
        if (!shuttingDown) {
            scheduleBackendRestart(code);
        }
    });
    return backendProcess;
}

function loadBackendOrigin(origin) {
    backendOrigin = origin;
    if (!mainWindow) return;
    void mainWindow.loadURL(origin).then(() => {
        // 后端就绪可能是启动后好几秒的事。窗口还没显示（首次启动）就显示出来，
        // 但绝不能 focus/steal —— 用户在等待期间切去了别的应用的话，
        // 这一下会把他们硬拽回来。
        if (mainWindow && !mainWindow.isVisible()) {
            mainWindow.show();
            mainWindow.focus();
        }
        if (!updateStartupCheckScheduled) {
            updateStartupCheckScheduled = true;
            updates.scheduleStartupCheck();
        }
    }).catch(error => {
        dialog.showErrorBox('Evan 启动失败', `本地页面无法加载：${error.message}`);
    });
}

function launchBackend() {
    const backend = startBackend();
    backend.on('message', message => {
        if (message?.type !== 'backend-ready') return;
        loadBackendOrigin(message.origin);
    });
    return backend;
}

function scheduleBackendRestart(code) {
    const now = Date.now();
    backendCrashTimes = backendCrashTimes
        .filter(crashedAt => now - crashedAt < BACKEND_RESTART_WINDOW_MS);
    backendCrashTimes.push(now);
    backendOrigin = null;

    if (backendCrashTimes.length > BACKEND_RESTART_LIMIT) {
        dialog.showErrorBox(
            'Evan 后端无法恢复',
            `本地后端在 1 分钟内连续异常退出（最后代码 ${code}）。请完全退出 Evan 后重新打开。`
        );
        return;
    }

    if (mainWindow) {
        void mainWindow.loadURL(LOADING_PAGE);
    }
    backendRestartTimer = setTimeout(() => {
        backendRestartTimer = null;
        if (!shuttingDown && !backendProcess) launchBackend();
    }, BACKEND_RESTART_DELAY_MS);
    backendRestartTimer.unref?.();
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

    app.whenReady().then(async () => {
        const chrome = currentChromeStatus();
        createWindow(chrome.ready ? null : chromeRequiredPage(chrome));
        app.focus({ steal: true });
        if (chrome.ready) {
            try {
                await ensureSharedBrowserHub();
                launchBackend();
            } catch (error) {
                dialog.showErrorBox('共享浏览器启动失败', error.message || String(error));
            }
        } else void shell.openExternal(CHROME_DOWNLOAD_URL);

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0 && mainWindow === null) {
                const current = currentChromeStatus();
                createWindow(current.ready ? null : chromeRequiredPage(current));
                if (current.ready && !backendProcess) {
                    void ensureSharedBrowserHub()
                        .then(() => { if (!backendProcess) launchBackend(); })
                        .catch(error => dialog.showErrorBox('共享浏览器启动失败', error.message || String(error)));
                }
            }
        });
    });

    app.on('before-quit', event => {
        if (backendRestartTimer) {
            clearTimeout(backendRestartTimer);
            backendRestartTimer = null;
        }
        if (shuttingDown) return;
        event.preventDefault();
        shuttingDown = true;
        setTimeout(() => app.quit(), 10_500).unref();
        if (backendProcess) {
            backendProcess.postMessage({ type: 'shutdown' });
            backendProcess.once('exit', () => app.quit());
        } else app.quit();
    });

    app.on('window-all-closed', () => {
        // 用户关闭 Evan 主窗口只退出本 App；共享 Chrome 由 Hub 按租约空闲回收。
        app.quit();
    });
}
