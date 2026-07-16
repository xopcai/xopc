import type { AgentMessage } from '@earendil-works/pi-agent-core';

export type UserContextRejectionReason =
  | 'expired'
  | 'not_yet_valid'
  | 'sensitive'
  | 'requires_consent'
  | 'low_score'
  | 'budget';

export interface PlannedUserContextItem {
  recordId: string;
  content: string;
  score: number;
  section: 'task' | 'interaction' | 'safety';
  citation: string;
}

export interface UserContextPlan {
  traceId: string;
  modelMessage: AgentMessage;
  items: PlannedUserContextItem[];
  rejected: Array<{ recordId: string; reason: UserContextRejectionReason }>;
  estimatedTokens: number;
}
