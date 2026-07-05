import type { ProviderConfig } from '../config/models-json.js';
import { resolveConfigValue, resolveHeaders } from '../config/resolve-config-value.js';

import type { DomesticProviderModelPreset } from './domestic-presets.js';

export type DiscoverableProviderApi = Extract<
  NonNullable<ProviderConfig['api']>,
  'openai-completions' | 'openai-responses'
>;

export interface DiscoverProviderModelsParams {
  providerId: string;
  baseUrl: string;
  apiKey?: string;
  api?: ProviderConfig['api'];
  headers?: Record<string, string>;
  timeoutMs?: number;
  limit?: number;
}

export interface DiscoveredProviderModel extends DomesticProviderModelPreset {
  source: 'live';
}

interface OpenAiModelsResponse {
  data?: unknown;
}

function joinEndpoint(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`;
}

function normalizeModelId(row: unknown): string | undefined {
  if (typeof row === 'string') return row.trim() || undefined;
  if (!row || typeof row !== 'object') return undefined;
  const id = (row as { id?: unknown }).id;
  return typeof id === 'string' && id.trim() ? id.trim() : undefined;
}

function normalizeOpenAiModels(body: OpenAiModelsResponse, limit: number): DiscoveredProviderModel[] {
  const rows = Array.isArray(body.data) ? body.data : [];
  const ids = new Set<string>();
  const models: DiscoveredProviderModel[] = [];
  for (const row of rows) {
    const id = normalizeModelId(row);
    if (!id || ids.has(id)) continue;
    ids.add(id);
    models.push({ id, name: id, input: ['text'], source: 'live' });
    if (models.length >= limit) break;
  }
  return models.sort((a, b) => a.id.localeCompare(b.id, undefined, { sensitivity: 'base' }));
}

export function isProviderApiDiscoverable(api: ProviderConfig['api'] | undefined): api is DiscoverableProviderApi {
  return !api || api === 'openai-completions' || api === 'openai-responses';
}

export async function discoverProviderModels(
  params: DiscoverProviderModelsParams,
): Promise<DiscoveredProviderModel[]> {
  if (!isProviderApiDiscoverable(params.api)) {
    throw new Error(`Model discovery is only supported for OpenAI-compatible providers: ${params.providerId}`);
  }
  if (!URL.canParse(params.baseUrl)) {
    throw new Error(`Invalid Base URL for ${params.providerId}`);
  }

  const resolvedApiKey = params.apiKey ? resolveConfigValue(params.apiKey) : undefined;
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...(resolveHeaders(params.headers) ?? {}),
  };
  if (resolvedApiKey) {
    headers.authorization = `Bearer ${resolvedApiKey}`;
  }

  const timeout = AbortSignal.timeout(params.timeoutMs ?? 10_000);
  const endpoint = joinEndpoint(params.baseUrl, '/models');
  const res = await fetch(endpoint, {
    method: 'GET',
    headers,
    signal: timeout,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `${params.providerId} model discovery failed (${res.status}) at ${endpoint}${
        text ? `: ${text.slice(0, 300)}` : ''
      }`,
    );
  }

  const body = (await res.json()) as OpenAiModelsResponse;
  const models = normalizeOpenAiModels(body, params.limit ?? 500);
  if (models.length === 0) {
    throw new Error(`${params.providerId} model discovery returned no model ids`);
  }
  return models;
}
