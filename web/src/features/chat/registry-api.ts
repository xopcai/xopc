import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type ConfiguredModel = {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  vision?: boolean;
};

export async function fetchConfiguredModels(): Promise<ConfiguredModel[]> {
  const res = await apiFetch(apiUrl('/api/models'));
  if (!res.ok) throw new Error(`Models: HTTP ${res.status}`);
  const data = (await res.json()) as { payload?: { models?: ConfiguredModel[] } };
  return data.payload?.models ?? [];
}
