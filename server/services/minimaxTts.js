/**
 * server/services/minimaxTts.js
 *
 * MiniMax T2A v2 文本转语音（配音）服务。
 * 官方文档：https://platform.minimax.io/docs/api-reference/text-to-speech-t2a-v2
 *
 * 密钥仅从环境变量读取（MINIMAX_API_KEY / MINIMAX_GROUP_ID，可回退 HAILUO_API_KEY）。
 * 绝不把密钥写死；无密钥时返回明确错误，不产生任何付费调用。
 */

const T2A_URL = 'https://api.minimax.io/v1/t2a_v2';

// 默认音色（林默）——仅为默认 voiceId，非密钥。
export const DEFAULT_VOICE_ID = 'yuanboxiaoshu';

/**
 * @param {object} p
 * @param {string} p.apiKey
 * @param {string} p.groupId
 * @param {string} p.text
 * @param {string} [p.voiceId]
 * @param {number} [p.speed=1.0]
 * @param {number} [p.vol=1.0]
 * @param {number} [p.pitch=0]
 * @param {string} [p.emotion]        happy|sad|angry|fearful|disgusted|surprised|neutral
 * @param {string} [p.model='speech-02-hd']
 * @param {string} [p.format='mp3']
 * @param {number} [p.sampleRate=32000]
 * @returns {Promise<{buffer:Buffer, format:string, durationSec:number}>}
 */
export const synthesizeSpeech = async ({
  apiKey,
  groupId,
  text,
  voiceId = DEFAULT_VOICE_ID,
  speed = 1.0,
  vol = 1.0,
  pitch = 0,
  emotion,
  model = 'speech-02-hd',
  format = 'mp3',
  sampleRate = 32000,
}) => {
  if (!apiKey) throw new Error('MiniMax API Key 未配置（MINIMAX_API_KEY 或 HAILUO_API_KEY）');
  if (!groupId) throw new Error('MiniMax GroupId 未配置（MINIMAX_GROUP_ID）');
  if (!text || !String(text).trim()) throw new Error('text 不能为空');

  const voice_setting = {
    voice_id: voiceId,
    speed: Number(speed) || 1.0,
    vol: Number(vol) || 1.0,
    pitch: Number(pitch) || 0,
  };
  if (emotion) voice_setting.emotion = emotion;

  const body = {
    model,
    text: String(text),
    stream: false,
    voice_setting,
    audio_setting: {
      sample_rate: Number(sampleRate) || 32000,
      bitrate: 128000,
      format,
      channel: 1,
    },
  };

  const resp = await fetch(`${T2A_URL}?GroupId=${encodeURIComponent(groupId)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`MiniMax TTS HTTP ${resp.status}: ${t.slice(0, 300)}`);
  }

  const json = await resp.json();
  const status = json && json.base_resp && json.base_resp.status_code;
  if (status !== 0 && status !== undefined && status !== null) {
    throw new Error(`MiniMax TTS 错误(${status}): ${json.base_resp.status_msg || '未知错误'}`);
  }
  const hex = json && json.data && json.data.audio;
  if (!hex) throw new Error('MiniMax TTS 未返回音频数据');

  const buffer = Buffer.from(hex, 'hex');
  const durationSec =
    json.extra_info && json.extra_info.audio_length
      ? json.extra_info.audio_length / 1000
      : 0;

  return { buffer, format, durationSec };
};
