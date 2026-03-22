/**
 * Inbound Debounce Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InboundDebounce, buildTelegramDebounceKey } from '../debounce.js';

describe('InboundDebounce', () => {
  let flushedItems: any[][] = [];
  let debounce: InboundDebounce<{ id: number; chatId: number; senderId: number }>;

  beforeEach(async () => {
    // Ensure all async operations from previous tests complete
    await new Promise(resolve => setTimeout(resolve, 10));
    flushedItems = [];
    debounce = new InboundDebounce({
      debounceMs: 100,
      buildKey: (item) => `${item.chatId}:${item.senderId}`,
      onFlush: async (items) => {
        flushedItems.push(items);
      }
    });
  });

  afterEach(() => {
    // Clean up any pending timers
    debounce.clear();
  });

  it('should debounce items with same key', async () => {
    await debounce.process({ id: 1, chatId: 100, senderId: 200 });
    await debounce.process({ id: 2, chatId: 100, senderId: 200 });
    await debounce.process({ id: 3, chatId: 100, senderId: 200 });
    
    expect(flushedItems).toHaveLength(0);
    
    await new Promise(resolve => setTimeout(resolve, 150));
    
    expect(flushedItems).toHaveLength(1);
    expect(flushedItems[0]).toHaveLength(3);
  });

  it('should process items with different keys separately', async () => {
    await debounce.process({ id: 1, chatId: 100, senderId: 200 });
    await debounce.process({ id: 2, chatId: 100, senderId: 201 }); // Different sender
    
    await new Promise(resolve => setTimeout(resolve, 150));
    
    expect(flushedItems).toHaveLength(2);
  });

  it('should process immediately when shouldDebounce returns false', async () => {
    const selectiveDebounce = new InboundDebounce({
      debounceMs: 100,
      buildKey: (item) => `key:${item.id}`,
      shouldDebounce: (item) => item.id > 1, // Only debounce id > 1
      onFlush: async (items) => {
        flushedItems.push(items);
      }
    });
    
    await selectiveDebounce.process({ id: 1, chatId: 100, senderId: 200 });
    
    expect(flushedItems).toHaveLength(1);
    expect(flushedItems[0]).toHaveLength(1);
  });

  it('should flush specific key', async () => {
    await debounce.process({ id: 1, chatId: 100, senderId: 200 });
    await debounce.process({ id: 2, chatId: 101, senderId: 201 });
    
    await debounce.flushKey('100:200');
    
    expect(flushedItems).toHaveLength(1);
    expect(flushedItems[0]).toHaveLength(1);
    expect(flushedItems[0][0].id).toBe(1);
  });

  it('should flush all keys', async () => {
    await debounce.process({ id: 1, chatId: 100, senderId: 200 });
    await debounce.process({ id: 2, chatId: 101, senderId: 201 });
    
    await debounce.flushAll();
    
    expect(flushedItems).toHaveLength(2);
  });

  it('should clear without flushing', async () => {
    await debounce.process({ id: 1, chatId: 100, senderId: 200 });
    debounce.clear();
    
    await new Promise(resolve => setTimeout(resolve, 150));
    
    expect(flushedItems).toHaveLength(0);
  });

  it('should handle errors', async () => {
    const errors: any[] = [];
    const errorDebounce = new InboundDebounce({
      debounceMs: 100,
      buildKey: (_item) => 'key',
      onFlush: async () => {
        throw new Error('Test error');
      },
      onError: (err) => {
        errors.push(err);
      }
    });
    
    await errorDebounce.process({ id: 1, chatId: 100, senderId: 200 });
    await new Promise(resolve => setTimeout(resolve, 150));
    
    expect(errors).toHaveLength(1);
  });

  it('should return stats', async () => {
    await debounce.process({ id: 1, chatId: 100, senderId: 200 });
    await debounce.process({ id: 2, chatId: 100, senderId: 200 });
    await debounce.process({ id: 3, chatId: 101, senderId: 201 });
    
    const stats = debounce.getStats();
    expect(stats.pendingBuffers).toBe(2);
    expect(stats.totalPendingItems).toBe(3);
  });
});

describe('buildTelegramDebounceKey', () => {
  it('should build key from chat and sender', () => {
    const key = buildTelegramDebounceKey({
      chat: { id: 12345 },
      from: { id: 67890 }
    });
    expect(key).toBe('12345:67890');
  });

  it('should return undefined for missing chat ID', () => {
    const key = buildTelegramDebounceKey({
      from: { id: 67890 }
    });
    expect(key).toBeUndefined();
  });

  it('should return undefined for missing sender ID', () => {
    const key = buildTelegramDebounceKey({
      chat: { id: 12345 }
    });
    expect(key).toBeUndefined();
  });
});
