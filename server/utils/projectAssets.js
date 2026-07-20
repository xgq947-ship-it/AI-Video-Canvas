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

const MEDIA_URL_FIELDS = ['resultUrl', 'lastFrame', 'editorCanvasData', 'editorBackgroundUrl'];

const ILLEGAL_CHARS_RE = new RegExp('[\\/\\\\:*?"<>|]', 'g');

function sanitizeDirName(title) {
    const fallback = 'untitled';
    if (!title || typeof title !== 'string') return fallback;
    const cleaned = title
        .replace(ILLEGAL_CHARS_RE, '') // filesystem-illegal characters
        .replace(/\s/g, '')            // any Unicode whitespace (regular, full-width, etc.)
        .slice(0, 40);
    return cleaned || fallback;
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
    const srcJson = sidecarPathFor(srcPath);
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
export function renameWorkflowAssetDirs(workflow, newTitle, { imagesDir, videosDir }) {
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
export function organizeWorkflowAssets(workflow, { imagesDir, videosDir }) {
    if (!workflow?.id) return { changed: false };

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
export function deleteWorkflowAssetDirs(workflow, { imagesDir, videosDir }) {
    if (!workflow?.assetsDirName) return;
    for (const dir of [path.join(imagesDir, workflow.assetsDirName), path.join(videosDir, workflow.assetsDirName)]) {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
}
