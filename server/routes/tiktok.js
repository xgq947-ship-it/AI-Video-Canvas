/**
 * routes/tiktok.js
 *
 * TikTok 无水印导入与链接校验。
 * 从 server/index.js 原样搬出，行为未做改动。
 */

import express from 'express';

import { isValidTikTokUrl, processTikTokVideo } from '../tools/tiktok.js';
import { VIDEOS_DIR } from '../runtime/libraryPaths.js';

const router = express.Router();

// ============================================================================
// TIKTOK IMPORT API
// ============================================================================

/**
 * Import a TikTok video without watermark
 * Downloads the video, optionally trims first/last frames, saves to library
 */
router.post('/import', async (req, res) => {
    try {
        const { url, enableTrim = true } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'TikTok URL is required' });
        }

        if (!isValidTikTokUrl(url)) {
            return res.status(400).json({ error: 'Invalid TikTok URL format. Please provide a valid TikTok video URL.' });
        }

        console.log(`[TikTok API] Processing import request for: ${url}`);

        const result = await processTikTokVideo(url, VIDEOS_DIR, enableTrim);

        res.json(result);
    } catch (error) {
        console.error('[TikTok API] Import error:', error);
        res.status(500).json({
            error: error.message || 'Failed to import TikTok video',
            details: error.toString()
        });
    }
});

/**
 * Validate a TikTok URL without downloading
 */
router.post('/validate', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ valid: false, error: 'URL is required' });
        }

        const valid = isValidTikTokUrl(url);
        res.json({ valid, url });
    } catch (error) {
        res.status(500).json({ valid: false, error: error.message });
    }
});

export default router;
