/**
 * projectAssets.js
 *
 * Organizes a workflow's images/videos into a per-project folder
 * (library/images/{assetsDirName}/, library/videos/{assetsDirName}/) so a
 * project's media can be browsed directly in Finder and filtered in-app.
 *
 * Generation/upload routes keep writing into the flat library/images|videos
 * pool (unchanged) — that pool remains the durable original, shared across
 * projects and the global History panel. This module runs at workflow-save
 * time, copying (never moving) whichever files the just-saved nodes/cover
 * reference into that workflow's own folder and rewriting the URLs to point
 * at the project-local copy. Because the flat pool is untouched, the same
 * source asset can be safely "adopted" by more than one project.
 */

import fs from 'fs';
import path from 'path';

const MEDIA_URL_FIELDS = ['resultUrl', 'lastFrame', 'editorCanvasData', 'editorBackgroundUrl', 'mediaUrl', 'renderOutputUrl'];

const ILLEGAL_CHARS_RE = new RegExp('[\\/\\\\:*?"<>|]', 'g');

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
    return cleaned || fallback;
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
    const root = path.join(projectsDir, workflow.projectDirName);
    for (const type of ['images', 'videos', 'audio']) {
        fs.mkdirSync(path.join(root, type), { recursive: true });
    }
    return root;
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
        dirs.push(path.join(projectsDir, workflow.projectDirName));
    }
    for (const dir of dirs) {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
}
