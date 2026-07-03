import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type GlobalDefaultModels = {
  defaultRole: string;
  roles: Record<string, { model: string; fallbacks?: string[]; description?: string }>;
};

export type GlobalDefaultsProvider = {
  id: string;
  name: string;
  configured: boolean;
  source: 'config' | 'env' | 'oauth' | 'extension' | 'models_json' | 'agent' | null;
};

export type GlobalDefaultsPayload = {
  presetId: string;
  models: GlobalDefaultModels;
  providers: GlobalDefaultsProvider[];
  recommendations: Array<{
    provider: string;
    model: string;
    reason: 'configured-provider' | 'recommended';
  }>;
};

export async function fetchGlobalDefaults(): Promise<GlobalDefaultsPayload> {
  const res = await fetchJson<{ ok?: boolean; payload?: GlobalDefaultsPayload }>(apiUrl('/api/global-defaults'));
  if (!res.payload || typeof res.payload.presetId !== 'string') {
    throw new Error('Invalid global defaults response');
  }
  return res.payload;
}

export async function updateGlobalDefaultModels(models: GlobalDefaultModels): Promise<GlobalDefaultsPayload> {
  const res = await fetchJson<{ ok?: boolean; payload?: GlobalDefaultsPayload }>(apiUrl('/api/global-defaults'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ models }),
  });
  if (!res.payload || typeof res.payload.presetId !== 'string') {
    throw new Error('Invalid global defaults response');
  }
  return res.payload;
}
