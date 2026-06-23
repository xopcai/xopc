import { randomUUID } from 'node:crypto';

import { createLogger } from '../utils/logger.js';
import type { Config } from '../config/schema.js';
import { DEFAULT_AGENT_ID, normalizeAgentId } from '../agent/agent-scope.js';
import { buildSessionKey } from '../routing/session-key.js';
import {
  deleteCronJob,
  getCronJob,
  listCronJobs,
  saveCronJob,
  saveCronJobs,
} from '../storage/sqlite/index.js';
import { DefaultJobExecutor } from './executor.js';
import { CronRunLogStore } from './run-log-store.js';
import {
  computeNextRunAtMs,
  describeSchedule,
  timerDelayUntil,
} from './schedule.js';
import type {
  AddJobOptions,
  CronHealth,
  CronJobCreate,
  CronJobPatch,
  CronMetrics,
  CronRunHistoryRow,
  JobData,
  JobExecution,
  JobExecutorDeps,
} from './types.js';
import {
  AddJobRequestSchema,
  JobDataSchema,
  UpdateJobRequestSchema,
} from './validation.js';

const log = createLogger('CronService');

export interface CronServiceConfig {
  dbPath?: string;
  agentService?: unknown;
  messageBus?: unknown;
  maxConcurrentJobs?: number;
  missedJobStaggerMs?: number;
}

type TimerHandle = ReturnType<typeof setTimeout> & { unref?: () => void };

const DEFAULT_MAX_CONCURRENT_JOBS = 5;
const DEFAULT_MISSED_JOB_STAGGER_MS = 5_000;

export class CronJobAlreadyRunningError extends Error {
  readonly jobId: string;
  readonly runningSessionKey?: string;

  constructor(jobId: string, runningSessionKey?: string) {
    super(`Job is already running: ${jobId}`);
    this.name = 'CronJobAlreadyRunningError';
    this.jobId = jobId;
    this.runningSessionKey = runningSessionKey;
  }
}

export interface CronJobRunNowResult {
  job: JobData;
  history: JobExecution[];
}

function nowMs(): number {
  return Date.now();
}

function runStatusFromExecution(status: JobExecution['status']): 'ok' | 'error' | 'skipped' {
  if (status === 'success') return 'ok';
  if (status === 'cancelled' || status === 'skipped') return 'skipped';
  return 'error';
}

async function postFailureWebhook(url: string, payload: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Cron failure webhook failed: HTTP ${res.status}${text ? ` ${text.slice(0, 200)}` : ''}`);
  }
}

function inferJobName(input: Pick<CronJobCreate, 'name' | 'payload' | 'schedule'>): string {
  if (input.name?.trim()) return input.name.trim();
  if (input.payload.kind === 'agentTurn') return input.payload.message.slice(0, 60) || 'Agent task';
  if (input.payload.kind === 'systemEvent') return input.payload.text.slice(0, 60) || 'System event';
  if (input.payload.kind === 'workflowRun') return `Workflow ${input.payload.definitionId}`;
  if (input.payload.kind === 'goalContinue') return `Goal ${input.payload.goalId}`;
  return describeSchedule(input.schedule);
}

function resolveRunningSessionKey(job: JobData, deps: JobExecutorDeps): string | undefined {
  if (job.payload.kind !== 'agentTurn') return undefined;
  if (job.sessionTarget.startsWith('session:')) {
    return job.sessionTarget.slice('session:'.length).trim() || undefined;
  }
  if (job.sessionTarget === 'current') {
    return job.sessionKey?.trim() || undefined;
  }
  if (job.sessionTarget !== 'isolated') {
    return undefined;
  }
  const aid = job.agentId?.trim();
  const fallbackAgentId = deps.getDefaultCronAgentId?.() ?? DEFAULT_AGENT_ID;
  return buildSessionKey({
    agentId: normalizeAgentId(aid || fallbackAgentId),
    source: 'cron',
    accountId: 'default',
    peerKind: 'dm',
    peerId: `${job.id}-${randomUUID().slice(0, 8)}`,
  });
}

export class CronService {
  private executor = new DefaultJobExecutor();
  private runLogStore: CronRunLogStore;
  private initialized = false;
  private stopped = false;
  private running = false;
  private timer: TimerHandle | null = null;
  private deps: JobExecutorDeps = {};
  private maxConcurrentJobs: number;
  private missedJobStaggerMs: number;

  constructor(config?: CronServiceConfig) {
    this.runLogStore = new CronRunLogStore(config?.dbPath);
    this.executor.setRunLogStore(this.runLogStore);
    this.maxConcurrentJobs = Math.max(1, Math.floor(config?.maxConcurrentJobs ?? DEFAULT_MAX_CONCURRENT_JOBS));
    this.missedJobStaggerMs = Math.max(0, Math.floor(config?.missedJobStaggerMs ?? DEFAULT_MISSED_JOB_STAGGER_MS));
    if (config?.agentService || config?.messageBus) {
      this.setDeps({ agentService: config.agentService, messageBus: config.messageBus });
    }
  }

  setDeps(deps: JobExecutorDeps): void {
    this.deps = { ...this.deps, ...deps };
    this.executor.setDeps(this.deps);
    log.debug('CronService dependencies set');
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.stopped = false;
    await this.recomputeAllNextRuns({ catchUp: true });
    this.initialized = true;
    this.armTimer();
    log.info('CronService initialized');
  }

  async addJob(scheduleOrInput: AddJobOptions['schedule'], options?: Omit<AddJobOptions, 'schedule'>): Promise<{ id: string; schedule: AddJobOptions['schedule'] }> {
    const raw = options ? { ...options, schedule: scheduleOrInput } : scheduleOrInput;
    const parsed = AddJobRequestSchema.parse(raw) as AddJobOptions;
    const ts = nowMs();
    const id = parsed.id?.trim() || randomUUID().slice(0, 12);
    const job = JobDataSchema.parse({
      ...parsed,
      id,
      name: inferJobName(parsed),
      enabled: parsed.enabled ?? true,
      deleteAfterRun: parsed.deleteAfterRun ?? parsed.schedule.kind === 'at',
      createdAtMs: ts,
      updatedAtMs: ts,
      sessionTarget: parsed.sessionTarget ?? (parsed.payload.kind === 'systemEvent' ? 'main' : 'isolated'),
      wakeMode: parsed.wakeMode ?? 'now',
      state: {
        ...(parsed.state ?? {}),
      },
    }) as JobData;
    job.state.nextRunAtMs = computeNextRunAtMs(job, ts);
    saveCronJob(job);
    this.armTimer();
    log.info({ jobId: job.id, name: job.name, schedule: job.schedule }, 'Cron job added');
    return { id: job.id, schedule: job.schedule };
  }

  async listJobs(): Promise<JobData[]> {
    return listCronJobs();
  }

  async getJob(id: string): Promise<JobData | null> {
    return getCronJob(id);
  }

  async updateJob(id: string, updates: CronJobPatch): Promise<boolean> {
    const parsed = UpdateJobRequestSchema.parse(updates) as CronJobPatch;
    const current = getCronJob(id);
    if (!current) return false;
    const ts = nowMs();
    const next = JobDataSchema.parse({
      ...current,
      ...parsed,
      id: current.id,
      createdAtMs: current.createdAtMs,
      updatedAtMs: ts,
      state: {
        ...current.state,
        ...(parsed.state ?? {}),
      },
    }) as JobData;
    if ('schedule' in parsed || 'enabled' in parsed) {
      next.state.nextRunAtMs = computeNextRunAtMs(next, ts);
      delete next.state.runningAtMs;
    }
    if ('agentId' in updates && updates.agentId?.trim() === '') {
      delete next.agentId;
    }
    if ('workingDirectory' in updates && updates.workingDirectory?.trim() === '') {
      delete next.workingDirectory;
    }
    saveCronJob(next);
    this.armTimer();
    log.info({ jobId: id }, 'Cron job updated');
    return true;
  }

  async removeJob(id: string): Promise<boolean> {
    const removed = deleteCronJob(id);
    if (removed) {
      this.executor.cancelJob(id);
      await this.runLogStore.deleteJobRuns(id);
      this.armTimer();
      log.info({ jobId: id }, 'Cron job removed');
    }
    return removed;
  }

  async toggleJob(id: string, enabled: boolean): Promise<boolean> {
    return this.updateJob(id, { enabled });
  }

  async getJobHistory(jobId: string, limit?: number): Promise<JobExecution[]> {
    return this.runLogStore.readJobHistory(jobId, Math.min(Math.max(limit ?? 10, 1), 500));
  }

  async getAllRunsHistory(limit?: number): Promise<CronRunHistoryRow[]> {
    const cap = Math.min(Math.max(limit ?? 50, 1), 500);
    const jobs = listCronJobs();
    const names = new Map(jobs.map((job) => [job.id, job.name] as const));
    return this.runLogStore.readAllRuns(cap, names);
  }

  async getMetrics(): Promise<CronMetrics> {
    const jobs = listCronJobs();
    const enabled = jobs.filter((job) => job.enabled);
    const next = enabled
      .filter((job) => job.state.nextRunAtMs != null)
      .toSorted((a, b) => (a.state.nextRunAtMs ?? 0) - (b.state.nextRunAtMs ?? 0))[0];
    return {
      totalJobs: jobs.length,
      runningJobs: jobs.filter((job) => job.state.runningAtMs != null).length,
      enabledJobs: enabled.length,
      failedLastHour: jobs.filter(
        (job) => job.state.lastRunStatus === 'error' && (job.state.lastRunAtMs ?? 0) >= nowMs() - 60 * 60_000,
      ).length,
      avgExecutionTime: 0,
      nextScheduledJob: next?.state.nextRunAtMs
        ? { id: next.id, name: next.name, runAt: new Date(next.state.nextRunAtMs) }
        : undefined,
    };
  }

  updateConfig(config: Config): void {
    this.maxConcurrentJobs = Math.max(1, Math.floor(config.cron?.maxConcurrentJobs ?? DEFAULT_MAX_CONCURRENT_JOBS));
    this.armTimer();
  }

  async healthCheck(): Promise<CronHealth> {
    const issues: string[] = [];
    if (!this.initialized) issues.push('Service not initialized');
    for (const job of listCronJobs()) {
      const parsed = JobDataSchema.safeParse(job);
      if (!parsed.success) issues.push(`Job ${job.id} is invalid`);
      if (job.enabled && job.state.nextRunAtMs == null && job.schedule.kind !== 'at') {
        issues.push(`Job ${job.id} has no next run`);
      }
    }
    return {
      status: issues.length === 0 ? 'healthy' : issues.length > 5 ? 'unhealthy' : 'degraded',
      issues,
    };
  }

  async runJobNow(id: string): Promise<CronJobRunNowResult> {
    const job = getCronJob(id);
    if (!job) throw new Error(`Job not found: ${id}`);
    if (job.state.runningAtMs != null) {
      throw new CronJobAlreadyRunningError(id, job.state.runningSessionKey);
    }
    const started = this.startSingleJob(job, { manual: true });
    return { job: started, history: await this.getJobHistory(id, 20) };
  }

  async stop(options?: { waitForRunning?: boolean; timeout?: number }): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const job of listCronJobs()) {
      this.executor.cancelJob(job.id);
    }
    if (options?.waitForRunning) {
      const started = nowMs();
      const timeout = options.timeout ?? 30_000;
      while (nowMs() - started < timeout) {
        if (listCronJobs().every((job) => job.state.runningAtMs == null)) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    log.info('CronService stopped');
  }

  private async recomputeAllNextRuns(opts?: { catchUp?: boolean }): Promise<void> {
    const ts = nowMs();
    const jobs = listCronJobs().map((job, index) => {
      const next = { ...job, state: { ...job.state } };
      if (next.state.runningAtMs != null) {
        next.state.lastRunStatus = 'error';
        next.state.lastError = 'Interrupted by gateway restart';
        next.state.consecutiveErrors = (next.state.consecutiveErrors ?? 0) + 1;
        delete next.state.runningAtMs;
      }
      if (next.enabled) {
        const existingNext = next.state.nextRunAtMs;
        if (opts?.catchUp && existingNext != null && existingNext <= ts) {
          next.state.nextRunAtMs = ts + index * this.missedJobStaggerMs;
        } else {
          next.state.nextRunAtMs = computeNextRunAtMs(next, ts);
        }
      } else {
        next.state.nextRunAtMs = undefined;
      }
      return next;
    });
    saveCronJobs(jobs);
  }

  private armTimer(): void {
    if (this.stopped) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const next = listCronJobs()
      .filter((job) => job.enabled && job.state.nextRunAtMs != null)
      .toSorted((a, b) => (a.state.nextRunAtMs ?? 0) - (b.state.nextRunAtMs ?? 0))[0];
    if (!next?.state.nextRunAtMs) return;
    this.timer = setTimeout(() => {
      void this.onTimer();
    }, timerDelayUntil(next.state.nextRunAtMs)) as TimerHandle;
    this.timer.unref?.();
  }

  private async onTimer(): Promise<void> {
    if (this.stopped) return;
    if (this.running) {
      this.armTimer();
      return;
    }
    this.running = true;
    try {
      const ts = nowMs();
      const jobs = listCronJobs();
      const due = jobs
        .filter((job) => job.enabled && job.state.nextRunAtMs != null && job.state.nextRunAtMs <= ts && job.state.runningAtMs == null)
        .slice(0, this.maxConcurrentJobs);
      if (due.length === 0) return;
      const reserved = due.map((job) => ({
        ...job,
        state: { ...job.state, runningAtMs: ts },
      }));
      saveCronJobs(reserved);
      await Promise.all(reserved.map((job) => this.runSingleJob(job)));
    } finally {
      this.running = false;
      this.armTimer();
    }
  }

  private startSingleJob(job: JobData, opts?: { manual?: boolean }): JobData {
    const started = nowMs();
    const runningSessionKey = resolveRunningSessionKey(job, this.deps);
    const reserved: JobData = {
      ...job,
      state: { ...job.state, runningAtMs: started, ...(runningSessionKey ? { runningSessionKey } : {}) },
    };
    saveCronJob(reserved);
    void this.runReservedJob(reserved, started, runningSessionKey, opts).catch((err) => {
      log.error({ err, jobId: job.id }, `Background cron job failed: ${err instanceof Error ? err.message : String(err)}`);
    });
    return reserved;
  }

  private async runSingleJob(job: JobData, opts?: { manual?: boolean }): Promise<void> {
    const started = nowMs();
    const runningSessionKey = resolveRunningSessionKey(job, this.deps);
    const reserved: JobData = {
      ...job,
      state: { ...job.state, runningAtMs: started, ...(runningSessionKey ? { runningSessionKey } : {}) },
    };
    saveCronJob(reserved);
    await this.runReservedJob(reserved, started, runningSessionKey, opts);
  }

  private async runReservedJob(
    reserved: JobData,
    started: number,
    runningSessionKey: string | undefined,
    opts?: { manual?: boolean },
  ): Promise<void> {
    const controller = new AbortController();
    await this.executor.execute(
      runningSessionKey ? { ...reserved, sessionKey: runningSessionKey } : reserved,
      controller.signal,
      this.deps,
    );
    const latestRun = (await this.getJobHistory(reserved.id, 1))[0];
    const finished = nowMs();
    const status = latestRun ? runStatusFromExecution(latestRun.status) : 'error';
    const latest = getCronJob(reserved.id);
    if (!latest) return;

    const next: JobData = {
      ...latest,
      state: {
        ...latest.state,
        lastRunAtMs: finished,
        lastRunStatus: status,
        lastError: latestRun?.error,
        lastDurationMs: finished - started,
        consecutiveErrors: status === 'error' ? (latest.state.consecutiveErrors ?? 0) + 1 : 0,
        consecutiveSkipped: status === 'skipped' ? (latest.state.consecutiveSkipped ?? 0) + 1 : 0,
        lastDeliveryStatus: latest.delivery?.mode && latest.delivery.mode !== 'none' ? 'unknown' : 'not-requested',
      },
    };
    delete next.state.runningAtMs;
    delete next.state.runningSessionKey;
    if (!opts?.manual && next.deleteAfterRun && status === 'ok') {
      await this.removeJob(next.id);
      return;
    }
    next.state.nextRunAtMs = computeNextRunAtMs(next, finished);
    saveCronJob(next);
    await this.maybeEmitFailureAlert(next);
  }

  private async maybeEmitFailureAlert(job: JobData): Promise<void> {
    if (!job.failureAlert) return;
    if (job.state.lastRunStatus !== 'error') return;
    const threshold = job.failureAlert.after ?? 1;
    if ((job.state.consecutiveErrors ?? 0) < threshold) return;
    const ts = nowMs();
    const cooldownMs = job.failureAlert.cooldownMs ?? 60 * 60_000;
    if (job.state.lastFailureAlertAtMs && ts - job.state.lastFailureAlertAtMs < cooldownMs) return;
    const channel = job.failureAlert.channel || job.delivery?.channel;
    const to = job.failureAlert.to || job.delivery?.to;
    if (!to) return;
    if (job.failureAlert.mode === 'webhook') {
      await postFailureWebhook(to, {
        jobId: job.id,
        jobName: job.name,
        status: job.state.lastRunStatus,
        error: job.state.lastError ?? 'Unknown error',
        consecutiveErrors: job.state.consecutiveErrors ?? 0,
        lastRunAtMs: job.state.lastRunAtMs,
      });
      job.state.lastFailureAlertAtMs = ts;
      saveCronJob(job);
      return;
    }
    if (!this.deps.messageBus || !channel) return;
    await this.deps.messageBus.publishOutbound({
      channel,
      chat_id: to,
      type: 'message',
      content: `Cron job failed: ${job.name}\n${job.state.lastError ?? 'Unknown error'}`,
    });
    job.state.lastFailureAlertAtMs = ts;
    saveCronJob(job);
  }
}
