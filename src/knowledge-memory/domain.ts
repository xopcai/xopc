import type { UserModelScope } from '../user-model/domain.js';

export type KnowledgeKind =
  | 'work_thread'
  | 'project_fact'
  | 'workspace_fact'
  | 'decision'
  | 'task_lesson'
  | 'commitment'
  | 'open_question'
  | 'episode'
  | 'note';
export type KnowledgeStatus = 'candidate' | 'active' | 'needs_review' | 'stale' | 'archived' | 'rejected';
export type KnowledgeReviewAction = 'approve' | 'edit_and_approve' | 'reject' | 'archive';
export type KnowledgeStatusActor = 'user' | 'agent' | 'runtime' | 'maintenance' | 'migration';
export type KnowledgeOriginClass = 'owner' | 'agent' | 'system' | 'untrusted';
export type KnowledgeRecordClass = 'memory' | 'source_index';
export type KnowledgeVisibilityScope = UserModelScope['type'];
export type KnowledgeContentSource = 'memory' | 'local_import' | 'connector';

export interface KnowledgeReadPolicy {
  scopes: readonly KnowledgeVisibilityScope[];
  contentSources: readonly KnowledgeContentSource[];
}

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
  sourceConversationId?: string;
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
  conversationId: string;
}

export interface KnowledgeStatusEvent {
  id: string;
  knowledgeId: string;
  fromStatus?: KnowledgeStatus;
  toStatus: KnowledgeStatus;
  actor: KnowledgeStatusActor;
  reason: string;
  createdAt: number;
}
