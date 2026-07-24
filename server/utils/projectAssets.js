/**
 * projectAssets.js
 *
 * Organizes a workflow's images/videos into a per-project folder
 * (library/images/{assetsDirName}/, library/videos/{assetsDirName}/) so a
 * project's media can be browsed directly in Finder and filtered in-app.
 *
 * New project media is written directly into library/projects/<project>/.
 * The legacy flat pools remain readable so old workflows and explicitly saved
 * library assets can still be copied into the active project.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const MEDIA_URL_FIELDS = ['resultUrl', 'lastFrame', 'editorCanvasData', 'editorBackgroundUrl', 'mediaUrl', 'renderOutputUrl'];

const ILLEGAL_CHARS_RE = new RegExp('[\\/\\\\:*?"<>|]', 'g');
const WINDOWS_RESERVED_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function sanitizeDirName(title) {
    const fallback = 'untitled';
    if (!title || typeof title !== 'string') return fallback;
    const cleaned = title
        .replace(ILLEGAL_CHARS_RE, '') // filesystem-illegal characters
        .replace(/\s/g, '')            // any Unicode whitespace (regular, full-width, etc.)
        .slice(0, 40);
    return cleaned || fallback;
}

export function sanitizeProjectDirName(title) {
    const fallback = 'untitled';
    if (!title || typeof title !== 'string') return fallback;
    const cleaned = title
        .replace(ILLEGAL_CHARS_RE, '')
        .trim()
        .replace(/[. ]+$/g, '')
        .slice(0, 40);
    if (!cleaned) return fallback;
    return WINDOWS_RESERVED_NAME_RE.test(cleaned) ? `${cleaned}_project` : cleaned;
}

function pathEntryExists(candidate) {
    try {
        fs.lstatSync(candidate);
        return true;
    } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
    }
}

function isSamePath(left, right) {
    const normalize = (value) => {
        let resolved;
        try {
            resolved = fs.realpathSync(value);
        } catch {
            resolved = path.resolve(value);
        }
        resolved = resolved.replace(/^\\\\\?\\/, '');
        return process.platform === 'win32' ? resolved.toLocaleLowerCase() : resolved;
    };
    return normalize(left) === normalize(right);
}

function ensureExternalProjectAlias(workflow, projectsDir) {
    const target = path.resolve(workflow.projectPath);
    const alias = path.join(projectsDir, workflow.projectDirName);

    if (pathEntryExists(alias)) {
        if (!fs.existsSync(target)) {
            const error = new Error(`自定义项目文件夹不存在或磁盘未连接：${target}`);
            error.code = 'PROJECT_LOCATION_MISSING';
            throw error;
        }
        let resolvedAlias;
        try {
            resolvedAlias = fs.realpathSync(alias);
        } catch {
            const error = new Error(`项目目录映射已失效：${alias}`);
            error.code = 'PROJECT_LOCATION_MISSING';
            throw error;
        }
        if (!isSamePath(resolvedAlias, target)) {
            const error = new Error(`项目目录名称已被占用：${workflow.projectDirName}`);
            error.code = 'EEXIST';
            throw error;
        }
        return target;
    }

    fs.mkdirSync(target, { recursive: true });
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
    return target;
}

/** Returns the real project folder, including a user-selected external folder. */
export function resolveWorkflowProjectRoot(workflow, projectsDir) {
    if (!workflow?.projectDirName || !projectsDir) return null;
    if (workflow.projectPath) {
        if (!path.isAbsolute(workflow.projectPath)) {
            const error = new Error('自定义项目路径必须是绝对路径');
            error.code = 'INVALID_PROJECT_LOCATION';
            throw error;
        }
        return path.resolve(workflow.projectPath);
    }
    return path.join(projectsDir, workflow.projectDirName);
}

function projectUrl(projectDirName, type, filename, origin = '') {
    return `${origin}/library/projects/${encodeURIComponent(projectDirName)}/${type}/${encodeURIComponent(filename)}`;
}

function parseProjectUrl(url) {
    if (!url || typeof url !== 'string') return null;
    let origin = '';
    let pathname = url.split('?')[0];
    if (/^https?:\/\//i.test(url)) {
        try {
            const parsed = new URL(url);
            origin = parsed.origin;
            pathname = parsed.pathname;
        } catch {
            return null;
        }
    }
    const match = pathname.match(/^\/library\/projects\/([^/]+)\/(images|videos|audio)\/([^/]+)$/);
    if (!match) return null;
    try {
        return {
            origin,
            projectDir: decodeURIComponent(match[1]),
            type: match[2],
            filename: decodeURIComponent(match[3])
        };
    } catch {
        return null;
    }
}

function parseAnyLibraryUrl(url) {
    const project = parseProjectUrl(url);
    if (project) return { ...project, layout: 'project' };
    const legacy = parseLibraryUrl(url);
    if (legacy) return { ...legacy, layout: 'legacy' };
    if (!url || typeof url !== 'string') return null;
    let origin = '';
    let pathname = url.split('?')[0];
    if (/^https?:\/\//i.test(url)) {
        try {
            const parsed = new URL(url);
            origin = parsed.origin;
            pathname = parsed.pathname;
        } catch { return null; }
    }
    const audioMatch = pathname.match(/^\/library\/audio\/([^/]+)$/);
    if (!audioMatch) return null;
    try {
        return { origin, type: 'audio', projectDir: null, filename: decodeURIComponent(audioMatch[1]), layout: 'legacy' };
    } catch { return null; }
}

function buildAssetsDirName(workflow, title) {
    const shortId = (workflow.id || '').replace(/-/g, '').slice(0, 8) || Math.random().toString(36).slice(2, 10);
    return `${sanitizeDirName(title)}_${shortId}`;
}

/**
 * Assigns and returns the folder name this workflow's assets live under.
 * The title endpoint keeps this name synchronized after later title edits.
 */
export function ensureAssetsDirName(workflow) {
    if (!workflow.assetsDirName) {
        workflow.assetsDirName = buildAssetsDirName(workflow, workflow.title);
    }
    return workflow.assetsDirName;
}

/**
 * Creates the durable project folder. New projects use the exact sanitized
 * title; legacy/duplicate projects fall back to a stable id suffix.
 */
export function ensureProjectFolder(workflow, { projectsDir }, { exactName = false } = {}) {
    if (!projectsDir) return null;
    if (!workflow.projectDirName) {
        const baseName = sanitizeProjectDirName(workflow.title);
        const exactPath = path.join(projectsDir, baseName);
        if (exactName && fs.existsSync(exactPath)) {
            const error = new Error(`项目名称已存在：${workflow.title}`);
            error.code = 'EEXIST';
            throw error;
        }
        workflow.projectDirName = !fs.existsSync(exactPath)
            ? baseName
            : buildAssetsDirName(workflow, workflow.title);
    }
    const root = workflow.projectPath
        ? ensureExternalProjectAlias(workflow, projectsDir)
        : path.join(projectsDir, workflow.projectDirName);
    for (const type of ['images', 'videos', 'audio']) {
        fs.mkdirSync(path.join(root, type), { recursive: true });
    }
    return root;
}

/** Resolve a workflow id to a writable project media directory and public URL prefix. */
export function resolveProjectMediaTarget(workflowId, type, { workflowsDir, projectsDir }) {
    if (!workflowId || typeof workflowId !== 'string') {
        const error = new Error('请先新建或打开项目');
        error.code = 'PROJECT_REQUIRED';
        throw error;
    }
    if (!['images', 'videos', 'audio'].includes(type)) {
        const error = new Error('不支持的项目素材类型');
        error.code = 'UNSUPPORTED_MEDIA_TYPE';
        throw error;
    }
    const workflowPath = path.join(workflowsDir, `${workflowId}.json`);
    if (!fs.existsSync(workflowPath)) {
        const error = new Error('项目不存在，请重新打开项目');
        error.code = 'PROJECT_NOT_FOUND';
        throw error;
    }
    const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
    const previousProjectDirName = workflow.projectDirName;
    ensureProjectFolder(workflow, { projectsDir });
    if (!workflow.projectDirName) {
        const error = new Error('项目目录不可用');
        error.code = 'PROJECT_NOT_FOUND';
        throw error;
    }
    if (!previousProjectDirName) {
        const temporaryPath = `${workflowPath}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(temporaryPath, JSON.stringify(workflow, null, 2));
        fs.renameSync(temporaryPath, workflowPath);
    }
    const targetDir = path.join(projectsDir, workflow.projectDirName, type);
    fs.mkdirSync(targetDir, { recursive: true });
    return {
        workflow,
        targetDir,
        projectDirName: workflow.projectDirName,
        urlPrefix: `/library/projects/${encodeURIComponent(workflow.projectDirName)}/${type}`
    };
}

const IMAGE_EXTENSION_BY_MIME = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif'
};

/** Save a pasted/dropped image directly into the active project's image folder. */
export function saveProjectImageUpload(workflow, payload, { projectsDir }) {
    const dataUrl = String(payload?.data || '');
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif|avif));base64,([A-Za-z0-9+/=\r\n]+)$/);
    if (!match) {
        const error = new Error('只支持 PNG、JPEG、WebP、GIF 或 AVIF 图片');
        error.code = 'UNSUPPORTED_IMAGE';
        throw error;
    }

    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length === 0) {
        const error = new Error('图片文件为空');
        error.code = 'UNSUPPORTED_IMAGE';
        throw error;
    }
    if (buffer.length > 100 * 1024 * 1024) {
        const error = new Error('图片不能超过 100MB');
        error.code = 'IMAGE_TOO_LARGE';
        throw error;
    }

    ensureProjectFolder(workflow, { projectsDir });
    const id = crypto.randomUUID();
    const extension = IMAGE_EXTENSION_BY_MIME[match[1]];
    const filename = `img_${Date.now()}_${id.slice(0, 8)}.${extension}`;
    const imageDir = path.join(projectsDir, workflow.projectDirName, 'images');
    const imagePath = path.join(imageDir, filename);
    const metadataPath = path.join(imageDir, `${filename.slice(0, filename.lastIndexOf('.'))}.json`);
    const metadata = {
        id,
        filename,
        prompt: String(payload?.prompt || payload?.originalFilename || ''),
        originalFilename: payload?.originalFilename || undefined,
        mimeType: match[1],
        createdAt: new Date().toISOString(),
        type: 'images'
    };

    fs.writeFileSync(imagePath, buffer);
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    return {
        id,
        filename,
        url: projectUrl(workflow.projectDirName, 'images', filename),
        projectDirName: workflow.projectDirName,
        metadata
    };
}

function sourcePathFor(parsed, { libraryDir, projectsDir, imagesDir, videosDir, audioDir }) {
    if (parsed.layout === 'project') {
        return path.join(projectsDir, parsed.projectDir, parsed.type, parsed.filename);
    }
    const bases = {
        images: imagesDir || path.join(libraryDir, 'images'),
        videos: videosDir || path.join(libraryDir, 'videos'),
        audio: audioDir || path.join(libraryDir, 'audio')
    };
    return parsed.projectDir
        ? path.join(bases[parsed.type], parsed.projectDir, parsed.filename)
        : path.join(bases[parsed.type], parsed.filename);
}

/** Copy one local library asset into a project and return its project-local URL. */
export function importProjectAsset(workflow, sourceUrl, dirs) {
    const parsed = parseAnyLibraryUrl(sourceUrl);
    if (!parsed) {
        const error = new Error('只支持导入本地素材库文件');
        error.code = 'UNSUPPORTED_ASSET_URL';
        throw error;
    }
    if (path.basename(parsed.filename) !== parsed.filename || parsed.filename === '.' || parsed.filename === '..') {
        const error = new Error('素材文件名不合法');
        error.code = 'UNSUPPORTED_ASSET_URL';
        throw error;
    }
    if (parsed.projectDir && path.basename(parsed.projectDir) !== parsed.projectDir) {
        const error = new Error('素材项目目录不合法');
        error.code = 'UNSUPPORTED_ASSET_URL';
        throw error;
    }
    ensureProjectFolder(workflow, dirs);
    if (parsed.layout === 'project' && parsed.projectDir === workflow.projectDirName) {
        return { url: projectUrl(workflow.projectDirName, parsed.type, parsed.filename, parsed.origin), type: parsed.type };
    }
    const sourcePath = sourcePathFor(parsed, dirs);
    if (!fs.existsSync(sourcePath)) {
        const error = new Error('素材源文件不存在');
        error.code = 'ENOENT';
        throw error;
    }
    const destination = path.join(dirs.projectsDir, workflow.projectDirName, parsed.type, parsed.filename);
    copyIfNeeded(sourcePath, destination);
    return { url: projectUrl(workflow.projectDirName, parsed.type, parsed.filename, parsed.origin), type: parsed.type };
}

/**
 * Parses a `/library/images/...` or `/library/videos/...` URL (optionally with an
 * origin prefix, e.g. http://localhost:3001) into its parts. Returns null for
 * anything else (external URLs, blob:, data:, already-consumed fields, etc).
 */
function parseLibraryUrl(url) {
    if (!url || typeof url !== 'string') return null;
    let origin = '';
    let pathname = url;
    if (/^https?:\/\//i.test(url)) {
        try {
            const u = new URL(url);
            origin = u.origin;
            pathname = u.pathname;
        } catch {
            return null;
        }
    }
    try {
        pathname = decodeURIComponent(pathname);
    } catch {
        // Keep malformed legacy URLs untouched rather than failing a save.
    }
    pathname = pathname.split('?')[0];
    const m = pathname.match(/^\/library\/(images|videos)\/(.+)$/);
    if (!m) return null;
    const segments = m[2].split('/');
    if (segments.length === 1) return { origin, type: m[1], projectDir: null, filename: segments[0] };
    if (segments.length === 2) return { origin, type: m[1], projectDir: segments[0], filename: segments[1] };
    return null; // unexpected nesting depth — leave untouched
}

function sidecarPathFor(filePath) {
    return filePath.slice(0, filePath.lastIndexOf('.')) + '.json';
}

/** Copies file + its sidecar metadata (if any) into destPath's directory, if not already there. */
function copyIfNeeded(srcPath, destPath) {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    // A title rename may have already moved the project directory while an
    // in-flight client save still contains the old URL. In that case the
    // destination is authoritative and the URL can safely be rewritten.
    if (fs.existsSync(destPath)) return true;
    if (!fs.existsSync(srcPath)) return false;
    if (!fs.existsSync(destPath)) {
        fs.copyFileSync(srcPath, destPath);
    }
    let srcJson = sidecarPathFor(srcPath);
    if (!fs.existsSync(srcJson)) {
        // Audio metadata uses an id-based JSON filename while the media filename
        // may have a tts_/original-name prefix. Resolve it by its filename field.
        try {
            srcJson = fs.readdirSync(path.dirname(srcPath))
                .filter(name => name.endsWith('.json'))
                .map(name => path.join(path.dirname(srcPath), name))
                .find(candidate => {
                    try { return JSON.parse(fs.readFileSync(candidate, 'utf8')).filename === path.basename(srcPath); }
                    catch { return false; }
                }) || srcJson;
        } catch { /* no readable metadata directory */ }
    }
    if (fs.existsSync(srcJson)) {
        const destJson = sidecarPathFor(destPath);
        if (!fs.existsSync(destJson)) {
            fs.copyFileSync(srcJson, destJson);
        }
    }
    return true;
}

/**
 * Renames this workflow's image/video folders to match a new project title and
 * rewrites every project-local media URL. The stable workflow-id suffix keeps
 * folders unique even when multiple projects share the same title.
 *
 * Mutates `workflow` only after all filesystem renames succeed.
 * @returns {{ changed: boolean, oldDirName: string | null, newDirName: string, rollback: () => void }}
 */
export function renameWorkflowAssetDirs(workflow, newTitle, { imagesDir, videosDir, projectsDir }) {
    if (projectsDir && workflow?.projectDirName) {
        const oldDirName = workflow.projectDirName;
        const newDirName = sanitizeProjectDirName(newTitle);
        if (oldDirName === newDirName) {
            return { changed: false, oldDirName, newDirName, rollback: () => {} };
        }
        const from = path.join(projectsDir, oldDirName);
        const to = path.join(projectsDir, newDirName);
        if (fs.existsSync(to)) {
            const error = new Error(`目标项目目录已存在：${newDirName}`);
            error.code = 'EEXIST';
            throw error;
        }
        if (fs.existsSync(from)) fs.renameSync(from, to);
        const rewrite = (url) => {
            const parsed = parseProjectUrl(url);
            if (!parsed || parsed.projectDir !== oldDirName) return url;
            return projectUrl(newDirName, parsed.type, parsed.filename, parsed.origin);
        };
        workflow.projectDirName = newDirName;
        for (const node of workflow.nodes || []) {
            for (const field of MEDIA_URL_FIELDS) {
                if (typeof node[field] === 'string') node[field] = rewrite(node[field]);
            }
            if (Array.isArray(node.imageVersions)) {
                node.imageVersions = node.imageVersions.map(version => ({ ...version, url: rewrite(version.url) }));
            }
        }
        if (typeof workflow.coverUrl === 'string') workflow.coverUrl = rewrite(workflow.coverUrl);
        return {
            changed: true,
            oldDirName,
            newDirName,
            rollback: () => {
                if (fs.existsSync(to) && !fs.existsSync(from)) fs.renameSync(to, from);
            }
        };
    }
    const oldDirName = workflow?.assetsDirName || null;
    const newDirName = buildAssetsDirName(workflow, newTitle);
    if (!oldDirName || oldDirName === newDirName) {
        if (oldDirName) workflow.assetsDirName = newDirName;
        return { changed: false, oldDirName, newDirName, rollback: () => {} };
    }

    const baseDirs = [imagesDir, videosDir];
    const moves = baseDirs
        .map(baseDir => ({
            from: path.join(baseDir, oldDirName),
            to: path.join(baseDir, newDirName)
        }))
        .filter(move => fs.existsSync(move.from));

    for (const move of moves) {
        if (fs.existsSync(move.to)) {
            const error = new Error(`目标项目素材目录已存在：${path.basename(move.to)}`);
            error.code = 'EEXIST';
            throw error;
        }
    }

    const completedMoves = [];
    try {
        for (const move of moves) {
            fs.renameSync(move.from, move.to);
            completedMoves.push(move);
        }
    } catch (error) {
        for (const move of completedMoves.reverse()) {
            if (fs.existsSync(move.to) && !fs.existsSync(move.from)) {
                fs.renameSync(move.to, move.from);
            }
        }
        throw error;
    }

    const rewrite = (url) => {
        const parsed = parseLibraryUrl(url);
        if (!parsed || parsed.projectDir !== oldDirName) return url;
        return `${parsed.origin}/library/${parsed.type}/${newDirName}/${parsed.filename}`;
    };

    workflow.assetsDirName = newDirName;
    for (const node of workflow.nodes || []) {
        for (const field of MEDIA_URL_FIELDS) {
            if (typeof node[field] === 'string') node[field] = rewrite(node[field]);
        }
    }
    if (typeof workflow.coverUrl === 'string') workflow.coverUrl = rewrite(workflow.coverUrl);

    return {
        changed: true,
        oldDirName,
        newDirName,
        rollback: () => {
            for (const move of [...completedMoves].reverse()) {
                if (fs.existsSync(move.to) && !fs.existsSync(move.from)) {
                    fs.renameSync(move.to, move.from);
                }
            }
        }
    };
}

/**
 * Ensures every media URL referenced by this workflow's nodes/cover physically
 * lives under this workflow's own folder, copying it in and rewriting the URL
 * where needed. Also prunes files in that folder no longer referenced by the
 * just-saved nodes (safe: the flat pool keeps the original).
 *
 * Mutates `workflow` in place (assetsDirName, node URLs, coverUrl).
 * @returns {{ changed: boolean }}
 */
export function organizeWorkflowAssets(workflow, { imagesDir, videosDir, audioDir, libraryDir, projectsDir }) {
    if (!workflow?.id) return { changed: false };

    if (projectsDir) {
        let changed = false;
        const before = workflow.projectDirName;
        ensureProjectFolder(workflow, { projectsDir });
        if (before !== workflow.projectDirName) changed = true;

        const relocate = (url) => {
            if (typeof url !== 'string') return url;
            try {
                const imported = importProjectAsset(workflow, url, {
                    libraryDir,
                    projectsDir,
                    imagesDir,
                    videosDir,
                    audioDir
                });
                if (imported.url !== url) changed = true;
                return imported.url;
            } catch (error) {
                if (error.code === 'UNSUPPORTED_ASSET_URL' || error.code === 'ENOENT') return url;
                throw error;
            }
        };

        for (const node of workflow.nodes || []) {
            for (const field of MEDIA_URL_FIELDS) {
                if (typeof node[field] === 'string') node[field] = relocate(node[field]);
            }
            if (Array.isArray(node.imageVersions)) {
                node.imageVersions = node.imageVersions.map(version => ({ ...version, url: relocate(version.url) }));
            }
        }
        if (typeof workflow.coverUrl === 'string') workflow.coverUrl = relocate(workflow.coverUrl);
        return { changed };
    }

    let changed = false;
    const dirNameBefore = workflow.assetsDirName;
    const assetsDirName = ensureAssetsDirName(workflow);
    if (assetsDirName !== dirNameBefore) changed = true;

    const baseDirs = { images: imagesDir, videos: videosDir };
    const keepBaseNames = { images: new Set(), videos: new Set() };

    const relocate = (url) => {
        const parsed = parseLibraryUrl(url);
        if (!parsed) return url;
        const { origin, type, projectDir, filename } = parsed;
        const baseDir = baseDirs[type];
        const destPath = path.join(baseDir, assetsDirName, filename);

        if (projectDir !== assetsDirName) {
            const srcPath = projectDir
                ? path.join(baseDir, projectDir, filename)
                : path.join(baseDir, filename);
            const ok = copyIfNeeded(srcPath, destPath);
            if (!ok) return url; // source vanished — leave the reference alone
            changed = true;
        }

        keepBaseNames[type].add(filename.slice(0, filename.lastIndexOf('.')));
        return `${origin}/library/${type}/${assetsDirName}/${filename}`;
    };

    for (const node of workflow.nodes || []) {
        for (const field of MEDIA_URL_FIELDS) {
            if (typeof node[field] === 'string') {
                node[field] = relocate(node[field]);
            }
        }
    }
    if (typeof workflow.coverUrl === 'string') {
        workflow.coverUrl = relocate(workflow.coverUrl);
    }

    // Prune project-local files no longer referenced by this save.
    for (const type of ['images', 'videos']) {
        const dir = path.join(baseDirs[type], assetsDirName);
        if (!fs.existsSync(dir)) continue;
        for (const f of fs.readdirSync(dir)) {
            const base = f.slice(0, f.lastIndexOf('.'));
            if (!keepBaseNames[type].has(base)) {
                fs.unlinkSync(path.join(dir, f));
                changed = true;
            }
        }
    }

    return { changed };
}

/** Removes a workflow's per-project asset folders entirely (called on workflow delete). */
export function deleteWorkflowAssetDirs(workflow, { imagesDir, videosDir, projectsDir }) {
    const dirs = [];
    if (workflow?.assetsDirName) {
        dirs.push(path.join(imagesDir, workflow.assetsDirName), path.join(videosDir, workflow.assetsDirName));
    }
    if (projectsDir && workflow?.projectDirName) {
        const alias = path.join(projectsDir, workflow.projectDirName);
        if (workflow.projectPath) {
            const target = path.resolve(workflow.projectPath);
            const manifestPath = path.join(target, 'project.json');
            let ownsTarget = false;
            try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                ownsTarget = manifest.id === workflow.id;
            } catch {
                // Never recursively delete a custom directory unless its marker
                // proves that it belongs to this workflow.
            }
            if (ownsTarget && fs.existsSync(target)) {
                fs.rmSync(target, { recursive: true, force: true });
            }
            if (pathEntryExists(alias)) {
                fs.unlinkSync(alias);
            }
        } else {
            dirs.push(alias);
        }
    }
    for (const dir of dirs) {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
}
