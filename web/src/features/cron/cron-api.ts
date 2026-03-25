import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { fetchConfiguredModelsCached } from '@/features/chat/registry-api';

export interface CronDelivery {
  mode: 'none' | 'announce' | 'direct';
  channel?: string;
  to?: string;
  bestEffort?: boolean;
}

export interface CronPayload {
  kind: 'systemEvent' | 'agentTurn';
  text?: string;
  message?: string;
  model?: string;
  timeoutSeconds?: number;
}

export interface CronJob {
  id: string;
  name?: string;
  schedule: string;
  enabled: boolean;
  timezone?: string;
  maxRetries: number;
  timeout: number;
  next_run?: string;
  created_at: string;
  updated_at: string;
  sessionTarget?: 'main' | 'isolated';
  payload: CronPayload;
  delivery?: CronDelivery;
  model?: string;
}

export interface AddJobOptions {
  name?: string;
  timezone?: string;
  sessionTarget?: 'main' | 'isolated';
  model?: string;
  delivery?: CronDelivery;
  payload: CronPayload;
}

export function cronJobBodyText(job: Pick<CronJob, 'payload'>): string {
  const p = job.payload;
  if (p.kind === 'systemEvent') return p.text ?? '';
  return p.message ?? '';
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
  const raw = (c as { agents?: { defaults?: { model?: unknown } } }).agents?.defaults?.model;
  if (raw === undefined || raw === null) return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'object' && raw !== null && 'primary' in raw) {
    const p = (raw as { primary?: unknown }).primary;
    return typeof p === 'string' ? p.trim() : '';
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
}

export interface CronRunHistoryRow extends CronJobExecution {
  jobName?: string;
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
    runAt: Date | string;
  };
}

export interface CronJobUpdate {
  name?: string;
  schedule?: string;
  enabled?: boolean;
  timezone?: string;
  maxRetries?: number;
  timeout?: number;
  sessionTarget?: 'main' | 'isolated';
  model?: string;
  delivery?: CronDelivery;
  payload?: CronPayload;
}

async function fetchJsonCron<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await apiFetch(input, init);
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    const msg = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export async function listJobs(): Promise<CronJob[]> {
  const result = await fetchJsonCron<{ jobs: CronJob[] }>(apiUrl('/api/cron'));
  return result.jobs || [];
}

export async function getJob(id: string): Promise<CronJob | null> {
  const res = await apiFetch(apiUrl(`/api/cron/${encodeURIComponent(id)}`));
  if (res.status === 404) return null;
  const data = (await res.json().catch(() => ({}))) as { error?: string; job?: CronJob };
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
  }
  return data.job ?? null;
}

export async function addJob(schedule: string, options: AddJobOptions): Promise<{ id: string; schedule: string }> {
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

export async function runJob(id: string): Promise<void> {
  await fetchJsonCron(apiUrl(`/api/cron/${encodeURIComponent(id)}/run`), { method: 'POST' });
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

export async function getMetrics(): Promise<CronMetrics> {
  return fetchJsonCron<CronMetrics>(apiUrl('/api/cron/metrics'));
}

export async function getChannels(): Promise<ChannelStatus[]> {
  const result = await fetchJsonCron<{ ok: boolean; payload: { channels: ChannelStatus[] } }>(
    apiUrl('/api/channels/status'),
  );
  return result.payload?.channels || [];
}

export async function getModels(): Promise<ModelInfo[]> {
  const models = await fetchConfiguredModelsCached();
  // Map ConfiguredModel to ModelInfo (they have compatible fields)
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
