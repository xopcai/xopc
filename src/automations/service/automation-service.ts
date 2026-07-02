import { randomUUID } from 'node:crypto';

import { createLogger } from '../../utils/logger.js';
import {
  computeNextAutomationRunAtMs,
  timerDelayUntil,
} from '../domain/schedule.js';
import type {
  Automation,
  AutomationDeps,
  AutomationMetrics,
  AutomationRun,
  AutomationRunStatus,
} from '../domain/types.js';
import {
  CreateAutomationSchema,
  UpdateAutomationSchema,
  type CreateAutomationInput,
  type UpdateAutomationInput,
  AutomationSchema,
} from '../domain/validation.js';
import {
  deleteAutomation,
  getAutomation,
  getAutomationRun,
  listAutomationRuns,
  listAutomations,
  saveAutomation,
  saveAutomationRun,
  saveAutomations,
} from '../storage/index.js';
import { AutomationActionExecutor } from './action-executor.js';

const log = createLogger('AutomationService');

type TimerHandle = ReturnType<typeof setTimeout> & { unref?: () => void };

const DEFAULT_MAX_CONCURRENT_RUNS = 5;
const MISSED_RUN_STAGGER_MS = 5_000;

export class AutomationAlreadyRunningError extends Error {
  constructor(readonly automationId: string, readonly runningRunId?: string) {
    super(`Automation is already running: ${automationId}`);
    this.name = 'AutomationAlreadyRunningError';
  }
}

export class AutomationService {
  private readonly executor = new AutomationActionExecutor();
  private timer: TimerHandle | null = null;
  private stopped = true;
  private runningScheduler = false;
  private deps: AutomationDeps = {};
  private maxConcurrentRuns = DEFAULT_MAX_CONCURRENT_RUNS;
  private readonly activeRuns = new Map<string, AbortController>();

  setDeps(deps: AutomationDeps): void {
    this.deps = { ...this.deps, ...deps };
    this.executor.setDeps(this.deps);
  }

  async initialize(options?: { maxConcurrentRuns?: number }): Promise<void> {
    this.maxConcurrentRuns = Math.max(1, Math.floor(options?.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS));
    this.stopped = false;
    await this.recomputeNextRuns({ catchUp: true });
    this.armTimer();
    log.info('Automation service initialized');
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const controller of this.activeRuns.values()) {
      controller.abort();
    }
    log.info('Automation service stopped');
  }

  async create(input: CreateAutomationInput): Promise<Automation> {
    const parsed = CreateAutomationSchema.parse(input);
    const now = Date.now();
    const automation = AutomationSchema.parse({
      ...parsed,
      id: parsed.id?.trim() || randomUUID().slice(0, 12),
      enabled: parsed.enabled ?? true,
      afterRun: parsed.afterRun ?? { kind: 'none' },
      state: parsed.state ?? {},
      createdAtMs: now,
      updatedAtMs: now,
    }) as Automation;
    automation.state.nextRunAtMs = computeNextAutomationRunAtMs(automation, now);
    saveAutomation(automation);
    this.armTimer();
    return automation;
  }

  async list(): Promise<Automation[]> {
    return listAutomations();
  }

  async get(id: string): Promise<Automation | null> {
    return getAutomation(id);
  }

  async update(id: string, patch: UpdateAutomationInput): Promise<Automation | null> {
    const parsed = UpdateAutomationSchema.parse(patch);
    const current = getAutomation(id);
    if (!current) return null;
    const now = Date.now();
    const next = AutomationSchema.parse({
      ...current,
      ...parsed,
      id: current.id,
      createdAtMs: current.createdAtMs,
      updatedAtMs: now,
      state: {
        ...current.state,
        ...(parsed.state ?? {}),
      },
    }) as Automation;
    if ('enabled' in parsed || 'trigger' in parsed) {
      next.state.nextRunAtMs = computeNextAutomationRunAtMs(next, now);
    }
    saveAutomation(next);
    this.armTimer();
    return next;
  }

  async remove(id: string): Promise<boolean> {
    const automation = getAutomation(id);
    if (automation?.state.runningRunId) {
      this.activeRuns.get(automation.state.runningRunId)?.abort();
    }
    const removed = deleteAutomation(id);
    if (removed) {
      this.armTimer();
    }
    return removed;
  }

  async pause(id: string): Promise<Automation | null> {
    return this.update(id, { enabled: false });
  }

  async resume(id: string): Promise<Automation | null> {
    return this.update(id, { enabled: true });
  }

  async runNow(id: string): Promise<AutomationRun> {
    const automation = getAutomation(id);
    if (!automation) throw new Error(`Automation not found: ${id}`);
    if (automation.state.runningRunId) {
      throw new AutomationAlreadyRunningError(id, automation.state.runningRunId);
    }
    return this.startRun(automation, { manual: true });
  }

  async listRuns(options?: { automationId?: string; limit?: number }): Promise<AutomationRun[]> {
    return listAutomationRuns(options);
  }

  async getRun(runId: string): Promise<AutomationRun | null> {
    return getAutomationRun(runId);
  }

  async cancelRun(runId: string): Promise<boolean> {
    const controller = this.activeRuns.get(runId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  async getMetrics(): Promise<AutomationMetrics> {
    const automations = listAutomations();
    const enabled = automations.filter((automation) => automation.enabled);
    const next = enabled
      .filter((automation) => automation.state.nextRunAtMs != null)
      .toSorted((a, b) => (a.state.nextRunAtMs ?? 0) - (b.state.nextRunAtMs ?? 0))[0];
    const oneHourAgo = Date.now() - 60 * 60_000;
    return {
      totalAutomations: automations.length,
      enabledAutomations: enabled.length,
      runningRuns: this.activeRuns.size,
      failedLastHour: automations.filter(
        (automation) =>
          (automation.state.lastRunStatus === 'failed' || automation.state.lastRunStatus === 'timeout') &&
          (automation.state.lastRunAtMs ?? 0) >= oneHourAgo,
      ).length,
      nextRun: next?.state.nextRunAtMs
        ? {
            automationId: next.id,
            name: next.name,
            runAtMs: next.state.nextRunAtMs,
          }
        : undefined,
    };
  }

  private async recomputeNextRuns(options?: { catchUp?: boolean }): Promise<void> {
    const now = Date.now();
    const automations = listAutomations().map((automation, index) => {
      const next: Automation = {
        ...automation,
        state: { ...automation.state },
      };
      if (next.state.runningRunId) {
        next.state.lastRunStatus = 'failed';
        next.state.lastError = 'Interrupted by gateway restart';
        next.state.consecutiveFailures = (next.state.consecutiveFailures ?? 0) + 1;
        delete next.state.runningRunId;
      }
      const computed = computeNextAutomationRunAtMs(next, now);
      next.state.nextRunAtMs =
        options?.catchUp && computed != null && computed <= now
          ? now + index * MISSED_RUN_STAGGER_MS
          : computed;
      return next;
    });
    saveAutomations(automations);
  }

  private armTimer(): void {
    if (this.stopped) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const next = listAutomations()
      .filter((automation) => automation.enabled && automation.state.nextRunAtMs != null)
      .toSorted((a, b) => (a.state.nextRunAtMs ?? 0) - (b.state.nextRunAtMs ?? 0))[0];
    if (!next?.state.nextRunAtMs) return;
    this.timer = setTimeout(() => {
      void this.onTimer();
    }, timerDelayUntil(next.state.nextRunAtMs)) as TimerHandle;
    this.timer.unref?.();
  }

  private async onTimer(): Promise<void> {
    if (this.stopped) return;
    if (this.runningScheduler) {
      this.armTimer();
      return;
    }
    this.runningScheduler = true;
    try {
      const now = Date.now();
      const due = listAutomations()
        .filter(
          (automation) =>
            automation.enabled &&
            automation.trigger.kind === 'schedule' &&
            automation.state.nextRunAtMs != null &&
            automation.state.nextRunAtMs <= now &&
            !automation.state.runningRunId,
        )
        .slice(0, this.maxConcurrentRuns);
      await Promise.all(due.map((automation) => this.startRun(automation, { manual: false })));
    } finally {
      this.runningScheduler = false;
      this.armTimer();
    }
  }

  private async startRun(automation: Automation, opts: { manual: boolean }): Promise<AutomationRun> {
    const now = Date.now();
    const run: AutomationRun = {
      id: randomUUID(),
      automationId: automation.id,
      automationName: automation.name,
      status: 'queued',
      triggerSnapshot: automation.trigger,
      actionSnapshot: automation.action,
      manual: opts.manual,
      createdAtMs: now,
    };
    saveAutomationRun(run);
    const nextAutomation: Automation = {
      ...automation,
      state: {
        ...automation.state,
        runningRunId: run.id,
      },
    };
    saveAutomation(nextAutomation);

    void this.executeRun(nextAutomation, run).catch((err) => {
      log.error(
        { err, automationId: automation.id, runId: run.id },
        `Automation run failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    return run;
  }

  private async executeRun(automation: Automation, initialRun: AutomationRun): Promise<void> {
    const controller = new AbortController();
    this.activeRuns.set(initialRun.id, controller);
    const startedAtMs = Date.now();
    let run: AutomationRun = {
      ...initialRun,
      status: 'running',
      startedAtMs,
    };
    saveAutomationRun(run);

    let status: AutomationRunStatus = 'failed';
    let error: string | undefined;
    try {
      const outcome = await this.executor.execute(automation, run, controller.signal);
      status = outcome.status;
      error = outcome.error;
      run = {
        ...run,
        status,
        summary: outcome.summary,
        error,
        sessionKey: outcome.sessionKey,
        workflowRunId: outcome.workflowRunId,
        model: outcome.model,
      };
      if (automation.afterRun?.kind === 'webhook') {
        await this.postAfterRunWebhook(automation.afterRun.url, run);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      status = controller.signal.aborted ? 'cancelled' : 'failed';
      run = { ...run, status, error };
    } finally {
      const endedAtMs = Date.now();
      run = {
        ...run,
        status,
        endedAtMs,
        durationMs: endedAtMs - startedAtMs,
      };
      saveAutomationRun(run);
      this.activeRuns.delete(initialRun.id);
      this.finishAutomationRun(automation.id, status, error, endedAtMs);
    }
  }

  private finishAutomationRun(
    automationId: string,
    status: AutomationRunStatus,
    error: string | undefined,
    finishedAtMs: number,
  ): void {
    const current = getAutomation(automationId);
    if (!current) return;
    const failed = status === 'failed' || status === 'timeout';
    const consecutiveFailures = failed ? (current.state.consecutiveFailures ?? 0) + 1 : 0;
    const disableAfter = current.reliability?.disableAfterConsecutiveFailures;
    const shouldDisable = disableAfter != null && consecutiveFailures >= disableAfter;
    const next: Automation = {
      ...current,
      enabled: shouldDisable ? false : current.enabled,
      state: {
        ...current.state,
        lastRunAtMs: finishedAtMs,
        lastRunStatus: status,
        lastError: error,
        consecutiveFailures,
      },
      updatedAtMs: shouldDisable ? finishedAtMs : current.updatedAtMs,
    };
    delete next.state.runningRunId;
    next.state.nextRunAtMs = computeNextAutomationRunAtMs(next, finishedAtMs);
    saveAutomation(next);
    this.armTimer();
  }

  private async postAfterRunWebhook(url: string, run: AutomationRun): Promise<void> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ run }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Automation webhook failed: HTTP ${response.status}${text ? ` ${text.slice(0, 200)}` : ''}`);
    }
  }
}
