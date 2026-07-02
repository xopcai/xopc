import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type AutomationSchedule =
  | { kind: 'once'; at: string }
  | { kind: 'interval'; everyMs: number; anchorMs?: number }
  | { kind: 'cron'; expr: string; tz?: string };

export type AutomationTrigger =
  | { kind: 'manual' }
  | { kind: 'schedule'; schedule: AutomationSchedule }
  | { kind: 'webhook'; secretId?: string };

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
      goal?: string;
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

export interface Automation {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  action: AutomationAction;
  afterRun?: AutomationAfterRun;
  reliability?: AutomationReliability;
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
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timeout';
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

export interface AutomationInput {
  name: string;
  description?: string;
  enabled?: boolean;
  trigger: AutomationTrigger;
  action: AutomationAction;
  afterRun?: AutomationAfterRun;
  reliability?: AutomationReliability;
}

export const automationApi = {
  list: () => fetchJson<{ automations: Automation[] }>(apiUrl('/api/automations')),
  metrics: () => fetchJson<AutomationMetrics>(apiUrl('/api/automations/metrics')),
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
  runs: (limit = 50, automationId?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (automationId) params.set('automationId', automationId);
    return fetchJson<{ runs: AutomationRun[] }>(apiUrl(`/api/automation-runs?${params.toString()}`));
  },
  cancelRun: (runId: string) =>
    fetchJson<{ cancelled: boolean }>(apiUrl(`/api/automation-runs/${encodeURIComponent(runId)}/cancel`), {
      method: 'POST',
    }),
};

