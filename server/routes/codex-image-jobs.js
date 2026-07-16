import express from 'express';
import {
    createCodexImageJob,
    getCodexImageJob,
    listCodexImageJobs
} from '../services/codexImageJobs.js';

const router = express.Router();

router.post('/codex-image-jobs', (req, res) => {
    try {
        const { CODEX_IMAGE_JOBS_DIR, LIBRARY_DIR } = req.app.locals;
        const job = createCodexImageJob({
            jobsDir: CODEX_IMAGE_JOBS_DIR,
            libraryDir: LIBRARY_DIR,
            nodeId: req.body.nodeId,
            prompt: req.body.prompt,
            aspectRatio: req.body.aspectRatio,
            resolution: req.body.resolution,
            referenceImages: req.body.referenceImages
        });
        res.status(202).json(job);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
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
