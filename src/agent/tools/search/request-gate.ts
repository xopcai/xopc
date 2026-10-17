import { setTimeout as delay } from 'node:timers/promises';

export class SearchRateLimitError extends Error {
  readonly status = 429;
  constructor(readonly retryAfterMs: number) { super('Search upstream rate limit exceeded'); }
}

/** Process-wide callers share a gate, including when credentials belong to one account. */
export class SearchRequestGate {
  private nextStartAt = 0;
  private cooldownUntil = 0;
  private pending = 0;

  cooldown(ms: number): void {
    this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + ms);
  }

  async wait(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.pending >= 8) throw new SearchRateLimitError(1_000);
    this.pending++;
    const queuedAt = Date.now();
    try {
      while (true) {
        signal?.throwIfAborted();
        const now = Date.now();
        const waitMs = Math.max(0, this.nextStartAt - now, this.cooldownUntil - now);
        if (now - queuedAt + waitMs > 2_000) throw new SearchRateLimitError(waitMs || 250);
        if (!waitMs) {
          this.nextStartAt = now + 250;
          return;
        }
        await delay(waitMs, undefined, { signal });
        // Recheck the actual start time after waking; event-loop stalls must not cause bursts.
      }
    } finally { this.pending--; }
  }
}
