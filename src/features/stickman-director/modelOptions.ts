import { useEffect, useState } from 'react';

export interface StickmanDirectorModelOption {
  id: string;
  providerId: string;
  name: string;
  modelId: string;
  available: boolean;
  customModel: boolean;
}

let cached: StickmanDirectorModelOption[] | null = null;
let inflight: Promise<StickmanDirectorModelOption[]> | null = null;

const load = async () => {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = fetch('/api/skills/stickman-video-director/models', { cache: 'no-store' })
    .then(async response => {
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      return Array.isArray(data.models) ? data.models as StickmanDirectorModelOption[] : [];
    })
    .then(models => {
      cached = models;
      return models;
    })
    .catch(() => {
      const fallback: StickmanDirectorModelOption[] = [
        { id: 'deepseek', providerId: 'deepseek', name: 'DeepSeek V4 Flash（云端 API）', modelId: 'deepseek-v4-flash', available: true, customModel: true },
        { id: 'gemini', providerId: 'gemini-web', name: 'Gemini Web（网页）', modelId: 'Gemini Web', available: true, customModel: true },
        { id: 'codex', providerId: 'codex-cli', name: 'Codex CLI（本机）', modelId: 'gpt-5.6-luna', available: true, customModel: true },
      ];
      cached = fallback;
      return fallback;
    })
    .finally(() => { inflight = null; });
  return inflight;
};

export function useStickmanDirectorModels() {
  const [models, setModels] = useState<StickmanDirectorModelOption[]>(() => cached || []);
  const [loading, setLoading] = useState(!cached);
  useEffect(() => {
    let alive = true;
    void load().then(next => {
      if (!alive) return;
      setModels(next);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);
  return { models, loading };
}
