import type { ConnectorDefinition, ConnectorSecretField } from '../types.js';
import type { ConnectorRegistryAdapter, ConnectorRegistrySearchParams, ConnectorRegistrySearchResult } from './types.js';

const DEFAULT_BASE_URL = 'https://www.modelscope.cn';

function modelscopeBaseUrl(): string {
  return process.env.XOPC_MODELSCOPE_REGISTRY_URL?.trim().replace(/\/+$/, '') || DEFAULT_BASE_URL;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function slugFrom(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'modelscope-mcp';
}

function categoryFromModelScope(categories: unknown): ConnectorDefinition['category'] {
  const text = readArray(categories).map((item) => readString(item)).filter(Boolean).join(' ').toLowerCase();
  if (text.includes('browser')) return 'browser';
  if (text.includes('automation')) return 'automation';
  if (text.includes('database') || text.includes('data')) return 'data';
  if (text.includes('code') || text.includes('developer')) return 'code';
  if (text.includes('docs') || text.includes('knowledge')) return 'docs';
  return 'custom';
}

function secretFieldsFromEnvSchema(schema: unknown): ConnectorSecretField[] {
  const record = readRecord(schema);
  const properties = readRecord(record?.properties);
  if (!properties) return [];
  const required = new Set(readArray(record?.required).map((item) => readString(item)).filter((item): item is string => Boolean(item)));
  return Object.entries(properties).map(([key, value]) => {
    const field = readRecord(value);
    return {
      key,
      label: key,
      description: readString(field?.description),
      required: required.size === 0 ? true : required.has(key),
    } satisfies ConnectorSecretField;
  });
}

function firstMcpServerConfig(server: Record<string, unknown>): Record<string, unknown> | undefined {
  for (const config of readArray(server.ServerConfig ?? server.serverConfig)) {
    const configRecord = readRecord(config);
    const mcpServers = readRecord(configRecord?.mcpServers);
    if (!mcpServers) continue;
    for (const value of Object.values(mcpServers)) {
      const serverConfig = readRecord(value);
      if (serverConfig && readString(serverConfig.command)) return serverConfig;
    }
  }
  return undefined;
}

function secretFieldsFromServerConfig(server: Record<string, unknown>): ConnectorSecretField[] {
  const config = firstMcpServerConfig(server);
  const env = readRecord(config?.env);
  if (!env) return [];
  return Object.keys(env).map((key) => ({
    key,
    label: key,
    description: `Environment variable required by the ModelScope MCP server config.`,
    required: true,
  } satisfies ConnectorSecretField));
}

function mergeSecretFields(...groups: ConnectorSecretField[][]): ConnectorSecretField[] {
  const merged = new Map<string, ConnectorSecretField>();
  for (const group of groups) {
    for (const field of group) {
      const previous = merged.get(field.key);
      merged.set(field.key, {
        ...field,
        description: previous?.description ?? field.description,
        required: previous?.required ?? field.required,
      });
    }
  }
  return [...merged.values()];
}

function normalizeEnv(env: unknown, secrets: ConnectorSecretField[]): Record<string, unknown> | undefined {
  const envRecord = readRecord(env);
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(envRecord ?? {})) {
    output[key] = secrets.some((field) => field.key === key) ? `{{secrets.${key}}}` : value;
  }
  for (const field of secrets) {
    if (output[field.key] === undefined) output[field.key] = `{{secrets.${field.key}}}`;
  }
  return Object.keys(output).length ? output : undefined;
}

function normalizeServerTemplate(server: Record<string, unknown>, secrets: ConnectorSecretField[]): Record<string, unknown> | undefined {
  const deployedUrl = readString(server.DeployedUrl ?? server.deployedUrl);
  if (deployedUrl?.startsWith('http://') || deployedUrl?.startsWith('https://')) {
    const transport = readString(server.DeployedUrlTransportType ?? server.deployedUrlTransportType)?.toLowerCase();
    return { url: deployedUrl, transport: transport === 'sse' ? 'sse' : 'streamable-http' };
  }

  for (const key of ['StreamableHTTPServerConfig', 'streamableHTTPServerConfig', 'SSEServerConfig', 'sseServerConfig']) {
    const config = readRecord(server[key]);
    const url = readString(config?.url ?? config?.endpoint);
    if (url?.startsWith('http://') || url?.startsWith('https://')) {
      return { url, transport: key.toLowerCase().includes('sse') ? 'sse' : 'streamable-http' };
    }
  }

  const config = firstMcpServerConfig(server);
  const command = readString(config?.command);
  if (!command) return undefined;
  const args = readArray(config?.args).map((arg) => String(arg));
  const env = normalizeEnv(config.env, secrets);
  return {
    command,
    ...(args.length ? { args } : {}),
    ...(env ? { env } : {}),
    ...(readString(config.cwd) ? { cwd: readString(config.cwd) } : {}),
  };
}

function connectorFromModelScopeServer(server: Record<string, unknown>): ConnectorDefinition | undefined {
  const name = readString(server.Name ?? server.name);
  const path = readString(server.Path ?? server.path ?? server.FromSitePath ?? server.fromSitePath);
  const displayName = readString(server.ChineseName ?? server.DisplayName ?? server.displayName) || name;
  if (!name || !displayName) return undefined;

  const qualifiedName = path ? `${path}/${name}` : name;
  const serverId = slugFrom(qualifiedName);
  const secrets = mergeSecretFields(
    secretFieldsFromEnvSchema(server.EnvSchema ?? server.envSchema),
    secretFieldsFromServerConfig(server),
  );
  const serverTemplate = normalizeServerTemplate(server, secrets);
  if (!serverTemplate) return undefined;

  const isRemote = typeof serverTemplate.url === 'string';
  const tags = [
    ...readArray(server.Category ?? server.category).map((tag) => readString(tag)).filter((tag): tag is string => Boolean(tag)),
    ...readArray(server.Tags ?? server.tags).map((tag) => readString(tag)).filter((tag): tag is string => Boolean(tag)),
    'modelscope',
    'registry',
    'mcp',
  ];

  return {
    id: `modelscope-${serverId}`,
    version: readString(server.Version ?? server.version) ?? 'registry',
    displayName,
    description: readString(server.Abstract ?? server.AbstractCN ?? server.description) ?? 'MCP server from ModelScope MCP registry.',
    category: categoryFromModelScope(server.Category ?? server.category),
    kind: 'mcp',
    source: 'registry',
    capabilities: isRemote
      ? ['tools', 'resources', 'prompts', 'runtime.mcp.streamableHttp']
      : ['tools', 'resources', 'prompts', 'runtime.mcp.stdio'],
    tags: Array.from(new Set(tags)).slice(0, 8),
    auth: { mode: secrets.length ? 'apiKey' : 'none' },
    setup: { secrets: secrets.length ? secrets : undefined },
    runtime: {
      type: 'mcp',
      serverId,
      serverTemplate,
    },
  };
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function extractMcpServers(payload: unknown): { servers: Record<string, unknown>[]; total?: number } {
  const root = readRecord(payload);
  const data = readRecord(root?.Data);
  const nestedData = readRecord(data?.Data) ?? data;
  const mcp = readRecord(nestedData?.Mcp ?? nestedData?.McpServer ?? nestedData?.mcp);
  const servers = readArray(mcp?.McpServers ?? mcp?.servers ?? mcp?.items)
    .map((item) => readRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
  const total = typeof mcp?.TotalCount === 'number' ? mcp.TotalCount : undefined;
  return { servers, total };
}

async function fetchModelScopeMcp(params: ConnectorRegistrySearchParams): Promise<unknown> {
  const url = new URL('/api/v1/dolphin/agg', modelscopeBaseUrl());
  const body = {
    PageSize: Math.min(Math.max(params.pageSize ?? 24, 1), 100),
    PageNumber: Math.max(params.page ?? 1, 1),
    Query: params.query?.trim() ?? '',
    Criterion: [],
  };
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-modelscope-accept-language': 'zh_CN',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`ModelScope registry returned ${response.status}`);
  return response.json();
}

export const modelscopeRegistryAdapter: ConnectorRegistryAdapter = {
  source: 'modelscope',
  displayName: 'ModelScope',
  async search(params: ConnectorRegistrySearchParams): Promise<ConnectorRegistrySearchResult> {
    const payload = await fetchModelScopeMcp(params);
    const { servers, total } = extractMcpServers(payload);
    const pageSize = Math.min(Math.max(params.pageSize ?? 24, 1), 100);
    return {
      source: 'modelscope',
      connectors: servers
        .toSorted((a, b) => readNumber(b.CallVolume ?? b.callVolume) - readNumber(a.CallVolume ?? a.callVolume))
        .map(connectorFromModelScopeServer)
        .filter((item): item is ConnectorDefinition => Boolean(item)),
      totalPages: total === undefined ? undefined : Math.ceil(total / pageSize),
    };
  },
};
