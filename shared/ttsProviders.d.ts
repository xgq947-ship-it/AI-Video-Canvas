export type TtsProviderId =
  | 'chatcut-elevenlabs'
  | 'doubao'
  | 'fish-audio'
  | 'qwen-local'
  | 'import';

export type TtsProviderMode = 'direct' | 'external' | 'local' | 'import';

export interface TtsProviderDefinition {
  id: TtsProviderId;
  label: string;
  mode: TtsProviderMode;
  description: string;
}

export const TTS_PROVIDER_IDS: Record<string, TtsProviderId>;
export const TTS_PROVIDERS: TtsProviderDefinition[];
export const DEFAULT_TTS_PROVIDER: TtsProviderId;
export const isKnownTtsProvider: (value?: string) => boolean;
export const normalizeTtsProvider: (value?: string) => TtsProviderId;
export const getTtsProvider: (value?: string) => TtsProviderDefinition;
export const canGenerateTtsDirectly: (value?: string) => boolean;
