import type { GoalWithDetails } from './types.js';

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
  message?: string;
  lastError?: string;
  source: 'api' | 'cron' | 'workflow' | 'system';
}

export interface GoalRunnerOptions {
  maxConcurrent?: number;
  defaultMaxRetries?: number;
  retryBaseMs?: number;
  ensureSession: (goal: GoalWithDetails) => Promise<string>;
  hasActiveRun: (sessionKey: string) => boolean;
  runContinuation: (sessionKey: string, message: string) => Promise<void>;
  emit?: (type: string, payload: unknown) => void;
}

export interface EnqueueGoalRunOptions {
  message?: string;
  maxRetries?: number;
  source?: GoalQueueItemSnapshot['source'];
}
