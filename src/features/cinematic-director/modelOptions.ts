import { useEffect, useState } from 'react';

export interface CinematicDirectorModelOption {
  id: string;
  providerId: string;
  name: string;
  modelId: string;
  available: boolean;
  customModel: boolean;
}

let cached: CinematicDirectorModelOption[] | null = null;
let inflight: Promise<CinematicDirectorModelOption[]> | null = null;

const fallback: CinematicDirectorModelOption[] = [
  { id: 'deepseek', providerId: 'deepseek', name: 'DeepSeek V4 Flash（云端 API）', modelId: 'deepseek-v4-flash', available: true, customModel: true },
  { id: 'gemini', providerId: 'gemini-web', name: 'Gemini Web（网页）', modelId: 'Gemini Web', available: true, customModel: true },
  { id: 'codex', providerId: 'codex-cli', name: 'Codex CLI（本机）', modelId: 'gpt-5.6-luna', available: true, customModel: true },
];

const load = async () => {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = fetch('/api/skills/cinematic-director/models', { cache: 'no-store' })
    .then(async response => {
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      return Array.isArray(data.models) ? data.models as CinematicDirectorModelOption[] : [];
    })
    .then(models => {
      cached = models.length ? models : fallback;
      return cached;
    })
    .catch(() => {
      cached = fallback;
      return fallback;
    })
    .finally(() => { inflight = null; });
  return inflight;
};

export function useCinematicDirectorModels() {
  const [models, setModels] = useState<CinematicDirectorModelOption[]>(() => cached || fallback);
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
