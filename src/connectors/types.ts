export type ConnectorKind = 'mcp' | 'cli' | 'http' | 'channel' | 'browser' | 'extension' | 'builtin';

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

export type ConnectorAuthMode = 'none' | 'apiKey' | 'oauth';

export type ConnectorSecretReference = {
  xopcSecretRef: {
    provider: string;
    fieldKey: string;
  };
};

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
  defaultValue?: unknown;
  description?: string;
};

export type ConnectorRuntimeDefinition = {
  type: 'mcp';
  serverId: string;
  serverTemplate: Record<string, unknown>;
};

export type ConnectorDefinition = {
  id: string;
  version: string;
  displayName: string;
  description: string;
  category: ConnectorCategory;
  kind: ConnectorKind;
  source: 'builtin' | 'extension' | 'custom' | 'registry';
  capabilities: ConnectorCapability[];
  tags?: string[];
  auth: {
    mode: ConnectorAuthMode;
  };
  setup: {
    secrets?: ConnectorSecretField[];
    config?: ConnectorConfigField[];
  };
  runtime: ConnectorRuntimeDefinition;
};

export type ConnectorInstallInput = {
  secrets?: Record<string, unknown>;
  config?: Record<string, unknown>;
};

export type ConnectorUsageRecord = {
  lastHealthCheckAt?: string;
  lastHealthStatus?: ConnectorHealthStatus;
  lastToolCount?: number;
};

export type ConnectorAuditRecord = {
  at: string;
  action: 'installed' | 'removed' | 'health_check';
  status?: ConnectorHealthStatus;
  ok?: boolean;
  toolCount?: number;
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
  usage: ConnectorUsageRecord;
  audit: ConnectorAuditRecord[];
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

export type ConnectorHealthResult = {
  serverId: string;
  ok: boolean;
  status: ConnectorHealthStatus;
  toolCount: number;
  tools: Array<{ name: string; shortName?: string; description?: string }>;
  error?: string;
  action?: string;
};

export type ConnectorDetail = {
  definition: ConnectorDefinition;
  instances: ConnectorInstance[];
};

export type ManagedConnectorMarker = {
  managed: true;
  connectorId: string;
  version: string;
};
