import express from 'express';
import {
  listCinematicDirectorModels,
  runCinematicDirector,
} from '../services/cinematicDirector.js';
import { requireFeature } from '../services/licenseGuard.js';
import { FEATURE_KEYS } from '../../shared/licenseFeatures.js';

const router = express.Router();

router.get('/skills/cinematic-director/models', (req, res) => {
  res.json({ models: listCinematicDirectorModels(req.app) });
});

// 电影导演是本期高级节点（导演工作流），执行前必须再次校验授权状态——
// 这一层不可绕过，UI 上的禁用/锁定只是好看，真正的判定在这里（文档 §13）。
router.post('/skills/cinematic-director/run', requireFeature(FEATURE_KEYS.DIRECTOR_WORKFLOW), async (req, res) => {
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
