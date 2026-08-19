import { randomUUID } from 'node:crypto';

import { createLogger } from '../../utils/logger.js';
import type { ProactiveSignalPublisher } from '../../proactive/events/publisher.js';
import { runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import {
  computeNextAutomationRunAtMs,
  timerDelayUntil,
} from '../domain/schedule.js';
import type {
  Automation,
  AutomationDeps,
  AutomationEvent,
  AutomationMetrics,
  AutomationProductEventRun,
  AutomationRun,
  AutomationRunEvent,
  AutomationRunEventType,
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
  appendAutomationRunEvent,
  deleteAutomation,
  getAutomation,
  getAutomationRun,
  listAutomationRunEvents,
  listAutomationRuns,
  listAutomationRunsForProductEvent,
  listAutomations,
  saveAutomation,
  saveAutomationRun,
  saveAutomations,
  touchAutomationRunLease,
} from '../storage/index.js';
import { AutomationActionExecutor } from './action-executor.js';

const log = createLogger('AutomationService');

type TimerHandle = ReturnType<typeof setTimeout> & { unref?: () => void };

const DEFAULT_MAX_CONCURRENT_RUNS = 5;
const MISSED_RUN_STAGGER_MS = 5_000;
const RUN_HEARTBEAT_INTERVAL_MS = 10_000;
const RUN_LEASE_DURATION_MS = 30_000;
const RETRY_BASE_DELAY_MS = 1_000;

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
  private readonly heartbeatTimers = new Map<string, TimerHandle>();
  private readonly leaseOwner = `automation-service:${process.pid}:${randomUUID()}`;

  constructor(private readonly signals?: ProactiveSignalPublisher) {}

  setDeps(deps: AutomationDeps): void {
    this.deps = { ...this.deps, ...deps };
    this.executor.setDeps(this.deps);
  }

  async initialize(options?: { maxConcurrentRuns?: number }): Promise<void> {
    this.maxConcurrentRuns = Math.max(1, Math.floor(options?.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS));
    this.stopped = false;
    await this.recoverInterruptedRuns();
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
    for (const timer of this.heartbeatTimers.values()) clearInterval(timer);
    this.heartbeatTimers.clear();
    log.info('Automation service stopped');
  }

  async create(input: CreateAutomationInput): Promise<Automation> {
    const parsed = CreateAutomationSchema.parse(input);
    const now = Date.now();
    const automation = AutomationSchema.parse({
      ...parsed,
      id: parsed.id?.trim() || randomUUID().slice(0, 12),
      enabled: parsed.enabled ?? true,
      safety: parsed.safety ?? { mode: 'auto_apply' },
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

  async list(options?: { projectId?: string }): Promise<Automation[]> {
    return listAutomations(options);
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

  async rerunFromRun(runId: string): Promise<AutomationRun> {
    const previous = getAutomationRun(runId);
    if (!previous) throw new Error(`Automation run not found: ${runId}`);
    const automation = getAutomation(previous.automationId);
    if (!automation) throw new Error(`Automation not found: ${previous.automationId}`);
    if (automation.state.runningRunId) {
      throw new AutomationAlreadyRunningError(automation.id, automation.state.runningRunId);
    }
    const triggerEvent = listAutomationRunEvents(runId)
      .map((event) => readAutomationEventFromRunEvent(event))
      .find((event): event is AutomationEvent => event !== null);
    return this.startRun(automation, triggerEvent ? { manual: false, event: triggerEvent } : { manual: true });
  }

  async triggerEvent(event: AutomationEvent): Promise<AutomationRun[]> {
    const normalized: AutomationEvent = {
      ...event,
      occurredAtMs: event.occurredAtMs ?? Date.now(),
    };
    const automations = listAutomations().filter(
      (automation) =>
        automation.enabled &&
        automation.trigger.kind === 'event' &&
        !automation.state.runningRunId &&
        matchesAutomationEvent(automation.trigger, normalized),
    );
    const availableSlots = Math.max(0, this.maxConcurrentRuns - this.activeRuns.size);
    const started: AutomationRun[] = [];
    for (const automation of automations.slice(0, availableSlots)) {
      started.push(await this.startRun(automation, { manual: false, event: normalized }));
    }
    return started;
  }

  async listRuns(options?: { automationId?: string; projectId?: string; limit?: number }): Promise<AutomationRun[]> {
    return listAutomationRuns(options);
  }

  async listRunsForProductEvent(options: {
    eventType: string;
    source?: string;
    payloadKey?: string;
    payloadValue?: string;
    limit?: number;
  }): Promise<AutomationProductEventRun[]> {
    return listAutomationRunsForProductEvent(options);
  }

  async getRun(runId: string): Promise<AutomationRun | null> {
    return getAutomationRun(runId);
  }

  async listRunEvents(runId: string): Promise<AutomationRunEvent[]> {
    return listAutomationRunEvents(runId);
  }

  async cancelRun(runId: string): Promise<boolean> {
    const controller = this.activeRuns.get(runId);
    if (!controller) return false;
    const now = Date.now();
    const current = getAutomationRun(runId);
    if (current && current.status === 'running') {
      const cancelling: AutomationRun = {
        ...current,
        status: 'cancelling',
        currentPhase: 'cancelling',
        cancelRequestedAtMs: now,
      };
      saveAutomationRun(cancelling);
      this.appendRunEvent(cancelling, 'run.cancel_requested', 'Automation cancellation requested', {
        reason: 'user_cancelled',
      });
    }
    controller.abort(new Error('Automation run was cancelled by the user'));
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
      if (next.state.runningRunId && !this.activeRuns.has(next.state.runningRunId)) {
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

  private async startRun(
    automation: Automation,
    opts: { manual: boolean; event?: AutomationEvent },
  ): Promise<AutomationRun> {
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
      attemptNumber: 1,
    };
    run.rootRunId = run.id;
    saveAutomationRun(run);
    this.appendRunEvent(
      run,
      'run.queued',
      opts.event
        ? `Event ${opts.event.type} queued automation`
        : opts.manual
          ? 'Manual run queued'
          : 'Scheduled run queued',
      {
        trigger: automation.trigger,
        actionKind: automation.action.kind,
        safety: automation.safety ?? { mode: 'auto_apply' },
        event: opts.event,
      },
    );
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
      currentPhase: 'action',
      heartbeatAtMs: startedAtMs,
      leaseOwner: this.leaseOwner,
      leaseExpiresAtMs: startedAtMs + RUN_LEASE_DURATION_MS,
    };
    saveAutomationRun(run);
    this.appendRunEvent(run, 'run.started', 'Automation run started');
    const heartbeat = setInterval(() => {
      const now = Date.now();
      touchAutomationRunLease(
        run.id,
        this.leaseOwner,
        now,
        now + RUN_LEASE_DURATION_MS,
      );
    }, RUN_HEARTBEAT_INTERVAL_MS) as TimerHandle;
    heartbeat.unref?.();
    this.heartbeatTimers.set(run.id, heartbeat);

    let status: AutomationRunStatus = 'failed';
    let error: string | undefined;
    let activePhase: 'action' | 'after_run' = 'action';
    try {
      const maxAttempts = Math.max(1, (automation.reliability?.retryCount ?? 0) + 1);
      let task: Awaited<ReturnType<AutomationActionExecutor['execute']>>;
      for (let attempt = 1; ; attempt += 1) {
        run = { ...run, attemptNumber: attempt };
        saveAutomationRun(run);
        this.appendRunEvent(run, 'action.started', `Running ${automation.action.kind} action`, {
          actionKind: automation.action.kind,
          safety: automation.safety ?? { mode: 'auto_apply' },
          attempt,
          maxAttempts,
        });
        task = await this.executor.execute(automation, run, controller.signal, {
          onRunPatch: (patch) => {
            const previousDeadline = run.deadlineAtMs;
            run = { ...run, ...patch };
            saveAutomationRun(run);
            if (patch.deadlineAtMs !== undefined && patch.deadlineAtMs !== previousDeadline) {
              this.appendRunEvent(run, 'run.deadline_resolved', 'Automation deadline resolved', {
                deadlineAtMs: patch.deadlineAtMs,
                timeoutMs: patch.deadlineAtMs - startedAtMs,
              });
            }
          },
        });
        // A timeout consumes the shared automation deadline, so only ordinary
        // failures can start another attempt within the same run.
        const retryable = task.status === 'failed';
        if (!retryable || attempt >= maxAttempts || controller.signal.aborted) break;
        const delayMs = Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), 30_000);
        this.appendRunEvent(run, 'action.retry_scheduled', 'Automation action retry scheduled', {
          attempt,
          nextAttempt: attempt + 1,
          maxAttempts,
          delayMs,
          status: task.status,
          error: task.error,
        });
        await this.waitForRetry(delayMs, controller.signal);
      }
      status = task.status;
      error = task.error;
      const persistedRun = getAutomationRun(run.id);
      if (persistedRun) run = { ...run, ...persistedRun };
      this.appendRunEvent(
        run,
        status === 'succeeded' ? 'action.completed' : 'action.failed',
        status === 'succeeded'
          ? `${automation.action.kind} action completed`
          : `${automation.action.kind} action ${status}`,
        {
          summary: task.summary,
          error: task.error,
          sessionKey: task.sessionKey,
          workflowRunId: task.workflowRunId,
          model: task.model,
        },
      );
      run = {
        ...run,
        status,
        summary: task.summary,
        error,
        sessionKey: task.sessionKey,
        workflowRunId: task.workflowRunId,
        model: task.model,
        deadlineAtMs: task.deadlineAtMs ?? run.deadlineAtMs,
        termination: task.termination ?? (status === 'succeeded'
          ? { reason: 'completed', cancellationConfirmed: true }
          : status === 'failed'
            ? { reason: 'failed', cancellationConfirmed: true }
            : run.termination),
      };
      if (task.termination) {
        const now = Date.now();
        run = {
          ...run,
          currentPhase: 'cancelling',
          cancelRequestedAtMs: run.cancelRequestedAtMs ?? now,
          cancelConfirmedAtMs: task.termination.cancellationConfirmed ? now : undefined,
        };
        this.appendRunEvent(
          run,
          task.termination.cancellationConfirmed ? 'run.cancel_confirmed' : 'run.cancellation_unconfirmed',
          task.termination.cancellationConfirmed
            ? 'Automation cancellation confirmed'
            : 'Automation cancellation was not confirmed within the cleanup grace period',
          { termination: task.termination },
        );
      }
      if ((status === 'timeout' || status === 'cancelled')) {
        // Cancellation must not start new external work after the action stops.
      } else if ((automation.safety?.mode ?? 'auto_apply') !== 'auto_apply' && automation.afterRun?.kind === 'webhook') {
        this.appendRunEvent(run, 'after_run.completed', 'After-run webhook skipped by safety mode', {
          safety: automation.safety ?? { mode: 'auto_apply' },
        });
      } else if (automation.afterRun?.kind === 'webhook') {
        activePhase = 'after_run';
        run = { ...run, currentPhase: 'after_run' };
        saveAutomationRun(run);
        this.appendRunEvent(run, 'after_run.started', 'Calling after-run webhook', {
          url: automation.afterRun.url,
        });
        await this.postAfterRunWebhook(automation.afterRun.url, run, controller.signal);
        this.appendRunEvent(run, 'after_run.completed', 'After-run webhook completed');
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      const deadlineExceeded = run.deadlineAtMs !== undefined && Date.now() >= run.deadlineAtMs;
      status = controller.signal.aborted ? 'cancelled' : deadlineExceeded ? 'timeout' : 'failed';
      this.appendRunEvent(run, activePhase === 'after_run' ? 'after_run.failed' : 'action.failed', `Automation run ${status}`, {
        error,
      });
      run = {
        ...run,
        status,
        error,
        termination: {
          reason: status === 'cancelled'
            ? 'user_cancelled'
            : status === 'timeout'
              ? 'deadline_exceeded'
              : 'failed',
          component: activePhase === 'after_run' ? 'automation' : run.termination?.component,
          cancellationConfirmed: status !== 'cancelled' || controller.signal.aborted,
        },
      };
    } finally {
      const endedAtMs = Date.now();
      run = {
        ...run,
        status,
        endedAtMs,
        durationMs: endedAtMs - startedAtMs,
        currentPhase: 'completed',
      };
      this.activeRuns.delete(initialRun.id);
      const heartbeatTimer = this.heartbeatTimers.get(initialRun.id);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      this.heartbeatTimers.delete(initialRun.id);
      run = {
        ...run,
        heartbeatAtMs: endedAtMs,
        leaseOwner: undefined,
        leaseExpiresAtMs: undefined,
      };
      runSqliteWriteTransaction(() => {
        saveAutomationRun(run);
        this.appendRunEvent(run, 'run.completed', `Automation run ${status}`, { status, durationMs: run.durationMs, error });
        this.finishAutomationRun(automation.id, status, error, endedAtMs);
        if (status === 'failed' || status === 'timeout') {
          this.signals?.publish({
            type: 'automation.run_failed.v1', schemaVersion: 1,
            source: { kind: 'automations', id: automation.id }, subject: { kind: 'automation_run', id: run.id },
            actor: { kind: 'system' }, scope: { workspaceId: 'default' },
            occurredAt: new Date(endedAtMs).toISOString(), dedupeKey: `automation_run:${run.id}:failed`,
            sensitivity: 'personal', payload: { automationId: automation.id, status, error, summary: run.summary, durationMs: run.durationMs },
          });
        }
      });
      try {
        this.deps.onRunCompleted?.(run);
      } catch (err) {
        log.warn({ err, automationId: automation.id, runId: run.id }, 'Automation completion hook failed');
      }
    }
  }

  private async recoverInterruptedRuns(): Promise<void> {
    const recoverable = listAutomationRuns({ limit: 500 })
      .filter((run) => run.status === 'queued' || run.status === 'running' || run.status === 'cancelling');
    for (const run of recoverable) {
      const automation = getAutomation(run.automationId);
      if (run.status === 'queued' && automation) {
        const claimed: Automation = {
          ...automation,
          state: { ...automation.state, runningRunId: run.id },
        };
        saveAutomation(claimed);
        this.appendRunEvent(run, 'run.recovered', 'Queued automation run recovered after restart', {
          previousLeaseOwner: run.leaseOwner,
        });
        void this.executeRun(claimed, run).catch((err) => {
          log.error({ err, runId: run.id }, 'Recovered automation run failed');
        });
        continue;
      }

      const now = Date.now();
      const status: AutomationRunStatus = run.status === 'cancelling' ? 'cancelled' : 'failed';
      const error = run.status === 'cancelling'
        ? 'Cancellation interrupted by gateway restart'
        : 'Automation execution interrupted by gateway restart';
      const recovered: AutomationRun = {
        ...run,
        status,
        error,
        endedAtMs: now,
        durationMs: run.startedAtMs ? now - run.startedAtMs : undefined,
        currentPhase: 'completed',
        heartbeatAtMs: now,
        leaseOwner: undefined,
        leaseExpiresAtMs: undefined,
        termination: {
          reason: status === 'cancelled' ? 'user_cancelled' : 'failed',
          component: 'automation',
          cancellationConfirmed: false,
        },
      };
      saveAutomationRun(recovered);
      this.appendRunEvent(recovered, 'run.recovered', error, {
        previousLeaseOwner: run.leaseOwner,
        previousLeaseExpiresAtMs: run.leaseExpiresAtMs,
      });
      this.appendRunEvent(recovered, 'run.completed', `Automation run ${status}`, { status, error });
      if (automation) this.finishAutomationRun(automation.id, status, error, now);
    }
  }

  private waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, delayMs);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('Automation run was cancelled'));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private appendRunEvent(
    run: Pick<AutomationRun, 'id' | 'automationId'>,
    type: AutomationRunEventType,
    message: string,
    data?: unknown,
  ): void {
    appendAutomationRunEvent({
      id: randomUUID(),
      runId: run.id,
      automationId: run.automationId,
      type,
      message,
      data,
      createdAtMs: Date.now(),
    });
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

  private async postAfterRunWebhook(
    url: string,
    run: AutomationRun,
    signal: AbortSignal,
  ): Promise<void> {
    const remainingMs = run.deadlineAtMs === undefined
      ? 30_000
      : Math.max(1, run.deadlineAtMs - Date.now());
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(remainingMs)]);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ run }),
      signal: requestSignal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Automation webhook failed: HTTP ${response.status}${text ? ` ${text.slice(0, 200)}` : ''}`);
    }
  }
}

function matchesAutomationEvent(
  trigger: Extract<Automation['trigger'], { kind: 'event' }>,
  event: AutomationEvent,
): boolean {
  if (trigger.eventType !== event.type) return false;
  if (trigger.source && trigger.source !== event.source) return false;
  const payloadMatch = trigger.payloadMatch;
  if (!payloadMatch) return true;
  const payload = event.payload ?? {};
  return Object.entries(payloadMatch).every(([key, expected]) => Object.is(payload[key], expected));
}

function readAutomationEventFromRunEvent(event: AutomationRunEvent): AutomationEvent | null {
  if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) return null;
  const raw = (event.data as { event?: unknown }).event;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as Partial<AutomationEvent>;
  if (typeof candidate.type !== 'string' || !candidate.type.trim()) return null;
  return {
    type: candidate.type,
    source: typeof candidate.source === 'string' ? candidate.source : undefined,
    payload: candidate.payload && typeof candidate.payload === 'object' && !Array.isArray(candidate.payload)
      ? candidate.payload as Record<string, unknown>
      : undefined,
    occurredAtMs: typeof candidate.occurredAtMs === 'number' ? candidate.occurredAtMs : undefined,
  };
}
