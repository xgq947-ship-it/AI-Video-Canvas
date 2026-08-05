import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sanitizeProjectDirName } from '../utils/projectAssets.js';
import { writeJsonAtomicSync } from '../utils/workflowVideoRemixMigration.js';

const WORKFLOW_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const IGNORED_TOP_LEVEL_ENTRIES = new Set(['.git', '.trash', 'node_modules']);

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSamePath(left, right) {
    const normalize = value => {
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

function isPathInside(parent, candidate) {
    const parentPath = path.resolve(parent);
    const candidatePath = path.resolve(candidate);
    return candidatePath === parentPath || candidatePath.startsWith(`${parentPath}${path.sep}`);
}

function readProjectManifest(sourceRoot) {
    const manifestPath = path.join(sourceRoot, 'project.json');
    if (!fs.existsSync(manifestPath)) {
        const error = new Error('所选文件夹不是 Evan 项目：缺少 project.json');
        error.code = 'PROJECT_MANIFEST_MISSING';
        throw error;
    }

    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
        const error = new Error('项目文件 project.json 无法读取，请确认文件未损坏');
        error.code = 'PROJECT_MANIFEST_INVALID';
        throw error;
    }
    if (!isObject(manifest)) {
        const error = new Error('项目文件 project.json 格式不正确');
        error.code = 'PROJECT_MANIFEST_INVALID';
        throw error;
    }
    return manifest;
}

function safeWorkflowId(value) {
    const id = String(value || '').trim();
    return WORKFLOW_ID_RE.test(id) ? id : null;
}

function readWorkflowFile(workflowsDir, id) {
    const workflowPath = path.join(workflowsDir, `${id}.json`);
    if (!fs.existsSync(workflowPath)) return null;
    try {
        const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
        return isObject(workflow) ? workflow : null;
    } catch {
        return null;
    }
}

function resolveExistingProjectRoot(workflow, projectsDir) {
    if (workflow?.projectPath && path.isAbsolute(workflow.projectPath)) {
        return path.resolve(workflow.projectPath);
    }
    if (workflow?.projectDirName) {
        return path.join(projectsDir, workflow.projectDirName);
    }
    return null;
}

function findAlreadyImportedWorkflow(manifest, sourceRoot, { workflowsDir, projectsDir }) {
    const id = safeWorkflowId(manifest.id);
    if (!id) return null;
    const registered = readWorkflowFile(workflowsDir, id);
    if (!registered) return null;
    const registeredRoot = resolveExistingProjectRoot(registered, projectsDir);
    return registeredRoot && isSamePath(registeredRoot, sourceRoot) ? registered : null;
}

function uniqueProjectDirName(baseName, projectsDir, id) {
    const normalizedBase = sanitizeProjectDirName(baseName);
    const safeBase = normalizedBase === 'untitled' ? `local-project-${id.slice(0, 8)}` : normalizedBase;
    let candidate = safeBase;
    let suffix = 2;
    while (fs.existsSync(path.join(projectsDir, candidate))) {
        candidate = `${safeBase}-${suffix}`;
        suffix += 1;
    }
    return candidate;
}

function uniqueWorkflowId(candidate, workflowsDir) {
    let id = safeWorkflowId(candidate);
    if (!id || fs.existsSync(path.join(workflowsDir, `${id}.json`))) {
        id = crypto.randomUUID();
    }
    return id;
}

function rewriteProjectUrls(value, previousProjectDirName, nextProjectDirName) {
    if (typeof value === 'string') {
        const nextPrefix = `/library/projects/${encodeURIComponent(nextProjectDirName)}/`;
        const prefixes = [
            `/library/projects/${encodeURIComponent(previousProjectDirName)}/`,
            `/library/projects/${previousProjectDirName}/`
        ];
        return prefixes.reduce((result, prefix) => result.split(prefix).join(nextPrefix), value);
    }
    if (Array.isArray(value)) {
        return value.map(item => rewriteProjectUrls(item, previousProjectDirName, nextProjectDirName));
    }
    if (!isObject(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
        key,
        rewriteProjectUrls(item, previousProjectDirName, nextProjectDirName)
    ]));
}

function copyProjectDirectory(sourceRoot, destinationRoot) {
    fs.cpSync(sourceRoot, destinationRoot, {
        recursive: true,
        errorOnExist: true,
        filter: sourcePath => {
            const relative = path.relative(sourceRoot, sourcePath);
            if (!relative) return true;
            const topLevel = relative.split(path.sep)[0];
            return !IGNORED_TOP_LEVEL_ENTRIES.has(topLevel);
        }
    });
}

function normalizeImportedWorkflow(manifest, sourceRoot, projectDirName, id) {
    const title = String(manifest.title || path.basename(sourceRoot) || '本地项目').trim() || '本地项目';
    const previousProjectDirName = String(
        manifest.projectDirName || path.basename(sourceRoot) || projectDirName
    );
    const now = new Date().toISOString();
    const workflow = rewriteProjectUrls({ ...manifest }, previousProjectDirName, projectDirName);

    workflow.id = id;
    workflow.title = title;
    workflow.projectDirName = projectDirName;
    delete workflow.projectPath;
    delete workflow.projectStorage;
    workflow.nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
    workflow.groups = Array.isArray(workflow.groups) ? workflow.groups : [];
    workflow.viewport = isObject(workflow.viewport)
        ? workflow.viewport
        : { x: 0, y: 0, zoom: 1 };
    workflow.createdAt = typeof workflow.createdAt === 'string' ? workflow.createdAt : now;
    workflow.updatedAt = now;
    return workflow;
}

/**
 * Imports a self-contained Evan project folder without modifying the source.
 * The copied project is registered in the central workflow index and can then
 * be loaded through the normal /api/workflows/:id path.
 */
export function importLocalProject(sourcePath, { projectsDir, workflowsDir }) {
    const requestedPath = String(sourcePath || '').trim();
    if (!path.isAbsolute(requestedPath)) {
        const error = new Error('本地项目路径必须是绝对路径');
        error.code = 'INVALID_PROJECT_LOCATION';
        throw error;
    }
    if (!projectsDir || !workflowsDir) {
        throw new Error('项目库路径未配置');
    }

    let sourceRoot;
    try {
        sourceRoot = fs.realpathSync(path.resolve(requestedPath));
    } catch {
        const error = new Error('所选本地项目文件夹不存在或无法读取');
        error.code = 'PROJECT_LOCATION_MISSING';
        throw error;
    }
    if (!fs.statSync(sourceRoot).isDirectory()) {
        const error = new Error('请选择文件夹作为本地项目');
        error.code = 'INVALID_PROJECT_LOCATION';
        throw error;
    }

    const projectsRoot = path.resolve(projectsDir);
    const workflowsRoot = path.resolve(workflowsDir);
    if (isPathInside(sourceRoot, projectsRoot)) {
        const error = new Error('所选文件夹不能包含 Evan 的项目库，请选择具体项目文件夹');
        error.code = 'INVALID_PROJECT_LOCATION';
        throw error;
    }

    const manifest = readProjectManifest(sourceRoot);
    const existing = findAlreadyImportedWorkflow(manifest, sourceRoot, {
        workflowsDir: workflowsRoot,
        projectsDir: projectsRoot
    });
    if (existing) {
        return { workflow: existing, alreadyImported: true };
    }

    fs.mkdirSync(projectsRoot, { recursive: true });
    fs.mkdirSync(workflowsRoot, { recursive: true });
    const id = uniqueWorkflowId(manifest.id, workflowsRoot);
    const projectDirName = uniqueProjectDirName(
        manifest.title || path.basename(sourceRoot),
        projectsRoot,
        id
    );
    const workflow = normalizeImportedWorkflow(manifest, sourceRoot, projectDirName, id);
    const destinationRoot = path.join(projectsRoot, projectDirName);
    const workflowPath = path.join(workflowsRoot, `${id}.json`);

    try {
        copyProjectDirectory(sourceRoot, destinationRoot);
        for (const type of ['images', 'videos', 'audio']) {
            fs.mkdirSync(path.join(destinationRoot, type), { recursive: true });
        }
        writeJsonAtomicSync(path.join(destinationRoot, 'project.json'), workflow);
        writeJsonAtomicSync(workflowPath, workflow);
    } catch (error) {
        if (fs.existsSync(workflowPath)) fs.rmSync(workflowPath, { force: true });
        if (fs.existsSync(destinationRoot)) fs.rmSync(destinationRoot, { recursive: true, force: true });
        throw error;
    }

    return { workflow, alreadyImported: false };
}
