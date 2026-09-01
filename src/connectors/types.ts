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

export type ConnectorAuthDefinition =
  | { mode: 'none' }
  | { mode: 'apiKey' }
  | { mode: 'oauth'; provider?: string; clientId?: string };

export type ConnectorScope = 'read' | 'write' | 'admin';

export type ConnectorVerificationLevel = 'verified' | 'beta' | 'experimental';

export type ConnectorBenefit = 'understand' | 'act' | 'reach';

export type ConnectorBranding = {
  logoUrl?: string;
  source?: 'builtin' | 'composio-catalog' | 'registry' | 'extension' | 'custom';
  backgroundColor?: string;
  fetchedAt?: string;
};

export type ConnectorConfirmationPolicy = 'always' | 'writes' | 'admin' | 'never';

export type ConnectorPermissions = {
  data?: string[];
  networkDomains?: string[];
  localExec?: boolean;
  filesystem?: string[];
};

export type ConnectorIntegrationStrategy = {
  lane: 'native' | 'mcp' | 'composio';
  workload: 'core' | 'high_frequency' | 'long_tail';
  preferred: boolean;
  alternative?: {
    kind: 'channel' | 'connector';
    id: string;
  };
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
      localPackage?: {
        registry: 'npm';
        name: string;
        version: string;
      };
    }
  | {
      type: 'channel';
      channelId: string;
      pluginId: string;
    }
  | {
      type: 'composio';
      toolkit: string;
      role: 'credential' | 'toolkit';
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
  benefits?: ConnectorBenefit[];
  understanding?: {
    mode: 'activity' | 'inventory';
    bootstrapWindowDays: number;
    readOnly: true;
  };
  tags?: string[];
  branding?: ConnectorBranding;
  verificationLevel?: ConnectorVerificationLevel;
  auth: ConnectorAuthDefinition;
  setup: {
    secrets?: ConnectorSecretField[];
    config?: ConnectorConfigField[];
  };
  runtime: ConnectorRuntimeDefinition;
  permissions?: ConnectorPermissions;
  integrationStrategy?: ConnectorIntegrationStrategy;
  provenance?: {
    packageName: string;
    sha256: string;
  };
};

export type ConnectorInstallationPolicy = {
  id: string;
  connectorId: string;
  principalId: string;
  enabled: boolean;
  allowedAgentIds: string[];
  maxScope: ConnectorScope;
  confirmationPolicy: ConnectorConfirmationPolicy;
  selectedConnectionIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ConnectorConnectionStatus =
  | 'pending'
  | 'active'
  | 'expired'
  | 'failed'
  | 'revoked'
  | 'disabled'
  | 'unknown';

export type ConnectorConnection = {
  id: string;
  accountId?: string;
  installationId?: string;
  connectorId: string;
  provider: string;
  principalId: string;
  providerConnectionId: string;
  alias?: string;
  identity: Record<string, unknown>;
  status: ConnectorConnectionStatus;
  isDefault: boolean;
  connectedAt?: string;
  expiresAt?: string;
  lastError?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ConnectorAccount = {
  id: string;
  connectorId: string;
  principalId: string;
  identityKey?: string;
  identity: Record<string, unknown>;
  currentConnectionId?: string;
  createdAt: string;
  updatedAt: string;
};

export type ConnectorActionMetadata = {
  connectorId: string;
  actionId: string;
  toolkit?: string;
  scope: ConnectorScope;
  curated: boolean;
  inputSchema?: unknown;
  schemaVersion?: string;
  cachedAt: string;
};

export type ConnectorExecutionDecision = 'allowed' | 'denied' | 'confirmation_required';

export type ConnectorExecutionAuditRecord = {
  id: string;
  installationId?: string;
  connectionId?: string;
  connectorId: string;
  principalId: string;
  agentId?: string;
  sessionKey?: string;
  actionId: string;
  scope: ConnectorScope;
  decision: ConnectorExecutionDecision;
  resultStatus: 'success' | 'error' | 'not_executed';
  durationMs?: number;
  errorCode?: string;
  createdAt: string;
};

export type ConnectorApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'consumed';

export type ConnectorApprovalRecord = {
  id: string;
  principalId: string;
  connectorId: string;
  connectionId?: string;
  agentId?: string;
  sessionKey?: string;
  actionId: string;
  scope: ConnectorScope;
  argumentsHash: string;
  argumentsPreview: Record<string, unknown>;
  status: ConnectorApprovalStatus;
  expiresAt: string;
  createdAt: string;
  decidedAt?: string;
  consumedAt?: string;
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
        type: 'composio';
        id: string;
        toolkit: string;
        role: 'credential' | 'toolkit';
      }
    | {
        type: 'channel' | 'nativeTool' | 'memorySource';
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
  /** Immutable install-time snapshot used for update, health, and uninstall after restart. */
  definition?: ConnectorDefinition;
};
