/**
 * Media Group Buffer Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MediaGroupBuffer } from '../media-group.js';

describe('MediaGroupBuffer', () => {
  let flushedMessages: any[] = [];
  let buffer: MediaGroupBuffer;

  beforeEach(async () => {
    // Ensure all async operations from previous tests complete
    await new Promise(resolve => setTimeout(resolve, 10));
    flushedMessages = [];
    buffer = new MediaGroupBuffer({
      timeoutMs: 100,
      onFlush: async (messages) => {
        flushedMessages.push(messages);
      }
    });
  });

  afterEach(() => {
    // Clean up any pending timers
    buffer.clear();
  });

  it('should buffer media group messages', async () => {
    const ctx1 = createMockContext({ media_group_id: 'group1', message_id: 1 });
    const ctx2 = createMockContext({ media_group_id: 'group1', message_id: 2 });
    
    const result1 = await buffer.process(ctx1);
    const result2 = await buffer.process(ctx2);
    
    expect(result1).toBe(true); // Buffered
    expect(result2).toBe(true); // Buffered
    expect(flushedMessages).toHaveLength(0); // Not yet flushed
  });

  it('should flush after timeout', async () => {
    const ctx1 = createMockContext({ media_group_id: 'group1', message_id: 1 });
    const ctx2 = createMockContext({ media_group_id: 'group1', message_id: 2 });
    
    await buffer.process(ctx1);
    await buffer.process(ctx2);
    
    // Wait for timeout
    await new Promise(resolve => setTimeout(resolve, 150));
    
    expect(flushedMessages).toHaveLength(1);
    expect(flushedMessages[0]).toHaveLength(2);
  });

  it('should not buffer non-media-group messages', async () => {
    const ctx = createMockContext({ message_id: 1 }); // No media_group_id
    
    const result = await buffer.process(ctx);
    
    expect(result).toBe(false);
  });

  it('should handle multiple media groups separately', async () => {
    const ctx1 = createMockContext({ media_group_id: 'group1', message_id: 1 });
    const ctx2 = createMockContext({ media_group_id: 'group2', message_id: 2 });
    
    await buffer.process(ctx1);
    await buffer.process(ctx2);
    
    await new Promise(resolve => setTimeout(resolve, 150));
    
    expect(flushedMessages).toHaveLength(2);
  });

  it('should flush all on flushAll', async () => {
    const ctx1 = createMockContext({ media_group_id: 'group1', message_id: 1 });
    const ctx2 = createMockContext({ media_group_id: 'group2', message_id: 2 });
    
    await buffer.process(ctx1);
    await buffer.process(ctx2);
    
    await buffer.flushAll();
    
    expect(flushedMessages).toHaveLength(2);
  });

  it('should clear without flushing', async () => {
    const ctx = createMockContext({ media_group_id: 'group1', message_id: 1 });
    
    await buffer.process(ctx);
    buffer.clear();
    
    // Wait for original timeout
    await new Promise(resolve => setTimeout(resolve, 150));
    
    expect(flushedMessages).toHaveLength(0);
    expect(buffer.getStats().pendingGroups).toBe(0);
  });

  it('should return stats', async () => {
    const ctx1 = createMockContext({ media_group_id: 'group1', message_id: 1 });
    const ctx2 = createMockContext({ media_group_id: 'group1', message_id: 2 });
    
    await buffer.process(ctx1);
    await buffer.process(ctx2);
    
    const stats = buffer.getStats();
    expect(stats.pendingGroups).toBe(1);
    expect(stats.totalPendingMessages).toBe(2);
  });
});

function createMockContext(messageOverrides: any) {
  return {
    message: {
      message_id: 1,
      chat: { id: 12345 },
      ...messageOverrides
    },
    chat: { id: 12345 }
  };
}
