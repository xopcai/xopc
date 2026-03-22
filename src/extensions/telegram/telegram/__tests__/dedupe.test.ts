/**
 * Telegram Update Deduplication Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DedupeCache, buildTelegramUpdateKey } from '../dedupe.js';

describe('DedupeCache', () => {
  let cache: DedupeCache;

  beforeEach(() => {
    cache = new DedupeCache({ ttlMs: 1000, maxSize: 10 });
  });

  it('should return false for new keys', () => {
    expect(cache.has('key1')).toBe(false);
  });

  it('should return true for existing keys', () => {
    cache.add('key1');
    expect(cache.has('key1')).toBe(true);
  });

  it('should checkAndAdd return false for new key', () => {
    const existed = cache.checkAndAdd('key1');
    expect(existed).toBe(false);
  });

  it('should checkAndAdd return true for existing key', () => {
    cache.checkAndAdd('key1');
    const existed = cache.checkAndAdd('key1');
    expect(existed).toBe(true);
  });

  it('should expire entries after TTL', async () => {
    cache.add('key1');
    expect(cache.has('key1')).toBe(true);
    
    // Wait for TTL to expire
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(cache.has('key1')).toBe(false);
  });

  it('should evict oldest entries when max size reached', () => {
    const smallCache = new DedupeCache({ ttlMs: 10000, maxSize: 3 });
    
    smallCache.add('key1');
    smallCache.add('key2');
    smallCache.add('key3');
    smallCache.add('key4'); // Should evict key1
    
    expect(smallCache.has('key1')).toBe(false);
    expect(smallCache.has('key2')).toBe(true);
    expect(smallCache.has('key3')).toBe(true);
    expect(smallCache.has('key4')).toBe(true);
  });

  it('should clear all entries', () => {
    cache.add('key1');
    cache.add('key2');
    cache.clear();
    expect(cache.has('key1')).toBe(false);
    expect(cache.has('key2')).toBe(false);
  });

  it('should return stats', () => {
    cache.add('key1');
    cache.add('key2');
    const stats = cache.getStats();
    expect(stats.size).toBe(2);
    expect(stats.maxSize).toBe(10);
    expect(stats.ttlMs).toBe(1000);
  });
});

describe('buildTelegramUpdateKey', () => {
  it('should use update_id when available', () => {
    const key = buildTelegramUpdateKey({
      update: { update_id: 12345 }
    });
    expect(key).toBe('update:12345');
  });

  it('should use callback query ID when available', () => {
    const key = buildTelegramUpdateKey({
      callbackQuery: { id: 'callback_123' }
    });
    expect(key).toBe('callback:callback_123');
  });

  it('should use message identifier as fallback', () => {
    const key = buildTelegramUpdateKey({
      update: {
        message: {
          message_id: 100,
          chat: { id: 98765 }
        }
      }
    });
    expect(key).toBe('message:98765:100');
  });

  it('should return undefined for invalid context', () => {
    const key = buildTelegramUpdateKey({});
    expect(key).toBeUndefined();
  });
});
