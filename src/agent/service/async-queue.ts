/**
 * Async FIFO queue with `for await` support.
 *
 * Replaces the ad-hoc `eventQueue + resolveWaiting` single-slot pattern that
 * the streaming direct turn used to manage run events. The previous pattern was
 * lossy if two pushes landed before the single waiter resumed; this queue buffers
 * until consumed, supports an explicit bound, and drains cleanly on close.
 */
export interface AsyncQueueOptions<T> {
  /** Maximum buffer size. Lossy events are evicted; critical-only overflow fails fast. */
  maxBuffered?: number;
  isDroppable?: (value: T) => boolean;
}

export class AsyncQueueOverflowError extends Error {
  constructor(readonly maxBuffered: number) {
    super(`Async queue exceeded its ${maxBuffered}-event buffer`);
    this.name = 'AsyncQueueOverflowError';
  }
}

export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private readonly waiters: Array<(value: T | typeof CLOSE_SENTINEL) => void> = [];
  private closed = false;
  private dropped = 0;

  constructor(private readonly options: AsyncQueueOptions<T> = {}) {}

  /** Push a value to the queue. No-op when the queue is closed. */
  push(value: T): boolean {
    if (this.closed) {
      return false;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(value);
      return true;
    }

    const maxBuffered = this.options.maxBuffered;
    if (maxBuffered && this.buffer.length >= maxBuffered) {
      const droppableIndex = this.options.isDroppable
        ? this.buffer.findIndex(this.options.isDroppable)
        : -1;
      if (droppableIndex >= 0) {
        this.buffer.splice(droppableIndex, 1);
        this.dropped += 1;
      } else if (this.options.isDroppable?.(value)) {
        this.dropped += 1;
        return false;
      } else {
        throw new AsyncQueueOverflowError(maxBuffered);
      }
    }
    this.buffer.push(value);
    return true;
  }

  get droppedCount(): number {
    return this.dropped;
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
