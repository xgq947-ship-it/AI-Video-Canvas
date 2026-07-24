// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
// Desktop builds must not load an arbitrary .env from the process working
// directory. Their settings live under the app's user-data directory.
if (process.env.EVAN_DESKTOP !== '1') dotenv.config();

import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { spawn } from 'child_process';
import generationRoutes from './routes/generation.js';
import { processTikTokVideo, isValidTikTokUrl } from './tools/tiktok.js';
import storyboardRoutes from './routes/storyboard.js';
import audioRoutes from './routes/audio.js';
import renderRoutes from './routes/render.js';
import codexImageJobRoutes from './routes/codex-image-jobs.js';
import settingsRoutes from './routes/settings.js';
import { applyApiKeysToApp, loadApiKeyOverrides } from './services/apiKeyStore.js';
import { normalizeCharacterAssetMeta } from './services/characterAssets.js';
import { createUniqueAssetFilename } from './services/assetFilenames.js';
import { createCodexImageAutomation } from './services/codexImageAutomation.js';
import { createCodexIntegration } from './services/codexIntegration.js';
import { decodeProcessOutput } from './utils/processOutput.js';
import { scanAssetLibrary } from './utils/scanAssetLibrary.js';
import {
    organizeWorkflowAssets,
    deleteWorkflowAssetDirs,
    renameWorkflowAssetDirs,
    ensureProjectFolder,
    importProjectAsset,
    resolveProjectMediaTarget,
    saveProjectImageUpload,
    sanitizeProjectDirName
} from './utils/projectAssets.js';
import { execFile } from 'child_process';
import {
    buildPromptOptimizationInstruction,
    formatOptimizedPrompt,
    getPromptOptimizationProfile
} from '../shared/promptOptimizationProfiles.js';
import { getPromptOptimizerProvider } from './services/promptOptimizerProviders.js';
import { applyOptimizerPreferenceToApp, loadOptimizerPreference } from './services/optimizerPreference.js';
import { BROWSER_MODELS_SETUP_HINT, isBrowserModelsReady, runOpsCli } from './services/opsCliRunner.js';
import { browserSessionState } from './services/browserSessionState.js';
import { resolveImageToBase64 } from './utils/imageHelpers.js';
import { MASSAGE_EQUIPMENT_NAMES } from '../shared/massageEquipmentCategories.js';
import { RUNTIME_PATHS } from './runtime/paths.js';
import { FFMPEG_PATH } from './runtime/mediaTools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '127.0.0.1';

// Ensure library directories exist
const LIBRARY_DIR = RUNTIME_PATHS.libraryDir;
// Transitional compatibility for helpers that still accept LIBRARY_DIR from
// the environment. Desktop mode injects a user-writable path here.
process.env.LIBRARY_DIR = LIBRARY_DIR;
const WORKFLOWS_DIR = path.join(LIBRARY_DIR, 'workflows');
const IMAGES_DIR = path.join(LIBRARY_DIR, 'images');
const VIDEOS_DIR = path.join(LIBRARY_DIR, 'videos');
const AUDIO_DIR = path.join(LIBRARY_DIR, 'audio');
const PROJECTS_DIR = path.join(LIBRARY_DIR, 'projects');
const LIBRARY_ASSETS_DIR = path.join(LIBRARY_DIR, 'assets');
const CODEX_IMAGE_JOBS_DIR = path.join(LIBRARY_DIR, 'codex-image-jobs');
const MASSAGE_EQUIPMENT_SUBCATEGORY_NAMES = MASSAGE_EQUIPMENT_NAMES;

[LIBRARY_DIR, WORKFLOWS_DIR, IMAGES_DIR, VIDEOS_DIR, AUDIO_DIR, PROJECTS_DIR, LIBRARY_ASSETS_DIR, CODEX_IMAGE_JOBS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Materialize the two-level massage equipment library in Finder as well as UI.
MASSAGE_EQUIPMENT_SUBCATEGORY_NAMES.forEach(subcategory => {
    fs.mkdirSync(path.join(LIBRARY_ASSETS_DIR, 'Massage Equipment', subcategory), { recursive: true });
});

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

const getClient = () => {
    return new GoogleGenAI({ apiKey: app.locals.GEMINI_API_KEY || '' });
};

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

// ============================================================================
// WORKFLOW SANITIZATION HELPERS
// ============================================================================

/**
 * Saves base64 data URL to a file and returns the file URL path.
 * @param {string} dataUrl - Base64 data URL (e.g., data:image/png;base64,...)
 * @returns {{ url: string } | null} - File URL path or null if not base64
 */
function saveBase64ToFile(dataUrl, workflowId) {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
        return null;
    }

    const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) return null;

    const mimeType = matches[1];
    const base64Data = matches[2];

    try {
        const buffer = Buffer.from(base64Data, 'base64');
        const id = `wf_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

        let filename, urlType;

        if (mimeType.startsWith('video/')) {
            filename = `${id}.mp4`;
            urlType = 'videos';
        } else {
            const ext = mimeType === 'image/jpeg' ? 'jpg' : 'png';
            filename = `${id}.${ext}`;
            urlType = 'images';
        }

        const { targetDir, urlPrefix } = resolveProjectMediaTarget(workflowId, urlType, {
            workflowsDir: WORKFLOWS_DIR,
            projectsDir: PROJECTS_DIR
        });

        fs.writeFileSync(path.join(targetDir, filename), buffer);
        console.log(`  [Workflow Sanitize] Saved base64 → ${urlPrefix}/${filename}`);

        return { url: `${urlPrefix}/${filename}` };
    } catch (err) {
        console.error('  [Workflow Sanitize] Failed to save base64:', err.message);
        return null;
    }
}

/**
 * Sanitizes workflow nodes by converting base64 data to file URLs.
 * Prevents large base64 strings from bloating workflow JSON files.
 * @param {Array} nodes - Array of workflow nodes
 * @returns {{ nodes: Array, sanitizedCount: number }} - Sanitized nodes with file URLs instead of base64, and how many fields were converted
 */
function sanitizeWorkflowNodes(nodes, workflowId) {
    if (!nodes || !Array.isArray(nodes)) return { nodes, sanitizedCount: 0 };

    let sanitizedCount = 0;

    const sanitized = nodes.map(node => {
        const cleanNode = { ...node };

        // Check resultUrl for base64 data
        if (cleanNode.resultUrl && cleanNode.resultUrl.startsWith('data:')) {
            const saved = saveBase64ToFile(cleanNode.resultUrl, workflowId);
            if (saved) {
                cleanNode.resultUrl = saved.url;
                sanitizedCount++;
            }
        }

        // Check lastFrame for base64 data (video nodes)
        if (cleanNode.lastFrame && cleanNode.lastFrame.startsWith('data:')) {
            const saved = saveBase64ToFile(cleanNode.lastFrame, workflowId);
            if (saved) {
                cleanNode.lastFrame = saved.url;
                sanitizedCount++;
            }
        }

        // Check editorCanvasData for base64 data (Image Editor)
        if (cleanNode.editorCanvasData && cleanNode.editorCanvasData.startsWith('data:')) {
            const saved = saveBase64ToFile(cleanNode.editorCanvasData, workflowId);
            if (saved) {
                cleanNode.editorCanvasData = saved.url;
                sanitizedCount++;
            }
        }

        // Check editorBackgroundUrl for base64 data (Image Editor)
        if (cleanNode.editorBackgroundUrl && cleanNode.editorBackgroundUrl.startsWith('data:')) {
            const saved = saveBase64ToFile(cleanNode.editorBackgroundUrl, workflowId);
            if (saved) {
                cleanNode.editorBackgroundUrl = saved.url;
                sanitizedCount++;
            }
        }

        return cleanNode;
    });

    if (sanitizedCount > 0) {
        console.log(`[Workflow Sanitize] Converted ${sanitizedCount} base64 field(s) to file URLs`);
    }

    return { nodes: sanitized, sanitizedCount };
}

// Mount generation routes (image and video generation)
app.use('/api', generationRoutes);
app.use('/api', codexImageJobRoutes);
app.use('/api/settings', settingsRoutes);

// Mount Local Models routes (local open-source model discovery)

// Mount Storyboard routes (AI script generation)
app.use('/api/storyboard', storyboardRoutes);

// Mount Audio routes (外部平台或本地音频导入)
app.use('/api/audio', audioRoutes);

// Mount Render routes (通用 Remotion 成片渲染任务)
app.use('/api/render', renderRoutes);

// --- Library Assets API ---

const CURATED_LIBRARY_CATEGORIES = new Set(['Character', 'Scene', 'Item', 'Massage Equipment']);
const MASSAGE_EQUIPMENT_SUBCATEGORIES = new Set(MASSAGE_EQUIPMENT_SUBCATEGORY_NAMES);
const LIBRARY_UPLOAD_MIME_EXTENSIONS = new Map([
    ['image/png', '.png'],
    ['image/jpeg', '.jpg'],
    ['image/webp', '.webp'],
    ['image/gif', '.gif'],
    ['image/avif', '.avif'],
    ['image/bmp', '.bmp'],
    ['video/mp4', '.mp4'],
    ['video/quicktime', '.mov'],
    ['video/webm', '.webm'],
    ['video/x-m4v', '.m4v']
]);
const LIBRARY_UPLOAD_EXTENSION_TYPES = new Map([
    ['.png', 'image'], ['.jpg', 'image'], ['.jpeg', 'image'], ['.webp', 'image'],
    ['.gif', 'image'], ['.avif', 'image'], ['.bmp', 'image'],
    ['.mp4', 'video'], ['.mov', 'video'], ['.webm', 'video'], ['.m4v', 'video']
]);

const readLibraryIndex = () => {
    const libraryJsonPath = path.join(LIBRARY_ASSETS_DIR, 'assets.json');
    if (!fs.existsSync(libraryJsonPath)) return [];
    const parsed = JSON.parse(fs.readFileSync(libraryJsonPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
};

const writeLibraryIndex = (libraryData) => {
    fs.writeFileSync(
        path.join(LIBRARY_ASSETS_DIR, 'assets.json'),
        JSON.stringify(libraryData, null, 2)
    );
};

// Direct upload used by the asset library. Files are stored in the selected
// top-level category, with massage products one folder deeper by product type.
app.post('/api/library/upload', (req, res) => {
    try {
        const { data, name, category, subcategory } = req.body || {};
        if (!data || !name || !CURATED_LIBRARY_CATEGORIES.has(category)) {
            return res.status(400).json({ error: '请选择有效的素材分类' });
        }
        if (category === 'Massage Equipment' && !MASSAGE_EQUIPMENT_SUBCATEGORIES.has(subcategory)) {
            return res.status(400).json({ error: '请选择有效的按摩器材子分类' });
        }
        if (category !== 'Massage Equipment' && subcategory) {
            return res.status(400).json({ error: '该分类不支持子目录' });
        }

        const match = String(data).match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
        if (!match) return res.status(400).json({ error: '素材数据格式无效' });

        const originalExtension = path.extname(String(name)).toLowerCase();
        const mimeExtension = LIBRARY_UPLOAD_MIME_EXTENSIONS.get(match[1].toLowerCase());
        const extension = LIBRARY_UPLOAD_EXTENSION_TYPES.has(originalExtension)
            ? originalExtension
            : mimeExtension;
        const type = LIBRARY_UPLOAD_EXTENSION_TYPES.get(extension);
        if (!extension || !type) {
            return res.status(400).json({ error: '仅支持常见图片和视频格式' });
        }

        const buffer = Buffer.from(match[2], 'base64');
        if (buffer.length === 0) return res.status(400).json({ error: '素材文件为空' });
        if (buffer.length > 100 * 1024 * 1024) {
            return res.status(400).json({ error: '单个素材不能超过 100MB' });
        }

        const assetId = crypto.randomUUID();
        const displayName = path.basename(String(name), originalExtension || extension).trim() || '未命名素材';
        const directorySegments = category === 'Massage Equipment'
            ? [category, subcategory]
            : [category];
        const destinationDir = path.join(LIBRARY_ASSETS_DIR, ...directorySegments);
        fs.mkdirSync(destinationDir, { recursive: true });
        const filename = createUniqueAssetFilename(displayName, extension, assetId);
        fs.writeFileSync(path.join(destinationDir, filename), buffer);

        const relativeUrl = [...directorySegments, filename].join('/');
        const asset = {
            id: assetId,
            name: displayName,
            category,
            ...(subcategory ? { subcategory } : {}),
            url: `/library/assets/${relativeUrl}`,
            type,
            createdAt: new Date().toISOString()
        };
        const libraryData = readLibraryIndex();
        libraryData.unshift(asset);
        writeLibraryIndex(libraryData);
        res.status(201).json({ success: true, asset });
    } catch (error) {
        console.error('Upload library asset error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Save curated asset to library
app.post('/api/library', async (req, res) => {
    try {
        const { sourceUrl, name, meta, description } = req.body;
        // 只有用户主动“保存到素材库”才进入全局素材库；未选分类时归入道具。
        const category = req.body.category || 'Item';

        if (!sourceUrl || !name) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        // Determine destination directory
        const destDir = path.join(LIBRARY_ASSETS_DIR, category);
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }

        let destFilename;
        let destPath;
        const assetId = crypto.randomUUID();

        // HANDLE DATA URL (Base64)
        if (sourceUrl.startsWith('data:')) {
            const matches = sourceUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) {
                return res.status(400).json({ error: 'Invalid data URL format' });
            }

            const mimeType = matches[1];
            const base64Data = matches[2];
            const buffer = Buffer.from(base64Data, 'base64');

            // Determine extension from mime
            let ext = '.png';
            if (mimeType === 'image/jpeg') ext = '.jpg';
            else if (mimeType === 'video/mp4') ext = '.mp4';
            // Add more as needed

            destFilename = createUniqueAssetFilename(name, ext, assetId);
            destPath = path.join(destDir, destFilename);

            fs.writeFileSync(destPath, buffer);
        }
        // HANDLE FILE PATH OR URL
        else {
            // Determine source file path
            let sourcePath = null;

            // Normalize URL: remove origin if present to get just the path
            let cleanUrl = sourceUrl;
            try {
                // If it's a full URL, extract pathname
                if (sourceUrl.startsWith('http')) {
                    const u = new URL(sourceUrl);
                    cleanUrl = u.pathname;
                }
            } catch (e) {
                // Not a valid URL, treat as path
            }

            // Always strip query string (cache busting params like ?t=123)
            cleanUrl = cleanUrl.split('?')[0];

            // Ensure cleanUrl starts with / if it doesn't (though URL.pathname does)
            if (!cleanUrl.startsWith('/')) cleanUrl = '/' + cleanUrl;

            // Handle URL decoding (e.g. %20 -> space)
            cleanUrl = decodeURIComponent(cleanUrl);

            if (cleanUrl.startsWith('/library/images/')) {
                sourcePath = path.join(IMAGES_DIR, cleanUrl.replace('/library/images/', ''));
            } else if (cleanUrl.startsWith('/library/videos/')) {
                sourcePath = path.join(VIDEOS_DIR, cleanUrl.replace('/library/videos/', ''));
            } else if (cleanUrl.startsWith('/library/projects/')) {
                const candidate = path.resolve(LIBRARY_DIR, cleanUrl.replace(/^\/library\//, ''));
                const projectsRoot = path.resolve(PROJECTS_DIR) + path.sep;
                if (candidate.startsWith(projectsRoot)) sourcePath = candidate;
            } else if (cleanUrl.startsWith('/assets/images/')) { // Legacy support
                sourcePath = path.join(IMAGES_DIR, cleanUrl.replace('/assets/images/', ''));
            } else if (cleanUrl.startsWith('/assets/videos/')) { // Legacy support
                sourcePath = path.join(VIDEOS_DIR, cleanUrl.replace('/assets/videos/', ''));
            }

            if (!sourcePath || !fs.existsSync(sourcePath)) {
                console.error(`Save asset failed: Source file not found. URL: ${sourceUrl}, Path: ${sourcePath}`);
                return res.status(404).json({ error: "Source file not found", debug: { sourceUrl, sourcePath, cleanUrl } });
            }

            // Copy file
            const ext = path.extname(sourcePath);
            destFilename = createUniqueAssetFilename(name, ext, assetId);
            destPath = path.join(destDir, destFilename);

            fs.copyFileSync(sourcePath, destPath);
        }

        // Update assets.json
        const libraryJsonPath = path.join(LIBRARY_ASSETS_DIR, 'assets.json');
        let libraryData = [];
        if (fs.existsSync(libraryJsonPath)) {
            libraryData = JSON.parse(fs.readFileSync(libraryJsonPath, 'utf8'));
        }

        const normalizedMeta = normalizeCharacterAssetMeta({ category, meta, libraryData });

        const newEntry = {
            id: assetId,
            name: name,
            category: category,
            url: `/library/assets/${category}/${destFilename}`,
            type: sourceUrl.includes('video') || (sourceUrl.startsWith('data:video')) ? 'video' : 'image',
            createdAt: new Date().toISOString(),
            ...(description?.trim() ? { description: description.trim() } : {}),
            ...normalizedMeta
        };

        libraryData.push(newEntry);
        fs.writeFileSync(libraryJsonPath, JSON.stringify(libraryData, null, 2));

        res.json({ success: true, asset: newEntry });
    } catch (error) {
        console.error("Save to library error:", error);
        res.status(500).json({ error: error.message });
    }
});

// List library assets
app.get('/api/library', async (req, res) => {
    try {
        const libraryJsonPath = path.join(LIBRARY_ASSETS_DIR, 'assets.json');
        if (!fs.existsSync(libraryJsonPath)) {
            return res.json([]);
        }
        const libraryData = JSON.parse(fs.readFileSync(libraryJsonPath, 'utf8'));
        // Sort newest first
        libraryData.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json(libraryData);
    } catch (error) {
        console.error("List library error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Delete library asset
app.delete('/api/library/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const libraryJsonPath = path.join(LIBRARY_ASSETS_DIR, 'assets.json');

        if (!fs.existsSync(libraryJsonPath)) {
            return res.status(404).json({ error: "Library not found" });
        }

        let libraryData = JSON.parse(fs.readFileSync(libraryJsonPath, 'utf8'));
        const assetIndex = libraryData.findIndex(a => a.id === id);

        if (assetIndex === -1) {
            return res.status(404).json({ error: "Asset not found" });
        }

        const asset = libraryData[assetIndex];

        // Delete the actual file if it exists in our assets folder
        // asset.url usually looks like /library/assets/Category/file.ext
        if (asset.url && asset.url.startsWith('/library/assets/')) {
            const relativePath = asset.url.replace('/library/assets/', '');
            const filePath = path.join(LIBRARY_ASSETS_DIR, relativePath);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        // Remove from array
        libraryData.splice(assetIndex, 1);
        fs.writeFileSync(libraryJsonPath, JSON.stringify(libraryData, null, 2));

        res.json({ success: true });
    } catch (error) {
        console.error("Delete library asset error:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- Workflow API Routes ---

const projectAssetDirs = () => ({
    libraryDir: LIBRARY_DIR,
    projectsDir: PROJECTS_DIR,
    imagesDir: IMAGES_DIR,
    videosDir: VIDEOS_DIR,
    audioDir: AUDIO_DIR
});

const writeProjectManifest = (workflow) => {
    if (!workflow?.projectDirName) return;
    const projectRoot = ensureProjectFolder(workflow, { projectsDir: PROJECTS_DIR });
    const manifestPath = path.join(projectRoot, 'project.json');
    // Keep a complete, human-visible project copy beside its media. The central
    // workflow index remains the fast application index, while this file makes
    // a user-selected project folder self-contained for backup and inspection.
    fs.writeFileSync(manifestPath, JSON.stringify(workflow, null, 2));
};

const findWorkflowByTitle = (title, exceptId = null) => {
    const normalized = title.trim().toLocaleLowerCase();
    for (const file of fs.readdirSync(WORKFLOWS_DIR).filter(name => name.endsWith('.json'))) {
        try {
            const workflow = JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8'));
            if (workflow.id !== exceptId && String(workflow.title || '').trim().toLocaleLowerCase() === normalized) {
                return workflow;
            }
        } catch { /* invalid legacy file is ignored here and handled by its own load path */ }
    }
    return null;
};

// Create a real, empty project immediately. This is intentionally separate
// from the legacy save endpoint so clicking "新建" reserves the name and folder
// before any generation/upload can start.
app.post('/api/projects', (req, res) => {
    let workflow = null;
    let customProjectCreated = false;
    let workflowFilePath = null;
    try {
        const title = String(req.body?.title || '').trim();
        if (!title) return res.status(400).json({ error: '项目名称不能为空' });
        const dirName = sanitizeProjectDirName(title);
        if (!dirName || dirName === 'untitled') return res.status(400).json({ error: '项目名称不合法' });
        if (findWorkflowByTitle(title) || fs.existsSync(path.join(PROJECTS_DIR, dirName))) {
            return res.status(409).json({ error: '项目名称已存在，请换一个名称' });
        }

        const requestedParent = String(req.body?.parentDirectory || '').trim();
        let projectPath = null;
        if (requestedParent) {
            if (
                !process.env.EVAN_DESKTOP_TOKEN
                || req.get('X-Evan-Desktop-Token') !== process.env.EVAN_DESKTOP_TOKEN
            ) {
                return res.status(403).json({ error: '自定义项目路径必须通过桌面应用选择' });
            }
            if (!path.isAbsolute(requestedParent)) {
                return res.status(400).json({ error: '项目存放位置必须是绝对路径' });
            }

            const parentDirectory = path.resolve(requestedParent);
            let parentStat;
            try {
                parentStat = fs.statSync(parentDirectory);
                fs.accessSync(parentDirectory, fs.constants.R_OK | fs.constants.W_OK);
            } catch {
                return res.status(400).json({ error: '所选文件夹不存在或没有写入权限' });
            }
            if (!parentStat.isDirectory()) {
                return res.status(400).json({ error: '请选择文件夹作为项目存放位置' });
            }

            if (parentDirectory !== path.resolve(PROJECTS_DIR)) {
                projectPath = path.join(parentDirectory, dirName);
                try {
                    fs.lstatSync(projectPath);
                    return res.status(409).json({ error: `所选位置已存在同名文件夹：${dirName}` });
                } catch (error) {
                    if (error.code !== 'ENOENT') throw error;
                }
            }
        }

        const now = new Date().toISOString();
        workflow = {
            id: crypto.randomUUID(),
            title,
            projectDirName: dirName,
            ...(projectPath ? { projectPath, projectStorage: 'custom' } : {}),
            nodes: [],
            groups: [],
            viewport: { x: 0, y: 0, zoom: 1 },
            createdAt: now,
            updatedAt: now
        };
        ensureProjectFolder(workflow, { projectsDir: PROJECTS_DIR }, { exactName: true });
        customProjectCreated = Boolean(workflow.projectPath);
        workflowFilePath = path.join(WORKFLOWS_DIR, `${workflow.id}.json`);
        fs.writeFileSync(workflowFilePath, JSON.stringify(workflow, null, 2));
        writeProjectManifest(workflow);
        res.status(201).json(workflow);
    } catch (error) {
        console.error('Create project error:', error);
        if (workflowFilePath && fs.existsSync(workflowFilePath)) {
            fs.rmSync(workflowFilePath, { force: true });
        }
        if (workflow?.projectPath) {
            try {
                deleteWorkflowAssetDirs(workflow, {
                    imagesDir: IMAGES_DIR,
                    videosDir: VIDEOS_DIR,
                    projectsDir: PROJECTS_DIR
                });
                if (customProjectCreated && fs.existsSync(workflow.projectPath)) {
                    fs.rmSync(workflow.projectPath, { recursive: true, force: true });
                }
            } catch (cleanupError) {
                console.error('Create project cleanup error:', cleanupError);
            }
        }
        res.status(error.code === 'EEXIST' ? 409 : 500).json({ error: error.message });
    }
});

app.post('/api/projects/:id/assets/import', (req, res) => {
    try {
        const workflowPath = path.join(WORKFLOWS_DIR, `${req.params.id}.json`);
        if (!fs.existsSync(workflowPath)) return res.status(404).json({ error: '项目不存在' });
        const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
        const imported = importProjectAsset(workflow, req.body?.sourceUrl, projectAssetDirs());
        workflow.updatedAt = new Date().toISOString();
        fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
        writeProjectManifest(workflow);
        res.json({ success: true, ...imported, projectDirName: workflow.projectDirName });
    } catch (error) {
        console.error('Import project asset error:', error);
        const status = error.code === 'ENOENT' ? 404 : error.code === 'UNSUPPORTED_ASSET_URL' ? 400 : 500;
        res.status(status).json({ error: error.message });
    }
});

app.post('/api/projects/:id/assets/upload-image', (req, res) => {
    try {
        const workflowPath = path.join(WORKFLOWS_DIR, `${req.params.id}.json`);
        if (!fs.existsSync(workflowPath)) return res.status(404).json({ error: '项目不存在' });
        const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
        const saved = saveProjectImageUpload(workflow, req.body, { projectsDir: PROJECTS_DIR });
        workflow.updatedAt = new Date().toISOString();
        fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
        writeProjectManifest(workflow);
        res.status(201).json({ success: true, ...saved });
    } catch (error) {
        console.error('Upload project image error:', error);
        const status = error.code === 'UNSUPPORTED_IMAGE' || error.code === 'IMAGE_TOO_LARGE' ? 400 : 500;
        res.status(status).json({ error: error.message });
    }
});

app.get('/api/projects/:id/assets', (req, res) => {
    try {
        const workflowPath = path.join(WORKFLOWS_DIR, `${req.params.id}.json`);
        if (!fs.existsSync(workflowPath)) return res.status(404).json({ error: '项目不存在' });
        const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
        if (!workflow.projectDirName) return res.json([]);
        const projectRoot = ensureProjectFolder(workflow, { projectsDir: PROJECTS_DIR });
        const result = [];
        for (const type of ['images', 'videos', 'audio']) {
            const dir = path.join(projectRoot, type);
            if (!fs.existsSync(dir)) continue;
            const allowed = type === 'images'
                ? /\.(png|jpe?g|webp|gif|avif)$/i
                : type === 'videos' ? /\.(mp4|webm|mov|m4v|mkv)$/i : /\.(mp3|wav|aac|ogg|m4a)$/i;
            for (const filename of fs.readdirSync(dir).filter(name => allowed.test(name))) {
                const base = filename.slice(0, filename.lastIndexOf('.'));
                let meta = {};
                const sidecar = path.join(dir, `${base}.json`);
                try { if (fs.existsSync(sidecar)) meta = JSON.parse(fs.readFileSync(sidecar, 'utf8')); } catch { /* ignore bad sidecar */ }
                const stat = fs.statSync(path.join(dir, filename));
                result.push({
                    ...meta,
                    id: meta.id || `${type}:${base}`,
                    filename,
                    name: meta.prompt || meta.originalName || meta.text || filename,
                    type: type === 'images' ? 'image' : type === 'videos' ? 'video' : 'audio',
                    url: `/library/projects/${encodeURIComponent(workflow.projectDirName)}/${type}/${encodeURIComponent(filename)}`,
                    createdAt: meta.createdAt || stat.mtime.toISOString()
                });
            }
        }
        result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json(result);
    } catch (error) {
        console.error('List project assets error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Save/Update workflow
app.post('/api/workflows', async (req, res) => {
    try {
        const workflow = req.body;
        if (!workflow.id) {
            workflow.id = crypto.randomUUID();
        }
        workflow.updatedAt = new Date().toISOString();
        if (!workflow.createdAt) {
            workflow.createdAt = workflow.updatedAt;
        }


        const filePath = path.join(WORKFLOWS_DIR, `${workflow.id}.json`);

        // Preserve existing coverUrl and project directory identity — neither is
        // sent by the client, so without this they'd be lost/regenerated on every save
        // (assetsDirName in particular must stay frozen once assigned; see projectAssets.js).
        if (fs.existsSync(filePath)) {
            try {
                const existingData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                if (existingData.title !== workflow.title && findWorkflowByTitle(workflow.title, workflow.id)) {
                    return res.status(409).json({ error: '项目名称已存在，请换一个名称' });
                }
                if (existingData.coverUrl) {
                    workflow.coverUrl = existingData.coverUrl;
                }
                if (existingData.assetsDirName) {
                    workflow.assetsDirName = existingData.assetsDirName;
                }
                if (existingData.projectDirName) {
                    workflow.projectDirName = existingData.projectDirName;
                    if (existingData.projectPath) {
                        workflow.projectPath = existingData.projectPath;
                        workflow.projectStorage = existingData.projectStorage || 'custom';
                    }
                    if (existingData.title !== workflow.title) {
                        renameWorkflowAssetDirs(workflow, workflow.title, {
                            projectsDir: PROJECTS_DIR,
                            imagesDir: IMAGES_DIR,
                            videosDir: VIDEOS_DIR
                        });
                    }
                }
            } catch (readError) {
                console.warn("Could not read existing workflow to preserve cover:", readError);
            }
        }

        // Sanitize nodes: convert any base64 data to file URLs before saving
        let sanitizedCount = 0;
        if (workflow.nodes) {
            const result = sanitizeWorkflowNodes(workflow.nodes, workflow.id);
            workflow.nodes = result.nodes;
            sanitizedCount = result.sanitizedCount;
        }

        // Organize this workflow's media into its own per-project folder
        // (library/images|videos/{assetsDirName}/) so it can be browsed both
        // in-app (filtered by project) and directly in Finder.
        const { changed: assetsOrganized } = organizeWorkflowAssets(workflow, {
            libraryDir: LIBRARY_DIR,
            projectsDir: PROJECTS_DIR,
            imagesDir: IMAGES_DIR,
            videosDir: VIDEOS_DIR,
            audioDir: AUDIO_DIR
        });

        fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2));
        writeProjectManifest(workflow);

        // Only send nodes back when something actually changed (base64 sanitized
        // and/or media relocated into the project folder), so the client can sync
        // its local state and stop re-sending stale base64/URLs on the next save.
        res.json({
            success: true,
            id: workflow.id,
            projectDirName: workflow.projectDirName,
            ...(sanitizedCount > 0 || assetsOrganized ? { nodes: workflow.nodes } : {})
        });
    } catch (error) {
        console.error("Save workflow error:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- Public Workflows API (bundled examples) ---

// List public workflows (shipped with the repo in public/workflows/)
// Dynamically scans directory - no need to maintain index.json manually
app.get('/api/public-workflows', async (req, res) => {
    try {
        const publicWorkflowsDir = path.join(__dirname, '..', 'public', 'workflows');

        if (!fs.existsSync(publicWorkflowsDir)) {
            return res.json([]);
        }

        // Scan all .json files except index.json
        const files = fs.readdirSync(publicWorkflowsDir)
            .filter(f => f.endsWith('.json') && f !== 'index.json');

        const workflows = files.map(file => {
            try {
                const content = fs.readFileSync(path.join(publicWorkflowsDir, file), 'utf8');
                const workflow = JSON.parse(content);

                // Generate description from workflow content
                const nodeTypes = workflow.nodes?.reduce((acc, n) => {
                    acc[n.type] = (acc[n.type] || 0) + 1;
                    return acc;
                }, {}) || {};
                const typesSummary = Object.entries(nodeTypes)
                    .map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`)
                    .join(', ');
                const description = workflow.description ||
                    (typesSummary ? `Workflow with ${typesSummary}` : 'A public workflow template');

                return {
                    id: file.replace('.json', ''),
                    title: workflow.title || 'Untitled Workflow',
                    description,
                    nodeCount: workflow.nodes?.length || 0,
                    coverUrl: workflow.coverUrl || null
                };
            } catch (parseError) {
                console.warn(`Skipping invalid workflow file: ${file}`, parseError.message);
                return null;
            }
        }).filter(Boolean); // Remove any null entries from parse errors

        // Sort by title alphabetically
        workflows.sort((a, b) => a.title.localeCompare(b.title));

        res.json(workflows);
    } catch (error) {
        console.error("List public workflows error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Load specific public workflow
app.get('/api/public-workflows/:id', async (req, res) => {
    try {
        const publicWorkflowsDir = path.join(__dirname, '..', 'public', 'workflows');
        const filePath = path.join(publicWorkflowsDir, `${req.params.id}.json`);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: "Public workflow not found" });
        }

        const content = fs.readFileSync(filePath, 'utf8');
        res.json(JSON.parse(content));
    } catch (error) {
        console.error("Load public workflow error:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- User Workflows API ---

// List all workflows
app.get('/api/workflows', async (req, res) => {
    try {
        const files = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.json'));
        const workflows = files.map(file => {
            const content = fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8');
            const workflow = JSON.parse(content);
            return {
                id: workflow.id,
                title: workflow.title,
                createdAt: workflow.createdAt,
                updatedAt: workflow.updatedAt,
                nodeCount: workflow.nodes?.length || 0,
                coverUrl: workflow.coverUrl,
                // 工作流选择卡片使用真实节点生成画布缩略图，只返回预览所需字段。
                previewNodes: (workflow.nodes || []).map(node => ({
                    id: node.id,
                    type: node.type,
                    x: node.x,
                    y: node.y,
                    status: node.status,
                    resultUrl: node.resultUrl,
                    resultAspectRatio: node.resultAspectRatio,
                    aspectRatio: node.aspectRatio,
                    parentIds: node.parentIds
                }))
            };
        });
        workflows.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        res.json(workflows);
    } catch (error) {
        console.error("List workflows error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Load specific workflow
app.get('/api/workflows/:id', async (req, res) => {
    try {
        const filePath = path.join(WORKFLOWS_DIR, `${req.params.id}.json`);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: "Workflow not found" });
        }
        const workflow = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const { changed } = organizeWorkflowAssets(workflow, projectAssetDirs());
        if (changed) {
            workflow.updatedAt = new Date().toISOString();
            fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2));
            writeProjectManifest(workflow);
        }
        res.json(workflow);
    } catch (error) {
        console.error("Load workflow error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Delete workflow
app.delete('/api/workflows/:id', async (req, res) => {
    try {
        const filePath = path.join(WORKFLOWS_DIR, `${req.params.id}.json`);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: "Workflow not found" });
        }
        let workflow = null;
        try {
            workflow = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (readError) {
            console.warn("Could not read workflow before delete:", readError);
        }
        fs.unlinkSync(filePath);
        // Also remove this project's own asset folders (the flat pool / other
        // projects' copies are untouched — see projectAssets.js).
        deleteWorkflowAssetDirs(workflow, { imagesDir: IMAGES_DIR, videosDir: VIDEOS_DIR, projectsDir: PROJECTS_DIR });
        res.json({ success: true });
    } catch (error) {
        console.error("Delete workflow error:", error);
        res.status(500).json({ error: error.message });
    }
});

// 运行时能力探测：前端据此把「需本地配置」的模型置灰，而不是让用户点了才报错。
app.get('/api/capabilities', (req, res) => {
    res.json({
        // Google Flow / 即梦 依赖 server/python 下的浏览器自动化运行时，
        // 未安装时这些模型不可用，但其余官方 API 模型照常工作。
        browserModels: {
            ready: isBrowserModelsReady(),
            sessions: browserSessionState.list(),
            models: [
                'google-flow-omni-flash',
                'google-flow-veo-3-1-lite',
                'google-flow-nano-banana-pro',
                'google-flow-nano-banana-2',
                'google-flow-nano-banana-2-lite',
                'jimeng-image-5-0-pro',
                'jimeng-image-5-0-lite',
                'jimeng-seedance-2-0-mini',
                'jimeng-seedance-2-0-fast-standard',
                'jimeng-seedance-2-0-standard',
                'jimeng-seedance-2-0',
                'jimeng-seedance-2-0-fast'
            ],
            setupCommand: 'npm run setup:browser-models',
            hint: BROWSER_MODELS_SETUP_HINT
        },
        platform: process.platform
    });
});

app.post('/api/browser-sessions/:provider/reauthenticate', async (req, res) => {
    const provider = String(req.params.provider || '');
    if (!['google-flow', 'jimeng'].includes(provider)) {
        return res.status(400).json({ error: '不支持的浏览器登录平台' });
    }
    try {
        const { data } = await runOpsCli({
            args: ['browser', 'login', '--provider', provider],
            timeoutMs: 90_000,
            label: `${provider} 登录`,
            initialSessionState: 'reauthenticating',
            successSessionState: 'reauthenticating'
        });
        res.json({
            success: true,
            provider,
            session: browserSessionState.get(provider),
            ...data
        });
    } catch (error) {
        res.status(500).json({
            error: error.message,
            code: error.code || 'BROWSER_LOGIN_FAILED',
            session: browserSessionState.get(provider)
        });
    }
});

app.post('/api/browser/open', async (_req, res) => {
    try {
        const { data } = await runOpsCli({
            args: ['browser', 'open'],
            timeoutMs: 30_000,
            label: '打开内置浏览器'
        });
        res.json({ success: true, ...data });
    } catch (error) {
        res.status(500).json({
            error: error.message,
            code: error.code || 'BROWSER_OPEN_FAILED'
        });
    }
});

// 在系统文件管理器中打开该项目的素材目录（Finder / 资源管理器 / 桌面环境默认）
app.post('/api/workflows/:id/reveal-assets', async (req, res) => {
    try {
        const filePath = path.join(WORKFLOWS_DIR, `${req.params.id}.json`);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: "Workflow not found" });
        }
        const workflow = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!workflow.projectDirName && !workflow.assetsDirName) {
            return res.status(404).json({ error: "该项目还没有生成任何素材" });
        }
        const dir = workflow.projectDirName
            ? ensureProjectFolder(workflow, { projectsDir: PROJECTS_DIR })
            : path.join(IMAGES_DIR, workflow.assetsDirName);
        fs.mkdirSync(dir, { recursive: true });
        // 三平台各自的「打开目录」命令，写法与 server/routes/render.js 保持一致。
        const opener = process.platform === 'darwin'
            ? 'open'
            : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
        execFile(opener, [dir], (err) => {
            // explorer.exe 打开成功时也可能返回非 0 退出码，这里不据此判失败。
            if (err && process.platform !== 'win32') {
                console.error('Failed to open file manager:', err);
                return res.status(500).json({ error: err.message });
            }
            res.json({ success: true });
        });
    } catch (error) {
        console.error("Reveal assets error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Update workflow title and keep its Finder-visible asset folders in sync.
app.put('/api/workflows/:id/title', async (req, res) => {
    let assetRename = null;
    let tempFilePath = null;
    try {
        const { title } = req.body;
        if (!title || !title.trim()) {
            return res.status(400).json({ error: "标题不能为空" });
        }
        const filePath = path.join(WORKFLOWS_DIR, `${req.params.id}.json`);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: "Workflow not found" });
        }

        const workflowData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const nextTitle = title.trim();
        if (findWorkflowByTitle(nextTitle, workflowData.id)) {
            return res.status(409).json({ error: '项目名称已存在，请换一个名称' });
        }
        assetRename = renameWorkflowAssetDirs(workflowData, nextTitle, {
            projectsDir: PROJECTS_DIR,
            imagesDir: IMAGES_DIR,
            videosDir: VIDEOS_DIR
        });
        workflowData.title = nextTitle;
        workflowData.updatedAt = new Date().toISOString();
        tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tempFilePath, JSON.stringify(workflowData, null, 2));
        fs.renameSync(tempFilePath, filePath);
        tempFilePath = null;
        writeProjectManifest(workflowData);

        res.json({
            success: true,
            title: workflowData.title,
            assetsDirName: workflowData.assetsDirName || null,
            projectDirName: workflowData.projectDirName || null,
            projectPath: workflowData.projectPath || null,
            nodes: workflowData.nodes || [],
            coverUrl: workflowData.coverUrl || null
        });
    } catch (error) {
        if (tempFilePath && fs.existsSync(tempFilePath)) fs.rmSync(tempFilePath, { force: true });
        try {
            assetRename?.rollback?.();
        } catch (rollbackError) {
            console.error("Asset directory rollback error:", rollbackError);
        }
        console.error("Update title error:", error);
        res.status(error.code === 'EEXIST' ? 409 : 500).json({ error: error.message });
    }
});

// Update workflow cover
app.put('/api/workflows/:id/cover', async (req, res) => {
    try {
        const { coverUrl } = req.body;
        const filePath = path.join(WORKFLOWS_DIR, `${req.params.id}.json`);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: "Workflow not found" });
        }

        const workflowData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        workflowData.coverUrl = coverUrl;
        workflowData.updatedAt = new Date().toISOString();
        fs.writeFileSync(filePath, JSON.stringify(workflowData, null, 2));
        writeProjectManifest(workflowData);

        res.json({ success: true, coverUrl });
    } catch (error) {
        console.error("Update cover error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// GEMINI IMAGE DESCRIPTION API
// ============================================================================

// Describe an image for prompt generation
app.post('/api/gemini/describe-image', async (req, res) => {
    try {
        const { imageUrl, prompt } = req.body;
        console.log(`[Gemini DescribeV2] Request received. imageUrl: ${imageUrl ? (imageUrl.length > 100 ? imageUrl.substring(0, 100) + '...' : imageUrl) : 'missing'}`);
        // DEBUG: Verify story context injection
        if (prompt) {
            console.log('[Gemini DescribeV2] Received Prompt:', prompt);
        }

        if (!imageUrl) {
            return res.status(400).json({ error: 'Image URL is required' });
        }

        // 统一支持 data URL、旧素材路径和 project 项目目录路径。
        const imageDataUrl = resolveImageToBase64(imageUrl);
        const imageMatch = imageDataUrl?.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,(.+)$/s);
        const imagePart = imageMatch ? {
            inlineData: {
                data: imageMatch[2],
                mimeType: imageMatch[1]
            }
        } : null;

        if (!imagePart) {
            console.log('[Gemini DescribeV2] Failed to process image part');
            return res.status(400).json({ error: 'Could not process image URL. Provide base64 data or a valid library path.', debug: { imageUrl } });
        }

        const client = getClient();
        // Correct SDK usage for @google/genai ^1.32.0
        const result = await client.models.generateContent({
            model: "gemini-2.0-flash",
            contents: {
                parts: [
                    { text: prompt || "Describe this image in detail for video generation." },
                    imagePart
                ]
            }
        });

        let text = "";

        // Handle @google/genai SDK response structure
        if (result.candidates && result.candidates.length > 0) {
            const candidate = result.candidates[0];
            if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                text = candidate.content.parts[0].text || "";
            }
        }
        // Fallback for other potential response shapes
        else if (result.response && typeof result.response.text === 'function') {
            text = result.response.text();
        }

        if (!text) {
            console.warn('[Gemini DescribeV2] Warning: No text content found in response.');
            console.debug('[Gemini DescribeV2] Response dump:', JSON.stringify(result, null, 2));
        }

        res.json({ description: text });

    } catch (error) {
        console.error("Describe image error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Reverse an image into a generation prompt through the prompt backend selected
// in Settings. Codex CLI accepts the current node image directly and needs no
// additional API key.
app.post('/api/prompt/describe-image', async (req, res) => {
    try {
        const { imageUrl, prompt } = req.body;
        if (!imageUrl) return res.status(400).json({ error: '当前节点没有可分析的图片' });
        if (!prompt) return res.status(400).json({ error: '缺少图片提示词生成指令' });

        const imageDataUrl = resolveImageToBase64(imageUrl);
        if (!imageDataUrl?.startsWith('data:image/')) {
            return res.status(400).json({ error: '无法读取当前节点图片，请确认项目素材文件仍然存在' });
        }

        const providerId = req.app.locals.PROMPT_OPTIMIZER_PROVIDER || 'deepseek';
        const provider = getPromptOptimizerProvider(providerId);
        if (!provider) return res.status(400).json({ error: `未知的提示词后端：${providerId}` });
        if (!provider.supportsImage) {
            return res.status(400).json({ error: `${provider.label} 不支持识图，请在设置中选择 Codex CLI（本机）` });
        }

        const model = req.app.locals.PROMPT_OPTIMIZER_MODEL || provider.defaultModel;
        let text;
        try {
            text = await provider.run({
                systemInstruction: prompt,
                userPrompt: '请严格按照上述规则分析随请求附带的当前节点图片。',
                imageDataUrl,
                model,
                effort: provider.defaultEffort || '',
                temperature: 0.2,
                maxTokens: 2500
            });
        } catch (upstreamError) {
            return res.status(upstreamError.status || 502).json({ error: upstreamError.message });
        }

        const description = String(text || '').trim();
        if (!description) return res.status(500).json({ error: '图片提示词生成结果为空' });
        return res.json({ description, provider: providerId, model });
    } catch (error) {
        console.error('Reverse image prompt error:', error);
        return res.status(500).json({ error: error.message });
    }
});

// Optimize image/video prompts through extensible shared profiles + pluggable LLM backends.
// System instruction is model-agnostic (shared/promptOptimizationProfiles.js); the backend is
// chosen by PROMPT_OPTIMIZER_PROVIDER (default DeepSeek). Adding Claude / Codex = register a
// provider in services/promptOptimizerProviders.js — this handler stays unchanged.
// The old Gemini-named route remains as a compatibility alias for StoryboardVideoModal.
const optimizePromptHandler = async (req, res) => {
    try {
        const { prompt, profileId = 'video', context = {} } = req.body;
        const profile = getPromptOptimizationProfile(profileId);

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }
        if (!profile) {
            return res.status(400).json({ error: `Unknown prompt optimization profile: ${profileId}` });
        }

        const providerId = req.app.locals.PROMPT_OPTIMIZER_PROVIDER || 'deepseek';
        const provider = getPromptOptimizerProvider(providerId);
        if (!provider) {
            return res.status(400).json({ error: `未知的提示词优化后端：${providerId}` });
        }
        // HTTP API 后端需要密钥；本地 CLI 后端（apiKeyField 为 null）用本机已登录的 CLI，无需密钥。
        let apiKey;
        if (provider.apiKeyField) {
            apiKey = req.app.locals[provider.apiKeyField];
            if (!apiKey) {
                return res.status(400).json({ error: `未配置 ${provider.apiKeyField}，请先在 API 密钥设置中添加` });
            }
        }
        const model = req.app.locals.PROMPT_OPTIMIZER_MODEL || provider.defaultModel;
        const effort = provider.defaultEffort || '';
        console.log(`[Prompt Optimize:${providerId}] Model: ${model}${effort ? ` (effort=${effort})` : ''}. Profile: ${profileId}. Prompt: ${prompt.length > 50 ? prompt.substring(0, 50) + '...' : prompt}`);

        const systemInstruction = buildPromptOptimizationInstruction(profile, context);

        let text;
        try {
            text = await provider.run({
                systemInstruction,
                userPrompt: prompt,
                apiKey,
                model,
                effort,
                temperature: 0.25,
                maxTokens: 2500
            });
        } catch (upstreamError) {
            return res.status(upstreamError.status || 502).json({ error: upstreamError.message });
        }

        if (!text) {
            console.warn(`[Prompt Optimize:${providerId}] Warning: No text content found in response.`);
            return res.status(500).json({ error: 'Failed to optimize prompt' });
        }

        text = formatOptimizedPrompt(text, profile);

        res.json({
            optimizedPrompt: text,
            profileId: profile.id,
            aspectRatio: profile.aspectRatio
        });

    } catch (error) {
        console.error("Optimize prompt error:", error);
        res.status(500).json({ error: error.message });
    }
};

app.post('/api/prompt/optimize', optimizePromptHandler);
app.post('/api/gemini/optimize-prompt', optimizePromptHandler);

// NOTE: Old generation routes removed - now in server/routes/generation.js


// ============================================================================
// ASSET HISTORY API
// ============================================================================

// Save an asset (image or video)
app.post('/api/assets/:type', async (req, res) => {
    try {
        const { type } = req.params;
        const { data, prompt, originalFilename, mimeType, workflowId } = req.body;

        if (!['images', 'videos'].includes(type)) {
            return res.status(400).json({ error: 'Invalid asset type' });
        }

        const { targetDir, urlPrefix } = resolveProjectMediaTarget(workflowId, type, {
            workflowsDir: WORKFLOWS_DIR,
            projectsDir: PROJECTS_DIR
        });
        const id = Date.now().toString();
        const requestedVideoExtension = path.extname(originalFilename || '').toLowerCase().replace('.', '');
        const supportedVideoExtensions = new Set(['mp4', 'webm', 'mov', 'm4v']);
        const mimeVideoExtension = {
            'video/mp4': 'mp4',
            'video/webm': 'webm',
            'video/quicktime': 'mov',
            'video/x-m4v': 'm4v',
        }[mimeType];
        const ext = type === 'images'
            ? 'png'
            : supportedVideoExtensions.has(requestedVideoExtension)
                ? requestedVideoExtension
                : mimeVideoExtension || 'mp4';
        const filename = `${id}.${ext}`;
        const metaFilename = `${id}.json`;

        // Save the asset file
        const base64Data = data.replace(/^data:[^;]+;base64,/, '');
        fs.writeFileSync(path.join(targetDir, filename), base64Data, 'base64');

        // Save metadata
        const metadata = {
            id,
            filename,
            prompt: prompt || '',
            originalFilename: originalFilename || undefined,
            mimeType: mimeType || undefined,
            createdAt: new Date().toISOString(),
            type
        };
        fs.writeFileSync(path.join(targetDir, metaFilename), JSON.stringify(metadata, null, 2));

        res.json({ success: true, id, filename, url: `${urlPrefix}/${filename}` });
    } catch (error) {
        console.error('Save asset error:', error);
        res.status(500).json({ error: error.message });
    }
});

// List all assets of a type (with pagination support)
// Pass ?workflowId=<id> to scope the listing to that project's own folder instead
// of the global flat pool (used by the History panel's "本项目" tab).
app.get('/api/assets/:type', async (req, res) => {
    try {
        const { type } = req.params;
        const { workflowId } = req.query;
        const limit = parseInt(req.query.limit) || 0; // 0 = no limit (backward compatible)
        const offset = parseInt(req.query.offset) || 0;

        if (!['images', 'videos'].includes(type)) {
            return res.status(400).json({ error: 'Invalid asset type' });
        }

        const emptyResult = () => res.json(limit > 0 ? { assets: [], total: 0, hasMore: false } : []);

        let targetDir = type === 'images' ? IMAGES_DIR : VIDEOS_DIR;
        let urlPrefix = `/library/${type}`;

        if (workflowId) {
            const wfPath = path.join(WORKFLOWS_DIR, `${workflowId}.json`);
            if (!fs.existsSync(wfPath)) return emptyResult();
            let assetsDirName;
            let projectDirName;
            try {
                const workflow = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
                assetsDirName = workflow.assetsDirName;
                projectDirName = workflow.projectDirName;
            } catch (e) {
                return emptyResult();
            }
            if (projectDirName) {
                targetDir = path.join(PROJECTS_DIR, projectDirName, type);
                urlPrefix = `/library/projects/${encodeURIComponent(projectDirName)}/${type}`;
            } else {
                if (!assetsDirName) return emptyResult(); // legacy project has no organized media yet
                targetDir = path.join(targetDir, assetsDirName);
                urlPrefix = `${urlPrefix}/${assetsDirName}`;
            }
        }

        if (!fs.existsSync(targetDir)) {
            return emptyResult();
        }

        const files = fs.readdirSync(targetDir);
        const assets = [];

        if (workflowId) {
            // Project folders often contain media with no sidecar metadata (workflow-editor
            // saves, generation results) — unlike the global pool, everything physically in
            // this folder belongs to the project, so list every media file directly and
            // enrich it with sidecar JSON where one happens to exist (same basename).
            const mediaExts = type === 'images'
                ? new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
                : new Set(['.mp4', '.webm', '.mov', '.m4v']);

            for (const file of files) {
                const ext = path.extname(file).toLowerCase();
                if (!mediaExts.has(ext)) continue;

                const base = file.slice(0, file.lastIndexOf('.'));
                const sidecarPath = path.join(targetDir, `${base}.json`);
                let metadata = { id: base, filename: file, prompt: '', type };
                if (fs.existsSync(sidecarPath)) {
                    try {
                        metadata = { ...metadata, ...JSON.parse(fs.readFileSync(sidecarPath, 'utf8')) };
                    } catch (e) {
                        // Fall back to the synthesized metadata below
                    }
                }
                if (!metadata.createdAt) {
                    metadata.createdAt = fs.statSync(path.join(targetDir, file)).mtime.toISOString();
                }
                metadata.filename = file;
                metadata.url = `${urlPrefix}/${file}`;
                assets.push(metadata);
            }
        } else {
            for (const file of files) {
                if (file.endsWith('.json')) {
                    try {
                        const content = fs.readFileSync(path.join(targetDir, file), 'utf8');
                        const metadata = JSON.parse(content);
                        metadata.url = `${urlPrefix}/${metadata.filename}`;
                        assets.push(metadata);
                    } catch (e) {
                        // Skip invalid JSON files
                    }
                }
            }
        }

        // Sort by createdAt descending (newest first)
        assets.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        // If limit is specified, return paginated response
        if (limit > 0) {
            const paginatedAssets = assets.slice(offset, offset + limit);
            return res.json({
                assets: paginatedAssets,
                total: assets.length,
                hasMore: offset + limit < assets.length
            });
        }

        // Backward compatible: return full array if no limit specified
        res.json(assets);
    } catch (error) {
        console.error('List assets error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete an asset
app.delete('/api/assets/:type/:id', async (req, res) => {
    try {
        const { type, id } = req.params;

        if (!['images', 'videos'].includes(type)) {
            return res.status(400).json({ error: 'Invalid asset type' });
        }

        const targetDir = type === 'images' ? IMAGES_DIR : VIDEOS_DIR;
        const metaPath = path.join(targetDir, `${id}.json`);

        // Read metadata to get the actual filename (may differ from ID)
        let assetFilename = null;
        if (fs.existsSync(metaPath)) {
            try {
                const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                assetFilename = metadata.filename;
            } catch (e) {
                console.warn(`Could not read metadata for ${id}:`, e.message);
            }
        }

        // Delete the media file using filename from metadata
        if (assetFilename) {
            const assetPath = path.join(targetDir, assetFilename);
            if (fs.existsSync(assetPath)) {
                fs.unlinkSync(assetPath);
                console.log(`Deleted asset file: ${assetPath}`);
            }
        }

        // Delete the metadata file
        if (fs.existsSync(metaPath)) {
            fs.unlinkSync(metaPath);
            console.log(`Deleted metadata file: ${metaPath}`);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Delete asset error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// TIKTOK IMPORT API
// ============================================================================

/**
 * Import a TikTok video without watermark
 * Downloads the video, optionally trims first/last frames, saves to library
 */
app.post('/api/tiktok/import', async (req, res) => {
    try {
        const { url, enableTrim = true } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'TikTok URL is required' });
        }

        if (!isValidTikTokUrl(url)) {
            return res.status(400).json({ error: 'Invalid TikTok URL format. Please provide a valid TikTok video URL.' });
        }

        console.log(`[TikTok API] Processing import request for: ${url}`);

        const result = await processTikTokVideo(url, VIDEOS_DIR, enableTrim);

        res.json(result);
    } catch (error) {
        console.error('[TikTok API] Import error:', error);
        res.status(500).json({
            error: error.message || 'Failed to import TikTok video',
            details: error.toString()
        });
    }
});

/**
 * Validate a TikTok URL without downloading
 */
app.post('/api/tiktok/validate', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ valid: false, error: 'URL is required' });
        }

        const valid = isValidTikTokUrl(url);
        res.json({ valid, url });
    } catch (error) {
        res.status(500).json({ valid: false, error: error.message });
    }
});

// ============================================================================
// VIDEO TRIM API
// ============================================================================

/**
 * Check if FFmpeg is available on the system
 */
async function isFFmpegAvailable() {
    return new Promise((resolve) => {
        const proc = spawn(FFMPEG_PATH, ['-version']);
        proc.on('close', (code) => resolve(code === 0));
        proc.on('error', () => resolve(false));
    });
}

/**
 * Trim a video using FFmpeg
 * @param {string} inputPath - Input video path
 * @param {string} outputPath - Output video path
 * @param {number} startTime - Start time in seconds
 * @param {number} endTime - End time in seconds
 */
async function trimVideoWithFFmpeg(inputPath, outputPath, startTime, endTime) {
    return new Promise((resolve, reject) => {
        const duration = endTime - startTime;

        if (duration <= 0) {
            reject(new Error('Invalid trim range: end time must be greater than start time'));
            return;
        }

        const args = [
            '-y',                           // Overwrite output
            '-i', inputPath,                // Input file
            '-ss', startTime.toString(),    // Start time
            '-t', duration.toString(),      // Duration
            '-c:v', 'libx264',              // Video codec
            '-c:a', 'aac',                  // Audio codec
            '-preset', 'fast',              // Encoding speed
            '-crf', '23',                   // Quality (lower = better)
            outputPath                       // Output file
        ];

        console.log(`[Video Trim] Running FFmpeg with args:`, args.join(' '));

        const proc = spawn(FFMPEG_PATH, args);

        const stderrChunks = [];
        proc.stderr.on('data', (data) => {
            stderrChunks.push(Buffer.from(data));
        });

        proc.on('close', (code) => {
            if (code === 0) {
                console.log(`[Video Trim] Successfully trimmed video`);
                resolve();
            } else {
                const stderr = decodeProcessOutput(stderrChunks);
                reject(new Error(`FFmpeg failed with code ${code}: ${stderr.slice(-500)}`));
            }
        });

        proc.on('error', (err) => {
            reject(new Error(`FFmpeg error: ${err.message}`));
        });
    });
}

/**
 * Trim a video and save to library
 * Accepts video URL (from library), start/end times, and saves trimmed video
 */
app.post('/api/trim-video', async (req, res) => {
    try {
        const { videoUrl, startTime, endTime, nodeId } = req.body;

        if (!videoUrl || startTime === undefined || endTime === undefined) {
            return res.status(400).json({ error: 'videoUrl, startTime, and endTime are required' });
        }

        console.log(`[Video Trim] Request: ${videoUrl}, ${startTime}s to ${endTime}s`);

        // Check if FFmpeg is available
        const ffmpegAvailable = await isFFmpegAvailable();
        if (!ffmpegAvailable) {
            return res.status(500).json({
                error: 'Evan 内置 FFmpeg 不可用，请重新安装或重新执行 npm install。'
            });
        }

        // Strip query string from URL (e.g., ?t=123456 cache busters)
        const cleanVideoUrl = videoUrl.split('?')[0];

        // Resolve video path from URL
        let inputPath;
        if (cleanVideoUrl.startsWith('/library/videos/')) {
            inputPath = path.join(VIDEOS_DIR, cleanVideoUrl.replace('/library/videos/', ''));
        } else if (cleanVideoUrl.startsWith('http')) {
            // For remote URLs, we'd need to download first - for now, only local library videos
            return res.status(400).json({ error: 'Only local library videos can be trimmed' });
        } else {
            return res.status(400).json({ error: 'Invalid video URL format' });
        }

        // Check if input file exists
        if (!fs.existsSync(inputPath)) {
            console.error(`[Video Trim] Input file not found: ${inputPath}`);
            return res.status(404).json({ error: 'Source video not found' });
        }

        // Generate unique output filename
        const timestamp = Date.now();
        const hash = crypto.randomBytes(4).toString('hex');
        const outputFilename = `trimmed_${timestamp}_${hash}.mp4`;
        const outputPath = path.join(VIDEOS_DIR, outputFilename);

        // Trim the video
        await trimVideoWithFFmpeg(inputPath, outputPath, startTime, endTime);

        // Save metadata for history panel
        const id = `${timestamp}_${hash}`;
        const metaFilename = `${id}.json`;
        const metadata = {
            id,
            filename: outputFilename,
            prompt: `Trimmed video (${startTime.toFixed(1)}s - ${endTime.toFixed(1)}s)`,
            model: 'video-editor',
            sourceUrl: videoUrl,
            trimStart: startTime,
            trimEnd: endTime,
            createdAt: new Date().toISOString(),
            type: 'videos'
        };
        fs.writeFileSync(path.join(VIDEOS_DIR, metaFilename), JSON.stringify(metadata, null, 2));

        const resultUrl = `/library/videos/${outputFilename}`;
        console.log(`[Video Trim] Saved: ${resultUrl}`);

        res.json({
            success: true,
            url: resultUrl,
            filename: outputFilename,
            duration: endTime - startTime
        });

    } catch (error) {
        console.error('[Video Trim] Error:', error);
        res.status(500).json({
            error: error.message || 'Failed to trim video',
            details: error.toString()
        });
    }
});

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
    startBackend();
}
