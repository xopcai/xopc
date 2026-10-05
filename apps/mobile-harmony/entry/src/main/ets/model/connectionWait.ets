export interface XopcConnectionNeed {
  key: string;
  label: string;
  target: XopcConnectionTarget;
  capabilities: string[];
  phase: string;
  authorizationMode: 'browser' | 'desktop';
  accounts: XopcConnectionAccount[];
  accountId?: string;
  alternatives?: XopcConnectionAlternative[];
  reason?: string;
  capabilityError?: string;
}

export interface XopcConnectionTarget { type: string; connectorId?: string; packageName?: string; }
export interface XopcConnectionAccount { id: string; label: string; }
export interface XopcConnectionAlternative { candidateRef: string; label: string; }
export interface XopcConnectionTimeRange { from: string; to: string; timezone: string; expression: string; }

export interface XopcConnectionWait {
  id: string;
  conversationId: string;
  summary: string;
  objectiveUpdatedAt: number;
  version: number;
  phase: string;
  needs: XopcConnectionNeed[];
  timeRange?: XopcConnectionTimeRange;
}

export interface XopcConnectionWaitSnapshot {
  transcriptId: string;
  revision: number;
  wait: XopcConnectionWait | null;
}

export interface XopcConnectionWaitActionResult {
  snapshot: XopcConnectionWaitSnapshot;
  authorizationUrl?: string;
}

export type XopcConnectionAction = 'connect' | 'check' | 'select_account' | 'confirm_scope' | 'skip' | 'cancel';

export interface XopcConnectionActionRequest {
  action: XopcConnectionAction;
  needKey?: string;
  accountId?: string;
  waitId: string;
  expectedTranscriptId: string;
  expectedVersion: number;
  idempotencyKey: string;
}
