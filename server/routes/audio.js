/**
 * server/routes/audio.js
 *
 * 音频相关 API。
 *   POST /api/audio/minimax/tts   MiniMax 文本转语音（配音），保存到本地素材库。
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { synthesizeSpeech, DEFAULT_VOICE_ID } from '../services/minimaxTts.js';
import {
  DEFAULT_TTS_PROVIDER,
  getTtsProvider,
  isKnownTtsProvider,
  normalizeTtsProvider,
} from '../../shared/ttsProviders.js';

const router = express.Router();

const handleTts = async (req, res) => {
  try {
    const {
      provider: requestedProvider,
      text,
      voiceId,
      voiceName,
      speaker,
      speed,
      vol,
      volume, // 兼容别名
      pitch,
      emotion,
      model,
      format,
    } = req.body || {};

    if (requestedProvider && !isKnownTtsProvider(requestedProvider)) {
      return res.status(400).json({
        error: `不支持的配音供应商: ${requestedProvider}`,
        code: 'TTS_PROVIDER_UNSUPPORTED',
      });
    }
    const provider = normalizeTtsProvider(requestedProvider || DEFAULT_TTS_PROVIDER);
    const providerDefinition = getTtsProvider(provider);
    if (providerDefinition.mode !== 'direct') {
      return res.status(422).json({
        error: `${providerDefinition.label} 当前使用“平台生成后导入”模式`,
        code: 'TTS_EXTERNAL_IMPORT_REQUIRED',
        provider,
        mode: providerDefinition.mode,
      });
    }

    const apiKey = process.env.MINIMAX_API_KEY || req.app.locals.HAILUO_API_KEY || process.env.HAILUO_API_KEY;
    const groupId = process.env.MINIMAX_GROUP_ID;

    if (!apiKey || !groupId) {
      return res.status(400).json({
        error: 'MiniMax 配音未配置：请在 .env 设置 MINIMAX_API_KEY 与 MINIMAX_GROUP_ID',
        needsConfig: true,
      });
    }

    const { buffer, format: outFmt, durationSec } = await synthesizeSpeech({
      apiKey,
      groupId,
      text,
      voiceId: voiceId || DEFAULT_VOICE_ID,
      speed,
      vol: vol != null ? vol : volume,
      pitch,
      emotion,
      model,
      format,
    });

    // 保存到本地素材库 library/audio
    const audioDir = path.join(req.app.locals.LIBRARY_DIR, 'audio');
    fs.mkdirSync(audioDir, { recursive: true });
    const id = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const filename = `tts_${id}.${outFmt}`;
    const filePath = path.join(audioDir, filename);
    fs.writeFileSync(filePath, buffer);

    // 写入元数据（供素材库/历史面板）
    const metadata = {
      id,
      filename,
      type: 'audio',
      subtype: 'dialogue',
      text,
      speaker: speaker || '',
      provider,
      providerLabel: providerDefinition.label,
      model: model || 'speech-2.8-hd',
      voiceId: voiceId || DEFAULT_VOICE_ID,
      voiceName: voiceName || '',
      durationSec,
      source: 'generated',
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(audioDir, `${id}.json`), JSON.stringify(metadata, null, 2));

    res.json({
      success: true,
      url: `/library/audio/${filename}`,
      filename,
      durationSec,
      speaker: speaker || '',
      provider,
      model: metadata.model,
      voiceId: metadata.voiceId,
    });
  } catch (err) {
    console.error('[MiniMax TTS] Error:', err);
    res.status(500).json({ error: err.message || 'TTS 失败' });
  }
};

// 供应商中立入口；旧 MiniMax 路径继续保留，兼容已有项目与调用方。
router.post('/tts', handleTts);
router.post('/minimax/tts', (req, res) => {
  req.body = { ...(req.body || {}), provider: 'minimax' };
  return handleTts(req, res);
});

// 导入本地音频（音效/背景音乐/配音）到素材库
router.post('/upload', (req, res) => {
  try {
    const {
      dataUrl,
      filename,
      subtype,
      provider: requestedProvider,
      model,
      voiceId,
      voiceName,
      speaker,
      text,
    } = req.body || {};
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      return res.status(400).json({ error: '需要 base64 data URL 的 dataUrl' });
    }
    const m = dataUrl.match(/^data:([\w/+.-]+);base64,(.+)$/);
    if (!m) return res.status(400).json({ error: 'data URL 格式非法' });
    const mime = m[1];
    const buffer = Buffer.from(m[2], 'base64');

    const extMap = { 'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/aac': '.aac', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a' };
    let ext = extMap[mime] || '';
    if (!ext && filename && path.extname(filename)) ext = path.extname(filename);
    if (!ext) ext = '.mp3';

    const audioDir = path.join(req.app.locals.LIBRARY_DIR, 'audio');
    fs.mkdirSync(audioDir, { recursive: true });
    const id = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    // 仅使用安全的 basename，杜绝路径穿越
    const safeBase = filename ? path.basename(filename).replace(/[^\w一-龥.\-]+/g, '_') : `audio_${id}`;
    const outName = `${id}_${path.basename(safeBase, path.extname(safeBase))}${ext}`;
    fs.writeFileSync(path.join(audioDir, outName), buffer);

    const provider = isKnownTtsProvider(requestedProvider) ? requestedProvider : 'import';
    const metadata = {
      id, filename: outName, type: 'audio',
      subtype: subtype || 'sfx', provider,
      providerLabel: getTtsProvider(provider).label,
      model: model || '', voiceId: voiceId || '', voiceName: voiceName || '',
      speaker: speaker || '', text: text || '', source: 'imported',
      originalName: filename || '', createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(audioDir, `${id}.json`), JSON.stringify(metadata, null, 2));

    res.json({
      success: true,
      url: `/library/audio/${outName}`,
      filename: outName,
      provider,
      metadata,
    });
  } catch (err) {
    console.error('[Audio Upload] Error:', err);
    res.status(500).json({ error: err.message || '音频上传失败' });
  }
});

// 列出素材库中的音频
router.get('/list', (req, res) => {
  try {
    const audioDir = path.join(req.app.locals.LIBRARY_DIR, 'audio');
    if (!fs.existsSync(audioDir)) return res.json({ items: [] });
    const items = fs.readdirSync(audioDir)
      .filter((f) => /\.(mp3|wav|aac|ogg|m4a)$/i.test(f))
      .map((f) => {
        const metaPath = path.join(audioDir, f.replace(/\.[^.]+$/, '.json'));
        let meta = {};
        // 元数据文件名基于 id，前缀匹配
        const id = f.split('_').slice(0, 2).join('_');
        const mp = path.join(audioDir, `${id}.json`);
        try {
          if (fs.existsSync(mp)) meta = JSON.parse(fs.readFileSync(mp, 'utf8'));
          else if (fs.existsSync(metaPath)) meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        } catch { /* ignore */ }
        return { url: `/library/audio/${f}`, filename: f, ...meta };
      });
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
