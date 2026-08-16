import type { GoalWithDetails } from './types.js';
import type { UserTurnInput } from '../gateway/user-turn-input.js';

export type GoalQueueStatus = 'queued' | 'running' | 'retry_waiting' | 'succeeded' | 'failed' | 'skipped';

export interface GoalRunExecutionContext {
  outcomeId?: string;
  workItemId?: string;
  contextTraceId?: string;
  parentRunId?: string;
  triggerKind: 'user' | 'schedule' | 'webhook' | 'proactive' | 'retry';
}

export interface GoalQueueItemSnapshot {
  id: string;
  goalId: string;
  status: GoalQueueStatus;
  attempts: number;
  maxRetries: number;
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  nextRunAt?: number;
  sessionKey?: string;
  userTurn?: UserTurnInput;
  executionContext?: GoalRunExecutionContext;
  lastError?: string;
  source: 'api' | 'cron' | 'workflow' | 'system';
}

export interface GoalRunnerOptions {
  maxConcurrent?: number;
  defaultMaxRetries?: number;
  retryBaseMs?: number;
  ensureSession: (goal: GoalWithDetails, context?: GoalRunExecutionContext) => Promise<string>;
  bindExecutionContext?: (
    sessionKey: string,
    goal: GoalWithDetails,
    context?: GoalRunExecutionContext,
  ) => Promise<void>;
  hasActiveRun: (sessionKey: string) => boolean;
  runTurn: (sessionKey: string, userTurn: UserTurnInput) => Promise<void>;
  emit?: (type: string, payload: unknown) => void;
}

export interface EnqueueGoalRunOptions {
  userTurn?: UserTurnInput;
  maxRetries?: number;
  source?: GoalQueueItemSnapshot['source'];
  executionContext?: GoalRunExecutionContext;
}
