import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { fetchConfiguredModelsCached } from '@/features/chat/api/registry-api';
import type { WorkflowRunInputEnvelope, WorkflowRunSource } from '@/features/workflows/workflow-api';

export class CronApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly runningSessionKey?: string;

  constructor(message: string, details: { status: number; code?: string; runningSessionKey?: string }) {
    super(message);
    this.name = 'CronApiError';
    this.status = details.status;
    this.code = details.code;
    this.runningSessionKey = details.runningSessionKey;
  }
}

export interface CronDelivery {
  mode: 'none' | 'announce' | 'webhook';
  channel?: string;
  to?: string;
  accountId?: string;
  threadId?: string | number;
  bestEffort?: boolean;
}

export type CronSchedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; everyMs: number; anchorMs?: number }
  | { kind: 'cron'; expr: string; tz?: string; staggerMs?: number };

export type CronPayload =
  | { kind: 'systemEvent'; text: string }
  | { kind: 'agentTurn'; message: string; model?: string; timeoutSeconds?: number }
  | CronWorkflowRunPayload;

export interface CronWorkflowRunPayload {
  kind: 'workflowRun';
  definitionId: string;
  input?: unknown;
  inputEnvelope?: WorkflowRunInputEnvelope;
  goal?: string;
  agentId?: string;
  sessionKey?: string;
  /** When omitted or true, cron waits for terminal workflow status (default). */
  waitForCompletion?: boolean;
  source?: Partial<Extract<WorkflowRunSource, { kind: 'cron' }>>;
}

export interface CronJob {
  id: string;
  name: string;
  description?: string;
  schedule: CronSchedule;
  enabled: boolean;
  deleteAfterRun?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  nextRunAtMs?: number;
  sessionTarget?: 'main' | 'isolated' | 'current' | `session:${string}`;
  wakeMode?: 'now' | 'next-heartbeat';
  /** Isolated jobs: agent profile for session key; omit uses the default agent. */
  agentId?: string;
  sessionKey?: string;
  /** Isolated jobs: absolute workspace on gateway host; omit uses the agent default workspace. */
  workingDirectory?: string;
  payload: CronPayload;
  delivery?: CronDelivery;
  failureAlert?: unknown;
  model?: string;
  state?: CronJobState;
}

export interface CronJobState {
  nextRunAtMs?: number;
  runningAtMs?: number;
  runningSessionKey?: string;
  lastRunAtMs?: number;
  lastRunStatus?: 'ok' | 'error' | 'skipped';
  lastError?: string;
  lastDurationMs?: number;
}

export interface CronRunNowResult {
  triggered: boolean;
  job?: CronJob;
  history?: CronJobExecution[];
}

export interface AddJobOptions {
  name?: string;
  description?: string;
  sessionTarget?: 'main' | 'isolated' | 'current' | `session:${string}`;
  wakeMode?: 'now' | 'next-heartbeat';
  agentId?: string;
  sessionKey?: string;
  workingDirectory?: string;
  deleteAfterRun?: boolean;
  delivery?: CronDelivery;
  failureAlert?: unknown;
  payload: CronPayload;
}

export function cronJobBodyText(job: Pick<CronJob, 'payload'>): string {
  const p = job.payload;
  if (p.kind === 'systemEvent') return p.text;
  if (p.kind === 'agentTurn') return p.message;
  return p.goal || p.definitionId;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}

export interface ConfigInfo {
  model?: string;
}

function agentDefaultModelFromGatewayConfig(c: unknown): string {
  if (!c || typeof c !== 'object') return '';
  const agents = (c as { agents?: unknown }).agents;
  if (!agents || typeof agents !== 'object' || Array.isArray(agents)) return '';
  const root = agents as Record<string, unknown>;
  const list = Array.isArray(root.list) ? root.list : [];
  const defaultId = typeof root.default === 'string' && root.default.trim() ? root.default.trim() : '';
  const entry =
    list.find((item) => item && typeof item === 'object' && (item as { id?: unknown }).id === defaultId) ??
    list.find((item) => item && typeof item === 'object');
  if (!entry || typeof entry !== 'object') return '';
  const models = (entry as { models?: unknown }).models;
  if (!models || typeof models !== 'object' || Array.isArray(models)) return '';
  const defaultRole = (models as { defaultRole?: unknown }).defaultRole;
  const roles = (models as { roles?: unknown }).roles;
  if (typeof defaultRole !== 'string' || !roles || typeof roles !== 'object' || Array.isArray(roles)) {
    return '';
  }
  const role = (roles as Record<string, unknown>)[defaultRole];
  if (role && typeof role === 'object' && !Array.isArray(role)) {
    const model = (role as { model?: unknown }).model;
    return typeof model === 'string' ? model.trim() : '';
  }
  return '';
}

export interface ChannelStatus {
  name: string;
  enabled: boolean;
  connected: boolean;
}

export interface SessionChatId {
  channel: string;
  chatId: string;
  lastActive: string;
  accountId?: string;
  peerKind?: string;
  peerId?: string;
}

export interface CronJobExecution {
  id: string;
  jobId: string;
  status: 'running' | 'success' | 'failed' | 'cancelled';
  startedAt: string;
  endedAt?: string;
  duration?: number;
  error?: string;
  output?: string;
  retryCount: number;
  summary?: string;
  sessionKey?: string;
  sessionId?: string;
  sessionType?: string;
  model?: string;
  workflowRunId?: string;
}

export interface CronRunHistoryRow extends CronJobExecution {
  jobName?: string;
}

export interface CronJobUpdate {
  name?: string;
  description?: string;
  schedule?: CronSchedule;
  enabled?: boolean;
  sessionTarget?: 'main' | 'isolated' | 'current' | `session:${string}`;
  wakeMode?: 'now' | 'next-heartbeat';
  agentId?: string;
  sessionKey?: string;
  workingDirectory?: string;
  deleteAfterRun?: boolean;
  delivery?: CronDelivery;
  failureAlert?: unknown;
  payload?: CronPayload;
}

type ServerCronJob = Omit<CronJob, 'nextRunAtMs' | 'model'> & {
  state?: CronJobState;
  model?: string;
};

export function cronExpressionToSchedule(expr: string): CronSchedule {
  return { kind: 'cron', expr: expr.trim() };
}

function normalizeCronJob(job: ServerCronJob): CronJob {
  return {
    ...job,
    nextRunAtMs: job.state?.nextRunAtMs,
    model:
      job.model ??
      (job.payload?.kind === 'agentTurn' && job.payload.model ? job.payload.model : undefined),
  };
}

async function fetchJsonCron<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await apiFetch(input, init);
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    runningSessionKey?: string;
  };
  if (!res.ok) {
    const msg = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`;
    throw new CronApiError(msg, {
      status: res.status,
      code: data.code,
      runningSessionKey: data.runningSessionKey,
    });
  }
  return data as T;
}

export async function listJobs(): Promise<CronJob[]> {
  const result = await fetchJsonCron<{ jobs: ServerCronJob[] }>(apiUrl('/api/cron'));
  return (result.jobs || []).map(normalizeCronJob);
}

export async function getJob(id: string): Promise<CronJob | null> {
  const res = await apiFetch(apiUrl(`/api/cron/${encodeURIComponent(id)}`));
  if (res.status === 404) return null;
  const data = (await res.json().catch(() => ({}))) as { error?: string; job?: ServerCronJob };
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
  }
  return data.job ? normalizeCronJob(data.job) : null;
}

export async function addJob(schedule: CronSchedule, options: AddJobOptions): Promise<{ id: string; schedule: CronSchedule }> {
  return fetchJsonCron(apiUrl('/api/cron'), {
    method: 'POST',
    body: JSON.stringify({ schedule, ...options }),
  });
}

export async function updateJob(id: string, updates: CronJobUpdate): Promise<boolean> {
  const result = await fetchJsonCron<{ updated: boolean }>(apiUrl(`/api/cron/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return result.updated;
}

export async function removeJob(id: string): Promise<boolean> {
  const result = await fetchJsonCron<{ removed: boolean }>(apiUrl(`/api/cron/${encodeURIComponent(id)}`), {
    method: 'DELETE',
  });
  return result.removed;
}

export async function toggleJob(id: string, enabled: boolean): Promise<boolean> {
  const result = await fetchJsonCron<{ toggled: boolean }>(
    apiUrl(`/api/cron/${encodeURIComponent(id)}/toggle`),
    { method: 'POST', body: JSON.stringify({ enabled }) },
  );
  return result.toggled;
}

export async function runJob(id: string): Promise<CronRunNowResult> {
  return await fetchJsonCron<CronRunNowResult>(apiUrl(`/api/cron/${encodeURIComponent(id)}/run`), { method: 'POST' });
}

export async function getHistory(id: string, limit = 10): Promise<CronJobExecution[]> {
  const result = await fetchJsonCron<{ history: CronJobExecution[] }>(
    apiUrl(`/api/cron/${encodeURIComponent(id)}/history?limit=${limit}`),
  );
  return result.history || [];
}

export async function getAllRunsHistory(limit = 40): Promise<CronRunHistoryRow[]> {
  const result = await fetchJsonCron<{ runs: CronRunHistoryRow[] }>(
    apiUrl(`/api/cron/runs/history?limit=${limit}`),
  );
  return result.runs || [];
}

export async function getChannels(): Promise<ChannelStatus[]> {
  const result = await fetchJsonCron<{ ok: boolean; payload: { channels: ChannelStatus[] } }>(
    apiUrl('/api/channels/status'),
  );
  return result.payload?.channels || [];
}

export async function getModels(): Promise<ModelInfo[]> {
  const models = await fetchConfiguredModelsCached();
  // Map ConfiguredModel to ModelInfo (id / name / provider)
  return models.map((m) => ({
    id: m.id,
    name: m.name,
    provider: m.provider,
  }));
}

export async function getConfig(): Promise<ConfigInfo> {
  const result = await fetchJsonCron<{ ok?: boolean; payload?: { config?: unknown } }>(apiUrl('/api/config'));
  const c = result.payload?.config;
  return { model: agentDefaultModelFromGatewayConfig(c) };
}

export async function getSessionChatIds(channel?: string): Promise<SessionChatId[]> {
  const query = channel ? `?channel=${encodeURIComponent(channel)}` : '';
  const result = await fetchJsonCron<{ ok: boolean; payload: { chatIds: SessionChatId[] } }>(
    apiUrl(`/api/sessions/chat-ids${query}`),
  );
  return result.payload?.chatIds || [];
}
