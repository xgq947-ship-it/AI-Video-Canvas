import express from 'express';
import {
    createCodexImageJob,
    getCodexImageJob,
    listCodexImageJobs
} from '../services/codexImageJobs.js';
import { resolveProjectMediaTarget } from '../utils/projectAssets.js';

const router = express.Router();

router.post('/codex-image-jobs', (req, res) => {
    try {
        const codexStatus = req.app.locals.CODEX_INTEGRATION?.getStatus();
        if (!codexStatus?.available) {
            return res.status(503).json({
                error: '未检测到 Codex CLI。请在设置 → Codex 服务中选择本机 Codex。'
            });
        }
        if (!codexStatus.authenticated) {
            return res.status(401).json({
                error: 'Codex 尚未登录。请在设置 → Codex 服务中完成 ChatGPT 登录。'
            });
        }
        if (!codexStatus.skillInstalled || !codexStatus.queueBridgeReady) {
            return res.status(503).json({
                error: 'Codex 运行桥接未准备完成，请重启 Evan 后重试。'
            });
        }
        const { CODEX_IMAGE_JOBS_DIR, LIBRARY_DIR, WORKFLOWS_DIR, PROJECTS_DIR } = req.app.locals;
        const target = resolveProjectMediaTarget(req.body.workflowId, 'images', {
            workflowsDir: WORKFLOWS_DIR,
            projectsDir: PROJECTS_DIR
        });
        const job = createCodexImageJob({
            jobsDir: CODEX_IMAGE_JOBS_DIR,
            libraryDir: LIBRARY_DIR,
            nodeId: req.body.nodeId,
            prompt: req.body.prompt,
            aspectRatio: req.body.aspectRatio,
            resolution: req.body.resolution,
            referenceImages: req.body.referenceImages,
            workflowId: req.body.workflowId,
            projectDirName: target.projectDirName
        });
        req.app.locals.CODEX_IMAGE_AUTOMATION?.notify();
        res.status(202).json(job);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.get('/codex-image-automation/status', (req, res) => {
    const automation = req.app.locals.CODEX_IMAGE_AUTOMATION;
    if (!automation) {
        return res.json({ enabled: false, status: 'unavailable', queuedJobs: 0 });
    }
    res.json(automation.getStatus());
});

router.post('/codex-image-automation/retry', (req, res) => {
    const automation = req.app.locals.CODEX_IMAGE_AUTOMATION;
    if (!automation) {
        return res.status(503).json({ error: 'Codex 自动生图服务不可用' });
    }
    const started = automation.notify();
    res.status(started ? 202 : 503).json(automation.getStatus());
});

router.get('/codex-image-jobs', (req, res) => {
    try {
        const jobs = listCodexImageJobs(req.app.locals.CODEX_IMAGE_JOBS_DIR, req.query.status);
        res.json(jobs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/codex-image-jobs/:id', (req, res) => {
    try {
        const job = getCodexImageJob(req.app.locals.CODEX_IMAGE_JOBS_DIR, req.params.id);
        if (!job) return res.status(404).json({ error: 'Job not found' });
        res.json(job);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
