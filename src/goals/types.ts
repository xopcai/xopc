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
  requirementIds?: string[];
  createdAt: number;
}

export type GoalEvidenceRequirementStatus = 'pending' | 'ai_verified' | 'approved' | 'rejected';
export type GoalEvidenceReviewSource = 'ai' | 'user' | 'system';

/** A single, reviewable proof obligation from the goal contract. */
export interface GoalEvidenceRequirement {
  id: string;
  goalId: string;
  text: string;
  status: GoalEvidenceRequirementStatus;
  evidenceIds: string[];
  reviewReason?: string;
  reviewConfidence?: number;
  reviewedBy?: GoalEvidenceReviewSource;
  reviewedAt?: number;
  requiresHumanApproval: boolean;
  createdAt: number;
  updatedAt: number;
  sortOrder: number;
}

export type GoalContextAttachment = MediaRef;

export interface GoalContextMessage {
  goalId: string;
  text: string;
  attachments: GoalContextAttachment[];
  createdAt: number;
  updatedAt: number;
}

/**
 * The user-confirmed definition of success for a persistent goal.
 * Checklist items hold the individual acceptance criteria; this contract
 * supplies the outcome, scope boundary, and expected evidence around them.
 */
export interface GoalContract {
  goalId: string;
  version: number;
  objective: string;
  scopeBoundary?: string;
  evidencePlan: string[];
  outcomeMetric?: GoalOutcomeMetric;
  createdAt: number;
  updatedAt: number;
}

export type GoalOutcomeDirection = 'increase' | 'decrease';

/** A measurable user-visible result used to verify that outputs changed the intended outcome. */
export interface GoalOutcomeMetric {
  name: string;
  baselineValue: number;
  targetValue: number;
  currentValue?: number;
  unit?: string;
  direction: GoalOutcomeDirection;
  sourceUrl?: string;
  measuredAt?: number;
}

export interface GoalOutcomeMetricInput {
  name: string;
  baselineValue: number;
  targetValue: number;
  currentValue?: number;
  unit?: string;
  direction?: GoalOutcomeDirection;
  sourceUrl?: string;
  measuredAt?: number;
}

export interface GoalContractInput {
  objective?: string;
  scopeBoundary?: string;
  evidencePlan?: string[];
  criteria?: string[];
  outcomeMetric?: GoalOutcomeMetricInput | null;
}

export interface GoalWithDetails extends Goal {
  checklist: GoalChecklistItem[];
  latestRun?: GoalRun;
  contextMessage?: GoalContextMessage;
  contract?: GoalContract;
  evidenceRequirements: GoalEvidenceRequirement[];
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
  contract?: GoalContractInput;
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
