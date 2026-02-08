import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../manager.js';

// Mock fs module
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

// Mock os module
vi.mock('os', () => ({
  homedir: vi.fn(() => '/tmp/test-home'),
}));

import * as fs from 'fs';

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    manager = new SessionManager();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getOrCreate', () => {
    it('should create new session if not exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const session = manager.getOrCreate('test-session');

      expect(session.key).toBe('test-session');
      expect(session.messages).toEqual([]);
      expect(session.created_at).toBeDefined();
    });

    it('should return existing session from cache', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const session1 = manager.getOrCreate('test-session');
      const session2 = manager.getOrCreate('test-session');

      expect(session1).toBe(session2);
    });

    it('should load session from disk if exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ _type: 'metadata', created_at: '2024-01-01T00:00:00Z', metadata: {} }) + '\n' +
        JSON.stringify({ role: 'user', content: 'Hello', timestamp: Date.now() })
      );

      const session = manager.getOrCreate('test-session');

      expect(session.key).toBe('test-session');
      expect(session.messages).toHaveLength(1);
    });

    it('should create different sessions for different keys', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const session1 = manager.getOrCreate('session-1');
      const session2 = manager.getOrCreate('session-2');

      expect(session1.key).toBe('session-1');
      expect(session2.key).toBe('session-2');
      expect(session1).not.toBe(session2);
    });
  });

  describe('save', () => {
    it('should save session to disk', () => {
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      const session = manager.getOrCreate('test-session');
      manager.save(session);

      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should persist session messages', () => {
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      const session = manager.getOrCreate('test-session');
      session.messages.push({ role: 'user', content: 'Hello', timestamp: Date.now() });
      manager.save(session);

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenContent = writeCall[1] as string;
      expect(writtenContent).toContain('Hello');
    });
  });

  describe('delete', () => {
    it('should delete session from cache and disk', () => {
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        // Return true for session file check in delete
        return String(path).includes('test-session');
      });

      manager.getOrCreate('test-session');
      const result = manager.delete('test-session');

      // After delete, should create new session
      expect(result).toBe(true);
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it('should return false for non-existent session', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = manager.delete('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('listSessions', () => {
    it('should return empty array when no sessions', () => {
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);

      const sessions = manager.listSessions();

      expect(sessions).toEqual([]);
    });

    it('should return list of sessions', () => {
      vi.mocked(fs.readdirSync).mockReturnValue(['session1.jsonl', 'session2.jsonl'] as any);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ _type: 'metadata', created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-02T00:00:00Z' })
      );

      const sessions = manager.listSessions();

      expect(sessions).toHaveLength(2);
    });
  });
});
