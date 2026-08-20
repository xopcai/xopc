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

export type ConnectorDefinition = {
  id: string;
  version: string;
  displayName: string;
  description: string;
  category: ConnectorCategory;
  kind: string;
  source: string;
  capabilities: ConnectorCapability[];
  benefits?: Array<'understand' | 'act' | 'reach'>;
  understanding?: {
    mode: 'activity' | 'inventory';
    bootstrapWindowDays: number;
    readOnly: true;
  };
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
    | { mode: 'oauth'; provider: string };
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
  integrationStrategy?: {
    lane: 'native' | 'mcp' | 'composio';
    workload: 'core' | 'high_frequency' | 'long_tail';
    preferred: boolean;
    alternative?: { kind: 'channel' | 'connector'; id: string };
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

export type ConnectedPersonNode = {
  id: string;
  label: string;
  names: string[];
  emails: string[];
  usernames: string[];
  roles: string[];
  mentionCount: number;
  lastObservedAt: string;
};

export type ConnectedPeopleGraph = {
  people: ConnectedPersonNode[];
  sourceEdges: Array<{
    personId: string;
    sourceInstanceId: string;
    connectorId?: string;
    toolkit?: string;
    mentionCount: number;
    lastObservedAt: string;
  }>;
  scannedItems: number;
  truncated: boolean;
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
  authorizationUrl?: string;
  status: string;
  connectionId?: string;
};

export type ComposioConnection = {
  id: string;
  accountId?: string;
  providerConnectionId: string;
  toolkit: string;
  status: string;
  alias?: string;
  isDefault: boolean;
  isCurrentAuthorization: boolean;
  accountEmail?: string;
  workspace?: string;
  username?: string;
  identityKey?: string;
  workspaceId?: string;
  userId?: string;
  connectedAt?: string;
  lastError?: string;
};

export type ConnectorLearningJob = {
  id: string;
  accountId: string;
  connectionId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'paused';
  phase: 'queued' | 'fetching' | 'indexing' | 'deriving' | 'completed';
  itemsDiscovered: number;
  itemsIndexed: number;
  candidatesCreated: number;
  error?: string;
  updatedAt: string;
};

export type ConnectorSyncPolicy = {
  accountId: string;
  scanEnabled: boolean;
  proactiveEnabled: boolean;
  intervalMinutes?: number;
  allowedScenarioKeys: string[];
  revision: number;
  updatedAt: string;
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
  activeAccounts: number;
  affectedAccounts: number;
  checkedAt: string;
  message: string;
  recovery: 'none' | 'connect' | 'reconnect' | 'retry';
  errorCode?: 'missing_credential' | 'unauthorized' | 'forbidden' | 'network' | 'timeout' | 'provider_error';
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
  const response = await fetchJson<ApiEnvelope<{ connectors: ConnectorDefinition[] }>>(apiUrl('/api/connectors/catalog'));
  return requirePayload(response, 'Could not load connector catalog.').connectors;
}

export async function fetchComposioConnectorCatalog(params?: {
  q?: string;
  page?: number;
  pageSize?: number;
  refresh?: boolean;
  verification?: 'verified' | 'experimental' | 'all';
}): Promise<{ connectors: ConnectorDefinition[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }> {
  const search = new URLSearchParams();
  if (params?.q?.trim()) search.set('q', params.q.trim());
  if (params?.page) search.set('page', String(params.page));
  if (params?.pageSize) search.set('pageSize', String(params.pageSize));
  if (params?.refresh) search.set('refresh', '1');
  if (params?.verification) search.set('verification', params.verification);
  const suffix = search.size ? `?${search.toString()}` : '';
  const response = await fetchJson<ApiEnvelope<{
    connectors: ConnectorDefinition[];
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  }>>(
    apiUrl(`/api/connectors/composio/catalog${suffix}`),
  );
  return requirePayload(response, 'Could not load Composio catalog.');
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

export async function fetchConnectorInstances(): Promise<ConnectorInstance[]> {
  const response = await fetchJson<ApiEnvelope<{ instances: ConnectorInstance[] }>>(
    apiUrl('/api/connectors/installed'),
  );
  return requirePayload(response, 'Could not load installed connectors.').instances;
}

export async function startConnectorAuthorization(connectorId: string): Promise<ConnectorAuthorizationStartResult> {
  const response = await fetchJson<ApiEnvelope<{ authorization: ConnectorAuthorizationStartResult }>>(
    apiUrl(`/api/connectors/${encodeURIComponent(connectorId)}/auth/start`),
    { method: 'POST' },
  );
  return requirePayload(response, 'Could not start connector authorization.').authorization;
}

export async function getComposioSetupStatus(): Promise<{ configured: boolean }> {
  const response = await fetchJson<ApiEnvelope<{ configured: boolean }>>(
    apiUrl('/api/connectors/composio/setup-status'),
  );
  return requirePayload(response, 'Could not check the connection service.');
}

export async function configureComposio(apiKey: string): Promise<void> {
  const response = await fetchJson<ApiEnvelope<{ configured: boolean }>>(
    apiUrl('/api/connectors/composio/setup'),
    { method: 'POST', body: JSON.stringify({ apiKey }) },
  );
  requirePayload(response, 'Could not enable the connection service.');
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

export async function waitForActiveComposioConnection(
  toolkit: string,
  providerConnectionId?: string,
  timeoutMs = 120_000,
): Promise<ComposioConnection> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const connection = (await listComposioConnections().catch(() => []))
      .find((item) => (
        item.toolkit.toLowerCase() === toolkit.toLowerCase()
        && item.status === 'active'
        && (!providerConnectionId || item.providerConnectionId === providerConnectionId)
      ));
    if (connection) return connection;
    await new Promise((resolve) => window.setTimeout(resolve, 2_000));
  }
  throw new Error('Connection authorization timed out.');
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

export async function startAccountLearning(accountId: string): Promise<ConnectorLearningJob> {
  const response = await fetchJson<ApiEnvelope<{ job: ConnectorLearningJob }>>(
    apiUrl(`/api/connectors/composio/accounts/${encodeURIComponent(accountId)}/learning`),
    { method: 'POST' },
  );
  return requirePayload(response, 'Could not start learning from this connection.').job;
}

export async function listConnectorLearningJobs(): Promise<ConnectorLearningJob[]> {
  const response = await fetchJson<ApiEnvelope<{ jobs: ConnectorLearningJob[] }>>(
    apiUrl('/api/connectors/learning'),
  );
  return requirePayload(response, 'Could not load connector learning jobs.').jobs;
}

export async function getConnectorSyncPolicy(accountId: string): Promise<ConnectorSyncPolicy> {
  const response = await fetchJson<ApiEnvelope<{ policy: ConnectorSyncPolicy }>>(
    apiUrl(`/api/connectors/composio/accounts/${encodeURIComponent(accountId)}/sync-policy`),
  );
  return requirePayload(response, 'Could not load connector sync policy.').policy;
}

export async function updateConnectorSyncPolicy(
  accountId: string,
  patch: Partial<Pick<ConnectorSyncPolicy, 'scanEnabled' | 'proactiveEnabled' | 'intervalMinutes' | 'allowedScenarioKeys'>>,
): Promise<ConnectorSyncPolicy> {
  const response = await fetchJson<ApiEnvelope<{ policy: ConnectorSyncPolicy }>>(
    apiUrl(`/api/connectors/composio/accounts/${encodeURIComponent(accountId)}/sync-policy`),
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
  return requirePayload(response, 'Could not update connector sync policy.').policy;
}

export async function setAccountLearningPaused(accountId: string, paused: boolean): Promise<void> {
  const action = paused ? 'pause' : 'resume';
  const response = await fetchJson<ApiEnvelope<{ changed: number }>>(
    apiUrl(`/api/connectors/composio/accounts/${encodeURIComponent(accountId)}/learning/${action}`),
    { method: 'POST' },
  );
  requirePayload(response, `Could not ${action} connector learning.`);
}

export async function syncConnectorSource(connectorId: string): Promise<{ recordIds: string[] }> {
  const response = await fetchJson<ApiEnvelope<{ recordIds: string[] }>>(
    apiUrl(`/api/connectors/${encodeURIComponent(connectorId)}/source-sync`),
    { method: 'POST' },
  );
  return requirePayload(response, 'Could not sync connector source.');
}

export async function fetchConnectedPeopleGraph(query = '', limit = 100): Promise<ConnectedPeopleGraph> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const response = await fetchJson<ApiEnvelope<ConnectedPeopleGraph>>(
    apiUrl(`/api/connectors/people?${params.toString()}`),
  );
  return requirePayload(response, 'Could not load the connected people graph.');
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
