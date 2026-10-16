import type { ModelSetupPreview, ModelSetupRequest } from '@xopcai/gateway-contract';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { revalidateModelsHubCaches } from './models-hub-cache';

export async function fetchModelSetup(provider: string): Promise<ModelSetupPreview> {
  const data = await fetchJson<{ payload: ModelSetupPreview }>(apiUrl(`/api/models/setup/${encodeURIComponent(provider)}`));
  return data.payload;
}

export async function previewModelSetup(provider: string, request: ModelSetupRequest = {}): Promise<ModelSetupPreview> {
  const data = await fetchJson<{ payload: ModelSetupPreview }>(apiUrl(`/api/models/setup/${encodeURIComponent(provider)}/preview`), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
  });
  return data.payload;
}
export async function applyModelSetup(provider: string, request: ModelSetupRequest, revision: string): Promise<void> {
  await fetchJson(apiUrl(`/api/models/setup/${encodeURIComponent(provider)}/apply`), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...request, revision }),
  });
  await revalidateModelsHubCaches();
}
