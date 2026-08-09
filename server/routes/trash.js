/**
 * routes/trash.js
 *
 * 项目回收站：列出 / 移入 / 还原 / 清空 / 单条彻底删除 / 预览。
 *
 * 从 server/index.js 原样搬出，行为未做任何改动。搬出的前提是把
 * loadWorkflowForTrash / saveTrashWorkflow 提到 utils/workflowStore.js —— 它们
 * 原来只存在于 index.js 的模块作用域，也正是这些路由一直挪不走的原因。
 */

import express from 'express';

import {
    getProjectTrashPreviewPath,
    listProjectTrash,
    permanentlyDeleteProjectTrashEntry,
    purgeAllProjectTrash,
    restoreProjectTrashEntry,
    trashWorkflowNodes
} from '../services/projectTrash.js';
import { loadWorkflowForTrash, saveTrashWorkflow } from '../utils/workflowStore.js';

const router = express.Router();

router.get('/:id/trash', (req, res) => {
    try {
        const { workflow, projectRoot } = loadWorkflowForTrash(req.params.id);
        res.json(listProjectTrash(workflow, projectRoot));
    } catch (error) {
        const status = error.code === 'PROJECT_NOT_FOUND' ? 404 : 500;
        res.status(status).json({ error: error.message });
    }
});

router.post('/:id/trash', (req, res) => {
    try {
        const currentNodes = Array.isArray(req.body?.nodes) ? req.body.nodes : null;
        const nodeIds = Array.isArray(req.body?.nodeIds)
            ? req.body.nodeIds.filter(id => typeof id === 'string')
            : [];
        if (!currentNodes || nodeIds.length === 0) {
            return res.status(400).json({ error: '缺少要删除的画布节点' });
        }
        const { workflow, workflowPath, projectRoot } = loadWorkflowForTrash(req.params.id);
        const result = trashWorkflowNodes(workflow, currentNodes, nodeIds, projectRoot);
        saveTrashWorkflow(workflow, workflowPath);
        res.status(201).json({
            success: true,
            entry: result.entry,
            deletedNodeIds: result.deletedNodes.map(node => node.id)
        });
    } catch (error) {
        console.error('Move project image to trash error:', error);
        const status = error.code === 'PROJECT_NOT_FOUND' ? 404 : 500;
        res.status(status).json({ error: error.message });
    }
});

router.post('/:id/trash/:entryId/restore', (req, res) => {
    try {
        const { workflow, workflowPath, projectRoot } = loadWorkflowForTrash(req.params.id);
        const restoredNodes = restoreProjectTrashEntry(workflow, projectRoot, req.params.entryId);
        saveTrashWorkflow(workflow, workflowPath);
        res.json({ success: true, restoredNodes });
    } catch (error) {
        const status = error.code === 'TRASH_NOT_FOUND' || error.code === 'PROJECT_NOT_FOUND' ? 404 : 500;
        res.status(status).json({ error: error.message });
    }
});

// 清空：路由放在 /:entryId 之前，否则 "all" 会被当成 entryId 匹配掉。
router.delete('/:id/trash', (req, res) => {
    try {
        const { workflow, projectRoot } = loadWorkflowForTrash(req.params.id);
        res.json({ success: true, ...purgeAllProjectTrash(workflow, projectRoot) });
    } catch (error) {
        const status = error.code === 'PROJECT_NOT_FOUND' ? 404 : 500;
        res.status(status).json({ error: error.message });
    }
});

router.delete('/:id/trash/:entryId', (req, res) => {
    try {
        const { workflow, projectRoot } = loadWorkflowForTrash(req.params.id);
        permanentlyDeleteProjectTrashEntry(workflow, projectRoot, req.params.entryId);
        res.json({ success: true });
    } catch (error) {
        const status = error.code === 'TRASH_NOT_FOUND' || error.code === 'PROJECT_NOT_FOUND' ? 404 : 500;
        res.status(status).json({ error: error.message });
    }
});

router.get('/:id/trash/:entryId/preview', (req, res) => {
    try {
        const { projectRoot } = loadWorkflowForTrash(req.params.id);
        const previewPath = getProjectTrashPreviewPath(projectRoot, req.params.entryId);
        if (!previewPath) return res.status(404).end();
        // Express blocks files below dot-directories by default. Trash previews
        // live below the project-local `.trash/` folder, so explicitly allow
        // this already-resolved file while keeping the rest of the directory
        // private.
        res.sendFile(previewPath, {
            dotfiles: 'allow',
            headers: {
                'Cache-Control': 'private, no-cache'
            }
        });
    } catch (error) {
        res.status(error.code === 'PROJECT_NOT_FOUND' ? 404 : 500).json({ error: error.message });
    }
});

export default router;
