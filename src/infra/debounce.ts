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

interface DebounceBuffer<T> {
  items: T[];
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
    try {
      await onFlush(buffer.items);
    } catch (err) {
      onError?.(err, buffer.items);
    }
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
  
  async function enqueue(item: T): Promise<void> {
    const key = buildKey(item);
    const debounceMs = resolveMs(item);
    const canDebounce = debounceMs > 0 && (shouldDebounce?.(item) ?? true);
    
    if (!canDebounce) {
      if (key && buffers.has(key)) await flushKey(key);
      try { await onFlush([item]); } catch (err) { onError?.(err, [item]); }
      return;
    }
    
    if (!key) {
      try { await onFlush([item]); } catch (err) { onError?.(err, [item]); }
      return;
    }
    
    const existing = buffers.get(key);
    if (existing) {
      existing.items.push(item);
      existing.debounceMs = debounceMs;
      scheduleFlush(key, existing);
    } else {
      const buffer: DebounceBuffer<T> = { items: [item], timeout: null, debounceMs };
      buffers.set(key, buffer);
      scheduleFlush(key, buffer);
    }
  }
  
  async function flushAll(): Promise<void> {
    const keys = Array.from(buffers.keys());
    await Promise.all(keys.map(key => flushKey(key)));
  }
  
  function getBufferCount(): number {
    return buffers.size;
  }
  
  return { enqueue, flushKey, flushAll, getBufferCount };
}

export function hasControlCommand(text: string): boolean {
  return text.trim().startsWith('/');
}
