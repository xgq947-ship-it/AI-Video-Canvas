// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
// Desktop builds must not load an arbitrary .env from the process working
// directory. Their settings live under the app's user-data directory.
if (process.env.EVAN_DESKTOP !== '1') dotenv.config();

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import generationRoutes from './routes/generation.js';
import audioRoutes from './routes/audio.js';
import renderRoutes from './routes/render.js';
import autoSubtitleRoutes from './routes/auto-subtitles.js';
import codexImageJobRoutes from './routes/codex-image-jobs.js';
import settingsRoutes from './routes/settings.js';
import videoRemixRoutes from './routes/video-remix.js';
import videoAnalysisRoutes from './routes/video-analysis.js';
import stickmanDirectorRoutes from './routes/stickman-director.js';
import trashRoutes from './routes/trash.js';
import libraryRoutes from './routes/library.js';
import browserRoutes from './routes/browser.js';
import promptRoutes from './routes/prompt.js';
import assetRoutes from './routes/assets.js';
import tiktokRoutes from './routes/tiktok.js';
import projectRoutes from './routes/projects.js';
import workflowRoutes from './routes/workflows.js';
import { applyApiKeysToApp, loadApiKeyOverrides } from './services/apiKeyStore.js';
import { createCodexImageAutomation } from './services/codexImageAutomation.js';
import { createCodexIntegration } from './services/codexIntegration.js';
import { scanAssetLibrary } from './utils/scanAssetLibrary.js';
import { purgeAllExpiredProjectTrash } from './utils/workflowStore.js';
import { applyOptimizerPreferenceToApp, loadOptimizerPreference } from './services/optimizerPreference.js';
import {
    applyWebExecutionPreferenceToApp,
    loadWebExecutionPreference
} from './services/webhttp/index.js';
import { closeBrowserForShutdown } from './services/opsCliRunner.js';
import { RUNTIME_PATHS } from './runtime/paths.js';
import {
    AUDIO_DIR,
    CODEX_IMAGE_JOBS_DIR,
    IMAGES_DIR,
    LIBRARY_ASSETS_DIR,
    LIBRARY_DIR,
    PROJECTS_DIR,
    VIDEOS_DIR,
    WORKFLOWS_DIR,
    ensureLibraryDirs
} from './runtime/libraryPaths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '127.0.0.1';
const BACKEND_SESSION_ID = crypto.randomUUID();
const BACKEND_STARTED_AT = Date.now();

// 目录常量与建目录逻辑统一在 runtime/libraryPaths.js —— 路由模块直接 import 它，
// 不必再从这里的模块作用域取（那正是这些路由以前挪不出去的原因）。
// Transitional compatibility for helpers that still accept LIBRARY_DIR from
// the environment. Desktop mode injects a user-writable path here.
process.env.LIBRARY_DIR = LIBRARY_DIR;
ensureLibraryDirs();

const API_KEY_OVERRIDES = loadApiKeyOverrides(LIBRARY_DIR);


// Enable CORS for all routes (must come before static file serving)
app.use(cors());
// Base64 会比原始文件大约多三分之一；150MB 的请求上限对应前端 100MB 的本地素材限制。
app.use(express.json({ limit: '150mb' }));

// Serve static assets from library with CORS headers for cross-origin image access
app.use('/library', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
}, express.static(LIBRARY_DIR));


const API_KEY = API_KEY_OVERRIDES.GEMINI_API_KEY || process.env.GEMINI_API_KEY;

if (!API_KEY) {
    console.warn("SERVER WARNING: GEMINI_API_KEY is not set in environment or .env file.");
}

// ============================================================================
// SEEDANCE / 火山方舟中国区 CONFIGURATION
// ============================================================================

const ARK_API_KEY = API_KEY_OVERRIDES.ARK_API_KEY || process.env.ARK_API_KEY;

if (!ARK_API_KEY) {
    console.warn("SERVER WARNING: ARK_API_KEY not set. 火山方舟 Seedance models will not work.");
}

// ============================================================================
// OPENAI GPT IMAGE CONFIGURATION
// ============================================================================

const OPENAI_API_KEY = API_KEY_OVERRIDES.OPENAI_API_KEY || process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
    console.warn("SERVER WARNING: OPENAI_API_KEY not set. OpenAI GPT Image models will not work.");
}

// Set up app.locals for sharing config with route modules
app.locals.IMAGES_DIR = IMAGES_DIR;
app.locals.VIDEOS_DIR = VIDEOS_DIR;
app.locals.AUDIO_DIR = AUDIO_DIR;
app.locals.PROJECTS_DIR = PROJECTS_DIR;
app.locals.WORKFLOWS_DIR = WORKFLOWS_DIR;
app.locals.LIBRARY_DIR = LIBRARY_DIR;
app.locals.CODEX_IMAGE_JOBS_DIR = CODEX_IMAGE_JOBS_DIR;
app.locals.BACKEND_SESSION_ID = BACKEND_SESSION_ID;
app.locals.BACKEND_STARTED_AT = BACKEND_STARTED_AT;
app.locals.CODEX_INTEGRATION = createCodexIntegration({
    resourcesDir: RUNTIME_PATHS.resourcesDir,
    dataDir: RUNTIME_PATHS.dataDir,
    libraryDir: LIBRARY_DIR
});
app.locals.CODEX_IMAGE_AUTOMATION = createCodexImageAutomation({
    projectRoot: RUNTIME_PATHS.resourcesDir,
    workspaceDir: app.locals.CODEX_INTEGRATION.runtime.workspaceDir,
    jobsDir: CODEX_IMAGE_JOBS_DIR,
    codexPath: app.locals.CODEX_INTEGRATION.command,
    commandEnvironment: app.locals.CODEX_INTEGRATION.commandEnvironment
});
applyApiKeysToApp(app, process.env, API_KEY_OVERRIDES);

// 提示词优化后端选择：默认 DeepSeek；可在“配置”弹窗下拉里切换到 Claude / Codex 本机 CLI，
// 选择存到 library/config/optimizer.json（环境变量作为初始默认）。
applyOptimizerPreferenceToApp(app, process.env, loadOptimizerPreference(LIBRARY_DIR));

// Gemini Web / 即梦 / Flow 的执行通道：默认 auto（HTTP 优先，提交前失败才回退浏览器），
// 存到 library/config/web-execution.json，可在“配置”弹窗按平台单独切换。
applyWebExecutionPreferenceToApp(app, process.env, loadWebExecutionPreference(LIBRARY_DIR));

// ============================================================================
// WORKFLOW SANITIZATION HELPERS
// ============================================================================

/**
 * Saves base64 data URL to a file and returns the file URL path.
 * @param {string} dataUrl - Base64 data URL (e.g., data:image/png;base64,...)
 * @returns {{ url: string } | null} - File URL path or null if not base64
 */

// Mount generation routes (image and video generation)
app.use('/api', generationRoutes);
app.use('/api', codexImageJobRoutes);
app.use('/api/settings', settingsRoutes);

// Mount Local Models routes (local open-source model discovery)

// Mount Audio routes (外部平台或本地音频导入)
app.use('/api/audio', audioRoutes);

// Mount Render routes (通用 Remotion 成片渲染任务)
app.use('/api/render', renderRoutes);

// Mount automatic speech recognition + burned-in subtitle video jobs.
app.use('/api/auto-subtitles', autoSubtitleRoutes);

// Video Remix keeps reference originals under the current project's durable
// folder. Local uploads use a streaming body, so this router must not install a
// second JSON parser on its import endpoint.
app.use('/api/video-remix', videoRemixRoutes);
// Canvas-native video analysis reuses the Video Remix HTTP analyzer but writes
// only the lightweight result consumed by ordinary canvas nodes.
app.use('/api/video-analysis', videoAnalysisRoutes);
// Internal Stickman Video Director skill, Flow batch orchestration and merge jobs.
app.use('/api', stickmanDirectorRoutes);
app.use('/api/projects', trashRoutes);
app.use('/api/library', libraryRoutes);
// 能力探测 / 共享浏览器登录态：路径各不相同，统一挂在 /api 下。
app.use('/api', browserRoutes);
app.use('/api', promptRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/tiktok', tiktokRoutes);
// 注意顺序：trashRoutes 的 /:id/trash 必须先于 projectRoutes 的 /:id/assets 之类匹配，
// 两者路径不重叠，这里保持与拆分前一致的注册顺序。
app.use('/api/projects', projectRoutes);
app.use('/api', workflowRoutes);


// 项目回收站的定时清理。purgeAllExpiredProjectTrash 与其他项目读写工具一样
// 住在 utils/workflowStore.js，路由模块和这里共用同一份实现。
purgeAllExpiredProjectTrash();
const projectTrashCleanupTimer = setInterval(purgeAllExpiredProjectTrash, 60 * 60 * 1000);
projectTrashCleanupTimer.unref?.();

// Create a real, empty project immediately. This is intentionally separate
// from the legacy save endpoint so clicking "新建" reserves the name and folder
// before any generation/upload can start.


// Save/Update workflow


// NOTE: Old generation routes removed - now in server/routes/generation.js




// Desktop development also loads the already-built frontend from this backend.
// Without EVAN_DESKTOP here, Electron receives Express's "Cannot GET /" page.
if (process.env.NODE_ENV === 'production' || process.env.EVAN_DESKTOP === '1') {
    const distPath = RUNTIME_PATHS.distDir;
    app.use(express.static(distPath));

    // Handle SPA routing: serve index.html for any unknown routes
    // Express 5 / path-to-regexp 8 requires a named wildcard. The old '*'
    // pattern throws during packaged production startup.
    app.get('/{*splat}', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
    });
}

// 启动时自动扫描 library/assets/ 并同步 assets.json，手动放进分类文件夹的素材无需重启即可被登记
try {
    const scan = scanAssetLibrary(LIBRARY_ASSETS_DIR);
    if (scan.changed) {
        console.log(`[asset-scan] 素材库已同步：新增 ${scan.added}，清理 ${scan.removed}，当前共 ${scan.total} 条`);
    } else {
        console.log(`[asset-scan] 素材库无变化，当前共 ${scan.total} 条`);
    }
} catch (e) {
    console.warn(`[asset-scan] 扫描素材库失败：${e.message}`);
}

export function startBackend({
    port = PORT,
    host = HOST,
    onReady
} = {}) {
    const server = app.listen(port, host);
    server.once('listening', () => {
        const address = server.address();
        const actualPort = typeof address === 'object' && address ? address.port : port;
        console.log(`Backend server running on http://${host}:${actualPort}`);
        if (app.locals.CODEX_IMAGE_AUTOMATION.resumePending()) {
            console.log('[Codex 自动生图] 已恢复未完成的图片任务');
        }
        onReady?.({ host, port: actualPort, server });
    });
    return server;
}

export { app };

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === __filename) {
    const server = startBackend();

    // 直接 `node server/index.js`（npm run dev / npm run server）时，桌面端的
    // 退出链路（electron/main.js 的 before-quit → desktop-entry.js 的 shutdown）
    // 完全不参与。这里仍执行统一退出钩子以释放当前 App 的本地状态；系统共享 Chrome
    // 由 Hub 根据所有 App 的租约统一回收。concurrently 的 SIGTERM 同样走这里。
    let shuttingDown = false;
    const shutdown = () => {
        if (shuttingDown) return;
        shuttingDown = true;
        const finish = () => server.close(() => process.exit(0));
        closeBrowserForShutdown({ timeoutMs: 8_000 }).then(finish, finish);
        setTimeout(() => process.exit(1), 9_500).unref();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('SIGHUP', shutdown);
}
