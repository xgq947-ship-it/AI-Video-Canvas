import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const PROJECT_TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const TRASH_INDEX_VERSION = 2;
const TRASHABLE_IMAGE_NODE_TYPES = new Set(['Image', 'Image Editor', 'Camera Angle']);

function trashRoot(projectRoot) {
    return path.join(projectRoot, '.trash');
}

function trashIndexPath(projectRoot) {
    return path.join(trashRoot(projectRoot), 'index.json');
}

function writeJsonAtomic(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2));
    fs.renameSync(temporaryPath, filePath);
}

function readTrashIndex(projectRoot) {
    const indexPath = trashIndexPath(projectRoot);
    if (!fs.existsSync(indexPath)) {
        return { version: TRASH_INDEX_VERSION, entries: [] };
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        return {
            version: TRASH_INDEX_VERSION,
            entries: Array.isArray(parsed?.entries) ? parsed.entries : []
        };
    } catch {
        return { version: TRASH_INDEX_VERSION, entries: [] };
    }
}

function writeTrashIndex(projectRoot, index) {
    writeJsonAtomic(trashIndexPath(projectRoot), {
        version: TRASH_INDEX_VERSION,
        entries: index.entries
    });
}

function resolveWithin(root, relativePath) {
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(resolvedRoot, relativePath);
    const relative = path.relative(resolvedRoot, resolved);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        const error = new Error('回收站路径不合法');
        error.code = 'INVALID_TRASH_PATH';
        throw error;
    }
    return resolved;
}

function parseProjectImageUrl(value, projectDirName) {
    if (!value || typeof value !== 'string') return null;
    let pathname = value.split('?')[0];
    if (/^https?:\/\//i.test(value)) {
        try {
            pathname = new URL(value).pathname;
        } catch {
            return null;
        }
    }
    const match = pathname.match(/^\/library\/projects\/([^/]+)\/images\/([^/]+)$/);
    if (!match) return null;
    try {
        const parsedProjectDir = decodeURIComponent(match[1]);
        const filename = decodeURIComponent(match[2]);
        if (parsedProjectDir !== projectDirName || path.basename(filename) !== filename) return null;
        return {
            key: `/library/projects/${encodeURIComponent(projectDirName)}/images/${encodeURIComponent(filename)}`,
            filename
        };
    } catch {
        return null;
    }
}

function collectNodeImageUrls(node, projectDirName) {
    if (!node || !TRASHABLE_IMAGE_NODE_TYPES.has(node.type)) return [];
    const values = [node.resultUrl];
    for (const version of node.imageVersions || []) values.push(version?.url);
    const unique = new Map();
    for (const value of values) {
        const parsed = parseProjectImageUrl(value, projectDirName);
        if (parsed) unique.set(parsed.key, parsed);
    }
    return [...unique.values()];
}

function collectAllProjectImageReferences(node, projectDirName) {
    if (!node) return [];
    const values = [
        node.resultUrl,
        node.lastFrame,
        node.editorCanvasData,
        node.editorBackgroundUrl,
        node.mediaUrl,
        node.renderOutputUrl,
        node.inputUrl,
        ...(node.characterReferenceUrls || []),
        ...(node.imageVersions || []).map(version => version?.url)
    ];
    const unique = new Map();
    for (const value of values) {
        const parsed = parseProjectImageUrl(value, projectDirName);
        if (parsed) unique.set(parsed.key, parsed);
    }
    return [...unique.values()];
}

function sidecarPath(filePath) {
    const extension = path.extname(filePath);
    return extension ? filePath.slice(0, -extension.length) + '.json' : `${filePath}.json`;
}

function findImageMetadataRelativePaths(projectRoot, filename) {
    const imagesDir = resolveWithin(projectRoot, 'images');
    if (!fs.existsSync(imagesDir)) return [];

    const matches = new Set();
    const canonicalPath = sidecarPath(path.join(imagesDir, filename));
    if (fs.existsSync(canonicalPath)) {
        matches.add(path.relative(projectRoot, canonicalPath));
    }

    for (const candidate of fs.readdirSync(imagesDir).filter(name => name.endsWith('.json'))) {
        const candidatePath = path.join(imagesDir, candidate);
        try {
            const metadata = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
            if (metadata?.filename === filename) {
                matches.add(path.relative(projectRoot, candidatePath));
            }
        } catch {
            // A malformed or unrelated JSON file is not owned by this image.
        }
    }
    return [...matches];
}

function removeIfExists(filePath) {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
}

function publicEntry(entry, workflowId) {
    const previewFile = entry.files?.find(file => file.backupRelativePath);
    return {
        id: entry.id,
        deletedAt: entry.deletedAt,
        expiresAt: entry.expiresAt,
        nodeCount: entry.nodes?.length || 0,
        title: entry.nodes?.[0]?.title || (entry.nodes?.length > 1 ? `${entry.nodes.length} 个画布节点` : '图片素材'),
        previewUrl: previewFile
            ? `/api/projects/${encodeURIComponent(workflowId)}/trash/${encodeURIComponent(entry.id)}/preview`
            : entry.nodes?.[0]?.resultUrl
    };
}

export function purgeExpiredProjectTrash(projectRoot, now = Date.now()) {
    const index = readTrashIndex(projectRoot);
    const expired = index.entries.filter(entry => new Date(entry.expiresAt).getTime() <= now);
    if (expired.length === 0) return 0;

    for (const entry of expired) {
        fs.rmSync(resolveWithin(path.join(trashRoot(projectRoot), 'files'), entry.id), {
            recursive: true,
            force: true
        });
    }
    index.entries = index.entries.filter(entry => new Date(entry.expiresAt).getTime() > now);
    writeTrashIndex(projectRoot, index);
    return expired.length;
}

export function listProjectTrash(workflow, projectRoot, now = Date.now()) {
    purgeExpiredProjectTrash(projectRoot, now);
    return readTrashIndex(projectRoot).entries
        .sort((left, right) => new Date(right.deletedAt).getTime() - new Date(left.deletedAt).getTime())
        .map(entry => publicEntry(entry, workflow.id));
}

export function trashWorkflowNodes(workflow, currentNodes, nodeIds, projectRoot, now = Date.now()) {
    const requestedIds = new Set(nodeIds);
    const deletedNodes = currentNodes.filter(node => requestedIds.has(node.id));
    const remainingNodes = currentNodes.filter(node => !requestedIds.has(node.id));
    workflow.nodes = remainingNodes;

    const deletedFiles = new Map();
    for (const node of deletedNodes) {
        for (const file of collectNodeImageUrls(node, workflow.projectDirName)) {
            deletedFiles.set(file.key, file);
        }
    }
    if (deletedFiles.size === 0) {
        return { entry: null, deletedNodes, remainingNodes };
    }

    const activeFileKeys = new Set();
    for (const node of remainingNodes) {
        for (const file of collectAllProjectImageReferences(node, workflow.projectDirName)) {
            activeFileKeys.add(file.key);
        }
    }
    const coverReference = parseProjectImageUrl(workflow.coverUrl, workflow.projectDirName);
    if (coverReference) activeFileKeys.add(coverReference.key);

    const id = crypto.randomUUID();
    const deletedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + PROJECT_TRASH_RETENTION_MS).toISOString();
    const files = [];

    for (const file of deletedFiles.values()) {
        const originalRelativePath = `images/${file.filename}`;
        const originalPath = resolveWithin(projectRoot, originalRelativePath);
        const backupRelativePath = `files/${id}/images/${file.filename}`;
        const backupPath = resolveWithin(trashRoot(projectRoot), backupRelativePath);
        const metadataFiles = findImageMetadataRelativePaths(projectRoot, file.filename)
            .map(originalMetadataRelativePath => {
                const backupMetadataRelativePath = `files/${id}/${originalMetadataRelativePath}`;
                const originalMetadataPath = resolveWithin(projectRoot, originalMetadataRelativePath);
                const backupMetadataPath = resolveWithin(trashRoot(projectRoot), backupMetadataRelativePath);
                fs.mkdirSync(path.dirname(backupMetadataPath), { recursive: true });
                fs.copyFileSync(originalMetadataPath, backupMetadataPath);
                return {
                    originalRelativePath: originalMetadataRelativePath,
                    backupRelativePath: backupMetadataRelativePath
                };
            });

        if (fs.existsSync(originalPath)) {
            fs.mkdirSync(path.dirname(backupPath), { recursive: true });
            fs.copyFileSync(originalPath, backupPath);
        }

        files.push({
            key: file.key,
            originalRelativePath,
            backupRelativePath: fs.existsSync(backupPath) ? backupRelativePath : null,
            metadataFiles
        });
    }

    const entry = { id, deletedAt, expiresAt, nodes: deletedNodes, files };
    const index = readTrashIndex(projectRoot);
    index.entries.push(entry);
    writeTrashIndex(projectRoot, index);

    for (const file of files) {
        if (activeFileKeys.has(file.key)) continue;
        const originalPath = resolveWithin(projectRoot, file.originalRelativePath);
        removeIfExists(originalPath);
        for (const metadata of file.metadataFiles || []) {
            removeIfExists(resolveWithin(projectRoot, metadata.originalRelativePath));
        }
    }

    return { entry: publicEntry(entry, workflow.id), deletedNodes, remainingNodes };
}

export function restoreProjectTrashEntry(workflow, projectRoot, entryId) {
    const index = readTrashIndex(projectRoot);
    const entry = index.entries.find(candidate => candidate.id === entryId);
    if (!entry) {
        const error = new Error('回收站项目不存在或已过期');
        error.code = 'TRASH_NOT_FOUND';
        throw error;
    }

    for (const file of entry.files || []) {
        if (!file.backupRelativePath) continue;
        const backupPath = resolveWithin(trashRoot(projectRoot), file.backupRelativePath);
        const originalPath = resolveWithin(projectRoot, file.originalRelativePath);
        if (fs.existsSync(backupPath) && !fs.existsSync(originalPath)) {
            fs.mkdirSync(path.dirname(originalPath), { recursive: true });
            fs.copyFileSync(backupPath, originalPath);
        }
        // Version 1 entries stored only the canonical same-basename sidecar.
        const legacyBackupSidecarPath = sidecarPath(backupPath);
        const legacyOriginalSidecarPath = sidecarPath(originalPath);
        if (fs.existsSync(legacyBackupSidecarPath) && !fs.existsSync(legacyOriginalSidecarPath)) {
            fs.copyFileSync(legacyBackupSidecarPath, legacyOriginalSidecarPath);
        }
        for (const metadata of file.metadataFiles || []) {
            const backupMetadataPath = resolveWithin(trashRoot(projectRoot), metadata.backupRelativePath);
            const originalMetadataPath = resolveWithin(projectRoot, metadata.originalRelativePath);
            if (fs.existsSync(backupMetadataPath) && !fs.existsSync(originalMetadataPath)) {
                fs.mkdirSync(path.dirname(originalMetadataPath), { recursive: true });
                fs.copyFileSync(backupMetadataPath, originalMetadataPath);
            }
        }
    }

    const existingIds = new Set((workflow.nodes || []).map(node => node.id));
    const restoredNodes = (entry.nodes || []).filter(node => !existingIds.has(node.id));
    workflow.nodes = [...(workflow.nodes || []), ...restoredNodes];
    index.entries = index.entries.filter(candidate => candidate.id !== entryId);
    writeTrashIndex(projectRoot, index);
    fs.rmSync(resolveWithin(path.join(trashRoot(projectRoot), 'files'), entryId), {
        recursive: true,
        force: true
    });
    return restoredNodes;
}

export function permanentlyDeleteProjectTrashEntry(projectRoot, entryId) {
    const index = readTrashIndex(projectRoot);
    const exists = index.entries.some(entry => entry.id === entryId);
    if (!exists) {
        const error = new Error('回收站项目不存在或已过期');
        error.code = 'TRASH_NOT_FOUND';
        throw error;
    }
    index.entries = index.entries.filter(entry => entry.id !== entryId);
    writeTrashIndex(projectRoot, index);
    fs.rmSync(resolveWithin(path.join(trashRoot(projectRoot), 'files'), entryId), {
        recursive: true,
        force: true
    });
}

/**
 * 清空回收站。
 *
 * 复用逐条删除的那套路径处理（resolveWithin + files/<entryId>），不另开一条按目录
 * 递归删除的分支 —— 那种写法一旦 entryId 不干净就会删到 .trash 之外。
 *
 * @returns {{ deleted: number }}
 */
export function purgeAllProjectTrash(projectRoot) {
    const index = readTrashIndex(projectRoot);
    const entries = [...index.entries];
    if (!entries.length) return { deleted: 0 };
    index.entries = [];
    writeTrashIndex(projectRoot, index);
    let deleted = 0;
    for (const entry of entries) {
        try {
            fs.rmSync(resolveWithin(path.join(trashRoot(projectRoot), 'files'), entry.id), {
                recursive: true,
                force: true
            });
            deleted += 1;
        } catch (error) {
            // 索引已经清掉了，单个文件夹删不掉不该让整次清空失败；剩下的只是占磁盘。
            console.error(`[回收站] 清空时删除 ${entry.id} 失败：${error.message}`);
        }
    }
    return { deleted };
}

export function getProjectTrashPreviewPath(projectRoot, entryId) {
    const entry = readTrashIndex(projectRoot).entries.find(candidate => candidate.id === entryId);
    const file = entry?.files?.find(candidate => candidate.backupRelativePath);
    if (!file) return null;
    const previewPath = resolveWithin(trashRoot(projectRoot), file.backupRelativePath);
    return fs.existsSync(previewPath) ? previewPath : null;
}
