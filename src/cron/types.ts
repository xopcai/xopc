// Cron types and interfaces

import type { SessionStore } from '../session/store.js';
import type {
  WorkflowRunInputEnvelope,
  WorkflowRunSource,
  WorkflowRunView,
} from '../workflows/domain/index.js';
import type {
  StartWorkflowRunServiceParams,
  WorkflowRunServiceResult,
} from '../workflows/service/workflow-run-service.types.js';

export type {
  CronRunHistoryRow,
  CronRunOutcome,
  CronRunStatus,
  CronUsageSummary,
  JobExecution,
} from './execution-types.js';

// ============================================================================
// Delivery Types
// ============================================================================

export type CronDeliveryMode = 'none' | 'announce' | 'direct';

export interface CronDelivery {
  mode: CronDeliveryMode;
  channel?: string;  // 'telegram' | 'cli' | 'local'
  to?: string;       // recipient chat id (omit for `local`)
  bestEffort?: boolean;
}

// ============================================================================
// Payload Types
// ============================================================================

export type CronPayload =
  | { kind: 'systemEvent'; text: string }
  | { kind: 'agentTurn'; message: string; model?: string; timeoutSeconds?: number }
  | CronGoalContinuePayload
  | CronWorkflowRunPayload;

export interface CronGoalContinuePayload {
  kind: 'goalContinue';
  goalId: string;
  message?: string;
  maxRetries?: number;
}

export interface CronWorkflowRunPayload {
  kind: 'workflowRun';
  definitionId: string;
  input?: unknown;
  inputEnvelope?: WorkflowRunInputEnvelope;
  goal?: string;
  agentId?: string;
  sessionKey?: string;
  /** When true (default), cron waits for terminal workflow status before marking the job result. */
  waitForCompletion?: boolean;
  source?: Partial<Extract<WorkflowRunSource, { kind: 'cron' }>>;
}

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
  enabled: boolean;
  timezone?: string;
  maxRetries: number;
  timeout: number;
  created_at: string;
  updated_at: string;
  sessionTarget?: CronSessionTarget;
  /** When set, isolated agent runs use this agent id in the session key (multi-agent). */
  agentId?: string;
  /**
   * Optional absolute workspace root for isolated agent runs (same semantics as chat working directory).
   * Omit to use the effective agent profile default workspace.
   */
  workingDirectory?: string;
  payload: CronPayload;
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

// See ./execution-types.js for JobExecution, CronRunHistoryRow, CronRunOutcome, etc.

// ============================================================================
// Executor Interface
// ============================================================================

export interface CronWorkflowRunStarter {
  startWorkflowRun(params: StartWorkflowRunServiceParams): Promise<WorkflowRunServiceResult>;
  readWorkflowRunView?(agentId: string, runId: string): Promise<WorkflowRunView | null>;
  retryWorkflowRun?(params: { agentId: string; runId: string }): Promise<WorkflowRunServiceResult>;
}

/** Optional hook after a successful cron run (e.g. wake gateway heartbeat). */
export interface HeartbeatWakeSink {
  requestNow(opts?: { reason?: string }): void;
}

export interface JobExecutorDeps {
  agentService?: any;
  messageBus?: any;
  heartbeatService?: HeartbeatWakeSink;
  /** When set, weixin cron `delivery.to` may be a bare ilink user id; accountId is inferred from sessions. */
  sessionStore?: SessionStore;
  /**
   * When a job has no `agentId`, isolated cron runs use this id for the session key
   * (same as {@link JobData.agentId} set to the default agent). Typically `getDefaultAgentId(config)`.
   */
  getDefaultCronAgentId?: () => string;
  workflowRunService?: CronWorkflowRunStarter;
  goalRunner?: {
    enqueue(goalId: string, options?: {
      message?: string;
      maxRetries?: number;
      source?: 'api' | 'cron' | 'workflow' | 'system';
    }): { id: string; goalId: string; status: string; sessionKey?: string };
  };
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
  agentId?: string;
  workingDirectory?: string;
  payload: CronPayload;
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
