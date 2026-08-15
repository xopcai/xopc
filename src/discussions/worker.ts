import { randomUUID } from 'node:crypto';

import { createLogger } from '../utils/logger.js';

import { claimNextDiscussionCapture, getDiscussionCapture, updateDiscussionCapture } from './repository.js';
import type { DiscussionCapture } from './types.js';

const log = createLogger('DiscussionWorker');
const MAX_ATTEMPTS = 3;

export interface DiscussionWorkerProcessor {
  process(capture: DiscussionCapture, owner: string, signal?: AbortSignal): Promise<DiscussionCapture>;
}

export class DiscussionWorker {
  private readonly owner = randomUUID();
  private timer?: NodeJS.Timeout;
  private running = false;
  private stoppedWaiters: Array<() => void> = [];

  constructor(
    private readonly processor: DiscussionWorkerProcessor,
    private readonly onUpdated?: (capture: DiscussionCapture) => void,
    private readonly intervalMs = 2_000,
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
    if (!this.running) return;
    await new Promise<void>((resolve) => this.stoppedWaiters.push(resolve));
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const capture = claimNextDiscussionCapture(this.owner);
      if (!capture) return;
      this.onUpdated?.(capture);
      try {
        await this.processor.process(capture, this.owner);
      } catch (error) {
        this.failOrRetry(capture.id, error);
      }
    } finally {
      this.running = false;
      const waiters = this.stoppedWaiters.splice(0);
      for (const resolve of waiters) resolve();
    }
  }

  private failOrRetry(id: string, error: unknown): void {
    const current = getDiscussionCapture(id);
    if (!current || current.leaseOwner !== this.owner) return;
    const failedStage = current.processingStage ?? 'final_transcription';
    const exhausted = current.attemptCount >= MAX_ATTEMPTS;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const updated = updateDiscussionCapture(id, {
      status: exhausted ? 'failed' : 'finalizing',
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: exhausted ? undefined : Date.now() + 2 ** current.attemptCount * 1_000,
      lastErrorCode: `${failedStage}_failed`,
      lastErrorMessage: errorMessage.slice(0, 1_000),
    }, [current.status]);
    if (updated) this.onUpdated?.(updated);
    log.warn(
      { err: error, discussionId: id, failedStage, attemptCount: current.attemptCount, exhausted },
      `Discussion ${failedStage} failed: ${errorMessage}`,
    );
  }
}
