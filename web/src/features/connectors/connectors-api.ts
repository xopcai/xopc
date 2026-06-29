import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type ConnectorCategory = 'code' | 'docs' | 'browser' | 'data' | 'automation' | 'custom';
export type ConnectorCapability =
  | 'tools'
  | 'resources'
  | 'prompts'
  | 'context'
  | 'channel'
  | 'events'
  | 'ui'
  | 'memory_source'
  | 'workflows'
  | 'auth.apiKey'
  | 'auth.oauth'
  | 'runtime.mcp.stdio'
  | 'runtime.mcp.sse'
  | 'runtime.mcp.streamableHttp';

export type ConnectorSecretField = {
  key: string;
  label: string;
  description?: string;
  required: boolean;
};

export type ConnectorConfigField = {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'json' | 'path';
  required?: boolean;
  placeholder?: string;
  description?: string;
  defaultValue?: unknown;
};

export type ConnectorRegistryProvider = {
  id: string;
  displayName: string;
};

export type ConnectorDefinition = {
  id: string;
  version: string;
  displayName: string;
  description: string;
  category: ConnectorCategory;
  kind: string;
  source: string;
  capabilities: ConnectorCapability[];
  tags?: string[];
  auth: {
    mode: 'none' | 'apiKey' | 'oauth';
  };
  setup: {
    secrets?: ConnectorSecretField[];
    config?: ConnectorConfigField[];
  };
  runtime:
    | {
        type: 'mcp';
        serverId: string;
      }
    | {
        type: 'channel' | 'composio' | 'nativeTool' | 'memorySource';
        id?: string;
        channelId?: string;
        pluginId?: string;
        toolkit?: string;
        toolsetId?: string;
        sourceKind?: string;
      };
};

export type ConnectorHealthStatus =
  | 'ok'
  | 'server_not_found'
  | 'missing_secret'
  | 'startup_failed'
  | 'tools_list_failed'
  | 'timeout'
  | 'network_failed'
  | 'unauthorized'
  | 'disabled'
  | 'unknown_error';

export type ConnectorAuditRecord = {
  at: string;
  action: 'installed' | 'removed' | 'health_check';
  status?: ConnectorHealthStatus;
  ok?: boolean;
  toolCount?: number;
  resourceCount?: number;
  promptCount?: number;
};

export type ConnectorInstance = {
  instanceId: string;
  connectorId: string;
  displayName: string;
  enabled: boolean;
  status: 'installed' | 'not_configured' | 'failed' | 'disabled' | 'connecting' | 'connected' | 'unauthorized' | 'degraded';
  connectionStatus?: 'unknown' | 'disconnected' | 'connecting' | 'connected' | 'unauthorized' | 'error' | 'disabled';
  authStatus?: 'unknown' | 'none' | 'connected' | 'missing' | 'expired' | 'unauthorized';
  lastConnectedAt?: string;
  lastError?: string;
  secretStatus: Record<string, boolean>;
  materialized:
    | {
        type: 'mcp';
        serverId: string;
      }
    | {
        type: 'channel' | 'composio' | 'nativeTool' | 'memorySource';
        id: string;
        serverId?: string;
      };
  usage: {
    lastHealthCheckAt?: string;
    lastHealthStatus?: ConnectorHealthStatus;
    lastToolCount?: number;
    lastResourceCount?: number;
    lastPromptCount?: number;
  };
  audit: ConnectorAuditRecord[];
};

export type ConnectorToolInfo = {
  name: string;
  shortName?: string;
  description?: string;
};

export type ConnectorResourceInfo = {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
};

export type ConnectorPromptInfo = {
  name: string;
  title?: string;
  description?: string;
  argumentCount: number;
};

export type ConnectorHealthResult = {
  serverId: string;
  ok: boolean;
  status: ConnectorHealthStatus;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  tools: ConnectorToolInfo[];
  resources: ConnectorResourceInfo[];
  prompts: ConnectorPromptInfo[];
  error?: string;
  action?: string;
};

export type ConnectorInstallInput = {
  secrets?: Record<string, string>;
  config?: Record<string, unknown>;
  definition?: ConnectorDefinition;
};

export type ConnectorOAuthStartResult = {
  connectorId: string;
  provider: 'github';
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresInSeconds: number;
  intervalSeconds: number;
};

export type ConnectorOAuthCompleteResult = {
  connectorId: string;
  provider: 'github';
  connected: true;
};

export type ComposioConnection = {
  id: string;
  toolkit: string;
  status: string;
  accountEmail?: string;
  workspace?: string;
  username?: string;
};

export type ComposioAuthorizeResult = {
  toolkit: string;
  connectUrl: string;
  connectionId?: string;
};

export type ComposioScope = 'read' | 'write' | 'admin';

export type ComposioTool = {
  slug: string;
  name?: string;
  description?: string;
  inputSchema?: unknown;
  scope: ComposioScope;
  curated: boolean;
};

export type ComposioTriggerEvent = {
  at: string;
  id: string;
  toolkit?: string;
  trigger?: string;
  payload: unknown;
};

type ApiEnvelope<T> = {
  ok?: boolean;
  payload?: T;
  error?: string;
};

function requirePayload<T>(response: ApiEnvelope<T>, fallbackMessage: string): T {
  if (!response.payload) {
    throw new Error(response.error ?? fallbackMessage);
  }
  return response.payload;
}

export async function fetchConnectorCatalog(): Promise<ConnectorDefinition[]> {
  const response = await fetchJson<ApiEnvelope<{ connectors: ConnectorDefinition[] }>>(
    apiUrl('/api/connectors/catalog'),
  );
  return requirePayload(response, 'Could not load connector catalog.').connectors;
}

export async function fetchConnectorRegistries(): Promise<ConnectorRegistryProvider[]> {
  const response = await fetchJson<ApiEnvelope<{ registries?: ConnectorRegistryProvider[] }>>(
    apiUrl('/api/connectors/catalog'),
  );
  return requirePayload(response, 'Could not load connector registries.').registries ?? [];
}

export async function fetchConnectorInstances(): Promise<ConnectorInstance[]> {
  const response = await fetchJson<ApiEnvelope<{ instances: ConnectorInstance[] }>>(
    apiUrl('/api/connectors/installed'),
  );
  return requirePayload(response, 'Could not load installed connectors.').instances;
}

export type ConnectorRegistrySearchPage = {
  connectors: ConnectorDefinition[];
  totalPages?: number;
};

const registrySearchCache = new Map<string, { expiresAt: number; promise: Promise<ConnectorRegistrySearchPage> }>();
const REGISTRY_SEARCH_CACHE_MS = 5 * 60 * 1000;

export async function searchConnectorRegistryPage(
  query: string,
  source = 'all',
  options?: { browse?: boolean; page?: number; pageSize?: number },
): Promise<ConnectorRegistrySearchPage> {
  const normalizedQuery = query.trim();
  const normalizedSource = source.trim() || 'all';
  const browse = options?.browse ?? false;
  const page = Math.max(options?.page ?? 1, 1);
  const pageSize = Math.max(options?.pageSize ?? 24, 1);
  const cacheKey = `${normalizedSource}:${normalizedQuery}:${browse ? 'browse' : 'search'}:${page}:${pageSize}`;
  const now = Date.now();
  const cached = registrySearchCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }
  const params = new URLSearchParams();
  if (normalizedQuery) params.set('q', normalizedQuery);
  if (normalizedSource !== 'all') params.set('source', normalizedSource);
  if (browse) params.set('browse', '1');
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  const promise = fetchJson<ApiEnvelope<{ connectors: ConnectorDefinition[]; results?: Array<{ totalPages?: number }> }>>(
    apiUrl(`/api/connectors/registry/search?${params.toString()}`),
  ).then((response) => {
    const payload = requirePayload(response, 'Could not search connector registries.');
    const totalPages = Math.max(0, ...(payload.results ?? []).map((result) => result.totalPages ?? 0)) || undefined;
    return { connectors: payload.connectors, totalPages };
  });
  registrySearchCache.set(cacheKey, { expiresAt: now + REGISTRY_SEARCH_CACHE_MS, promise });
  try {
    return await promise;
  } catch (error) {
    registrySearchCache.delete(cacheKey);
    throw error;
  }
}

export async function searchConnectorRegistry(query: string, source = 'all', options?: { browse?: boolean }): Promise<ConnectorDefinition[]> {
  return (await searchConnectorRegistryPage(query, source, options)).connectors;
}

export async function startConnectorOAuth(connectorId: string): Promise<ConnectorOAuthStartResult> {
  const response = await fetchJson<ApiEnvelope<{ oauth: ConnectorOAuthStartResult }>>(
    apiUrl(`/api/connectors/${encodeURIComponent(connectorId)}/oauth/start`),
    { method: 'POST' },
  );
  return requirePayload(response, 'Could not start connector OAuth.').oauth;
}

export async function completeConnectorOAuth(
  connectorId: string,
  deviceCode: string,
): Promise<ConnectorOAuthCompleteResult> {
  const response = await fetchJson<ApiEnvelope<{ oauth: ConnectorOAuthCompleteResult }>>(
    apiUrl(`/api/connectors/${encodeURIComponent(connectorId)}/oauth/complete`),
    {
      method: 'POST',
      body: JSON.stringify({ deviceCode }),
    },
  );
  return requirePayload(response, 'Could not complete connector OAuth.').oauth;
}

export async function installConnector(
  connectorId: string,
  input: ConnectorInstallInput,
): Promise<ConnectorInstance> {
  const response = await fetchJson<ApiEnvelope<{ instance: ConnectorInstance }>>(
    apiUrl(`/api/connectors/${encodeURIComponent(connectorId)}/install`),
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
  void revalidateGatewayConfig();
  return requirePayload(response, 'Could not install connector.').instance;
}

export async function removeConnector(instanceId: string): Promise<void> {
  await fetchJson(apiUrl(`/api/connectors/${encodeURIComponent(instanceId)}`), {
    method: 'DELETE',
  });
  void revalidateGatewayConfig();
}

export async function testConnector(instanceId: string): Promise<ConnectorHealthResult> {
  const response = await fetchJson<ApiEnvelope<ConnectorHealthResult>>(
    apiUrl(`/api/connectors/${encodeURIComponent(instanceId)}/test`),
    { method: 'POST' },
  );
  return requirePayload(response, 'Connector test failed.');
}

export async function listComposioConnections(): Promise<ComposioConnection[]> {
  const response = await fetchJson<ApiEnvelope<{ connections: ComposioConnection[] }>>(
    apiUrl('/api/connectors/composio/connections'),
  );
  return requirePayload(response, 'Could not load Composio connections.').connections;
}

export async function startComposioAuthorize(toolkit: string): Promise<ComposioAuthorizeResult> {
  const response = await fetchJson<ApiEnvelope<{ oauth: ComposioAuthorizeResult }>>(
    apiUrl(`/api/connectors/composio/${encodeURIComponent(toolkit)}/authorize`),
    { method: 'POST' },
  );
  return requirePayload(response, 'Could not start Composio authorization.').oauth;
}

export async function getComposioScope(toolkit: string): Promise<ComposioScope> {
  const response = await fetchJson<ApiEnvelope<{ scope: ComposioScope }>>(
    apiUrl(`/api/connectors/composio/${encodeURIComponent(toolkit)}/scope`),
  );
  return requirePayload(response, 'Could not load Composio scope.').scope;
}

export async function setComposioScope(toolkit: string, scope: ComposioScope): Promise<ComposioScope> {
  const response = await fetchJson<ApiEnvelope<{ scope: ComposioScope }>>(
    apiUrl(`/api/connectors/composio/${encodeURIComponent(toolkit)}/scope`),
    { method: 'POST', body: JSON.stringify({ scope }) },
  );
  void revalidateGatewayConfig();
  return requirePayload(response, 'Could not update Composio scope.').scope;
}

export async function listComposioTools(toolkit: string): Promise<ComposioTool[]> {
  const response = await fetchJson<ApiEnvelope<{ tools: ComposioTool[] }>>(
    apiUrl(`/api/connectors/composio/${encodeURIComponent(toolkit)}/tools`),
  );
  return requirePayload(response, 'Could not load Composio tools.').tools;
}

export async function listComposioTriggerEvents(limit = 50): Promise<ComposioTriggerEvent[]> {
  const response = await fetchJson<ApiEnvelope<{ events: ComposioTriggerEvent[] }>>(
    apiUrl(`/api/connectors/composio/triggers?limit=${encodeURIComponent(String(limit))}`),
  );
  return requirePayload(response, 'Could not load Composio trigger events.').events;
}

export async function executeComposioTool(slug: string, args: unknown): Promise<unknown> {
  const response = await fetchJson<ApiEnvelope<{ result: unknown }>>(
    apiUrl(`/api/connectors/composio/tools/${encodeURIComponent(slug)}/execute`),
    { method: 'POST', body: JSON.stringify({ arguments: args }) },
  );
  return requirePayload(response, 'Could not execute Composio tool.').result;
}

export async function setConnectorEnabled(instanceId: string, enabled: boolean): Promise<ConnectorInstance> {
  const response = await fetchJson<ApiEnvelope<{ instance: ConnectorInstance }>>(
    apiUrl(`/api/connectors/${encodeURIComponent(instanceId)}/${enabled ? 'enable' : 'disable'}`),
    { method: 'POST' },
  );
  void revalidateGatewayConfig();
  return requirePayload(response, 'Could not update connector state.').instance;
}
