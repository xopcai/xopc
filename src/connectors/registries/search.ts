import { createLogger } from '../../utils/logger.js';
import { modelscopeRegistryAdapter } from './modelscope.js';
import { officialMcpRegistryAdapter } from './official-mcp.js';
import { smitheryRegistryAdapter } from './smithery.js';
import type { ConnectorRegistryAdapter, ConnectorRegistrySearchParams, ConnectorRegistrySearchResult } from './types.js';

const log = createLogger('Connectors:Registry');

const registryAdapters = new Map<string, ConnectorRegistryAdapter>();
const REGISTRY_CACHE_TTL_MS = 10 * 60 * 1000;
const registrySearchCache = new Map<string, { expiresAt: number; promise: Promise<ConnectorRegistrySearchResult[]> }>();

export type ConnectorRegistryRegistration = {
  adapter: ConnectorRegistryAdapter;
};

export function registerConnectorRegistryAdapter(registration: ConnectorRegistryRegistration): void {
  registryAdapters.set(registration.adapter.source, registration.adapter);
  registrySearchCache.clear();
}

export function unregisterConnectorRegistryAdapter(source: string): boolean {
  const removed = registryAdapters.delete(source);
  if (removed) registrySearchCache.clear();
  return removed;
}

registerConnectorRegistryAdapter({ adapter: officialMcpRegistryAdapter });
registerConnectorRegistryAdapter({ adapter: smitheryRegistryAdapter });
registerConnectorRegistryAdapter({ adapter: modelscopeRegistryAdapter });

function cacheKey(params: ConnectorRegistrySearchParams): string {
  return JSON.stringify({
    source: params.source ?? 'all',
    query: params.query?.trim() ?? '',
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 24,
    browse: params.browse ?? false,
  });
}

export function listConnectorRegistries(): Array<{ id: string; displayName: string }> {
  return [...registryAdapters.values()].map((registry) => ({ id: registry.source, displayName: registry.displayName }));
}

export function isConnectorRegistrySource(source: string): boolean {
  return registryAdapters.has(source);
}

async function runRegistrySearch(params: ConnectorRegistrySearchParams): Promise<ConnectorRegistrySearchResult[]> {
  const source = params.source ?? 'all';
  const registries = source === 'all'
    ? [...registryAdapters.values()]
    : [...registryAdapters.values()].filter((registry) => registry.source === source);
  return Promise.all(registries.map(async (registry) => {
    try {
      return await registry.search(params);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.warn({ source: registry.source, errorMessage }, `Connector registry search failed: ${errorMessage}`);
      return { source: registry.source, connectors: [], error: errorMessage } satisfies ConnectorRegistrySearchResult;
    }
  }));
}

export async function searchConnectorRegistries(params: ConnectorRegistrySearchParams): Promise<ConnectorRegistrySearchResult[]> {
  if (!params.query?.trim() && !params.browse) {
    const source = params.source ?? 'all';
    const registries = source === 'all'
      ? [...registryAdapters.values()]
      : [...registryAdapters.values()].filter((registry) => registry.source === source);
    return registries.map((registry) => ({ source: registry.source, connectors: [] }));
  }
  const key = cacheKey(params);
  const now = Date.now();
  const cached = registrySearchCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }
  const promise = runRegistrySearch(params);
  registrySearchCache.set(key, { expiresAt: now + REGISTRY_CACHE_TTL_MS, promise });
  try {
    return await promise;
  } catch (error) {
    registrySearchCache.delete(key);
    throw error;
  }
}
