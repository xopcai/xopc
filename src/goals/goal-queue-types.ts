import type { GoalWithDetails } from './types.js';
import type { UserTurnInput } from '../gateway/user-turn-input.js';

export type GoalQueueStatus = 'queued' | 'running' | 'retry_waiting' | 'succeeded' | 'failed' | 'skipped';

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
  lastError?: string;
  source: 'api' | 'cron' | 'workflow' | 'system';
}

export interface GoalRunnerOptions {
  maxConcurrent?: number;
  defaultMaxRetries?: number;
  retryBaseMs?: number;
  ensureSession: (goal: GoalWithDetails) => Promise<string>;
  hasActiveRun: (sessionKey: string) => boolean;
  runTurn: (sessionKey: string, userTurn: UserTurnInput) => Promise<void>;
  emit?: (type: string, payload: unknown) => void;
}

export interface EnqueueGoalRunOptions {
  userTurn?: UserTurnInput;
  maxRetries?: number;
  source?: GoalQueueItemSnapshot['source'];
}
