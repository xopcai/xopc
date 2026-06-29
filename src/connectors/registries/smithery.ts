import type { ConnectorDefinition } from '../types.js';
import type { ConnectorRegistryAdapter, ConnectorRegistrySearchParams, ConnectorRegistrySearchResult } from './types.js';

const DEFAULT_BASE_URL = 'https://registry.smithery.ai';

function smitheryApiKey(): string | undefined {
  return process.env.XOPC_SMITHERY_API_KEY?.trim() || process.env.SMITHERY_API_KEY?.trim() || undefined;
}

function smitheryBaseUrl(): string {
  return process.env.XOPC_SMITHERY_REGISTRY_URL?.trim().replace(/\/+$/, '') || DEFAULT_BASE_URL;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function slugFrom(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'smithery-mcp';
}

function connectorFromSmitheryServer(server: Record<string, unknown>, apiKey?: string): ConnectorDefinition | undefined {
  const qualifiedName = readString(server.qualifiedName ?? server.qualified_name ?? server.name ?? server.id);
  const displayName = readString(server.displayName ?? server.display_name ?? server.name) ?? qualifiedName;
  if (!qualifiedName || !displayName) return undefined;
  const serverId = slugFrom(qualifiedName);
  const encodedPath = qualifiedName.split('/').map((part) => encodeURIComponent(part)).join('/');
  const url = `https://server.smithery.ai/${encodedPath}/mcp`;
  return {
    id: `smithery-${serverId}`,
    version: readString(server.version) ?? 'registry',
    displayName,
    description: readString(server.description) ?? 'MCP server hosted through Smithery.',
    category: 'custom',
    kind: 'mcp',
    source: 'registry',
    capabilities: ['tools', 'resources', 'prompts', 'auth.apiKey', 'runtime.mcp.streamableHttp'],
    tags: ['smithery', 'registry', 'mcp'],
    auth: { mode: 'apiKey' },
    setup: apiKey
      ? {}
      : {
          secrets: [
            {
              key: 'SMITHERY_AUTHORIZATION_HEADER',
              label: 'Smithery Authorization header',
              description: 'Full Authorization header used when launching hosted Smithery MCP servers, for example "Bearer ...".',
              required: true,
            },
          ],
        },
    runtime: {
      type: 'mcp',
      serverId,
      serverTemplate: {
        url,
        transport: 'streamable-http',
        headers: {
          Authorization: apiKey ? `Bearer ${apiKey}` : '{{secrets.SMITHERY_AUTHORIZATION_HEADER}}',
        },
      },
    },
  };
}

function extractServers(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)));
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const data = payload as Record<string, unknown>;
  for (const key of ['servers', 'items', 'results', 'data']) {
    const value = data[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)));
    }
  }
  return [];
}

export const smitheryRegistryAdapter: ConnectorRegistryAdapter = {
  source: 'smithery',
  displayName: 'Smithery',
  async search(params: ConnectorRegistrySearchParams): Promise<ConnectorRegistrySearchResult> {
    const apiKey = smitheryApiKey();
    const url = new URL('/servers', smitheryBaseUrl());
    const query = params.query?.trim();
    if (query) url.searchParams.set('q', query);
    url.searchParams.set('pageSize', String(Math.min(Math.max(params.pageSize ?? 24, 1), 100)));
    if (params.page && params.page > 1) url.searchParams.set('page', String(params.page));
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
    });
    if (!response.ok) throw new Error(`Smithery registry returned ${response.status}`);
    const payload = await response.json();
    return {
      source: 'smithery',
      connectors: extractServers(payload).map((server) => connectorFromSmitheryServer(server, apiKey)).filter((item): item is ConnectorDefinition => Boolean(item)),
    };
  },
};
