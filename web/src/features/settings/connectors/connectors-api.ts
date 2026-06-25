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
  tags?: string[];
  auth: {
    mode: 'none' | 'apiKey' | 'oauth';
  };
  setup: {
    secrets?: ConnectorSecretField[];
    config?: ConnectorConfigField[];
  };
  runtime: {
    type: 'mcp';
    serverId: string;
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
  status: 'installed' | 'not_configured' | 'failed' | 'disabled';
  secretStatus: Record<string, boolean>;
  materialized: {
    type: 'mcp';
    serverId: string;
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

export async function fetchConnectorInstances(): Promise<ConnectorInstance[]> {
  const response = await fetchJson<ApiEnvelope<{ instances: ConnectorInstance[] }>>(
    apiUrl('/api/connectors/installed'),
  );
  return requirePayload(response, 'Could not load installed connectors.').instances;
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
