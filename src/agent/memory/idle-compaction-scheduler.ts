import { createLogger } from '../../utils/logger.js';

const log = createLogger('IdleCompaction');

export interface IdleCompactionOptions {
  idleMs: number;
  cooldownMs: number;
  timeoutMs: number;
}
export type IdleCompactionOutcome = 'committed' | 'skipped' | 'stale';
type Job = (signal: AbortSignal, isCurrent: () => boolean) => Promise<IdleCompactionOutcome>;
type State = {
  generation: number;
  active: number;
  timer?: ReturnType<typeof setTimeout>;
  controller?: AbortController;
  deadline?: ReturnType<typeof setTimeout>;
  job?: Job;
  options?: IdleCompactionOptions;
  eligibleAt: number;
  queuedAt?: number;
};

/** Generation checks protect commits even when a provider ignores cancellation. */
export class IdleCompactionScheduler {
  private readonly states = new Map<string, State>();
  private running = false;
  private disposed = false;
  private readonly metrics = { committed: 0, skipped: 0, stale: 0, cancelled: 0, failed: 0 };

  getMetrics() { return { ...this.metrics }; }

  interrupt(conversationId: string): void {
    const state = this.states.get(conversationId);
    if (!state) return;
    state.generation++;
    if (state.timer) clearTimeout(state.timer);
    state.timer = undefined;
    state.job = undefined;
    if (state.controller && !state.controller.signal.aborted) {
      this.metrics.cancelled++;
      state.controller.abort();
    }
  }

  beginTurn(conversationId: string): number {
    this.interrupt(conversationId);
    const state = this.states.get(conversationId) ?? { generation: 0, active: 0, eligibleAt: 0 };
    state.active++;
    this.states.set(conversationId, state);
    return state.generation;
  }

  endTurn(conversationId: string, generation: number, job?: Job, options?: IdleCompactionOptions): void {
    const state = this.states.get(conversationId);
    if (!state) return;
    state.active = Math.max(0, state.active - 1);
    if (this.disposed || state.active || state.generation !== generation || !job || !options) return;
    state.job = job;
    state.queuedAt = Date.now();
    state.options = options;
    const delay = Math.max(options.idleMs, state.eligibleAt - Date.now());
    state.timer = setTimeout(() => { state.timer = undefined; this.drain(); }, delay);
    state.timer.unref?.();
  }

  cancelAll(): void {
    for (const id of this.states.keys()) this.interrupt(id);
  }

  dispose(): void {
    this.disposed = true;
    this.cancelAll();
    for (const state of this.states.values()) if (state.deadline) clearTimeout(state.deadline);
    this.states.clear();
  }

  private drain(): void {
    if (this.running || this.disposed) return;
    const entry = [...this.states.entries()].find(([, state]) => state.job && !state.timer && !state.active);
    if (!entry) return;
    const [conversationId, state] = entry;
    const job = state.job!;
    const options = state.options!;
    state.job = undefined;
    const generation = state.generation;
    const controller = new AbortController();
    state.controller = controller;
    const startedAt = Date.now();
    const waitMs = startedAt - (state.queuedAt ?? startedAt);
    const isCurrent = () => !this.disposed && !controller.signal.aborted
      && state.generation === generation && !state.active;
    this.running = true;
    let timeout: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error('Idle compaction deadline exceeded'));
      }, options.timeoutMs);
      state.deadline = timeout;
      timeout.unref?.();
    });
    const operation = Promise.resolve().then(() => job(controller.signal, isCurrent));
    void Promise.race([operation, deadline])
      .then(outcome => {
        this.metrics[outcome]++;
        if (outcome === 'committed') state.eligibleAt = Date.now() + options.cooldownMs;
        const fields = { conversationId, outcome, waitMs, durationMs: Date.now() - startedAt };
        if (outcome === 'skipped') log.debug(fields, 'Idle compaction skipped');
        else log.info(fields, 'Idle compaction finished');
      })
      .catch(err => {
        if (state.generation === generation) {
          this.metrics.failed++;
          state.eligibleAt = Date.now() + options.cooldownMs;
          log.warn({ err, conversationId, durationMs: Date.now() - startedAt }, 'Idle compaction failed; retry deferred');
        }
      })
      .finally(() => {
        clearTimeout(timeout!);
        if (state.deadline === timeout!) state.deadline = undefined;
        if (state.controller === controller) state.controller = undefined;
      });
    const release = () => {
      this.running = false;
      this.drain();
    };
    // An ignored abort may keep the provider request alive, but never blocks a foreground turn.
    void operation.then(release, release);
  }
}
