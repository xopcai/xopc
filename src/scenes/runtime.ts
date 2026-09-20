import { randomUUID } from 'node:crypto';

import { createLogger } from '../utils/logger.js';
import type { SceneExecutionService } from './execution.js';
import type { SceneRepository } from './repository.js';
import type { SceneMailObservationService } from './mailObservations.js';

const log = createLogger('SceneRuntime');

/** Single-Gateway pump. Durable occurrence, lease and budget rules remain in the domain. */
export class SceneRuntime {
  private readonly worker = `scene:${randomUUID()}`;
  private controller = new AbortController();
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private observing?: Promise<void>;
  private observationCursor = '';
  private stopping?: Promise<void>;

  constructor(private readonly repository: SceneRepository, private readonly execution: SceneExecutionService,
    private readonly observations: Pick<SceneMailObservationService, 'scan'>,
    private readonly clock: () => number = Date.now, private readonly intervalMs = 5000) {
    if (!Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 60000) throw new Error('Invalid scene poll interval');
  }

  start(): void {
    if (this.stopping) throw new Error('Scene runtime is stopping');
    if (this.timer) return;
    if (this.controller.signal.aborted) this.controller = new AbortController();
    const poll = () => { void this.tick().catch((err) => log.error({ err, phase: 'scene_poll' }, 'Scene poll failed')); };
    this.timer = setInterval(poll, this.intervalMs);
    this.timer.unref();
    poll();
  }

  /** Ingests due occurrences even when an earlier model call is still running. */
  async tick(): Promise<void> {
    this.controller.signal.throwIfAborted();
    const now = this.clock();
    this.repository.enqueueDueWorkItems(now);
    this.repository.enqueueDueSchedules(now);
    if (!this.observing) this.observe();
    if (this.running) { await Promise.all([this.running, this.observing]); return; }
    const signal = this.controller.signal;
    const run = this.execution.runNext(this.worker, signal).then(() => undefined);
    this.running = run;
    const execution = run.finally(() => { if (this.running === run) this.running = undefined; });
    await Promise.all([execution, this.observing]);
  }

  private observe(): void {
    const controller = new AbortController();
    const outer = this.controller.signal;
    const abort = () => controller.abort(outer.reason);
    outer.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(new Error('Scene mail observation timed out')), 30_000);
    let removeListener = () => {};
    const aborted = new Promise<never>((_, reject) => {
      const listener = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', listener, { once: true });
      removeListener = () => controller.signal.removeEventListener('abort', listener);
    });
    const scan = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return this.observations.scan(controller.signal, this.observationCursor, id => {
        if (!controller.signal.aborted) this.observationCursor = id;
      });
    }).then((result) => {
      controller.signal.throwIfAborted();
      this.observationCursor = result.nextCursor ?? '';
    });
    const observing = Promise.race([scan, aborted]).finally(() => {
      clearTimeout(timeout); removeListener(); outer.removeEventListener('abort', abort);
      if (this.observing === observing) this.observing = undefined;
    });
    this.observing = observing;
  }

  /** Cancels the active read/model call before the host closes SQLite. */
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.controller.abort(new Error('Scene runtime stopped'));
    const stopped = Promise.allSettled([this.running, this.observing]).then(() => undefined);
    this.stopping = stopped;
    void stopped.finally(() => { if (this.stopping === stopped) this.stopping = undefined; });
    return stopped;
  }
}
