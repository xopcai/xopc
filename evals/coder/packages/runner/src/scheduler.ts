export interface ScheduledTask<T> {
  id: string;
  resource?: string;
  run(signal: AbortSignal): Promise<T>;
}

export interface ScheduleSnapshot {
  queued: number;
  active: number;
  completed: number;
  failed: number;
  cancelled: number;
  paused: boolean;
}

/** Bounded admission; a resource remains held until the actual task settles. */
export class TaskScheduler {
  private paused = false;
  private wake: (() => void) | undefined;
  private controller = new AbortController();

  constructor(readonly concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
      throw new Error('Concurrency must be an integer from 1 to 32');
    }
  }

  pause(): void { this.paused = true; this.wake?.(); }
  resume(): void { this.paused = false; this.wake?.(); }
  cancel(): void { this.controller.abort(); this.wake?.(); }

  async run<T>(tasks: ScheduledTask<T>[], observe?: (state: ScheduleSnapshot) => void): Promise<PromiseSettledResult<T>[]> {
    if (new Set(tasks.map(task => task.id)).size !== tasks.length) throw new Error('Duplicate task id');
    const results: PromiseSettledResult<T>[] = new Array(tasks.length);
    const pending = tasks.map((task, index) => ({ task, index }));
    const active = new Set<Promise<void>>();
    const resources = new Set<string>();
    let completed = 0;
    let failed = 0;
    let cancelled = 0;
    const emit = () => observe?.({ queued: pending.length, active: active.size, completed, failed, cancelled, paused: this.paused });
    while (pending.length || active.size) {
      if (this.controller.signal.aborted) {
        for (const item of pending.splice(0)) {
          results[item.index] = { status: 'rejected', reason: new Error('Cancelled before admission') };
          cancelled++;
        }
      }
      let available = pending.findIndex(({ task }) => !task.resource || !resources.has(task.resource));
      while (!this.paused && !this.controller.signal.aborted && active.size < this.concurrency && available >= 0) {
        const { task, index } = pending.splice(available, 1)[0]!;
        if (task.resource) resources.add(task.resource);
        const promise = Promise.resolve().then(() => task.run(this.controller.signal)).then(
          value => { results[index] = { status: 'fulfilled', value }; completed++; },
          reason => { results[index] = { status: 'rejected', reason }; failed++; },
        ).finally(() => {
          if (task.resource) resources.delete(task.resource);
          active.delete(promise);
          emit();
          this.wake?.();
        });
        active.add(promise);
        available = pending.findIndex(({ task }) => !task.resource || !resources.has(task.resource));
      }
      emit();
      if (!pending.length && !active.size) break;
      await new Promise<void>(resolve => { this.wake = resolve; });
      this.wake = undefined;
    }
    emit();
    return results;
  }
}
