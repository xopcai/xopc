import { randomUUID } from 'node:crypto';

import { createLogger } from '../utils/logger.js';
import type { SceneExecutionService } from './execution.js';
import type { SceneRepository } from './repository.js';

const log = createLogger('SceneRuntime');

/** Single-Gateway pump. Durable occurrence, lease and budget rules remain in the domain. */
export class SceneRuntime {
  private readonly worker = `scene:${randomUUID()}`;
  private controller = new AbortController();
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopping?: Promise<void>;

  constructor(private readonly repository: SceneRepository, private readonly execution: SceneExecutionService,
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
    if (this.running) return this.running;
    const signal = this.controller.signal;
    const run = this.execution.runNext(this.worker, signal).then(() => undefined);
    this.running = run;
    try { await run; } finally { if (this.running === run) this.running = undefined; }
  }

  /** Cancels the active read/model call before the host closes SQLite. */
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.controller.abort(new Error('Scene runtime stopped'));
    const stopped = (this.running ?? Promise.resolve()).then(() => undefined, (err) => {
      log.warn({ err, phase: 'scene_stop' }, 'Scene run stopped with an error');
    });
    this.stopping = stopped;
    void stopped.finally(() => { if (this.stopping === stopped) this.stopping = undefined; });
    return stopped;
  }
}
