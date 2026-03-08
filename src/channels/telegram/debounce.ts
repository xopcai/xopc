/**
 * Inbound Debounce
 * 
 * Buffers and combines rapid consecutive messages from the same user.
 * Useful when users send multiple short messages in quick succession.
 * 
 * Example:
 *   User: "Hi"
 *   User: "Are you there?"
 *   User: "I have a question"
 *   
 * Becomes:
 *   Combined: "Hi\nAre you there?\nI have a question"
 */

import { createLogger } from '../../utils/logger.js';

const log = createLogger('InboundDebounce');

export interface DebounceOptions {
  /** Debounce window in milliseconds */
  debounceMs?: number;
  /** Maximum combined message length */
  maxCombinedLength?: number;
  /** Maximum number of messages to combine */
  maxMessages?: number;
}

interface DebounceEntry <T>{
  items: T[];
  timer: ReturnType<typeof setTimeout> | null;
}

export interface InboundDebounceConfig<T> {
  /** Debounce window in milliseconds */
  debounceMs: number;
  /** Build a unique key for grouping items */
  buildKey: (item: T) => string | null | undefined;
  /** Check if item should be debounced */
  shouldDebounce?: (item: T) => boolean;
  /** Process flushed items */
  onFlush: (items: T[]) => Promise<void>;
  /** Error handler */
  onError?: (err: unknown, items: T[]) => void;
}

export class InboundDebounce<T> {
  private buffers = new Map<string, DebounceEntry<T>>();
  private config: InboundDebounceConfig<T>;

  constructor(config: InboundDebounceConfig<T>) {
    this.config = config;
  }

  /**
   * Process an item through the debounce buffer
   */
  async process(item: T): Promise<void> {
    const key = this.config.buildKey(item);
    const canDebounce = this.config.debounceMs > 0 && 
      (this.config.shouldDebounce?.(item) ?? true);

    // Can't debounce or no key - process immediately
    if (!canDebounce || !key) {
      // Flush any existing buffer for this key first
      if (key && this.buffers.has(key)) {
        await this.flushKey(key);
      }
      await this.config.onFlush([item]);
      return;
    }

    const existing = this.buffers.get(key);
    if (existing) {
      // Add to existing buffer
      existing.items.push(item);
      this.scheduleFlush(key, existing);
      log.debug({ key, itemCount: existing.items.length }, 'Added to debounce buffer');
      return;
    }

    // Create new buffer
    const entry: DebounceEntry<T> = { items: [item], timer: null };
    this.buffers.set(key, entry);
    this.scheduleFlush(key, entry);
    log.debug({ key }, 'Created new debounce buffer');
  }

  /**
   * Schedule flush for a buffer
   */
  private scheduleFlush(key: string, entry: DebounceEntry<T>): void {
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    
    entry.timer = setTimeout(() => {
      void this.flushKey(key);
    }, this.config.debounceMs);
  }

  /**
   * Flush a specific key's buffer
   */
  async flushKey(key: string): Promise<void> {
    const entry = this.buffers.get(key);
    if (!entry) return;

    this.buffers.delete(key);
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }

    if (entry.items.length === 0) return;

    try {
      await this.config.onFlush(entry.items);
    } catch (err) {
      this.config.onError?.(err, entry.items);
    }
  }

  /**
   * Flush all pending buffers
   */
  async flushAll(): Promise<void> {
    const keys = Array.from(this.buffers.keys());
    await Promise.all(keys.map(key => this.flushKey(key)));
  }

  /**
   * Clear all buffers without processing
   */
  clear(): void {
    for (const entry of this.buffers.values()) {
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
    }
    this.buffers.clear();
  }

  /**
   * Get buffer statistics
   */
  getStats(): {
    pendingBuffers: number;
    totalPendingItems: number;
  } {
    let totalItems = 0;
    for (const entry of this.buffers.values()) {
      totalItems += entry.items.length;
    }
    return {
      pendingBuffers: this.buffers.size,
      totalPendingItems: totalItems,
    };
  }
}

/**
 * Build debounce key for Telegram messages
 * Groups by chat + sender
 */
export function buildTelegramDebounceKey(ctx: {
  chat?: { id?: number };
  from?: { id?: number };
}): string | undefined {
  const chatId = ctx.chat?.id;
  const senderId = ctx.from?.id;
  
  if (typeof chatId !== 'number' || typeof senderId !== 'number') {
    return undefined;
  }
  
  return `${chatId}:${senderId}`;
}
