import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import type { TaskCommand, TaskPhase } from '@xopcai/gateway-contract';

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
      inputEnvelope?: unknown;
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
      capability: 'home.advisor.refresh' | 'memory.temporal_sweep' | 'memory.daily_reconciliation' | 'memory.weekly_knowledge';
    };

export interface AutomationTaskOption {
  id: string;
  title: string;
  projectId?: string;
  phase: TaskPhase;
}

export type AutomationConversationMode = 'new_session' | 'continuous';
export type AutomationNotificationPolicy = 'attention' | 'all' | 'none';
export type AutomationDeliveryDestination =
  | { key: string; kind: 'gateway_event' }
  | { key: string; kind: 'webhook'; endpoint: string; secretId: string }
  | { key: string; kind: 'file'; targetId: string; pathTemplate: string }
  | { key: string; kind: 'card'; channelId: string; templateId: string };

export interface AutomationReliability {
  executionTimeoutSeconds?: number;
  retryCount?: number;
  maxConcurrentRuns?: number;
  disableAfterConsecutiveFailures?: number;
}

export type AutomationSafetyMode = 'suggest_only' | 'ask_before_apply' | 'auto_apply';

export interface AutomationSafetyPolicy {
  mode: AutomationSafetyMode;
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
  delivery: {
    notificationPolicy: AutomationNotificationPolicy;
    destinations: AutomationDeliveryDestination[];
  };
  reliability?: AutomationReliability;
  management?: {
    owner: string;
    editable: Array<'enabled' | 'trigger'>;
    runnable: boolean;
    deletable: boolean;
  };
  state: {
    nextRunAtMs?: number;
    runningRunId?: string;
    lastRunAtMs?: number;
    lastRunStatus?: AutomationRun['status'];
    lastError?: string;
    consecutiveFailures?: number;
  };
  createdAtMs: number;
  updatedAtMs: number;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  automationName: string;
  status: 'queued' | 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled' | 'timeout';
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
  currentPhase?: 'queued' | 'action' | 'cancelling' | 'completed';
  cancelRequestedAtMs?: number;
  cancelConfirmedAtMs?: number;
  termination?: {
    reason: 'completed' | 'failed' | 'user_cancelled' | 'deadline_exceeded';
    component?: 'automation' | 'agent_turn' | 'tool' | 'mcp' | 'process';
    componentName?: string;
    cancellationConfirmed: boolean;
  };
  heartbeatAtMs?: number;
  leaseOwner?: string;
  leaseExpiresAtMs?: number;
  attemptNumber?: number;
  rootRunId?: string;
  readAtMs?: number;
}

export interface AutomationRunEvent {
  id: string;
  runId: string;
  automationId: string;
  type:
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
  message: string;
  data?: unknown;
  createdAtMs: number;
}

export interface AutomationProductEventRun {
  run: AutomationRun;
  triggerEvent: AutomationRunEvent;
}

export interface AutomationEventRecord {
  event: { id: string; type: string; source: string; occurredAtMs: number; ingestedAtMs: number; payload: Record<string, unknown> };
  projectionStatus: 'pending' | 'projecting' | 'retrying' | 'projected' | 'dead_letter';
  projectionAttempts: number;
  projectionError?: string;
  deliveries: Array<{
    automationId: string;
    status: 'pending' | 'retrying' | 'queued' | 'completed' | 'failed' | 'cancelled' | 'skipped' | 'dead_letter';
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

export interface AutomationSimulation {
  triggerSummary: string;
  actionSummary: string;
  safetyNotes: string[];
  requiredConfirmations: string[];
  canRunNow: boolean;
  runNowBlockedReason?: string;
}

export interface AutomationInput {
  name: string;
  description?: string;
  projectId?: string;
  enabled?: boolean;
  trigger: AutomationTrigger;
  action: AutomationAction;
  safety?: AutomationSafetyPolicy;
  conversationMode?: AutomationConversationMode;
  delivery: {
    notificationPolicy: AutomationNotificationPolicy;
    destinations: AutomationDeliveryDestination[];
  };
  reliability?: AutomationReliability;
}

export interface AutomationDraft {
  draftId: string;
  automation: AutomationInput;
  explanation: string;
  assumptions: string[];
  risks: string[];
  simulation: AutomationSimulation;
  repairAttempts: number;
}

export interface AutomationRepairDraft {
  draftId: string;
  patch: Partial<AutomationInput> & { enabled?: boolean };
  explanation: string;
  expectedEffect: string;
  risks: string[];
  requiresApproval: boolean;
  repairAttempts: number;
}

export const automationApi = {
  tasks: () => fetchJson<{
    items: Array<{ task: AutomationTaskOption }>;
  }>(apiUrl('/api/tasks?limit=200')),
  list: (input?: { projectId?: string }) => {
    const params = new URLSearchParams();
    if (input?.projectId) params.set('projectId', input.projectId);
    const suffix = params.toString();
    return fetchJson<{ automations: Automation[] }>(apiUrl(`/api/automations${suffix ? `?${suffix}` : ''}`));
  },
  metrics: () => fetchJson<AutomationMetrics>(apiUrl('/api/automations/metrics')),
  draft: (input: { prompt: string; agentId?: string; language?: 'en' | 'zh' }, idempotencyKey = crypto.randomUUID()) =>
    fetchJson<{ draft: AutomationDraft }>(apiUrl('/api/automations/draft'), {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(input),
    }),
  simulate: (input: AutomationInput) =>
    fetchJson<{ simulation: AutomationSimulation }>(apiUrl('/api/automations/simulate'), {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  create: (input: AutomationInput) =>
    fetchJson<{ automation: Automation }>(apiUrl('/api/automations'), {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: Partial<AutomationInput> & { enabled?: boolean }) =>
    fetchJson<{ automation: Automation }>(apiUrl(`/api/automations/${encodeURIComponent(id)}`), {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    fetchJson<{ removed: boolean }>(apiUrl(`/api/automations/${encodeURIComponent(id)}`), {
      method: 'DELETE',
    }),
  runNow: (id: string) =>
    fetchJson<{ run: AutomationRun }>(apiUrl(`/api/automations/${encodeURIComponent(id)}/run`), {
      method: 'POST',
    }),
  pause: (id: string) =>
    fetchJson<{ automation: Automation }>(apiUrl(`/api/automations/${encodeURIComponent(id)}/pause`), {
      method: 'POST',
    }),
  resume: (id: string) =>
    fetchJson<{ automation: Automation }>(apiUrl(`/api/automations/${encodeURIComponent(id)}/resume`), {
      method: 'POST',
    }),
  runs: (limit = 50, automationId?: string, options?: { projectId?: string }) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (automationId) params.set('automationId', automationId);
    if (!automationId && options?.projectId) params.set('projectId', options.projectId);
    return fetchJson<{ runs: AutomationRun[] }>(apiUrl(`/api/automation-runs?${params.toString()}`));
  },
  productEventRuns: (input: {
    eventType: string;
    source?: string;
    payloadKey?: string;
    payloadValue?: string;
    limit?: number;
  }) => {
    const params = new URLSearchParams({
      eventType: input.eventType,
      limit: String(input.limit ?? 5),
    });
    if (input.source) params.set('source', input.source);
    if (input.payloadKey) params.set('payloadKey', input.payloadKey);
    if (input.payloadValue !== undefined) params.set('payloadValue', input.payloadValue);
    return fetchJson<{ items: AutomationProductEventRun[] }>(
      apiUrl(`/api/automation-runs/product-events?${params.toString()}`),
    );
  },
  events: (input: { type?: string; source?: string; limit?: number } = {}) => {
    const params = new URLSearchParams({ limit: String(input.limit ?? 50) });
    if (input.type) params.set('type', input.type);
    if (input.source) params.set('source', input.source);
    return fetchJson<{ items: AutomationEventRecord[] }>(apiUrl(`/api/automation-events?${params.toString()}`));
  },
  deliveries: (input: { runId?: string; status?: AutomationResultDeliveryRecord['status']; limit?: number } = {}) => {
    const params = new URLSearchParams({ limit: String(input.limit ?? 50) });
    if (input.runId) params.set('runId', input.runId);
    if (input.status) params.set('status', input.status);
    return fetchJson<{ items: AutomationResultDeliveryRecord[] }>(apiUrl(`/api/automation-deliveries?${params.toString()}`));
  },
  runEvents: (runId: string) =>
    fetchJson<{ events: AutomationRunEvent[] }>(apiUrl(`/api/automation-runs/${encodeURIComponent(runId)}/events`)),
  rerun: (runId: string) =>
    fetchJson<{ run: AutomationRun }>(apiUrl(`/api/automation-runs/${encodeURIComponent(runId)}/rerun`), {
      method: 'POST',
    }),
  repairDraft: (runId: string, input: { agentId?: string; language?: 'en' | 'zh' }, idempotencyKey = crypto.randomUUID()) =>
    fetchJson<{ repair: AutomationRepairDraft }>(apiUrl(`/api/automation-runs/${encodeURIComponent(runId)}/repair-draft`), {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(input),
    }),
  cancelRun: (runId: string) =>
    fetchJson<{ cancelled: boolean }>(apiUrl(`/api/automation-runs/${encodeURIComponent(runId)}/cancel`), {
      method: 'POST',
    }),
  markRunRead: (runId: string) =>
    fetchJson<{ marked: true }>(apiUrl(`/api/automation-runs/${encodeURIComponent(runId)}/read`), {
      method: 'POST',
    }),
  markAllRunsRead: (projectId?: string) =>
    fetchJson<{ count: number }>(apiUrl(`/api/automation-runs/read-all${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`), {
      method: 'POST',
    }),
};
