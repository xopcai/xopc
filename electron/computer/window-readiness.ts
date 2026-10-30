async function wait(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** One deadline shared by launch, restore, metadata polling and capture. */
export async function withWindowReadiness<T>(signal: AbortSignal, operation: (signal: AbortSignal,
  poll: <V>(sample: () => Promise<V | undefined>, options?: { intervalMs?: number }) => Promise<V>) => Promise<T>, onWait?: (ms: number) => void, wake?: (signal: AbortSignal, watchdogMs: number) => Promise<void>): Promise<T> {
  const timeout = new AbortController();
  const combined = AbortSignal.any([signal, timeout.signal]);
  const timer = setTimeout(() => timeout.abort(new Error('COMPUTER_WINDOW_READY_TIMEOUT')), 5000);
  let rejectCancelled!: (reason: unknown) => void;
  const cancelled = new Promise<never>((_resolve, reject) => { rejectCancelled = reject; });
  const abort = () => rejectCancelled(combined.reason);
  combined.addEventListener('abort', abort, { once: true });
  const poll = async <V>(sample: () => Promise<V | undefined>, options?: { intervalMs?: number }): Promise<V> => {
    for (let attempt = 0; ; attempt++) {
      combined.throwIfAborted();
      const value = await sample();
      combined.throwIfAborted();
      if (value !== undefined) return value;
      const started = performance.now();
      const cadence = options?.intervalMs === undefined ? [16, 32, 64, 128][attempt] ?? 250
        : Math.max(8, Math.min(250, options.intervalMs));
      try { if (wake) await wake(combined, cadence); else await wait(cadence, combined); }
      finally { onWait?.(performance.now() - started); }
    }
  };
  try {
    combined.throwIfAborted();
    return await Promise.race([operation(combined, poll), cancelled]);
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (timeout.signal.aborted) throw new Error('COMPUTER_WINDOW_READY_TIMEOUT');
    throw error;
  } finally { clearTimeout(timer); combined.removeEventListener('abort', abort); }
}

/** Coalescing wake hints; an early notification cannot be lost between samples. */
export class ReadinessPulse {
  private pending = false;
  private epoch = 0;
  get version(): number { return this.epoch; }
  /** A successful fresh metadata read already covers hints received before it. */
  acknowledge(version: number): boolean {
    if (version !== this.epoch || !this.pending) return false;
    this.pending = false; return true;
  }
  private wake?: () => void;
  notify(): void { this.epoch++; this.pending = true; this.wake?.(); }
  async wait(signal: AbortSignal, watchdogMs: number): Promise<void> {
    signal.throwIfAborted();
    if (this.pending) { this.pending = false; return; }
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: unknown) => {
        clearTimeout(timer); signal.removeEventListener('abort', abort); this.wake = undefined;
        this.pending = false; if (error) reject(error); else resolve();
      };
      const abort = () => finish(signal.reason);
      const timer = setTimeout(() => finish(), watchdogMs);
      this.wake = () => finish(); signal.addEventListener('abort', abort, { once: true });
    });
  }
}
