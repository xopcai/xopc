import type { MediaRef } from '../media/types.js';

export type GoalStatus = 'active' | 'paused' | 'blocked' | 'needs_input' | 'done' | 'archived';
export type GoalPriority = 'low' | 'normal' | 'high';
export type GoalSource = 'chat' | 'cli' | 'cron' | 'workflow' | 'channel' | 'api';
export type GoalUiLocale = 'en' | 'zh';

export type GoalChecklistStatus = 'pending' | 'completed' | 'impossible';
export type GoalChecklistAddedBy = 'user' | 'judge';

export type GoalRunStatus = 'running' | 'succeeded' | 'failed' | 'aborted';
export type GoalRunVerdict = 'continue' | 'done' | 'blocked' | 'needs_input' | 'decompose';

export interface Goal {
  id: string;
  outcomeId: string;
  outcomeContractVersion: number;
  title: string;
  description?: string;
  status: GoalStatus;
  agentId: string;
  priority: GoalPriority;
  deadlineAt?: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  archivedAt?: number;
  activeSessionKey?: string;
  currentRunId?: string;
  nextAction?: string;
  blockedReason?: string;
  judgeModelRef?: string;
  maxTurns: number;
  turnsUsed: number;
  uiLocale?: GoalUiLocale;
  source: GoalSource;
  projectId?: string;
}

export interface GoalChecklistItem {
  id: string;
  goalId: string;
  text: string;
  status: GoalChecklistStatus;
  addedBy: GoalChecklistAddedBy;
  addedAt: number;
  completedAt?: number;
  evidenceSummary?: string;
  sortOrder: number;
}

export interface GoalRun {
  id: string;
  goalId: string;
  sessionKey: string;
  source: GoalSource;
  status: GoalRunStatus;
  startedAt: number;
  finishedAt?: number;
  verdict?: GoalRunVerdict;
  reason?: string;
  nextAction?: string;
  assistantPreview?: string;
  checklistProgress?: { done: number; total: number };
  confidence?: number;
  missingEvidence?: string[];
  userQuestion?: string;
  completedChecklistItemIds?: string[];
}

export interface GoalEvent {
  id: string;
  goalId: string;
  runId?: string;
  kind: string;
  message: string;
  data?: unknown;
  createdAt: number;
}

export interface GoalEvidence {
  id: string;
  goalId: string;
  runId?: string;
  kind: 'file' | 'diff' | 'command' | 'test' | 'link' | 'message' | 'artifact';
  title: string;
  summary?: string;
  uri?: string;
  data?: unknown;
  createdAt: number;
}

export type GoalContextAttachment = MediaRef;

export interface GoalContextMessage {
  goalId: string;
  text: string;
  attachments: GoalContextAttachment[];
  createdAt: number;
  updatedAt: number;
}


export interface GoalWithDetails extends Goal {
  checklist: GoalChecklistItem[];
  latestRun?: GoalRun;
  contextMessage?: GoalContextMessage;
}

export interface GoalListQuery {
  status?: GoalStatus | GoalStatus[];
  agentId?: string;
  sessionKey?: string;
  projectId?: string;
  limit?: number;
  offset?: number;
}

export interface CreateGoalInput {
  outcomeId: string;
  outcomeContractVersion: number;
  title: string;
  description?: string;
  agentId: string;
  sessionKey?: string;
  priority?: GoalPriority;
  deadlineAt?: number;
  judgeModelRef?: string;
  maxTurns: number;
  uiLocale?: GoalUiLocale;
  source?: GoalSource;
  projectId?: string;
}

export interface GoalJudgeDecision {
  verdict: GoalRunVerdict;
  reason: string;
  nextAction?: string;
  assistantPreview?: string;
  checklistProgress?: { done: number; total: number };
  confidence?: number;
  missingEvidence?: string[];
  userQuestion?: string;
  completedChecklistItemIds?: string[];
}
