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
  branding?: {
    logoUrl?: string;
    source?: 'builtin' | 'composio-catalog' | 'registry' | 'extension' | 'custom';
    backgroundColor?: string;
    fetchedAt?: string;
  };
  verificationLevel?: 'verified' | 'beta' | 'experimental';
  auth:
    | { mode: 'none' }
    | { mode: 'apiKey' }
    | { mode: 'oauth'; provider: string; installPhase: 'before_install' | 'after_install' };
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
        type: 'composio';
        id?: string;
        toolkit: string;
        role: 'credential' | 'toolkit';
      }
    | {
        type: 'channel' | 'nativeTool' | 'memorySource';
        id?: string;
        channelId?: string;
        pluginId?: string;
        toolsetId?: string;
        sourceKind?: string;
      };
};

export type StoreConnectorCatalogItem = {
  id: string;
  name: string;
  type: 'connector';
  category: string | null;
  description: string;
  downloads: number;
  author: { username: string; avatarUrl: string | null };
  latestVersion?: string;
  updatedAt: number;
};

export type StoreConnectorPermissions = {
  data?: string[];
  networkDomains?: string[];
  localExec?: boolean;
  filesystem?: string[];
};

export type StoreConnectorInstallPlan = {
  packageName: string;
  version: string;
  definition: ConnectorDefinition;
  permissions: StoreConnectorPermissions;
  requiresRestart: false;
  requiresOAuth: boolean;
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
  config?: Record<string, unknown>;
  materialized:
    | {
        type: 'mcp';
        serverId: string;
      }
    | {
        type: 'composio';
        id: string;
        toolkit: string;
        role: 'credential' | 'toolkit';
      }
    | {
        type: 'channel' | 'nativeTool' | 'memorySource';
        id: string;
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

export type ConnectorAuthorizationStartResult = {
  connectorId: string;
  provider: string;
  flowId?: string;
  userCode?: string;
  verificationUri?: string;
  authorizationUrl?: string;
  expiresInSeconds?: number;
  intervalSeconds?: number;
  status: string;
  installUrl?: string;
  connectionId?: string;
};

export type ConnectorAuthorizationStatusResult = {
  connectorId: string;
  provider: string;
  flowId: string;
  status: 'pending' | 'installation_required' | 'connected' | 'expired' | 'error';
  installUrl?: string;
  error?: string;
};

export type ComposioConnection = {
  id: string;
  providerConnectionId: string;
  toolkit: string;
  status: string;
  alias?: string;
  isDefault: boolean;
  accountEmail?: string;
  workspace?: string;
  username?: string;
  connectedAt?: string;
  lastError?: string;
};

export type ComposioScope = 'read' | 'write' | 'admin';

export type ComposioInstallationPolicy = {
  id: string;
  connectorId: string;
  principalId: string;
  enabled: boolean;
  allowedAgentIds: string[];
  maxScope: ComposioScope;
  confirmationPolicy: 'never' | 'writes' | 'always';
  selectedConnectionIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ConnectorAgentOption = { id: string; name: string };

export type ComposioConnectorHealth = {
  toolkit: string;
  status: 'connected' | 'disconnected' | 'reauthorization_required' | 'degraded';
  activeConnections: number;
  affectedConnections: number;
  checkedAt: string;
  message: string;
  recovery: 'none' | 'connect' | 'reconnect' | 'retry';
};

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

export type ConnectorApproval = {
  id: string;
  principalId: string;
  connectorId: string;
  connectionId?: string;
  agentId?: string;
  sessionKey?: string;
  actionId: string;
  scope: ComposioScope;
  argumentsPreview: Record<string, unknown>;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'consumed';
  expiresAt: string;
  createdAt: string;
  decidedAt?: string;
  consumedAt?: string;
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
  const [response, composio] = await Promise.all([
    fetchJson<ApiEnvelope<{ connectors: ConnectorDefinition[] }>>(apiUrl('/api/connectors/catalog')),
    fetchComposioConnectorCatalog().catch(() => []),
  ]);
  const connectors = requirePayload(response, 'Could not load connector catalog.').connectors;
  return [...new Map([...composio, ...connectors].map((connector) => [connector.id, connector])).values()];
}

export async function fetchComposioConnectorCatalog(refresh = false): Promise<ConnectorDefinition[]> {
  const response = await fetchJson<ApiEnvelope<{ connectors: ConnectorDefinition[] }>>(
    apiUrl(`/api/connectors/composio/catalog${refresh ? '?refresh=1' : ''}`),
  );
  return requirePayload(response, 'Could not load Composio catalog.').connectors;
}

export async function fetchStoreConnectorCatalog(params?: {
  q?: string;
  page?: number;
  pageSize?: number;
  category?: string;
  sort?: 'downloads' | 'newest';
}): Promise<{ items: StoreConnectorCatalogItem[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }> {
  const search = new URLSearchParams();
  if (params?.q?.trim()) search.set('q', params.q.trim());
  if (params?.page) search.set('page', String(params.page));
  if (params?.pageSize) search.set('pageSize', String(params.pageSize));
  if (params?.category?.trim()) search.set('category', params.category.trim());
  if (params?.sort) search.set('sort', params.sort);
  const suffix = search.size ? `?${search.toString()}` : '';
  const response = await fetchJson<ApiEnvelope<{ items: StoreConnectorCatalogItem[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }>>(
    apiUrl(`/api/capabilities/connectors${suffix}`),
  );
  return requirePayload(response, 'Could not load Store connector capabilities.');
}

export async function fetchStoreConnectorInstallPlan(
  packageName: string,
  version?: string,
): Promise<StoreConnectorInstallPlan> {
  const response = await fetchJson<ApiEnvelope<{ plan: StoreConnectorInstallPlan }>>(
    apiUrl(`/api/capabilities/connectors/${encodeURIComponent(packageName)}/install-plan`),
    { method: 'POST', body: JSON.stringify({ version }) },
  );
  return requirePayload(response, 'Could not prepare connector installation.').plan;
}

export async function installStoreConnector(
  packageName: string,
  input: Omit<ConnectorInstallInput, 'definition'>,
  version?: string,
): Promise<ConnectorInstance> {
  const response = await fetchJson<ApiEnvelope<{ instance: ConnectorInstance }>>(
    apiUrl(`/api/capabilities/connectors/${encodeURIComponent(packageName)}/install`),
    { method: 'POST', body: JSON.stringify({ ...input, version }) },
  );
  void revalidateGatewayConfig();
  return requirePayload(response, 'Could not install Store connector.').instance;
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

export async function startConnectorAuthorization(connectorId: string): Promise<ConnectorAuthorizationStartResult> {
  const response = await fetchJson<ApiEnvelope<{ authorization: ConnectorAuthorizationStartResult }>>(
    apiUrl(`/api/connectors/${encodeURIComponent(connectorId)}/auth/start`),
    { method: 'POST' },
  );
  return requirePayload(response, 'Could not start connector authorization.').authorization;
}

export async function getConnectorAuthorizationStatus(
  connectorId: string,
  flowId: string,
): Promise<ConnectorAuthorizationStatusResult> {
  const response = await fetchJson<ApiEnvelope<{ authorization: ConnectorAuthorizationStatusResult }>>(
    apiUrl(`/api/connectors/${encodeURIComponent(connectorId)}/auth/status/${encodeURIComponent(flowId)}`),
  );
  return requirePayload(response, 'Could not read connector authorization status.').authorization;
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

export async function previewConnector(
  connector: ConnectorDefinition,
  input: Omit<ConnectorInstallInput, 'definition'> = {},
): Promise<ConnectorHealthResult> {
  const response = await fetchJson<ApiEnvelope<{ preview: ConnectorHealthResult }>>(
    apiUrl('/api/connectors/preview'),
    {
      method: 'POST',
      body: JSON.stringify({ ...input, definition: connector }),
    },
  );
  return requirePayload(response, 'Could not preview connector capabilities.').preview;
}

export async function updateConnectorConfig(
  instanceId: string,
  input: Omit<ConnectorInstallInput, 'definition'>,
): Promise<ConnectorInstance> {
  const response = await fetchJson<ApiEnvelope<{ instance: ConnectorInstance }>>(
    apiUrl(`/api/connectors/${encodeURIComponent(instanceId)}/config`),
    { method: 'POST', body: JSON.stringify(input) },
  );
  return requirePayload(response, 'Could not update connector config.').instance;
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

export async function updateComposioConnection(
  id: string,
  patch: { alias?: string; isDefault?: boolean },
): Promise<ComposioConnection> {
  const response = await fetchJson<ApiEnvelope<{ connection: ComposioConnection }>>(
    apiUrl(`/api/connectors/composio/connections/${encodeURIComponent(id)}`),
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
  return requirePayload(response, 'Could not update Composio connection.').connection;
}

export async function getComposioHealth(toolkit: string): Promise<ComposioConnectorHealth> {
  const response = await fetchJson<ApiEnvelope<{ health: ComposioConnectorHealth }>>(
    apiUrl(`/api/connectors/composio/${encodeURIComponent(toolkit)}/health`),
  );
  return requirePayload(response, 'Could not check Composio connector health.').health;
}

export async function refreshComposioConnection(id: string): Promise<void> {
  await fetchJson(apiUrl(`/api/connectors/composio/connections/${encodeURIComponent(id)}/refresh`), { method: 'POST' });
}

export async function revokeComposioConnection(id: string): Promise<void> {
  await fetchJson(apiUrl(`/api/connectors/composio/connections/${encodeURIComponent(id)}`), { method: 'DELETE' });
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

export async function getComposioPolicy(toolkit: string): Promise<{ policy: ComposioInstallationPolicy; agents: ConnectorAgentOption[] }> {
  const response = await fetchJson<ApiEnvelope<{ policy: ComposioInstallationPolicy; agents: ConnectorAgentOption[] }>>(
    apiUrl(`/api/connectors/composio/${encodeURIComponent(toolkit)}/policy`),
  );
  return requirePayload(response, 'Could not load Composio policy.');
}

export async function updateComposioPolicy(
  toolkit: string,
  patch: Partial<Pick<ComposioInstallationPolicy, 'allowedAgentIds' | 'confirmationPolicy' | 'selectedConnectionIds'>>,
): Promise<ComposioInstallationPolicy> {
  const response = await fetchJson<ApiEnvelope<{ policy: ComposioInstallationPolicy }>>(
    apiUrl(`/api/connectors/composio/${encodeURIComponent(toolkit)}/policy`),
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
  return requirePayload(response, 'Could not update Composio policy.').policy;
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

export async function syncComposioMemory(input: {
  connectorId: string;
  actionId: string;
  agentId: string;
  connectionId?: string;
  arguments?: Record<string, unknown>;
}): Promise<{ recordId: string }> {
  const response = await fetchJson<ApiEnvelope<{ recordId: string }>>(
    apiUrl(`/api/connectors/${encodeURIComponent(input.connectorId)}/memory-sync`),
    { method: 'POST', body: JSON.stringify(input) },
  );
  return requirePayload(response, 'Could not sync connector data to memory.');
}

export async function listConnectorApprovals(status: ConnectorApproval['status'] = 'pending'): Promise<ConnectorApproval[]> {
  const response = await fetchJson<ApiEnvelope<{ approvals: ConnectorApproval[] }>>(
    apiUrl(`/api/connectors/approvals?status=${encodeURIComponent(status)}`),
  );
  return requirePayload(response, 'Could not load connector approvals.').approvals;
}

export async function respondConnectorApproval(
  id: string,
  decision: 'approved' | 'denied',
): Promise<ConnectorApproval> {
  const response = await fetchJson<ApiEnvelope<{ approval: ConnectorApproval }>>(
    apiUrl('/api/connectors/approvals/respond'),
    { method: 'POST', body: JSON.stringify({ id, decision }) },
  );
  return requirePayload(response, 'Could not update connector approval.').approval;
}

export async function setConnectorEnabled(instanceId: string, enabled: boolean): Promise<ConnectorInstance> {
  const response = await fetchJson<ApiEnvelope<{ instance: ConnectorInstance }>>(
    apiUrl(`/api/connectors/${encodeURIComponent(instanceId)}/${enabled ? 'enable' : 'disable'}`),
    { method: 'POST' },
  );
  void revalidateGatewayConfig();
  return requirePayload(response, 'Could not update connector state.').instance;
}
