import { GoalQueueStore } from './goal-queue-store.js';
import { GoalService } from './goal-service.js';
import type { EnqueueGoalRunOptions, GoalQueueItemSnapshot, GoalQueueStatus, GoalRunnerOptions } from './goal-queue-types.js';
import type { GoalWithDetails } from './types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('GoalRunner');

function terminalGoalStatus(status: GoalWithDetails['status']): boolean {
  return status === 'done' || status === 'archived';
}

export class GoalRunner {
  private readonly goals = new GoalService();
  private readonly store = new GoalQueueStore();
  private active = 0;
  private pumpTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: GoalRunnerOptions) {
    this.store.resetRunningToRetry();
    this.schedulePump(0);
  }

  enqueue(goalId: string, options: EnqueueGoalRunOptions = {}): GoalQueueItemSnapshot {
    const item = this.store.enqueue({
      goalId,
      maxRetries: Math.max(0, Math.floor(options.maxRetries ?? this.opts.defaultMaxRetries ?? 2)),
      message: options.message?.trim() || undefined,
      source: options.source ?? 'api',
    });
    this.emit('goal.queue.updated', item);
    this.schedulePump(0);
    return item;
  }

  snapshot(): GoalQueueItemSnapshot[] {
    return this.store.list();
  }

  private schedulePump(delayMs: number): void {
    if (this.pumpTimer) return;
    this.pumpTimer = setTimeout(() => {
      this.pumpTimer = null;
      void this.pump();
    }, delayMs);
  }

  private async pump(): Promise<void> {
    const maxConcurrent = Math.max(1, Math.floor(this.opts.maxConcurrent ?? 1));
    while (this.active < maxConcurrent) {
      const item = this.store.claimNext();
      if (!item) break;
      this.active += 1;
      void this.runItem(item).finally(() => {
        this.active -= 1;
        this.schedulePump(0);
      });
    }

    const nextRetry = this.store.list()
      .filter((item) => item.status === 'retry_waiting' && item.nextRunAt)
      .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))[0];
    if (nextRetry) this.schedulePump(Math.max(0, (nextRetry.nextRunAt ?? Date.now()) - Date.now()));
  }

  private async runItem(item: GoalQueueItemSnapshot): Promise<void> {
    this.emit('goal.queue.updated', item);
    try {
      const goal = this.goals.get(item.goalId);
      if (!goal) {
        this.finish(item, 'failed', 'Goal not found');
        return;
      }
      if (terminalGoalStatus(goal.status)) {
        this.finish(item, 'skipped', `Goal is ${goal.status}`);
        return;
      }
      const activeGoal =
        goal.status === 'paused' || goal.status === 'blocked' || goal.status === 'needs_input'
          ? this.goals.resume(goal.id)
          : goal;
      if (!activeGoal) {
        this.finish(item, 'failed', 'Goal not found');
        return;
      }
      const sessionKey = activeGoal.activeSessionKey ?? (await this.opts.ensureSession(activeGoal));
      item = this.store.setSessionKey(item.id, sessionKey) ?? { ...item, sessionKey };
      if (this.opts.hasActiveRun(sessionKey)) {
        this.retry(item, 'Goal session already has an active run');
        return;
      }
      const message = item.message || activeGoal.nextAction || activeGoal.title;
      await this.opts.runContinuation(sessionKey, message);
      this.finish(item, 'succeeded');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (item.attempts <= item.maxRetries) {
        this.retry(item, message);
      } else {
        this.finish(item, 'failed', message);
      }
    }
  }

  private retry(item: GoalQueueItemSnapshot, error: string): void {
    const base = Math.max(1_000, this.opts.retryBaseMs ?? 5_000);
    item.status = 'retry_waiting';
    item.lastError = error;
    item.nextRunAt = Date.now() + base * 2 ** Math.max(0, item.attempts - 1);
    item = this.store.markRetry(item.id, error, item.nextRunAt) ?? item;
    log.warn({ goalId: item.goalId, attempts: item.attempts, nextRunAt: item.nextRunAt, errorMessage: error }, `Goal run queued for retry: ${error}`);
    this.emit('goal.queue.updated', item);
    this.schedulePump(Math.max(0, item.nextRunAt - Date.now()));
  }

  private finish(item: GoalQueueItemSnapshot, status: GoalQueueStatus, error?: string): void {
    item = this.store.markFinished(item.id, status, error) ?? { ...item, status, finishedAt: Date.now(), lastError: error };
    if (status === 'failed') {
      log.warn({ goalId: item.goalId, attempts: item.attempts, errorMessage: error }, `Goal run failed: ${error}`);
    }
    this.emit('goal.queue.updated', item);
  }

  private emit(type: string, item: GoalQueueItemSnapshot): void {
    this.opts.emit?.(type, { item: { ...item } });
  }
}
