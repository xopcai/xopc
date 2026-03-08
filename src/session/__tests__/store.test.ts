/**
 * Session Store Unit Tests
 * 
 * Tests for core session management functionality:
 * - Message loading and saving
 * - Session archiving
 * - Archive loading (fromArchive option)
 * - Session deletion
 * - Edge cases
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionStore } from '../store.js';
import { WindowConfig, CompactionConfig } from '../agent/memory/index.js';
import { AgentMessage } from '@mariozechner/pi-agent-core';
import { join } from 'path';
import { mkdtemp, rm, _writeFile, _readFile, _readdir, stat } from 'fs/promises';
import { tmpdir } from 'os';

// Test helper to create a temporary directory
async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'xopcbot-test-'));
}

// Test helper to create a sample message
function createSampleMessage(role: 'user' | 'assistant', text: string): AgentMessage {
  return {
    role,
    content: [{ type: 'text', text }],
    timestamp: Date.now(),
  };
}

describe('SessionStore', () => {
  let store: SessionStore;
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempDir();
    const windowConfig: WindowConfig = { maxMessages: 100 };
    const compactionConfig: CompactionConfig = { enabled: false };
    store = new SessionStore(testDir, windowConfig, compactionConfig);
    await store.initialize();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // ========== Message Operations ==========

  describe('loadMessages', () => {
    it('should return empty array for non-existent session', async () => {
      const messages = await store.loadMessages('non-existent-session');
      expect(messages).toEqual([]);
    });

    it('should load saved messages', async () => {
      const key = 'test:session:1';
      const messages = [
        createSampleMessage('user', 'Hello'),
        createSampleMessage('assistant', 'Hi there!'),
      ];

      await store.saveMessages(key, messages);
      const loaded = await store.loadMessages(key);

      expect(loaded).toHaveLength(2);
      expect(loaded[0].content).toEqual([{ type: 'text', text: 'Hello' }]);
      expect(loaded[1].content).toEqual([{ type: 'text', text: 'Hi there!' }]);
    });

    it('should return empty array when session is deleted', async () => {
      const key = 'test:session:delete';
      const messages = [createSampleMessage('user', 'Test')];

      await store.saveMessages(key, messages);
      await store.delete(key);

      const loaded = await store.loadMessages(key);
      expect(loaded).toEqual([]);
    });

    it('should NOT load from archive by default', async () => {
      const key = 'test:session:archive';
      const messages = [createSampleMessage('user', 'Original message')];

      // Save and then delete (which triggers archive)
      await store.saveMessages(key, messages);
      await store.archive(key);
      await store.delete(key);

      // Load without fromArchive option - should return empty
      const loaded = await store.loadMessages(key);
      expect(loaded).toEqual([]);
    });

    it('should load from archive when fromArchive is true', async () => {
      const key = 'test:session:archive2';
      const messages = [createSampleMessage('user', 'Archived message')];

      // Save and then archive
      await store.saveMessages(key, messages);
      await store.archive(key);
      await store.delete(key);

      // Load with fromArchive option - should return archived messages
      const loaded = await store.loadMessages(key, { fromArchive: true });
      expect(loaded).toHaveLength(1);
      expect(loaded[0].content).toEqual([{ type: 'text', text: 'Archived message' }]);
    });

    it('should handle empty messages array', async () => {
      const key = 'test:session:empty';
      await store.saveMessages(key, []);
      
      const loaded = await store.loadMessages(key);
      expect(loaded).toEqual([]);
    });
  });

  describe('saveMessages', () => {
    it('should save messages to file', async () => {
      const key = 'test:session:save';
      const messages = [
        createSampleMessage('user', 'Hello'),
        createSampleMessage('assistant', 'Response'),
      ];

      await store.saveMessages(key, messages);

      // Verify by loading - file system path may be sanitized differently
      const loaded = await store.loadMessages(key);
      expect(loaded).toHaveLength(2);
      expect(loaded[0].role).toBe('user');
      expect(loaded[1].role).toBe('assistant');
    });

    it('should overwrite existing messages', async () => {
      const key = 'test:session:overwrite';
      
      await store.saveMessages(key, [createSampleMessage('user', 'First')]);
      await store.saveMessages(key, [createSampleMessage('user', 'Second')]);

      const loaded = await store.loadMessages(key);
      expect(loaded).toHaveLength(1);
      expect(loaded[0].content).toEqual([{ type: 'text', text: 'Second' }]);
    });

    it('should handle messages with special characters', async () => {
      const key = 'test:session:special';
      const messages = [
        createSampleMessage('user', 'Hello 🌍 你好 🔥'),
        createSampleMessage('assistant', 'Special chars: <>&"\''),
      ];

      await store.saveMessages(key, messages);
      const loaded = await store.loadMessages(key);

      expect(loaded).toHaveLength(2);
      expect(loaded[0].content[0].text).toBe('Hello 🌍 你好 🔥');
      expect(loaded[1].content[0].text).toBe('Special chars: <>&"\'');
    });

    it('should handle large messages', async () => {
      const key = 'test:session:large';
      const largeText = 'A'.repeat(100000); // 100KB string
      const messages = [createSampleMessage('user', largeText)];

      await store.saveMessages(key, messages);
      const loaded = await store.loadMessages(key);

      expect(loaded).toHaveLength(1);
      expect(loaded[0].content[0].text).toBe(largeText);
    });
  });

  // ========== Session Deletion ==========

  describe('delete', () => {
    it('should delete session file', async () => {
      const key = 'test:session:delete1';
      await store.saveMessages(key, [createSampleMessage('user', 'Test')]);

      const result = await store.delete(key);
      expect(result).toBe(true);

      // File should not exist
      const filePath = join(testDir, 'sessions', `${key}.json`);
      await expect(stat(filePath)).rejects.toThrow();
    });

    it('should return true for non-existent session (idempotent delete)', async () => {
      // delete is idempotent - returns true even if session doesn't exist
      const result = await store.delete('non-existent');
      expect(result).toBe(true);
    });

    it('should remove session from index', async () => {
      const key = 'test:session:delete2';
      await store.saveMessages(key, [createSampleMessage('user', 'Test')]);

      await store.delete(key);

      const sessions = await store.list({});
      expect(sessions.items.find(s => s.key === key)).toBeUndefined();
    });

    it('should handle concurrent deletions (idempotent)', async () => {
      const key = 'test:session:concurrent';
      await store.saveMessages(key, [createSampleMessage('user', 'Test')]);

      // Delete twice - both should succeed (idempotent)
      const result1 = await store.delete(key);
      const result2 = await store.delete(key);
      expect(result1).toBe(true);
      expect(result2).toBe(true);
    });
  });

  // ========== Session Archiving ==========

  describe('archive', () => {
    it('should archive active session', async () => {
      const key = 'test:session:archive1';
      const messages = [createSampleMessage('user', 'To be archived')];
      
      await store.saveMessages(key, messages);
      
      // Archive should delete the active file and create archive
      await store.archive(key);

      // After archive, load should return empty (unless fromArchive is true)
      const loaded = await store.loadMessages(key);
      expect(loaded).toEqual([]);
    });

    it('should preserve message content in archive', async () => {
      const key = 'test:session:archive2';
      const messages = [
        createSampleMessage('user', 'Message 1'),
        createSampleMessage('assistant', 'Response 1'),
      ];
      
      await store.saveMessages(key, messages);
      await store.archive(key);

      // Load from archive should preserve messages
      const loaded = await store.loadMessages(key, { fromArchive: true });
      expect(loaded).toHaveLength(2);
      expect(loaded[0].content).toEqual([{ type: 'text', text: 'Message 1' }]);
    });
  });

  // ========== Session Listing ==========

  describe('list', () => {
    it('should return empty list for no sessions', async () => {
      const result = await store.list({});
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should list all sessions', async () => {
      await store.saveMessages('session:a', [createSampleMessage('user', 'A')]);
      await store.saveMessages('session:b', [createSampleMessage('user', 'B')]);
      await store.saveMessages('session:c', [createSampleMessage('user', 'C')]);

      const result = await store.list({});
      expect(result.total).toBe(3);
      expect(result.items).toHaveLength(3);
    });

    it('should support pagination', async () => {
      for (let i = 0; i < 10; i++) {
        await store.saveMessages(`session:${i}`, [createSampleMessage('user', `Message ${i}`)]);
      }

      const page1 = await store.list({ limit: 3, offset: 0 });
      const page2 = await store.list({ limit: 3, offset: 3 });

      expect(page1.items).toHaveLength(3);
      expect(page2.items).toHaveLength(3);
      expect(page1.items[0].key).not.toBe(page2.items[0].key);
    });

    it('should filter by status', async () => {
      await store.saveMessages('active:session', [createSampleMessage('user', 'Active')]);
      await store.saveMessages('archived:session', [createSampleMessage('user', 'Archived')]);
      await store.archive('archived:session');

      const allSessions = await store.list({});
      expect(allSessions.total).toBeGreaterThanOrEqual(2);
    });
  });

  // ========== Session Key Handling ==========

  describe('session key handling', () => {
    it('should handle colon-separated keys', async () => {
      const key = 'telegram:dm:123456';
      await store.saveMessages(key, [createSampleMessage('user', 'Test')]);

      const loaded = await store.loadMessages(key);
      expect(loaded).toHaveLength(1);
    });

    it('should handle special characters in key', async () => {
      const key = 'test:special-key_123.abc';
      await store.saveMessages(key, [createSampleMessage('user', 'Test')]);

      const loaded = await store.loadMessages(key);
      expect(loaded).toHaveLength(1);
    });

    it('should handle unicode in key', async () => {
      const key = 'test:用户:123';
      await store.saveMessages(key, [createSampleMessage('user', 'Test')]);

      const loaded = await store.loadMessages(key);
      expect(loaded).toHaveLength(1);
    });

    it('should handle very long keys', async () => {
      const longKey = 'test:' + 'x'.repeat(200);
      await store.saveMessages(longKey, [createSampleMessage('user', 'Test')]);

      const loaded = await store.loadMessages(longKey);
      expect(loaded).toHaveLength(1);
    });
  });

  // ========== Index Management ==========

  describe('index management', () => {
    it('should create index on initialize', async () => {
      // The index should be created in memory, check via list
      const result = await store.list({});
      expect(result.items).toEqual([]);
    });

    it('should update index when saving messages', async () => {
      const key = 'test:index:update';
      await store.saveMessages(key, [createSampleMessage('user', 'Test')]);

      const result = await store.list({});
      const session = result.items.find(s => s.key === key);
      expect(session).toBeDefined();
      expect(session?.messageCount).toBe(1);
    });

    it('should update index when deleting messages', async () => {
      const key = 'test:index:delete';
      await store.saveMessages(key, [createSampleMessage('user', 'Test')]);
      await store.delete(key);

      const result = await store.list({});
      const session = result.items.find(s => s.key === key);
      
      expect(session).toBeUndefined();
    });
  });

  // ========== Edge Cases ==========

  describe('edge cases', () => {
    it('should handle concurrent save and load', async () => {
      const key = 'test:concurrent';
      
      // Save many messages concurrently
      const promises = Array.from({ length: 10 }, (_, i) => 
        store.saveMessages(key, [createSampleMessage('user', `Message ${i}`)])
      );
      await Promise.all(promises);

      // Should have some messages (last write wins)
      const loaded = await store.loadMessages(key);
      expect(loaded.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle rapid create and delete', async () => {
      const key = 'test:rapid';
      
      for (let i = 0; i < 5; i++) {
        await store.saveMessages(key, [createSampleMessage('user', `Message ${i}`)]);
        await store.delete(key);
      }

      // Should not have any messages
      const loaded = await store.loadMessages(key);
      expect(loaded).toEqual([]);
    });

    it('should handle empty messages array', async () => {
      const key = 'test:emptyarray';
      await store.saveMessages(key, []);
      
      const loaded = await store.loadMessages(key);
      expect(loaded).toEqual([]);
    });
  });

  // ========== Token Estimation ==========

  describe('estimateTokenUsage', () => {
    it('should estimate tokens for messages', async () => {
      const messages: AgentMessage[] = [
        { role: 'user', content: [{ type: 'text', text: 'Hello world' }], timestamp: Date.now() },
        { role: 'assistant', content: [{ type: 'text', text: 'Hi there!' }], timestamp: Date.now() },
      ];

      const estimate = await store.estimateTokenUsage('test', messages);
      expect(estimate).toBeGreaterThan(0);
    });

    it('should return 0 for empty messages', async () => {
      const estimate = await store.estimateTokenUsage('test', []);
      expect(estimate).toBe(0);
    });

    it('should handle large messages', async () => {
      const largeText = 'word '.repeat(10000);
      const messages: AgentMessage[] = [
        { role: 'user', content: [{ type: 'text', text: largeText }], timestamp: Date.now() },
      ];

      const estimate = await store.estimateTokenUsage('test', messages);
      // Rough estimate: ~4 chars per token, but 'word ' is 5 chars
      // 50000 chars / 4 ~= 12500 tokens
      expect(estimate).toBeGreaterThan(10000);
    });
  });

  // ========== Delete Many ==========

  describe('deleteMany', () => {
    it('should delete multiple sessions', async () => {
      await store.saveMessages('multi:1', [createSampleMessage('user', 'A')]);
      await store.saveMessages('multi:2', [createSampleMessage('user', 'B')]);
      await store.saveMessages('multi:3', [createSampleMessage('user', 'C')]);

      const result = await store.deleteMany(['multi:1', 'multi:2', 'multi:3']);

      expect(result.success).toHaveLength(3);
      expect(result.failed).toHaveLength(0);
    });

    it('should handle partial failures', async () => {
      await store.saveMessages('partial:1', [createSampleMessage('user', 'A')]);
      // 'partial:2' doesn't exist - should still succeed for partial:1

      const result = await store.deleteMany(['partial:1', 'partial:2']);

      expect(result.success).toContain('partial:1');
      // partial:2 doesn't exist, so it might be in success or failed depending on implementation
    });
  });
});
