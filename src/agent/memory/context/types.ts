import type { AgentMessage } from '@earendil-works/pi-agent-core';

export type UserContextRejectionReason =
  | 'expired'
  | 'not_yet_valid'
  | 'sensitive'
  | 'requires_consent'
  | 'needs_review'
  | 'scope_mismatch'
  | 'disabled'
  | 'conflict'
  | 'low_score'
  | 'budget';

export interface PlannedUserContextItem {
  recordId: string;
  objectType: 'profile' | 'rule' | 'understanding';
  versionId?: string;
  content: string;
  score: number;
  section: 'task' | 'interaction' | 'safety';
  citation: string;
  origin: 'told_by_user' | 'observed' | 'inferred' | 'connected_source';
  stability: number;
}

export interface UserContextPlan {
  traceId: string;
  modelMessage: AgentMessage;
  items: PlannedUserContextItem[];
  rejected: Array<{ recordId: string; reason: UserContextRejectionReason }>;
  consentRequests: Array<{ id: string; recordId: string; statement: string; purpose: string }>;
  estimatedTokens: number;
  allocation?: {
    profile: 'standard' | 'deep' | 'critical';
    maxResults: number;
    maxChars: number;
    reason: string;
  };
}
