// Cron job execution records — kept separate from cron/types.ts so SQLite
// repositories can import without pulling in session/store.

export interface CronUsageSummary {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

export interface JobExecution {
  id: string;
  jobId: string;
  status: 'running' | 'success' | 'failed' | 'cancelled' | 'skipped';
  startedAt: string;
  endedAt?: string;
  duration?: number;
  error?: string;
  output?: string;
  retryCount: number;
  summary?: string;
  sessionId?: string;
  sessionKey?: string;
  /** Persisted for local run logs (e.g. `cron` for isolated agent jobs). */
  sessionType?: string;
  model?: string;
  provider?: string;
  usage?: CronUsageSummary;
  workflowRunId?: string;
}

/** One row for GET /api/cron/runs/history (optional display name from job definition). */
export interface CronRunHistoryRow extends JobExecution {
  jobName?: string;
}

export type CronRunStatus = 'ok' | 'error' | 'skipped';

export interface CronRunOutcome {
  status: CronRunStatus;
  error?: string;
  summary?: string;
  sessionId?: string;
  sessionKey?: string;
  sessionType?: string;
  model?: string;
  provider?: string;
  usage?: CronUsageSummary;
  workflowRunId?: string;
}
