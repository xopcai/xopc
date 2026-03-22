/**
 * Update Deduplication
 * 
 * Prevents processing duplicate Telegram updates.
 * Telegram may occasionally send the same update multiple times.
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_SIZE = 2000;

interface CacheEntry {
  timestamp: number;
}

export interface DedupeCacheOptions {
  /** Time-to-live in milliseconds */
  ttlMs?: number;
  /** Maximum cache size */
  maxSize?: number;
}

export class DedupeCache {
  private cache = new Map<string, CacheEntry>();
  private ttlMs: number;
  private maxSize: number;

  constructor(options: DedupeCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: string): boolean {
    this.cleanup();
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Add key to cache
   */
  add(key: string): void {
    this.cleanup();
    
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    
    this.cache.set(key, { timestamp: Date.now() });
  }

  /**
   * Check and add atomically - returns true if was already seen
   */
  checkAndAdd(key: string): boolean {
    if (this.has(key)) {
      return true;
    }
    this.add(key);
    return false;
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.ttlMs) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache stats
   */
  getStats(): { size: number; maxSize: number; ttlMs: number } {
    this.cleanup();
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
    };
  }
}

/**
 * Build a unique key for a Telegram update
 */
export function buildTelegramUpdateKey(ctx: {
  update?: {
    update_id?: number;
    message?: { message_id?: number; chat?: { id?: number } };
  };
  callbackQuery?: { id?: string };
}): string | undefined {
  // Use update_id if available (most reliable)
  const updateId = ctx.update?.update_id;
  if (typeof updateId === 'number') {
    return `update:${updateId}`;
  }

  // Use callback query ID
  const callbackId = ctx.callbackQuery?.id;
  if (callbackId) {
    return `callback:${callbackId}`;
  }

  // Fall back to message identifier
  const msg = ctx.update?.message;
  const chatId = msg?.chat?.id;
  const messageId = msg?.message_id;
  if (typeof chatId === 'number' && typeof messageId === 'number') {
    return `message:${chatId}:${messageId}`;
  }

  return undefined;
}

// Singleton instance for the application
export const telegramUpdateDedupe = new DedupeCache({
  ttlMs: DEFAULT_TTL_MS,
  maxSize: DEFAULT_MAX_SIZE,
});
