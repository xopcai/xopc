import type { SessionListReader } from '../session/store-reader.js';
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

export type CronSchedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; everyMs: number; anchorMs?: number }
  | { kind: 'cron'; expr: string; tz?: string; staggerMs?: number };

export type CronSessionTarget = 'main' | 'isolated' | 'current' | `session:${string}`;
export type CronWakeMode = 'now' | 'next-heartbeat';

export type CronDeliveryMode = 'none' | 'announce' | 'webhook';

export interface CronDelivery {
  mode: CronDeliveryMode;
  channel?: string;
  to?: string;
  accountId?: string;
  threadId?: string | number;
  bestEffort?: boolean;
  completionDestination?: { mode: 'webhook'; to: string };
  failureDestination?: {
    mode?: 'announce' | 'webhook';
    channel?: string;
    to?: string;
    accountId?: string;
  };
}

export type CronPayload =
  | { kind: 'systemEvent'; text: string }
  | {
      kind: 'agentTurn';
      message: string;
      model?: string;
      thinking?: string;
      toolsAllow?: string[];
      timeoutSeconds?: number;
    }
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
  maxRetries?: number;
  waitForCompletion?: boolean;
  source?: Partial<Extract<WorkflowRunSource, { kind: 'cron' }>>;
}

export type CronRunStatusValue = 'ok' | 'error' | 'skipped';
export type CronDeliveryStatus = 'delivered' | 'not-delivered' | 'unknown' | 'not-requested';

export interface CronFailureAlert {
  after?: number;
  cooldownMs?: number;
  includeSkipped?: boolean;
  mode?: 'announce' | 'webhook';
  channel?: string;
  to?: string;
  accountId?: string;
}

export interface JobState {
  nextRunAtMs?: number;
  runningAtMs?: number;
  runningSessionKey?: string;
  lastRunAtMs?: number;
  lastRunStatus?: CronRunStatusValue;
  lastError?: string;
  lastDurationMs?: number;
  consecutiveErrors?: number;
  consecutiveSkipped?: number;
  lastDeliveryStatus?: CronDeliveryStatus;
  lastDeliveryError?: string;
  lastFailureAlertAtMs?: number;
}

export interface JobData {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: CronSchedule;
  sessionTarget: CronSessionTarget;
  wakeMode: CronWakeMode;
  agentId?: string;
  sessionKey?: string;
  workingDirectory?: string;
  payload: CronPayload;
  delivery?: CronDelivery;
  failureAlert?: CronFailureAlert | false;
  state: JobState;
}

export type CronJobCreate = Omit<JobData, 'id' | 'createdAtMs' | 'updatedAtMs' | 'state' | 'enabled' | 'sessionTarget' | 'wakeMode' | 'name'> & {
  id?: string;
  name?: string;
  enabled?: boolean;
  sessionTarget?: CronSessionTarget;
  wakeMode?: CronWakeMode;
  state?: Partial<JobState>;
};

export type CronJobPatch = Partial<
  Omit<JobData, 'id' | 'createdAtMs' | 'updatedAtMs' | 'state'>
> & {
  state?: Partial<JobState>;
};

export interface CronWorkflowRunStarter {
  startWorkflowRun(params: StartWorkflowRunServiceParams): Promise<WorkflowRunServiceResult>;
  readWorkflowRunView?(agentId: string, runId: string): Promise<WorkflowRunView | null>;
  retryWorkflowRun?(params: { agentId: string; runId: string }): Promise<WorkflowRunServiceResult>;
}

export interface HeartbeatWakeSink {
  requestNow(opts?: { reason?: string }): void;
}

export interface JobExecutorDeps {
  agentService?: any;
  messageBus?: any;
  heartbeatService?: HeartbeatWakeSink;
  sessionStore?: SessionListReader;
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

export type AddJobOptions = CronJobCreate;

export interface JobHistoryQuery {
  jobId: string;
  limit?: number;
  before?: Date;
}
