import type { WorkflowRunInputEnvelope } from '../../workflows/domain/index.js';
import type {
  StartWorkflowRunServiceParams,
  WorkflowRunServiceResult,
} from '../../workflows/service/workflow-run-service.types.js';

export type AutomationSchedule =
  | { kind: 'once'; at: string }
  | { kind: 'interval'; everyMs: number; anchorMs?: number }
  | { kind: 'cron'; expr: string; tz?: string };

export type AutomationTrigger =
  | { kind: 'manual' }
  | { kind: 'schedule'; schedule: AutomationSchedule }
  | { kind: 'webhook'; secretId?: string }
  | {
      kind: 'event';
      eventType: string;
      source?: string;
      payloadMatch?: Record<string, string | number | boolean | null>;
    };

export type AutomationAction =
  | {
      kind: 'agent';
      agentId?: string;
      instruction: string;
      workingDirectory?: string;
      model?: string;
      timeoutSeconds?: number;
    }
  | {
      kind: 'workflow';
      workflowId: string;
      agentId?: string;
      input?: unknown;
      inputEnvelope?: WorkflowRunInputEnvelope;
      goal?: string;
      concurrency?: number;
      maxSubagents?: number;
      timeoutSeconds?: number;
    };

export type AutomationAfterRun =
  | { kind: 'none' }
  | { kind: 'saveToSession' }
  | { kind: 'webhook'; url: string };

export interface AutomationReliability {
  timeoutSeconds?: number;
  retryCount?: number;
  maxConcurrentRuns?: number;
  disableAfterConsecutiveFailures?: number;
}

export type AutomationSafetyMode = 'suggest_only' | 'ask_before_apply' | 'auto_apply';

export interface AutomationSafetyPolicy {
  mode: AutomationSafetyMode;
}

export interface AutomationState {
  nextRunAtMs?: number;
  runningRunId?: string;
  lastRunAtMs?: number;
  lastRunStatus?: AutomationRunStatus;
  lastError?: string;
  consecutiveFailures?: number;
}

export interface Automation {
  id: string;
  name: string;
  description?: string;
  projectId?: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  action: AutomationAction;
  safety?: AutomationSafetyPolicy;
  afterRun?: AutomationAfterRun;
  reliability?: AutomationReliability;
  state: AutomationState;
  createdAtMs: number;
  updatedAtMs: number;
}

export type AutomationRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export interface AutomationRun {
  id: string;
  automationId: string;
  automationName: string;
  status: AutomationRunStatus;
  triggerSnapshot: AutomationTrigger;
  actionSnapshot: AutomationAction;
  manual: boolean;
  createdAtMs: number;
  startedAtMs?: number;
  endedAtMs?: number;
  durationMs?: number;
  summary?: string;
  error?: string;
  sessionKey?: string;
  workflowRunId?: string;
  model?: string;
}

export type AutomationRunEventType =
  | 'run.queued'
  | 'run.started'
  | 'action.started'
  | 'action.completed'
  | 'action.failed'
  | 'after_run.started'
  | 'after_run.completed'
  | 'after_run.failed'
  | 'run.completed';

export interface AutomationRunEvent {
  id: string;
  runId: string;
  automationId: string;
  type: AutomationRunEventType;
  message: string;
  data?: unknown;
  createdAtMs: number;
}

export interface AutomationProductEventRun {
  run: AutomationRun;
  triggerEvent: AutomationRunEvent;
}

export interface AutomationEvent {
  type: string;
  source?: string;
  payload?: Record<string, unknown>;
  occurredAtMs?: number;
}

export interface AutomationMetrics {
  totalAutomations: number;
  enabledAutomations: number;
  runningRuns: number;
  failedLastHour: number;
  nextRun?: {
    automationId: string;
    name: string;
    runAtMs: number;
  };
}

export interface AutomationDeps {
  agentService?: {
    sessionConfig?: {
      applyAutomationWorkingDirectory?: (sessionKey: string, workingDirectory: string | undefined) => Promise<void>;
      applyAutomationModelOverride?: (sessionKey: string, model: string | undefined) => Promise<boolean>;
    };
    turnDispatcher?: {
      processDirect: (message: string, sessionKey: string) => Promise<string>;
    };
    getModelForSession?: (sessionKey: string) => string | undefined;
  };
  getDefaultAgentId?: () => string;
  getProjectWorkspaceRoot?: (projectId: string) => string | undefined;
  workflowRunService?: {
    startWorkflowRun(params: StartWorkflowRunServiceParams): Promise<WorkflowRunServiceResult>;
  };
}

export interface AutomationActionOutcome {
  status: 'succeeded' | 'failed' | 'timeout' | 'cancelled';
  summary?: string;
  error?: string;
  sessionKey?: string;
  workflowRunId?: string;
  model?: string;
}
