import fs from 'node:fs/promises';
import path from 'node:path';

export function resolveProjectDirectory(workflow, dataDir) {
    if (workflow?.projectPath) {
        if (!path.isAbsolute(workflow.projectPath)) {
            throw new Error('项目目录路径无效');
        }
        return path.resolve(workflow.projectPath);
    }

    const directoryName = String(workflow?.projectDirName || '');
    if (!directoryName && workflow?.assetsDirName) {
        const legacyDirectoryName = String(workflow.assetsDirName);
        if (
            path.basename(legacyDirectoryName) !== legacyDirectoryName
            || legacyDirectoryName === '.'
            || legacyDirectoryName === '..'
        ) {
            throw new Error('项目目录路径无效');
        }
        return path.join(dataDir, 'library', 'images', legacyDirectoryName);
    }
    if (
        !directoryName
        || path.basename(directoryName) !== directoryName
        || directoryName === '.'
        || directoryName === '..'
    ) {
        throw new Error('项目目录路径无效');
    }
    return path.join(dataDir, 'library', 'projects', directoryName);
}

export function resolveWorkflowFile(workflowId, dataDir) {
    const id = String(workflowId || '').trim();
    const filename = `${id}.json`;
    if (
        !id
        || path.basename(filename) !== filename
        || id === '.'
        || id === '..'
    ) {
        throw new Error('项目 ID 无效');
    }
    return path.join(dataDir, 'library', 'workflows', filename);
}

export async function revealProjectDirectory(workflow, {
    dataDir,
    openPath,
    stat = fs.stat,
} = {}) {
    let directory;
    try {
        directory = resolveProjectDirectory(workflow, dataDir);
        const info = await stat(directory);
        if (!info.isDirectory()) {
            return { ok: false, error: '项目目录不存在' };
        }
    } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
            return { ok: false, error: '项目目录不存在' };
        }
        return { ok: false, error: error?.message || '项目目录不可用' };
    }

    const openError = await openPath(directory);
    if (openError) {
        return { ok: false, error: `无法打开项目目录：${openError}` };
    }
    return { ok: true, path: directory };
}

export async function revealProjectById(workflowId, {
    dataDir,
    openPath,
    readFile = fs.readFile,
    stat = fs.stat,
} = {}) {
    let workflow;
    try {
        const filePath = resolveWorkflowFile(workflowId, dataDir);
        workflow = JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
            return { ok: false, error: '项目不存在' };
        }
        return {
            ok: false,
            error: error instanceof SyntaxError ? '项目数据损坏' : (error?.message || '无法读取项目目录')
        };
    }
    return revealProjectDirectory(workflow, { dataDir, openPath, stat });
}
