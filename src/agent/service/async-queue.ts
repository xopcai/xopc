/**
 * Async FIFO queue with `for await` support.
 *
 * Replaces the ad-hoc `eventQueue + resolveWaiting` single-slot pattern that
 * the streaming direct turn used to manage SSE events. The previous pattern was
 * lossy if two pushes landed before the single waiter resumed; this queue keeps
 * the buffer growing until consumed, and closes cleanly so the iterator drains.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private readonly waiters: Array<(value: T | typeof CLOSE_SENTINEL) => void> = [];
  private closed = false;

  /** Push a value to the queue. No-op when the queue is closed. */
  push(value: T): void {
    if (this.closed) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(value);
      return;
    }
    this.buffer.push(value);
  }

  /** Close the queue. Pending iterators drain any buffered values and then complete. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()!(CLOSE_SENTINEL);
    }
  }

  /** True if the queue is closed and the internal buffer is drained. */
  get isDrained(): boolean {
    return this.closed && this.buffer.length === 0;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.buffer.length > 0) {
        yield this.buffer.shift()!;
        continue;
      }
      if (this.closed) {
        return;
      }
      const next = await new Promise<T | typeof CLOSE_SENTINEL>((resolve) => {
        this.waiters.push(resolve);
      });
      if (next === CLOSE_SENTINEL) {
        return;
      }
      yield next;
    }
  }
}

const CLOSE_SENTINEL = Symbol('AsyncQueue.close');
