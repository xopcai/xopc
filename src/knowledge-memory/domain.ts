import type { UserModelScope } from '../user-model/domain.js';

export type KnowledgeKind =
  | 'project_fact'
  | 'workspace_fact'
  | 'decision'
  | 'task_lesson'
  | 'commitment'
  | 'open_question'
  | 'episode'
  | 'note';
export type KnowledgeStatus = 'candidate' | 'active' | 'needs_review' | 'stale' | 'archived' | 'rejected';
export type KnowledgeOriginClass = 'owner' | 'agent' | 'system' | 'untrusted';
export type KnowledgeRecordClass = 'memory' | 'source_index';
export type KnowledgeSource = 'session' | 'workspace' | 'project' | 'connector';

export interface KnowledgeItem {
  id: string;
  principalId: string;
  kind: KnowledgeKind;
  scope: UserModelScope;
  content: string;
  canonicalKey: string;
  recordClass: KnowledgeRecordClass;
  status: KnowledgeStatus;
  confidence: number;
  importance: number;
  validFrom?: number;
  validTo?: number;
  expiresAt?: number;
  reviewAt?: number;
  originClass: KnowledgeOriginClass;
  sourceAgentId?: string;
  sourceSessionId?: string;
  sourceTurnId?: string;
  derivedFromRecalledContext: boolean;
  source: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeVisibilityContext {
  agentId: string;
  workspaceId: string;
  projectId?: string;
  sessionId: string;
}
