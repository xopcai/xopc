export type ConnectorKind = 'mcp' | 'cli' | 'http' | 'channel' | 'browser' | 'extension' | 'builtin' | 'composio' | 'nativeTool' | 'memorySource';

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

export type ConnectorPermissions = {
  data?: string[];
  networkDomains?: string[];
  localExec?: boolean;
  filesystem?: string[];
};

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

export type ConnectorRuntimeDefinition =
  | {
      type: 'mcp';
      serverId: string;
      serverTemplate: Record<string, unknown>;
    }
  | {
      type: 'channel';
      channelId: string;
      pluginId: string;
    }
  | {
      type: 'composio';
      toolkit: string;
    }
  | {
      type: 'nativeTool';
      toolsetId: string;
    }
  | {
      type: 'memorySource';
      sourceKind: string;
    };

export type ConnectorDefinition = {
  id: string;
  version: string;
  displayName: string;
  description: string;
  category: ConnectorCategory;
  kind: ConnectorKind;
  source: 'builtin' | 'extension' | 'custom' | 'registry' | 'store';
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
  permissions?: ConnectorPermissions;
  provenance?: {
    packageName: string;
    sha256: string;
  };
};

export type ConnectorInstallInput = {
  secrets?: Record<string, unknown>;
  config?: Record<string, unknown>;
};

export type ConnectorUsageRecord = {
  lastHealthCheckAt?: string;
  lastHealthStatus?: ConnectorHealthStatus;
  lastToolCount?: number;
  lastResourceCount?: number;
  lastPromptCount?: number;
};

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
        type: 'channel' | 'composio' | 'nativeTool' | 'memorySource';
        id: string;
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
  | 'unauthorized'
  | 'disabled'
  | 'unknown_error';

export type ConnectorHealthResult = {
  serverId: string;
  ok: boolean;
  status: ConnectorHealthStatus;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  tools: Array<{ name: string; shortName?: string; description?: string }>;
  resources: Array<{ uri: string; name: string; title?: string; description?: string; mimeType?: string }>;
  prompts: Array<{ name: string; title?: string; description?: string; argumentCount: number }>;
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
  enabled?: boolean;
  lastConnectedAt?: string;
  lastError?: string;
  displayName?: string;
  config?: Record<string, unknown>;
  source?: ConnectorDefinition['source'];
  artifactSha256?: string;
};
