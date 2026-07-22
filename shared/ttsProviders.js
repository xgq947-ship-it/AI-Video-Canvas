export const TTS_PROVIDER_IDS = {
  CHATCUT_ELEVENLABS: 'chatcut-elevenlabs',
  DOUBAO: 'doubao',
  FISH_AUDIO: 'fish-audio',
  QWEN_LOCAL: 'qwen-local',
  IMPORT: 'import',
};

export const TTS_PROVIDERS = [
  {
    id: TTS_PROVIDER_IDS.CHATCUT_ELEVENLABS,
    label: 'ChatCut / ElevenLabs',
    mode: 'external',
    description: '在 ChatCut 或 ElevenLabs 生成后导入音频',
  },
  {
    id: TTS_PROVIDER_IDS.DOUBAO,
    label: '豆包语音',
    mode: 'external',
    description: '在豆包语音生成后导入音频',
  },
  {
    id: TTS_PROVIDER_IDS.FISH_AUDIO,
    label: 'Fish Audio',
    mode: 'external',
    description: '在 Fish Audio 生成后导入音频',
  },
  {
    id: TTS_PROVIDER_IDS.QWEN_LOCAL,
    label: 'Qwen3-TTS 本地',
    mode: 'local',
    description: '本地模型接口预留，可导入本地生成音频',
  },
  {
    id: TTS_PROVIDER_IDS.IMPORT,
    label: '仅导入音频',
    mode: 'import',
    description: '兼容任意平台或真人录音',
  },
];

export const DEFAULT_TTS_PROVIDER = TTS_PROVIDER_IDS.IMPORT;

export const isKnownTtsProvider = (value) =>
  typeof value === 'string' && TTS_PROVIDERS.some((provider) => provider.id === value);

export const normalizeTtsProvider = (value) =>
  isKnownTtsProvider(value) ? value : DEFAULT_TTS_PROVIDER;

export const getTtsProvider = (value) => {
  const id = normalizeTtsProvider(value);
  return TTS_PROVIDERS.find((provider) => provider.id === id);
};

export const canGenerateTtsDirectly = (value) => getTtsProvider(value)?.mode === 'direct';
