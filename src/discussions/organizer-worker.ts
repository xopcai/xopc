import { randomUUID } from 'node:crypto';

import { createLogger } from '../utils/logger.js';

import {
  claimNextDiscussionCapture,
  getDiscussionCapture,
  releaseDiscussionWorkLease,
  updateDiscussionCapture,
} from './repository.js';
import type { DiscussionCapture } from './types.js';

const log = createLogger('DiscussionOrganizerWorker');

export interface DiscussionOrganizerProcessor {
  process(capture: DiscussionCapture, owner: string, signal?: AbortSignal): Promise<DiscussionCapture>;
}

export class DiscussionOrganizerWorker {
  private readonly owner = randomUUID();
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly processor: DiscussionOrganizerProcessor,
    private readonly onUpdated?: (capture: DiscussionCapture) => void,
    private readonly intervalMs = 1_000,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
    void this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const capture = claimNextDiscussionCapture(this.owner);
      if (!capture) return;
      try {
        await this.processor.process(capture, this.owner);
        releaseDiscussionWorkLease(capture.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        releaseDiscussionWorkLease(capture.id);
        const current = getDiscussionCapture(capture.id);
        const updated = current && updateDiscussionCapture(capture.id, {
          status: 'needs_attention',
          failureStage: 'organization',
          failureCode: 'organization_failed',
          failureMessage: message.slice(0, 1_000),
        }, ['organizing']);
        if (updated) this.onUpdated?.(updated);
        log.warn({ err: error, discussionId: capture.id }, `Discussion organization failed: ${message}`);
      }
    } finally {
      this.running = false;
    }
  }
}
