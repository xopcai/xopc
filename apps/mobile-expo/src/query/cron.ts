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
    schedule: input.schedule,
    name: input.name.trim(),
    sessionTarget: 'isolated' as const,
    delivery: { mode: 'none' as const },
    payload: { kind: 'agentTurn' as const, message: input.message.trim() },
  };
}

function updateJobBody(input: UpdateCronJobInput) {
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) body.name = input.name.trim();
  if (input.schedule !== undefined) body.schedule = input.schedule;
  if (input.message !== undefined) {
    body.payload = { kind: 'agentTurn', message: input.message.trim() };
  }
  return body;
}

export async function fetchCronJobs(): Promise<CronJob[]> {
  const res = await apiFetch('/api/cron');
  const data = (await parseJson(res)) as { jobs?: unknown };
  if (!res.ok) {
    throw new Error(formatApiHttpError(res.status, res.statusText, apiErrorMessage(data)));
  }
  if (!Array.isArray(data.jobs)) return [];
  return data.jobs.filter(isCronJob);
}

export async function fetchCronJob(id: string): Promise<CronJob | null> {
  const res = await apiFetch(`/api/cron/${encId(id)}`);
  const data = (await parseJson(res)) as { job?: unknown; error?: unknown };
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(formatApiHttpError(res.status, res.statusText, apiErrorMessage(data)));
  }
  return isCronJob(data.job) ? data.job : null;
}

export async function createCronJob(input: CreateCronJobInput): Promise<{ id: string }> {
  const res = await apiFetch('/api/cron', {
    method: 'POST',
    body: JSON.stringify(createJobBody(input)),
  });
  const data = (await parseJson(res)) as { id?: unknown; error?: unknown };
  if (!res.ok) {
    throw new Error(formatApiHttpError(res.status, res.statusText, apiErrorMessage(data)));
  }
  if (typeof data.id !== 'string') {
    throw new Error('Invalid create response');
  }
  return { id: data.id };
}

export async function updateCronJob(id: string, input: UpdateCronJobInput): Promise<void> {
  const res = await apiFetch(`/api/cron/${encId(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(updateJobBody(input)),
  });
  await throwIfNotOk(res);
}

export async function deleteCronJob(id: string): Promise<void> {
  const res = await apiFetch(`/api/cron/${encId(id)}`, { method: 'DELETE' });
  await throwIfNotOk(res);
}

export async function toggleCronJob(id: string, enabled: boolean): Promise<void> {
  const res = await apiFetch(`/api/cron/${encId(id)}/toggle`, {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });
  await throwIfNotOk(res);
}

export async function runCronJobNow(id: string): Promise<void> {
  const res = await apiFetch(`/api/cron/${encId(id)}/run`, { method: 'POST' });
  await throwIfNotOk(res);
}

export async function fetchCronRunsHistory(limit = RUNS_HISTORY_LIMIT): Promise<CronRunRow[]> {
  const q = encodeURIComponent(String(limit));
  const res = await apiFetch(`/api/cron/runs/history?limit=${q}`);
  const data = (await parseJson(res)) as { runs?: unknown };
  if (!res.ok) {
    throw new Error(formatApiHttpError(res.status, res.statusText, apiErrorMessage(data)));
  }
  if (!Array.isArray(data.runs)) return [];
  return data.runs.filter(isCronRunRow);
}
