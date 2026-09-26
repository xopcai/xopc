export type ConnectorConnectionTarget = {
  type: 'connector';
  connectorId: string;
};

export type PluginMcpConnectionTarget = {
  type: 'plugin-mcp';
  pluginId: string;
  serverId: string;
  serverName: string;
};

export type StoreConnectorConnectionTarget = {
  type: 'store-connector';
  packageName: string;
  connectorId: string;
  version: string;
  sha256: string;
  reviewHash: string;
  description: string;
};

export type ConnectionTarget = ConnectorConnectionTarget | PluginMcpConnectionTarget | StoreConnectorConnectionTarget;

export type ConnectionNeed = {
  key: string;
  target: ConnectionTarget;
  label: string;
  capabilities: string[];
  accountId?: string;
  accountSelector?: string;
  connectionId?: string;
  unavailable?: boolean;
  capabilityError?: string;
  attempt?: { id: string; connectionId?: string; expiresAt: number };
};

export type ConnectionCheckpoint = {
  entryId?: string;
  completedSteps: string[];
  pendingSteps: string[];
  timeRange?: { from: string; to: string; timezone: string; expression: string };
};

export type ConnectionWait = {
  id: string;
  principalId: string;
  conversationId: string;
  transcriptId: string;
  agentId: string;
  objectiveId: string;
  objectiveRevision: number;
  objectiveUpdatedAt: number;
  originInputId: string;
  originRunId: string;
  taskRunId?: string;
  summary: string;
  checkpoint: ConnectionCheckpoint;
  needs: ConnectionNeed[];
  status: 'open' | 'queued' | 'closed';
  resolution?: 'continued' | 'skipped' | 'cancelled' | 'replaced';
  intent?: { objectiveRevision: number; validUntil: number };
  scopeConfirmedAt?: number;
  lastAction?: { key: string; action: string };
  reviewRequired?: boolean;
  queuedInputId?: string;
  version: number;
  createdAt: number;
  updatedAt: number;
};

export type ConnectionNeedView = ConnectionNeed & {
  phase: 'install' | 'connect' | 'authorizing' | 'reconnect' | 'choose_account' | 'ready' | 'blocked';
  accounts: Array<{ id: string; label: string }>;
  alternatives?: Array<{ candidateRef: string; label: string }>;
  reason?: string;
};

export type ConnectionWaitView = Omit<ConnectionWait, 'needs' | 'intent' | 'checkpoint'> & {
  needs: ConnectionNeedView[];
  timeRange?: ConnectionCheckpoint['timeRange'];
  phase: 'needs_connection' | 'ready' | 'review_scope' | 'queued';
};

export type ConnectionWaitSnapshot = { transcriptId: string; revision: number; wait: ConnectionWaitView | null };
