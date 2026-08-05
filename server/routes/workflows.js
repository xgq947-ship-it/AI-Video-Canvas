/**
 * routes/workflows.js
 *
 * 画布（workflow）的保存、读取、删除、改名、封面，以及内置示例工作流。
 * 从 server/index.js 原样搬出，行为未做改动。
 */

import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';

import {
    deleteWorkflowAssetDirs,
    organizeWorkflowAssets,
    renameWorkflowAssetDirs,
    resolveWorkflowProjectRoot
} from '../utils/projectAssets.js';
import {
    ensureVideoRemixWorkspaceMigrationBackup,
    writeJsonAtomicSync
} from '../utils/workflowVideoRemixMigration.js';
import {
    reconcileDismissedProjectVideos,
    recoverProjectVideoNodes
} from '../services/projectMediaRecovery.js';
import { findWorkflowByTitle, writeProjectManifest } from '../utils/workflowStore.js';
import { sanitizeWorkflowNodes } from '../utils/workflowSanitize.js';
import {
    AUDIO_DIR,
    IMAGES_DIR,
    LIBRARY_DIR,
    PROJECTS_DIR,
    VIDEOS_DIR,
    WORKFLOWS_DIR,
    projectAssetDirs
} from '../runtime/libraryPaths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 内置示例工作流位于 <repo>/public/workflows；本文件在 server/routes/ 下，
// 因此要回退两级（原来在 server/index.js 里只需回退一级）。
const publicWorkflowsRoot = () => path.join(__dirname, '..', '..', 'public', 'workflows');

const router = express.Router();

router.post('/workflows', async (req, res) => {
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
        let existingData = null;

        // Preserve existing coverUrl and project directory identity — neither is
        // sent by the client, so without this they'd be lost/regenerated on every save
        // (assetsDirName in particular must stay frozen once assigned; see projectAssets.js).
        if (fs.existsSync(filePath)) {
            try {
                existingData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                workflow.createdAt = existingData.createdAt || workflow.createdAt;
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

        if (existingData) {
            ensureVideoRemixWorkspaceMigrationBackup(existingData, workflow, filePath);
            reconcileDismissedProjectVideos(existingData, workflow);
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

        writeJsonAtomicSync(filePath, workflow);
        writeProjectManifest(workflow);

        // Only send nodes back when something actually changed (base64 sanitized
        // and/or media relocated into the project folder), so the client can sync
        // its local state and stop re-sending stale base64/URLs on the next save.
        res.json({
            success: true,
            id: workflow.id,
            projectDirName: workflow.projectDirName,
            ...(sanitizedCount > 0 || assetsOrganized ? {
                nodes: workflow.nodes,
                videoRemixes: workflow.videoRemixes || []
            } : {})
        });
    } catch (error) {
        console.error("Save workflow error:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- Public Workflows API (bundled examples) ---

// List public workflows (shipped with the repo in public/workflows/)
// Dynamically scans directory - no need to maintain index.json manually
router.get('/public-workflows', async (req, res) => {
    try {
        const publicWorkflowsDir = publicWorkflowsRoot();

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
                    remixCount: workflow.videoRemixes?.length || 0,
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
router.get('/public-workflows/:id', async (req, res) => {
    try {
        const publicWorkflowsDir = publicWorkflowsRoot();
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
router.get('/workflows', async (req, res) => {
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
                remixCount: workflow.videoRemixes?.length || 0,
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
router.get('/workflows/:id', async (req, res) => {
    try {
        const filePath = path.join(WORKFLOWS_DIR, `${req.params.id}.json`);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: "Workflow not found" });
        }
        const workflow = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const { changed: assetsChanged } = organizeWorkflowAssets(workflow, projectAssetDirs());
        const { changed: recoveredVideos } = recoverProjectVideoNodes(workflow, {
            projectsDir: PROJECTS_DIR
        });
        if (assetsChanged || recoveredVideos) {
            workflow.updatedAt = new Date().toISOString();
            writeJsonAtomicSync(filePath, workflow);
            writeProjectManifest(workflow);
        }
        res.json(workflow);
    } catch (error) {
        console.error("Load workflow error:", error);
        res.status(500).json({ error: error.message });
    }
});

// Delete workflow
router.delete('/workflows/:id', async (req, res) => {
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


// Web 开发模式的兼容入口。桌面安装版走 Electron shell.openPath IPC；
// 这里同样只打开既有项目根目录，绝不因“显示目录”而重建丢失路径。
router.post('/workflows/:id/reveal-assets', async (req, res) => {
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
            ? resolveWorkflowProjectRoot(workflow, PROJECTS_DIR)
            : path.join(IMAGES_DIR, workflow.assetsDirName);
        if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
            return res.status(404).json({ error: '项目目录不存在' });
        }
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
router.put('/workflows/:id/title', async (req, res) => {
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
            videoRemixes: workflowData.videoRemixes || [],
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
router.put('/workflows/:id/cover', async (req, res) => {
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

export default router;
