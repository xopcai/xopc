// Cron types and interfaces

// ============================================================================
// Delivery Types
// ============================================================================

export type CronDeliveryMode = 'none' | 'announce' | 'direct';

export interface CronDelivery {
  mode: CronDeliveryMode;
  channel?: string;  // 'telegram' | 'whatsapp' | 'cli'
  to?: string;       // recipient chat id
  bestEffort?: boolean;
}

// ============================================================================
// Payload Types
// ============================================================================

export type CronPayload =
  | { kind: 'systemEvent'; text: string }
  | { kind: 'agentTurn'; message: string; model?: string; timeoutSeconds?: number };

// ============================================================================
// Session Target
// ============================================================================

export type CronSessionTarget = 'main' | 'isolated';

// ============================================================================
// Job Data
// ============================================================================

export interface JobData {
  id: string;
  name?: string;
  schedule: string;
  message: string;
  enabled: boolean;
  timezone?: string;
  maxRetries: number;
  timeout: number;
  created_at: string;
  updated_at: string;
  // New fields for agent integration
  sessionTarget?: CronSessionTarget;
  payload?: CronPayload;
  delivery?: CronDelivery;
  model?: string;
  // Internal state
  state?: JobState;
}

export interface JobState {
  nextRunAtMs?: number;
  runningAtMs?: number;
  lastRunAtMs?: number;
  lastStatus?: 'ok' | 'error' | 'skipped';
  lastError?: string;
  lastDurationMs?: number;
  consecutiveErrors?: number;
  scheduleErrorCount?: number;
}

// ============================================================================
// Job Execution
// ============================================================================

export interface JobExecution {
  id: string;
  jobId: string;
  status: 'running' | 'success' | 'failed' | 'cancelled' | 'skipped';
  startedAt: string;
  endedAt?: string;
  duration?: number; // milliseconds
  error?: string;
  output?: string;
  retryCount: number;
  summary?: string;
  sessionId?: string;
  sessionKey?: string;
  model?: string;
  provider?: string;
  usage?: CronUsageSummary;
}

export interface CronUsageSummary {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

export type CronRunStatus = 'ok' | 'error' | 'skipped';

export interface CronRunOutcome {
  status: CronRunStatus;
  error?: string;
  summary?: string;
  sessionId?: string;
  sessionKey?: string;
  model?: string;
  provider?: string;
  usage?: CronUsageSummary;
}

// ============================================================================
// Executor Interface
// ============================================================================

export interface JobExecutorDeps {
  agentService?: any;
  messageBus?: any;
}

export interface JobExecutor {
  execute(job: JobData, signal: AbortSignal, deps?: JobExecutorDeps): Promise<void>;
}

// ============================================================================
// Metrics & Health
// ============================================================================

export interface CronMetrics {
  totalJobs: number;
  runningJobs: number;
  enabledJobs: number;
  failedLastHour: number;
  avgExecutionTime: number;
  nextScheduledJob?: {
    id: string;
    name?: string;
    runAt: Date;
  };
}

export interface CronHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  issues: string[];
  lastError?: string;
}

// ============================================================================
// API Options
// ============================================================================

export interface AddJobOptions {
  name?: string;
  timezone?: string;
  maxRetries?: number;
  timeout?: number;
  sessionTarget?: CronSessionTarget;
  payload?: CronPayload;
  delivery?: CronDelivery;
  model?: string;
}

export interface JobWithNextRun extends Omit<JobData, 'created_at' | 'updated_at' | 'state'> {
  next_run?: string;
}

export interface JobHistoryQuery {
  jobId: string;
  limit?: number;
  before?: Date;
}
