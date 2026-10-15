import { randomUUID } from 'node:crypto';

import { createLogger } from '../utils/logger.js';

import {
  claimNextDiscussionCapture,
  getDiscussionCapture,
  releaseDiscussionWorkLease,
  renewDiscussionWorkLease,
} from './repository.js';
import { failOrRetryProcessing, resetProcessingRetry, withProcessingDeadline } from './processing.js';
import type { DiscussionCapture } from './types.js';

const log = createLogger('DiscussionOrganizerWorker');

export interface DiscussionOrganizerProcessor {
  process(capture: DiscussionCapture, owner: string, signal?: AbortSignal): Promise<DiscussionCapture>;
}

export class DiscussionOrganizerWorker {
  private readonly owner = randomUUID();
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopping = false;
  private controller?: AbortController;

  constructor(
    private readonly processor: DiscussionOrganizerProcessor,
    private readonly onUpdated?: (capture: DiscussionCapture) => void,
    private readonly intervalMs = 1_000,
    private readonly requestTimeoutMs = 10 * 60_000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.stopping = false;
    this.timer = setInterval(() => void this.tick().catch(error => log.error({ err: error }, 'Discussion organizer tick failed')), this.intervalMs);
    this.timer.unref();
    void this.tick().catch(error => log.error({ err: error }, 'Discussion organizer tick failed'));
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.controller?.abort(new Error('Discussion processing stopped'));
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  async tick(): Promise<void> {
    if (this.running || this.stopping) return;
    this.running = true;
    try {
      const capture = claimNextDiscussionCapture(this.owner);
      if (!capture) return;
      const controller = new AbortController();
      this.controller = controller;
      const renewal = setInterval(() => { if (!renewDiscussionWorkLease(capture.id, this.owner)) controller.abort(); }, 30_000);
      renewal.unref();
      try {
        await withProcessingDeadline(signal => this.processor.process(capture, this.owner, signal), controller.signal, this.requestTimeoutMs);
        resetProcessingRetry(capture.id);
        releaseDiscussionWorkLease(capture.id, this.owner);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const ownsLease = renewDiscussionWorkLease(capture.id, this.owner);
        releaseDiscussionWorkLease(capture.id, this.owner);
        const current = getDiscussionCapture(capture.id);
        const updated = ownsLease && !controller.signal.aborted && current
          ? failOrRetryProcessing(current, 'organization', error) : null;
        if (updated) this.onUpdated?.(updated);
        log.warn({ err: error, discussionId: capture.id }, `Discussion organization failed: ${message}`);
      } finally { clearInterval(renewal); this.controller = undefined; }
    } finally {
      this.running = false;
    }
  }
}
