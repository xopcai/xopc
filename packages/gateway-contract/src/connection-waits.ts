export type ConnectionNeed = {
  key: string;
  connectorId: string;
  label: string;
  capabilities: string[];
  accountId?: string;
  accountSelector?: string;
  connectionId?: string;
  unavailable?: boolean;
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
  sessionKey: string;
  sessionId: string;
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
  phase: 'connect' | 'authorizing' | 'reconnect' | 'choose_account' | 'ready' | 'blocked';
  accounts: Array<{ id: string; label: string }>;
  alternatives?: Array<{ candidateRef: string; label: string }>;
  reason?: string;
};

export type ConnectionWaitView = Omit<ConnectionWait, 'needs' | 'intent' | 'checkpoint'> & {
  needs: ConnectionNeedView[];
  timeRange?: ConnectionCheckpoint['timeRange'];
  phase: 'needs_connection' | 'ready' | 'review_scope' | 'queued';
};

export type ConnectionWaitSnapshot = { sessionId: string; revision: number; wait: ConnectionWaitView | null };
