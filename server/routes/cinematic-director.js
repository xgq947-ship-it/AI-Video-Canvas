import express from 'express';
import {
  listCinematicDirectorModels,
  runCinematicDirector,
} from '../services/cinematicDirector.js';

const router = express.Router();

router.get('/skills/cinematic-director/models', (req, res) => {
  res.json({ models: listCinematicDirectorModels(req.app) });
});

router.post('/skills/cinematic-director/run', async (req, res) => {
  try {
    const body = req.body || {};
    const provider = body.model?.provider || body.provider || 'auto';
    if (provider === 'deepseek' && !req.app.locals.DEEPSEEK_API_KEY) {
      return res.status(400).json({ error: '未配置 DEEPSEEK_API_KEY，请先在 API 密钥设置中添加 DeepSeek API Key' });
    }
    const result = await runCinematicDirector({
      input: body.input,
      cast: body.cast,
      settings: body.settings,
      provider,
      allowFallback: body.allowFallback !== false,
      apiKey: req.app.locals.DEEPSEEK_API_KEY,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('[Cinematic Director] run failed:', error);
    return res.status(error?.status || 502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
