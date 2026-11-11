/**
 * Inbound Debounce - Message debouncing for inbound traffic
 */

export interface InboundDebounceOptions<T> {
  debounceMs: number;
  buildKey: (item: T) => string | null | undefined;
  shouldDebounce?: (item: T) => boolean;
  resolveDebounceMs?: (item: T) => number | undefined;
  onFlush: (items: T[]) => Promise<void>;
  onError?: (err: unknown, items: T[]) => void;
}

interface DebounceEntry<T> {
  item: T;
  resolve?: () => void;
  reject?: (err: unknown) => void;
}

interface DebounceBuffer<T> {
  items: DebounceEntry<T>[];
  timeout: ReturnType<typeof setTimeout> | null;
  debounceMs: number;
}

export function createInboundDebouncer<T>(options: InboundDebounceOptions<T>) {
  const {
    debounceMs: defaultDebounceMs,
    buildKey,
    shouldDebounce,
    resolveDebounceMs,
    onFlush,
    onError,
  } = options;
  
  const buffers = new Map<string, DebounceBuffer<T>>();
  
  function resolveMs(item: T): number {
    const resolved = resolveDebounceMs?.(item);
    if (typeof resolved === 'number' && Number.isFinite(resolved)) {
      return Math.max(0, Math.trunc(resolved));
    }
    return Math.max(0, Math.trunc(defaultDebounceMs));
  }
  
  async function flushBuffer(key: string, buffer: DebounceBuffer<T>): Promise<void> {
    buffers.delete(key);
    if (buffer.timeout) {
      clearTimeout(buffer.timeout);
      buffer.timeout = null;
    }
    if (buffer.items.length === 0) return;
    await process(buffer.items);
  }
  
  async function flushKey(key: string): Promise<void> {
    const buffer = buffers.get(key);
    if (!buffer) return;
    await flushBuffer(key, buffer);
  }
  
  function scheduleFlush(key: string, buffer: DebounceBuffer<T>): void {
    if (buffer.timeout) clearTimeout(buffer.timeout);
    buffer.timeout = setTimeout(() => { void flushBuffer(key, buffer); }, buffer.debounceMs);
    buffer.timeout.unref?.();
  }
  
  async function process(entries: DebounceEntry<T>[]): Promise<void> {
    const items = entries.map(entry => entry.item);
    try {
      await onFlush(items);
      for (const entry of entries) entry.resolve?.();
    } catch (err) {
      for (const entry of entries) entry.reject?.(err);
      onError?.(err, items);
    }
  }

  async function enqueueEntry(entry: DebounceEntry<T>): Promise<void> {
    const { item } = entry;
    const key = buildKey(item);
    const debounceMs = resolveMs(item);
    const canDebounce = debounceMs > 0 && (shouldDebounce?.(item) ?? true);

    if (!key || !canDebounce) {
      if (key) await flushKey(key);
      await process([entry]);
      return;
    }

    const buffer = buffers.get(key) ?? { items: [], timeout: null, debounceMs };
    buffer.items.push(entry);
    buffer.debounceMs = debounceMs;
    buffers.set(key, buffer);
    scheduleFlush(key, buffer);
  }

  function enqueue(item: T): Promise<void> {
    return enqueueEntry({ item });
  }

  /** Resolve only after buffered items are dispatched. Used by durable ingress. */
  function enqueueAndWait(item: T): Promise<void> {
    return new Promise((resolve, reject) => {
      void enqueueEntry({ item, resolve, reject }).catch(reject);
    });
  }

  async function flushAll(): Promise<void> {
    const keys = Array.from(buffers.keys());
    await Promise.all(keys.map(key => flushKey(key)));
  }
  
  function getBufferCount(): number {
    return buffers.size;
  }
  
  return { enqueue, enqueueAndWait, flushKey, flushAll, getBufferCount };
}

export function hasControlCommand(text: string): boolean {
  return text.trim().startsWith('/');
}
