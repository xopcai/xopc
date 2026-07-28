import { apiFetch, formatApiHttpError } from '../api/client';

/** Mobile creates isolated agent-turn jobs only. */
export type CronAgentPayload = {
  kind: 'agentTurn';
  message: string;
};

export type CronJob = {
  id: string;
  name?: string;
  schedule: string;
  enabled: boolean;
  next_run?: string;
  payload?: CronAgentPayload | { kind: string; [key: string]: unknown };
};

export type CronRunRow = {
  id: string;
  jobId: string;
  jobName?: string;
  status: 'running' | 'success' | 'failed' | 'cancelled';
  startedAt: string;
  endedAt?: string;
  duration?: number;
  error?: string;
  summary?: string;
  sessionKey?: string;
  sessionId?: string;
};

type Automation = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: {
    kind: string;
    schedule?: { kind: string; expr?: string };
  };
  action: {
    kind: string;
    instruction?: string;
  };
  state?: {
    nextRunAtMs?: number;
  };
};

type AutomationRun = {
  id: string;
  automationId: string;
  automationName: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timeout';
  createdAtMs: number;
  startedAtMs?: number;
  endedAtMs?: number;
  durationMs?: number;
  error?: string;
  summary?: string;
  sessionKey?: string;
};

export function cronRunSessionKey(run: Pick<CronRunRow, 'sessionKey' | 'sessionId'>): string | null {
  const sk = run.sessionKey?.trim();
  if (sk) return sk;
  const sid = run.sessionId?.trim();
  if (sid) return sid;
  return null;
}

export type CreateCronJobInput = {
  name: string;
  schedule: string;
  message: string;
};

export type UpdateCronJobInput = {
  name?: string;
  schedule?: string;
  message?: string;
};

export const RUNS_HISTORY_LIMIT = 50;

function encId(id: string): string {
  return encodeURIComponent(id);
}

function parseJson(res: Response): Promise<unknown> {
  return res.json().catch(() => ({}));
}

function apiErrorMessage(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const error = (data as { error?: unknown }).error;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : undefined;
  }
  return undefined;
}

async function throwIfNotOk(res: Response): Promise<void> {
  if (res.ok) return;
  const data = await parseJson(res);
  throw new Error(formatApiHttpError(res.status, res.statusText, apiErrorMessage(data)));
}

function isCronJob(x: unknown): x is CronJob {
  if (x == null || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.schedule === 'string' && typeof o.enabled === 'boolean';
}

function isCronRunRow(x: unknown): x is CronRunRow {
  if (x == null || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  const status = o.status;
  return (
    typeof o.id === 'string' &&
    typeof o.jobId === 'string' &&
    typeof o.startedAt === 'string' &&
    (status === 'running' || status === 'success' || status === 'failed' || status === 'cancelled')
  );
}

function isAutomation(x: unknown): x is Automation {
  if (x == null || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.enabled === 'boolean' &&
    o.trigger != null &&
    typeof o.trigger === 'object' &&
    o.action != null &&
    typeof o.action === 'object'
  );
}

function isAutomationRun(x: unknown): x is AutomationRun {
  if (x == null || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.automationId === 'string' &&
    typeof o.automationName === 'string' &&
    typeof o.createdAtMs === 'number' &&
    (o.status === 'queued' ||
      o.status === 'running' ||
      o.status === 'succeeded' ||
      o.status === 'failed' ||
      o.status === 'cancelled' ||
      o.status === 'timeout')
  );
}

function cronJobFromAutomation(automation: Automation): CronJob {
  const schedule =
    automation.trigger.kind === 'schedule' &&
    automation.trigger.schedule?.kind === 'cron' &&
    typeof automation.trigger.schedule.expr === 'string'
      ? automation.trigger.schedule.expr
      : '';
  const payload =
    automation.action.kind === 'agent' && typeof automation.action.instruction === 'string'
      ? { kind: 'agentTurn' as const, message: automation.action.instruction }
      : undefined;

  return {
    id: automation.id,
    name: automation.name,
    schedule,
    enabled: automation.enabled,
    next_run:
      typeof automation.state?.nextRunAtMs === 'number'
        ? new Date(automation.state.nextRunAtMs).toISOString()
        : undefined,
    payload,
  };
}

function cronRunFromAutomationRun(run: AutomationRun): CronRunRow {
  const status: CronRunRow['status'] =
    run.status === 'succeeded'
      ? 'success'
      : run.status === 'queued' || run.status === 'running'
        ? 'running'
        : run.status === 'cancelled'
          ? 'cancelled'
          : 'failed';
  const startedAtMs = run.startedAtMs ?? run.createdAtMs;

  return {
    id: run.id,
    jobId: run.automationId,
    jobName: run.automationName,
    status,
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: typeof run.endedAtMs === 'number' ? new Date(run.endedAtMs).toISOString() : undefined,
    duration: run.durationMs,
    error: run.error,
    summary: run.summary,
    sessionKey: run.sessionKey,
  };
}

export function isEditableCronJob(job: CronJob): job is CronJob & { payload: CronAgentPayload } {
  const payload = job.payload;
  return payload?.kind === 'agentTurn' && typeof payload.message === 'string';
}

export function cronJobMessage(job: Pick<CronJob, 'payload'>): string {
  const payload = job.payload;
  if (payload?.kind === 'agentTurn' && typeof payload.message === 'string') {
    return payload.message.trim();
  }
  return '';
}

function createJobBody(input: CreateCronJobInput) {
  return {
    name: input.name.trim(),
    enabled: true,
    trigger: { kind: 'schedule' as const, schedule: { kind: 'cron' as const, expr: input.schedule } },
    action: { kind: 'agent' as const, instruction: input.message.trim() },
    afterRun: { kind: 'saveToSession' as const },
  };
}

function updateJobBody(input: UpdateCronJobInput) {
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) body.name = input.name.trim();
  if (input.schedule !== undefined) {
    body.trigger = { kind: 'schedule', schedule: { kind: 'cron', expr: input.schedule } };
  }
  if (input.message !== undefined) {
    body.action = { kind: 'agent', instruction: input.message.trim() };
  }
  return body;
}

export async function fetchCronJobs(): Promise<CronJob[]> {
  const res = await apiFetch('/api/automations');
  const data = (await parseJson(res)) as { automations?: unknown };
  if (!res.ok) {
    throw new Error(formatApiHttpError(res.status, res.statusText, apiErrorMessage(data)));
  }
  if (!Array.isArray(data.automations)) return [];
  return data.automations.filter(isAutomation).map(cronJobFromAutomation);
}

export async function fetchCronJob(id: string): Promise<CronJob | null> {
  const res = await apiFetch(`/api/automations/${encId(id)}`);
  const data = (await parseJson(res)) as { automation?: unknown; error?: unknown };
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(formatApiHttpError(res.status, res.statusText, apiErrorMessage(data)));
  }
  return isAutomation(data.automation) ? cronJobFromAutomation(data.automation) : null;
}

export async function createCronJob(input: CreateCronJobInput): Promise<{ id: string }> {
  const res = await apiFetch('/api/automations', {
    method: 'POST',
    body: JSON.stringify(createJobBody(input)),
  });
  const data = (await parseJson(res)) as { automation?: unknown; error?: unknown };
  if (!res.ok) {
    throw new Error(formatApiHttpError(res.status, res.statusText, apiErrorMessage(data)));
  }
  if (!isAutomation(data.automation)) {
    throw new Error('Invalid create response');
  }
  return { id: data.automation.id };
}

export async function updateCronJob(id: string, input: UpdateCronJobInput): Promise<void> {
  const res = await apiFetch(`/api/automations/${encId(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(updateJobBody(input)),
  });
  await throwIfNotOk(res);
}

export async function deleteCronJob(id: string): Promise<void> {
  const res = await apiFetch(`/api/automations/${encId(id)}`, { method: 'DELETE' });
  await throwIfNotOk(res);
}

export async function toggleCronJob(id: string, enabled: boolean): Promise<void> {
  const action = enabled ? 'resume' : 'pause';
  const res = await apiFetch(`/api/automations/${encId(id)}/${action}`, {
    method: 'POST',
  });
  await throwIfNotOk(res);
}

export async function runCronJobNow(id: string): Promise<void> {
  const res = await apiFetch(`/api/automations/${encId(id)}/run`, { method: 'POST' });
  await throwIfNotOk(res);
}

export async function fetchCronRunsHistory(limit = RUNS_HISTORY_LIMIT): Promise<CronRunRow[]> {
  const q = encodeURIComponent(String(limit));
  const res = await apiFetch(`/api/automation-runs?limit=${q}`);
  const data = (await parseJson(res)) as { runs?: unknown };
  if (!res.ok) {
    throw new Error(formatApiHttpError(res.status, res.statusText, apiErrorMessage(data)));
  }
  if (!Array.isArray(data.runs)) return [];
  return data.runs.filter(isAutomationRun).map(cronRunFromAutomationRun);
}
