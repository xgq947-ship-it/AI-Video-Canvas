/**
 * routes/library.js
 *
 * 全局素材库：直传、入库、列出、删除。
 * 从 server/index.js 原样搬出，行为未做改动。
 */

import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import path from 'path';

import { createUniqueAssetFilename } from '../services/assetFilenames.js';
import { normalizeCharacterAssetMeta } from '../services/characterAssets.js';
import {
    IMAGES_DIR,
    LIBRARY_ASSETS_DIR,
    LIBRARY_DIR,
    MASSAGE_EQUIPMENT_SUBCATEGORY_NAMES,
    PROJECTS_DIR,
    VIDEOS_DIR
} from '../runtime/libraryPaths.js';

const router = express.Router();

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
router.post('/upload', (req, res) => {
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
router.post('/', async (req, res) => {
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
router.get('/', async (req, res) => {
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
router.delete('/:id', async (req, res) => {
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

export default router;
