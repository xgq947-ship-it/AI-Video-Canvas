/**
 * routes/projects.js
 *
 * 项目（project）本身：新建、导入本地项目、项目内素材导入/上传/列出/改名。
 * 从 server/index.js 原样搬出，行为未做改动。
 */

import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import path from 'path';

import { importLocalProject } from '../services/projectImport.js';
import {
    readProjectAssetMetadata,
    resolveProjectAssetDisplayName,
    updateProjectAssetDisplayName
} from '../services/projectAssetNames.js';
import {
    deleteWorkflowAssetDirs,
    ensureProjectFolder,
    importProjectAsset,
    resolveWorkflowProjectRoot,
    sanitizeProjectDirName,
    saveProjectImageUpload
} from '../utils/projectAssets.js';
import { findWorkflowByTitle, writeProjectManifest } from '../utils/workflowStore.js';
import { IMAGES_DIR, PROJECTS_DIR, VIDEOS_DIR, WORKFLOWS_DIR, projectAssetDirs } from '../runtime/libraryPaths.js';

const router = express.Router();

router.post('/', (req, res) => {
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

// Import a self-contained project folder selected by the Electron main process.
// The renderer never submits an arbitrary filesystem path directly; the desktop
// token keeps this capability behind the native folder picker.
router.post('/import', (req, res) => {
    if (
        !process.env.EVAN_DESKTOP_TOKEN
        || req.get('X-Evan-Desktop-Token') !== process.env.EVAN_DESKTOP_TOKEN
    ) {
        return res.status(403).json({ error: '本地项目只能通过桌面应用选择导入' });
    }

    try {
        const result = importLocalProject(req.body?.sourcePath, {
            projectsDir: PROJECTS_DIR,
            workflowsDir: WORKFLOWS_DIR
        });
        res.status(result.alreadyImported ? 200 : 201).json(result.workflow);
    } catch (error) {
        console.error('Import local project error:', error);
        const status = [
            'PROJECT_MANIFEST_MISSING',
            'PROJECT_MANIFEST_INVALID',
            'INVALID_PROJECT_LOCATION',
            'PROJECT_LOCATION_MISSING'
        ].includes(error.code)
            ? 400
            : 500;
        res.status(status).json({ error: error.message || '本地项目导入失败' });
    }
});

router.post('/:id/assets/import', (req, res) => {
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

const storeProjectImageUpload = (req, res, payload) => {
    try {
        const workflowPath = path.join(WORKFLOWS_DIR, `${req.params.id}.json`);
        if (!fs.existsSync(workflowPath)) return res.status(404).json({ error: '项目不存在' });
        const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
        const saved = saveProjectImageUpload(workflow, payload, { projectsDir: PROJECTS_DIR });
        workflow.updatedAt = new Date().toISOString();
        fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
        writeProjectManifest(workflow);
        res.status(201).json({ success: true, ...saved });
    } catch (error) {
        console.error('Upload project image error:', error);
        const status = error.code === 'UNSUPPORTED_IMAGE' || error.code === 'IMAGE_TOO_LARGE' ? 400 : 500;
        res.status(status).json({ error: error.message });
    }
};

router.post('/:id/assets/upload-image', (req, res) => {
    storeProjectImageUpload(req, res, req.body);
});

/**
 * 二进制直传：请求体就是图片本身，元数据走请求头。
 *
 * 旧的 JSON + data URL 路径对大图非常伤：一张 100MB 的图会在渲染进程里先变成
 * 133MB 的 base64 字符串，JSON.stringify 再复制一份，后端还要解析出同样大的字符串。
 * 走 raw body 之后这三份拷贝都没有了，后端拿到的就是实际大小的 Buffer。
 * 旧路由保留，避免老客户端/其它调用方失效。
 */
router.post(
    '/:id/assets/upload-image-binary',
    express.raw({ type: () => true, limit: '100mb' }),
    (req, res) => {
        // 头部只能是 ASCII，中文文件名由客户端 encodeURIComponent 后传过来。
        const decodeHeader = (value) => {
            if (!value) return '';
            try {
                return decodeURIComponent(String(value));
            } catch {
                return String(value);
            }
        };
        storeProjectImageUpload(req, res, {
            buffer: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
            mimeType: String(req.get('x-evan-mime') || '').toLowerCase(),
            prompt: decodeHeader(req.get('x-evan-prompt')),
            originalFilename: decodeHeader(req.get('x-evan-filename'))
        });
    }
);

router.get('/:id/assets', (req, res) => {
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
                const { metadata: meta } = readProjectAssetMetadata(dir, filename);
                const stat = fs.statSync(path.join(dir, filename));
                result.push({
                    ...meta,
                    id: meta.id || `${type}:${base}`,
                    filename,
                    displayName: meta.displayName || undefined,
                    name: resolveProjectAssetDisplayName(meta, filename, {
                        type,
                        index: result.length + 1
                    }),
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

router.put('/:id/assets/:type/:filename/display-name', (req, res) => {
    try {
        const workflowPath = path.join(WORKFLOWS_DIR, `${req.params.id}.json`);
        if (!fs.existsSync(workflowPath)) return res.status(404).json({ error: '项目不存在' });
        const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
        const projectRoot = resolveWorkflowProjectRoot(workflow, PROJECTS_DIR);
        if (!projectRoot || !fs.existsSync(projectRoot)) {
            return res.status(404).json({ error: '项目目录不存在' });
        }

        const metadata = updateProjectAssetDisplayName(
            projectRoot,
            req.params.type,
            req.params.filename,
            req.body?.displayName
        );

        // Keep canvas rows and the asset tab consistent when both reference the
        // same local file. Only the display label changes; URLs and files stay put.
        const targetFilename = req.params.filename;
        const targetType = req.params.type;
        let workflowChanged = false;
        workflow.nodes = (workflow.nodes || []).map(node => {
            const mediaValues = [
                node.resultUrl,
                node.editorBackgroundUrl,
                node.lastFrame,
                node.mediaUrl,
                node.renderOutputUrl,
            ];
            const referencesTarget = mediaValues.some(value => {
                if (typeof value !== 'string' || !value) return false;
                try {
                    const pathname = value.startsWith('http') ? new URL(value).pathname : value.split('?')[0];
                    const segments = pathname.split('/').filter(Boolean).map(segment => decodeURIComponent(segment));
                    return (
                        segments.at(-4) === 'projects'
                        && segments.at(-3) === workflow.projectDirName
                        && segments.at(-2) === targetType
                        && segments.at(-1) === targetFilename
                    );
                } catch {
                    return false;
                }
            });
            if (!referencesTarget || node.displayName === metadata.displayName) return node;
            workflowChanged = true;
            return { ...node, displayName: metadata.displayName };
        });
        if (workflowChanged) {
            workflow.updatedAt = new Date().toISOString();
            fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
            writeProjectManifest(workflow);
        }

        res.json({ success: true, displayName: metadata.displayName });
    } catch (error) {
        const status = ['ENOENT'].includes(error.code)
            ? 404
            : ['EMPTY_DISPLAY_NAME', 'INVALID_ASSET_FILENAME', 'UNSUPPORTED_MEDIA_TYPE'].includes(error.code)
                ? 400
                : 500;
        res.status(status).json({ error: error.message });
    }
});

export default router;
