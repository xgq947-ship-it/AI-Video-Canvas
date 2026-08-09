/**
 * workflowStore.js
 *
 * 跨路由复用的项目（workflow）读写小工具。
 *
 * 这几个函数原本定义在 server/index.js 的模块作用域，被 projects / trash /
 * workflows 三组路由共同使用——这也是那些路由一直没法拆出去的直接原因。
 */

import fs from 'fs';
import path from 'path';

import { ensureProjectFolder, resolveWorkflowProjectRoot } from './projectAssets.js';
import { purgeExpiredProjectTrash } from '../services/projectTrash.js';
import { PROJECTS_DIR, WORKFLOWS_DIR } from '../runtime/libraryPaths.js';

/**
 * 把完整项目内容写到项目文件夹里的 project.json。
 *
 * 中央 workflows 索引仍是应用读取用的快索引；这份文件让用户自选的项目目录**自包含**，
 * 便于备份和直接查看。
 */
export const writeProjectManifest = (workflow) => {
    if (!workflow?.projectDirName) return;
    const projectRoot = ensureProjectFolder(workflow, { projectsDir: PROJECTS_DIR });
    const manifestPath = path.join(projectRoot, 'project.json');
    fs.writeFileSync(manifestPath, JSON.stringify(workflow, null, 2));
};

/** 按标题查找已有项目（用于重名判定）。忽略损坏的旧文件，交由各自的加载路径处理。 */
export const findWorkflowByTitle = (title, exceptId = null) => {
    const normalized = String(title).trim().toLocaleLowerCase();
    for (const file of fs.readdirSync(WORKFLOWS_DIR).filter(name => name.endsWith('.json'))) {
        try {
            const workflow = JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8'));
            if (workflow.id !== exceptId && String(workflow.title || '').trim().toLocaleLowerCase() === normalized) {
                return workflow;
            }
        } catch { /* invalid legacy file is ignored here and handled by its own load path */ }
    }
    return null;
};

/** 清理所有项目里过期的回收站条目。 */
export const purgeAllExpiredProjectTrash = () => {
    for (const filename of fs.readdirSync(WORKFLOWS_DIR).filter(name => name.endsWith('.json'))) {
        try {
            const workflow = JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, filename), 'utf8'));
            const projectRoot = resolveWorkflowProjectRoot(workflow, PROJECTS_DIR);
            if (projectRoot && fs.existsSync(projectRoot)) purgeExpiredProjectTrash(projectRoot, Date.now(), workflow);
        } catch (error) {
            console.warn(`[回收站] 清理 ${filename} 失败：${error.message}`);
        }
    }
};

/**
 * 加载项目并确认它的文件夹真实存在。
 * 两种失败给不同的 code：项目不存在 vs 磁盘/外置盘没挂上，界面提示不一样。
 */
export const loadWorkflowForTrash = (workflowId) => {
    const workflowPath = path.join(WORKFLOWS_DIR, `${workflowId}.json`);
    if (!fs.existsSync(workflowPath)) {
        const error = new Error('项目不存在');
        error.code = 'PROJECT_NOT_FOUND';
        throw error;
    }
    const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
    const projectRoot = resolveWorkflowProjectRoot(workflow, PROJECTS_DIR);
    if (!projectRoot || !fs.existsSync(projectRoot)) {
        const error = new Error('项目文件夹不存在或磁盘未连接');
        error.code = 'PROJECT_LOCATION_MISSING';
        throw error;
    }
    return { workflow, workflowPath, projectRoot };
};

export const saveTrashWorkflow = (workflow, workflowPath) => {
    workflow.updatedAt = new Date().toISOString();
    fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
    writeProjectManifest(workflow);
};

/** 以 limit 为上限并发映射，保持输出顺序与输入一致。 */
export async function mapWithConcurrency(items, limit, mapper) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const index = next;
            next += 1;
            results[index] = await mapper(items[index], index);
        }
    });
    await Promise.all(workers);
    return results;
}
