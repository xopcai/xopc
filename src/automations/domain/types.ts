import type { WorkflowRunInputEnvelope } from '../../workflows/domain/index.js';
import type { TaskCommand } from '@xopcai/gateway-contract';
import type { TurnOrigin } from '@xopcai/endpoint-tools-protocol';
import type {
  WorkflowRunServiceLike,
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
    }
  | {
      kind: 'browser_automation';
      automationId: string;
      inputs?: Record<string, unknown>;
      timeoutSeconds?: number;
    }
  | {
      kind: 'task_command';
      taskId: string;
      command: TaskCommand;
    }
  | {
      kind: 'system';
      capability:
        | 'home.advisor.refresh'
        | 'memory.temporal_sweep'
        | 'memory.daily_reconciliation'
        | 'memory.weekly_knowledge';
    };

export type AutomationEditableField = 'enabled' | 'trigger';

export interface AutomationManagement {
  owner: string;
  editable: AutomationEditableField[];
  runnable: boolean;
  deletable: boolean;
}

export type AutomationConversationMode = 'new_session' | 'continuous';

export type AutomationNotificationPolicy = 'attention' | 'all' | 'none';

export type AutomationDeliveryDestination =
  | { key: string; kind: 'gateway_event' }
  | { key: string; kind: 'webhook'; endpoint: string; secretId: string }
  | { key: string; kind: 'file'; targetId: string; pathTemplate: string }
  | { key: string; kind: 'card'; channelId: string; templateId: string };

export interface AutomationDeliveryPolicy {
  notificationPolicy: AutomationNotificationPolicy;
  destinations: AutomationDeliveryDestination[];
}

export interface AutomationRunDeliveryContext {
  notificationPolicy: AutomationNotificationPolicy;
  requiresAttention: boolean;
  projectId?: string;
}

export interface AutomationReliability {
  executionTimeoutSeconds?: number;
  retryCount?: number;
  maxConcurrentRuns?: number;
  disableAfterConsecutiveFailures?: number;
}

export type AutomationRunPhase = 'queued' | 'action' | 'cancelling' | 'completed';

export interface AutomationRunTermination {
  reason: 'completed' | 'failed' | 'user_cancelled' | 'deadline_exceeded';
  component?: 'automation' | 'agent_turn' | 'tool' | 'mcp' | 'process';
  componentName?: string;
  cancellationConfirmed: boolean;
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
  conversationMode: AutomationConversationMode;
  delivery: AutomationDeliveryPolicy;
  reliability?: AutomationReliability;
  management?: AutomationManagement;
  state: AutomationState;
  createdAtMs: number;
  updatedAtMs: number;
}

export type AutomationRunStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
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
  conversationId?: string;
  workflowRunId?: string;
  model?: string;
  deadlineAtMs?: number;
  currentPhase?: AutomationRunPhase;
  cancelRequestedAtMs?: number;
  cancelConfirmedAtMs?: number;
  termination?: AutomationRunTermination;
  heartbeatAtMs?: number;
  leaseOwner?: string;
  leaseExpiresAtMs?: number;
  attemptNumber?: number;
  rootRunId?: string;
  readAtMs?: number;
}

export type AutomationRunEventType =
  | 'run.queued'
  | 'run.started'
  | 'run.deadline_resolved'
  | 'run.cancel_requested'
  | 'run.cancel_confirmed'
  | 'run.cancellation_unconfirmed'
  | 'run.recovered'
  | 'action.started'
  | 'action.retry_scheduled'
  | 'action.completed'
  | 'action.failed'
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
  id?: string;
  type: string;
  source?: string;
  schemaVersion?: number;
  subject?: { kind: string; id: string };
  payload?: Record<string, unknown>;
  occurredAtMs?: number;
  correlationId?: string;
  causationId?: string;
  rootEventId?: string;
  chainDepth?: number;
  dedupeKey?: string;
  trust?: 'system' | 'user' | 'connector' | 'untrusted_webhook';
}

export interface AutomationEventEnvelope extends AutomationEvent {
  id: string;
  source: string;
  schemaVersion: number;
  occurredAtMs: number;
  ingestedAtMs: number;
  correlationId: string;
  rootEventId: string;
  chainDepth: number;
  trust: 'system' | 'user' | 'connector' | 'untrusted_webhook';
  payload: Record<string, unknown>;
}

export type AutomationEventProjectionStatus =
  | 'pending'
  | 'projecting'
  | 'retrying'
  | 'projected'
  | 'dead_letter';

export type AutomationEventDeliveryStatus =
  | 'pending'
  | 'retrying'
  | 'queued'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped'
  | 'dead_letter';

export interface AutomationEventRecord {
  event: AutomationEventEnvelope;
  projectionStatus: AutomationEventProjectionStatus;
  projectionAttempts: number;
  projectionError?: string;
  deliveries: Array<{
    automationId: string;
    status: AutomationEventDeliveryStatus;
    runId?: string;
    attempts: number;
    lastError?: string;
  }>;
}

export interface AutomationResultDeliveryRecord {
  runId: string;
  destinationKey: string;
  kind: string;
  status: 'pending' | 'delivering' | 'retrying' | 'delivered' | 'dead_letter';
  attempts: number;
  nextAttemptAtMs: number;
  lastError?: string;
  createdAtMs: number;
  updatedAtMs: number;
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
  pendingEvents: number;
  oldestPendingEventAgeMs: number;
  projectionDeadLetters: number;
  pendingRunDeliveries: number;
  runDeliveryDeadLetters: number;
  pendingResultDeliveries: number;
  resultDeliveryDeadLetters: number;
  activeExecutions: number;
  activeDeliveryLeases: number;
}

export type AutomationArtifact =
  | { id: string; kind: 'text'; text: string; mediaType: 'text/plain' | 'text/markdown' }
  | { id: string; kind: 'json'; schema: string; data: Record<string, unknown> }
  | { id: string; kind: 'file'; uri: string; name: string; mediaType: string; bytes?: number; sha256?: string }
  | { id: string; kind: 'card'; schema: string; data: Record<string, unknown> }
  | { id: string; kind: 'reference'; resourceType: string; resourceId: string; url?: string };

export interface AutomationResultEnvelope {
  schemaVersion: 1;
  resultId: string;
  runId: string;
  automationId: string;
  status: Extract<AutomationRunStatus, 'succeeded' | 'failed' | 'cancelled' | 'timeout'>;
  summary?: string;
  error?: { code: string; message: string; retryable: boolean };
  artifacts: AutomationArtifact[];
  correlationId: string;
  rootEventId: string;
  createdAtMs: number;
  completedAtMs: number;
}

export type AutomationRetrySafety =
  | { mode: 'never' }
  | { mode: 'idempotent'; key: 'run_id' }
  | { mode: 'transient_only'; classify: (error: unknown) => boolean };

export interface PrepareAutomationAgentSessionInput {
  automationName?: string;
  conversationId: string;
  projectId?: string;
  agentId: string;
  peerId: string;
  automationId: string;
  runId: string;
}

export interface AutomationDeps {
  agentService?: {
    sessionConfig?: {
      applyAutomationWorkingDirectory?: (conversationId: string, workingDirectory: string | undefined) => Promise<void>;
      applyAutomationModelOverride?: (conversationId: string, model: string | undefined) => Promise<boolean>;
    };
    turnDispatcher?: {
      processDirect: (
        message: string,
        conversationId: string,
        origin: TurnOrigin,
        attachments?: unknown[],
        thinking?: string,
        options?: { signal?: AbortSignal; runId?: string; deadlineAtMs?: number },
      ) => Promise<string>;
    };
    getModelForSession?: (conversationId: string) => string | undefined;
  };
  getDefaultAgentId?: () => string;
  prepareAgentSession?: (input: PrepareAutomationAgentSessionInput) => Promise<void>;
  workflowRunService?: WorkflowRunServiceLike;
  browserAutomationService?: {
    runAndWait(
      automationId: string,
      inputs: Record<string, unknown>,
      signal?: AbortSignal,
      context?: { triggerEvent?: AutomationEvent },
    ): Promise<{
      id: string;
      status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
      result?: unknown;
      error?: string;
    }>;
  };
  onRunCompleted?: (run: AutomationRun, context: AutomationRunDeliveryContext) => void | Promise<void>;
  onEvent?: (event: AutomationEventEnvelope, signal?: AbortSignal) => void | Promise<void>;
  onReliabilityAttention?: (input: {
    phase: 'event_projection' | 'event_delivery' | 'result_delivery';
    eventId?: string;
    automationId?: string;
    runId?: string;
    destinationKey?: string;
    error: string;
  }) => void;
  executeTaskCommand?: (input: {
    taskId: string;
    idempotencyKey: string;
    command: TaskCommand;
    triggerEvent?: AutomationEvent;
  }) => { ok: boolean; reason?: string; runId?: string };
  executeSystemAction?: (input: {
    capability: Extract<AutomationAction, { kind: 'system' }>['capability'];
    automationId: string;
    runId: string;
  }) => Promise<{ summary?: string }> | { summary?: string };
}

export interface AutomationActionTask {
  status: 'succeeded' | 'failed' | 'timeout' | 'cancelled';
  summary?: string;
  error?: string;
  conversationId?: string;
  workflowRunId?: string;
  model?: string;
  deadlineAtMs?: number;
  termination?: AutomationRunTermination;
  artifacts?: AutomationArtifact[];
}

export interface AutomationActionExecutionHooks {
  onRunPatch?: (patch: Partial<AutomationRun>) => void | Promise<void>;
}

export interface AutomationActionExecutionContext {
  triggerEvent?: AutomationEvent;
}
