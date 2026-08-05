/**
 * routes/assets.js
 *
 * 画布产物的历史素材接口（保存 / 列出 / 删除）。
 * 从 server/index.js 原样搬出，行为未做改动。
 */

import express from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

import { resolveProjectMediaTarget } from '../utils/projectAssets.js';
import { mapWithConcurrency } from '../utils/workflowStore.js';
import { IMAGES_DIR, PROJECTS_DIR, VIDEOS_DIR, WORKFLOWS_DIR } from '../runtime/libraryPaths.js';

/** 扫描素材目录时的并发上限：够快，又不至于一次打开几百个文件句柄。 */
const ASSET_SCAN_CONCURRENCY = 24;

const router = express.Router();

// ============================================================================
// ASSET HISTORY API
// ============================================================================

// Save an asset (image or video)
router.post('/:type', async (req, res) => {
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
router.get('/:type', async (req, res) => {
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
            let assetsDirName;
            let projectDirName;
            try {
                const workflow = JSON.parse(await fsp.readFile(wfPath, 'utf8'));
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

        // 全程异步 IO。以前这里是 readdirSync + 每个文件 existsSync/readFileSync/statSync，
        // 一个有几百张素材的项目打开素材库就会把 Node 事件循环卡住几百毫秒 ——
        // 同一时刻的生成轮询（1.5s 一次）、渲染进度、自动保存请求全都被堵在后面。
        let files;
        try {
            files = await fsp.readdir(targetDir);
        } catch (e) {
            return emptyResult();
        }

        let assets = [];

        if (workflowId) {
            // Project folders often contain media with no sidecar metadata (workflow-editor
            // saves, generation results) — unlike the global pool, everything physically in
            // this folder belongs to the project, so list every media file directly and
            // enrich it with sidecar JSON where one happens to exist (same basename).
            const mediaExts = type === 'images'
                ? new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
                : new Set(['.mp4', '.webm', '.mov', '.m4v']);

            const mediaFiles = files.filter(file => mediaExts.has(path.extname(file).toLowerCase()));
            assets = await mapWithConcurrency(mediaFiles, ASSET_SCAN_CONCURRENCY, async (file) => {
                const base = file.slice(0, file.lastIndexOf('.'));
                const sidecarPath = path.join(targetDir, `${base}.json`);
                let metadata = { id: base, filename: file, prompt: '', type };
                try {
                    metadata = { ...metadata, ...JSON.parse(await fsp.readFile(sidecarPath, 'utf8')) };
                } catch (e) {
                    // 没有 sidecar 或内容损坏：退回到上面合成的元数据
                }
                if (!metadata.createdAt) {
                    try {
                        const stats = await fsp.stat(path.join(targetDir, file));
                        metadata.createdAt = stats.mtime.toISOString();
                    } catch (e) {
                        metadata.createdAt = new Date(0).toISOString();
                    }
                }
                metadata.filename = file;
                metadata.url = `${urlPrefix}/${file}`;
                return metadata;
            });
        } else {
            const sidecars = files.filter(file => file.endsWith('.json'));
            const parsed = await mapWithConcurrency(sidecars, ASSET_SCAN_CONCURRENCY, async (file) => {
                try {
                    const content = await fsp.readFile(path.join(targetDir, file), 'utf8');
                    const metadata = JSON.parse(content);
                    metadata.url = `${urlPrefix}/${metadata.filename}`;
                    return metadata;
                } catch (e) {
                    return null; // Skip invalid JSON files
                }
            });
            assets = parsed.filter(Boolean);
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
router.delete('/:type/:id', async (req, res) => {
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

export default router;
