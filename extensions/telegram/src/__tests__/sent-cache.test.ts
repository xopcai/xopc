/**
 * Sent Message Cache Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SentMessageCache } from '../sent-cache.js';

describe('SentMessageCache', () => {
  let cache: SentMessageCache;

  beforeEach(() => {
    cache = new SentMessageCache({ ttlMs: 1000, cleanupThreshold: 5 });
  });

  it('should record sent messages', () => {
    cache.record('chat123', 100);
    expect(cache.wasSentByBot('chat123', 100)).toBe(true);
  });

  it('should return false for unknown messages', () => {
    expect(cache.wasSentByBot('chat123', 999)).toBe(false);
  });

  it('should track multiple messages per chat', () => {
    cache.record('chat123', 100);
    cache.record('chat123', 101);
    cache.record('chat123', 102);
    
    expect(cache.wasSentByBot('chat123', 100)).toBe(true);
    expect(cache.wasSentByBot('chat123', 101)).toBe(true);
    expect(cache.wasSentByBot('chat123', 102)).toBe(true);
  });

  it('should track messages per chat separately', () => {
    cache.record('chat123', 100);
    cache.record('chat456', 100);
    
    expect(cache.wasSentByBot('chat123', 100)).toBe(true);
    expect(cache.wasSentByBot('chat456', 100)).toBe(true);
  });

  it('should expire old messages', async () => {
    cache.record('chat123', 100);
    expect(cache.wasSentByBot('chat123', 100)).toBe(true);
    
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(cache.wasSentByBot('chat123', 100)).toBe(false);
  });

  it('should clear specific chat', () => {
    cache.record('chat123', 100);
    cache.record('chat456', 200);
    
    cache.clearChat('chat123');
    
    expect(cache.wasSentByBot('chat123', 100)).toBe(false);
    expect(cache.wasSentByBot('chat456', 200)).toBe(true);
  });

  it('should clear all chats', () => {
    cache.record('chat123', 100);
    cache.record('chat456', 200);
    
    cache.clearAll();
    
    expect(cache.wasSentByBot('chat123', 100)).toBe(false);
    expect(cache.wasSentByBot('chat456', 200)).toBe(false);
  });

  it('should return stats', () => {
    cache.record('chat123', 100);
    cache.record('chat123', 101);
    cache.record('chat456', 200);
    
    const stats = cache.getStats();
    expect(stats.totalChats).toBe(2);
    expect(stats.totalMessages).toBe(3);
    expect(stats.oldestMessageAt).toBeInstanceOf(Date);
    expect(stats.newestMessageAt).toBeInstanceOf(Date);
  });

  it('should handle number and string chat IDs', () => {
    cache.record(123456, 100);
    cache.record('123456', 101);
    
    // Both should be treated as same chat
    expect(cache.wasSentByBot(123456, 100)).toBe(true);
    expect(cache.wasSentByBot('123456', 101)).toBe(true);
  });
});
