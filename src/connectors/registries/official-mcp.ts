import type { ConnectorDefinition } from '../types.js';
import type { ConnectorRegistryAdapter, ConnectorRegistrySearchParams, ConnectorRegistrySearchResult } from './types.js';

const DEFAULT_BASE_URL = 'https://registry.modelcontextprotocol.io';

function officialRegistryBaseUrl(): string {
  return process.env.XOPC_MCP_OFFICIAL_REGISTRY_URL?.trim().replace(/\/+$/, '') || DEFAULT_BASE_URL;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function slugFrom(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'registry-mcp';
}

function normalizePackageCommand(pkg: Record<string, unknown>): { command: string; args: string[] } | undefined {
  const registryType = readString(pkg.registryType ?? pkg.registry_type ?? pkg.type)?.toLowerCase();
  const name = readString(pkg.name ?? pkg.packageName ?? pkg.package_name);
  if (!name) return undefined;
  if (registryType === 'pypi' || registryType === 'python') {
    return { command: 'uvx', args: [name] };
  }
  if (registryType === 'npm' || registryType === 'node' || !registryType) {
    return { command: 'npx', args: ['-y', name] };
  }
  return undefined;
}

function normalizeRemote(server: Record<string, unknown>): { url: string; transport: 'streamable-http' } | undefined {
  const remotes = readArray(server.remotes ?? server.remote ?? server.deployments);
  for (const raw of remotes) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    const url = readString(row.url ?? row.endpoint ?? row.deploymentUrl ?? row.deployment_url);
    if (url?.startsWith('http://') || url?.startsWith('https://')) {
      return { url, transport: 'streamable-http' };
    }
  }
  const url = readString(server.url ?? server.endpoint);
  if (url?.startsWith('http://') || url?.startsWith('https://')) {
    return { url, transport: 'streamable-http' };
  }
  return undefined;
}

function connectorFromOfficialServer(server: Record<string, unknown>): ConnectorDefinition | undefined {
  const qualifiedName = readString(server.name ?? server.id ?? server.qualifiedName ?? server.qualified_name);
  const displayName = readString(server.displayName ?? server.display_name ?? server.title ?? server.name) ?? qualifiedName;
  if (!qualifiedName || !displayName) return undefined;

  const packages = readArray(server.packages);
  const packageRuntime = packages
    .map((item) => (item && typeof item === 'object' && !Array.isArray(item) ? normalizePackageCommand(item as Record<string, unknown>) : undefined))
    .find(Boolean);
  const remoteRuntime = normalizeRemote(server);
  const serverId = slugFrom(qualifiedName);
  const serverTemplate = packageRuntime
    ? { command: packageRuntime.command, args: packageRuntime.args }
    : remoteRuntime
      ? { url: remoteRuntime.url, transport: remoteRuntime.transport }
      : undefined;
  if (!serverTemplate) return undefined;

  const tags = [
    ...readArray(server.tags).map((tag) => readString(tag)).filter((tag): tag is string => Boolean(tag)),
    'registry',
    'mcp',
  ];
  const description = readString(server.description) ?? 'MCP server from the official Model Context Protocol registry.';
  const capabilities: ConnectorDefinition['capabilities'] = packageRuntime
    ? ['tools', 'resources', 'prompts', 'runtime.mcp.stdio']
    : ['tools', 'resources', 'prompts', 'runtime.mcp.streamableHttp'];

  return {
    id: `mcp-official-${serverId}`,
    version: readString(server.version) ?? 'registry',
    displayName,
    description,
    category: 'custom',
    kind: 'mcp',
    source: 'registry',
    capabilities,
    tags: Array.from(new Set(tags)).slice(0, 8),
    auth: { mode: 'none' },
    setup: {},
    runtime: {
      type: 'mcp',
      serverId,
      serverTemplate,
    },
  };
}

async function fetchJson(url: URL): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Official MCP registry returned ${response.status}`);
  }
  return response.json();
}

function normalizeServerRecord(item: unknown): Record<string, unknown> | undefined {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
  const record = item as Record<string, unknown>;
  const nested = record.server;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return record;
}

function extractServers(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.map(normalizeServerRecord).filter((item): item is Record<string, unknown> => Boolean(item));
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const data = payload as Record<string, unknown>;
  for (const key of ['servers', 'items', 'results', 'data']) {
    const value = data[key];
    if (Array.isArray(value)) {
      return value.map(normalizeServerRecord).filter((item): item is Record<string, unknown> => Boolean(item));
    }
  }
  return [];
}

export const officialMcpRegistryAdapter: ConnectorRegistryAdapter = {
  source: 'mcp_official',
  displayName: 'Official MCP registry',
  async search(params: ConnectorRegistrySearchParams): Promise<ConnectorRegistrySearchResult> {
    const base = officialRegistryBaseUrl();
    const url = new URL('/v0/servers', base);
    const query = params.query?.trim();
    if (query) url.searchParams.set('q', query);
    url.searchParams.set('limit', String(Math.min(Math.max(params.pageSize ?? 24, 1), 100)));
    if (params.page && params.page > 1) url.searchParams.set('page', String(params.page));
    const payload = await fetchJson(url);
    return {
      source: 'mcp_official',
      connectors: extractServers(payload).map(connectorFromOfficialServer).filter((item): item is ConnectorDefinition => Boolean(item)),
    };
  },
};
