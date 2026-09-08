export type ClarificationKind = 'input' | 'approval';
export type ClarificationStatus =
  | 'open'
  | 'queued'
  | 'resolved'
  | 'expired'
  | 'cancelled'
  | 'superseded';
export type ClarificationResolution = 'answered' | 'agent_decide' | 'cancelled';

export type ClarificationCheckpoint = {
  transcriptEntryId?: string;
  objectiveSummary: string;
  completedSteps: string[];
  pendingSteps: string[];
  originalRequestAt: number;
};

export type ClarificationWait = {
  id: string;
  principalId: string;
  sessionKey: string;
  sessionId: string;
  objectiveId: string;
  objectiveRevision: number;
  originRunId: string;
  originInputId: string;
  originToolCallId: string;
  taskRunId?: string;
  kind: ClarificationKind;
  status: ClarificationStatus;
  question: string;
  choices?: string[];
  suggestedAnswer?: string;
  checkpoint: ClarificationCheckpoint;
  answer?: string;
  resolution?: ClarificationResolution;
  expiresAt?: number;
  approvalKey?: string;
  approvalConsumedAt?: number;
  responseIdempotencyKey?: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
};

export type ClarificationWaitSnapshot = {
  sessionId: string;
  revision: number;
  serverTime: number;
  clarification: ClarificationWait | null;
};

export type ClarificationResponseAction = 'answer' | 'agent_decide' | 'cancel';
