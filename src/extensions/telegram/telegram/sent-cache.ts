/**
 * Sent Message Cache
 * 
 * Tracks message IDs sent by the bot for:
 * - Reaction filtering (don't react to own messages)
 * - Message editing/deletion
 * - Session context tracking
 */

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  messageIds: Set<number>;
  timestamps: Map<number, number>; // messageId -> timestamp
}

export interface SentMessageCacheOptions {
  /** Time-to-live in milliseconds */
  ttlMs?: number;
  /** Cleanup threshold - cleanup when size exceeds this */
  cleanupThreshold?: number;
}

export class SentMessageCache {
  private cache = new Map<string, CacheEntry>();
  private ttlMs: number;
  private cleanupThreshold: number;

  constructor(options: SentMessageCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.cleanupThreshold = options.cleanupThreshold ?? 100;
  }

  private getChatKey(chatId: number | string): string {
    return String(chatId);
  }

  /**
   * Record a message ID as sent by the bot
   */
  record(chatId: number | string, messageId: number): void {
    const key = this.getChatKey(chatId);
    let entry = this.cache.get(key);
    
    if (!entry) {
      entry = { messageIds: new Set(), timestamps: new Map() };
      this.cache.set(key, entry);
    }

    entry.messageIds.add(messageId);
    entry.timestamps.set(messageId, Date.now());

    // Periodic cleanup
    if (entry.messageIds.size > this.cleanupThreshold) {
      this.cleanupEntry(entry);
    }
  }

  /**
   * Check if a message was sent by the bot
   */
  wasSentByBot(chatId: number | string, messageId: number): boolean {
    const key = this.getChatKey(chatId);
    const entry = this.cache.get(key);
    
    if (!entry) {
      return false;
    }

    // Clean up expired entries on read
    this.cleanupEntry(entry);
    
    return entry.messageIds.has(messageId);
  }

  /**
   * Clean up expired entries in a chat entry
   */
  private cleanupEntry(entry: CacheEntry): void {
    const now = Date.now();
    for (const [msgId, timestamp] of entry.timestamps) {
      if (now - timestamp > this.ttlMs) {
        entry.messageIds.delete(msgId);
        entry.timestamps.delete(msgId);
      }
    }
  }

  /**
   * Clear all entries for a chat
   */
  clearChat(chatId: number | string): void {
    this.cache.delete(this.getChatKey(chatId));
  }

  /**
   * Clear all entries (for testing)
   */
  clearAll(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): { 
    totalChats: number; 
    totalMessages: number;
    oldestMessageAt?: Date;
    newestMessageAt?: Date;
  } {
    let totalMessages = 0;
    let oldestTimestamp = Infinity;
    let newestTimestamp = 0;

    for (const entry of this.cache.values()) {
      totalMessages += entry.messageIds.size;
      
      for (const timestamp of entry.timestamps.values()) {
        if (timestamp < oldestTimestamp) oldestTimestamp = timestamp;
        if (timestamp > newestTimestamp) newestTimestamp = timestamp;
      }
    }

    return {
      totalChats: this.cache.size,
      totalMessages,
      oldestMessageAt: oldestTimestamp !== Infinity ? new Date(oldestTimestamp) : undefined,
      newestMessageAt: newestTimestamp > 0 ? new Date(newestTimestamp) : undefined,
    };
  }
}

// Singleton instance for the application
export const sentMessageCache = new SentMessageCache({
  ttlMs: DEFAULT_TTL_MS,
  cleanupThreshold: 100,
});
