type Waiting = { key: string; start: () => void; signal?: AbortSignal; abort: () => void };

/** Shared limits across batches and callers; queued cancellation never consumes a permit. */
export class DataScheduler {
  private readonly running = new Map<string, number>();
  private readonly queue: Waiting[] = [];
  private active = 0;

  constructor(private readonly totalLimit = 8, private readonly resourceLimit = 4) {}

  run<T>(key: string, signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T> {
    signal?.throwIfAborted();
    return new Promise<T>((resolve, reject) => {
      const item: Waiting = {
        key, signal,
        abort: () => {
          const index = this.queue.indexOf(item);
          if (index !== -1) this.queue.splice(index, 1);
          reject(signal?.reason ?? new Error('Data operation cancelled'));
        },
        start: () => {
          signal?.removeEventListener('abort', item.abort);
          this.active++;
          this.running.set(key, (this.running.get(key) ?? 0) + 1);
          Promise.resolve().then(() => {
            signal?.throwIfAborted();
            return task();
          }).then(resolve, reject).finally(() => {
            this.active--;
            const count = (this.running.get(key) ?? 1) - 1;
            if (count) this.running.set(key, count);
            else this.running.delete(key);
            this.drain();
          });
        },
      };
      signal?.addEventListener('abort', item.abort, { once: true });
      this.queue.push(item);
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < this.totalLimit) {
      const index = this.queue.findIndex(item => (this.running.get(item.key) ?? 0) < this.resourceLimit);
      if (index === -1) return;
      this.queue.splice(index, 1)[0]!.start();
    }
  }
}

export const dataScheduler = new DataScheduler();
