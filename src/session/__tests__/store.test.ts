import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { SessionStore } from '../store.js';

describe('SessionStore', () => {
  let tempDir: string;
  let store: SessionStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'xopcbot-session-test-'));
    store = new SessionStore(tempDir);
    await store.initialize();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('routing metadata extraction', () => {
    it('should extract routing from basic session key', async () => {
      const messages: any[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ];

      await store.saveMessages('main:telegram:default:dm:123456', messages);
      const metadata = await store.getMetadata('main:telegram:default:dm:123456');

      expect(metadata?.routing).toEqual({
        agentId: 'main',
        source: 'telegram',
        accountId: 'default',
        peerKind: 'dm',
        peerId: '123456',
      });
    });

    it('should extract routing with thread', async () => {
      const messages: any[] = [{ role: 'user', content: 'Thread message' }];

      await store.saveMessages('main:discord:work:channel:987654:thread:789', messages);
      const metadata = await store.getMetadata('main:discord:work:channel:987654:thread:789');

      expect(metadata?.routing).toEqual({
        agentId: 'main',
        source: 'discord',
        accountId: 'work',
        peerKind: 'channel',
        peerId: '987654',
        threadId: '789',
      });
    });

    it('should extract routing with scope', async () => {
      const messages: any[] = [{ role: 'user', content: 'Scoped message' }];

      await store.saveMessages('main:telegram:default:dm:123456:scope:scope1', messages);
      const metadata = await store.getMetadata('main:telegram:default:dm:123456:scope:scope1');

      expect(metadata?.routing).toEqual({
        agentId: 'main',
        source: 'telegram',
        accountId: 'default',
        peerKind: 'dm',
        peerId: '123456',
        scopeId: 'scope1',
      });
    });

    it('should handle invalid session key', async () => {
      const messages: any[] = [{ role: 'user', content: 'Test' }];

      await store.saveMessages('invalid-key', messages);
      const metadata = await store.getMetadata('invalid-key');

      expect(metadata?.routing).toBeUndefined();
    });
  });

  describe('getByAgent', () => {
    it('should filter sessions by agent ID', async () => {
      await store.saveMessages('main:telegram:default:dm:1', [{ role: 'user', content: '1' }]);
      await store.saveMessages('main:telegram:default:dm:2', [{ role: 'user', content: '2' }]);
      await store.saveMessages('agent2:telegram:default:dm:3', [{ role: 'user', content: '3' }]);

      const mainSessions = await store.getByAgent('main');
      expect(mainSessions).toHaveLength(2);
      expect(mainSessions.every((s) => s.routing?.agentId === 'main')).toBe(true);

      const agent2Sessions = await store.getByAgent('agent2');
      expect(agent2Sessions).toHaveLength(1);
    });
  });

  describe('getByAccount', () => {
    it('should filter sessions by account ID', async () => {
      await store.saveMessages('main:telegram:default:dm:1', [{ role: 'user', content: '1' }]);
      await store.saveMessages('main:telegram:work:dm:2', [{ role: 'user', content: '2' }]);
      await store.saveMessages('main:telegram:work:dm:3', [{ role: 'user', content: '3' }]);

      const defaultSessions = await store.getByAccount('default');
      expect(defaultSessions).toHaveLength(1);

      const workSessions = await store.getByAccount('work');
      expect(workSessions).toHaveLength(2);
    });
  });

  describe('getByPeer', () => {
    it('should filter sessions by peer', async () => {
      await store.saveMessages('main:telegram:default:dm:123456', [
        { role: 'user', content: '1' },
      ]);
      await store.saveMessages('main:telegram:default:dm:789012', [
        { role: 'user', content: '2' },
      ]);
      await store.saveMessages('main:telegram:default:group:group1', [
        { role: 'user', content: '3' },
      ]);

      const peer1Sessions = await store.getByPeer('dm', '123456');
      expect(peer1Sessions).toHaveLength(1);

      const dmSessions = await store.getByPeer('dm', '123456');
      expect(dmSessions.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getMainSession', () => {
    it('should find main DM session', async () => {
      await store.saveMessages('main:telegram:default:dm:main', [
        { role: 'user', content: 'Main session' },
      ]);
      await store.saveMessages('main:telegram:default:dm:123456', [
        { role: 'user', content: 'Peer session' },
      ]);

      const mainSession = await store.getMainSession('telegram', 'default');
      expect(mainSession).not.toBeNull();
      expect(mainSession?.routing?.peerId).toBe('main');
    });

    it('should return null when no main session exists', async () => {
      await store.saveMessages('main:telegram:default:dm:123456', [
        { role: 'user', content: 'Peer session' },
      ]);

      const mainSession = await store.getMainSession('telegram', 'default');
      expect(mainSession).toBeNull();
    });
  });

  describe('stats tracking', () => {
    it('should track message count and token count', async () => {
      const messages: any[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
        { role: 'user', content: 'How are you?' },
      ];

      await store.saveMessages('main:telegram:default:dm:123456', messages);
      const metadata = await store.getMetadata('main:telegram:default:dm:123456');

      expect(metadata?.stats?.messageCount).toBe(3);
      expect(metadata?.stats?.tokenCount).toBeGreaterThan(0);
      expect(metadata?.stats?.lastTurnAt).toBeDefined();
    });

    it('should update stats on subsequent saves', async () => {
      await store.saveMessages('main:telegram:default:dm:123456', [
        { role: 'user', content: 'First' },
      ]);
      let metadata = await store.getMetadata('main:telegram:default:dm:123456');
      expect(metadata?.stats?.messageCount).toBe(1);

      await store.saveMessages('main:telegram:default:dm:123456', [
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'Second' },
      ]);
      metadata = await store.getMetadata('main:telegram:default:dm:123456');
      expect(metadata?.stats?.messageCount).toBe(2);
    });
  });

  describe('list with routing filters', () => {
    it('should list sessions with channel filter', async () => {
      await store.saveMessages('main:telegram:default:dm:1', [{ role: 'user', content: '1' }]);
      await store.saveMessages('main:discord:default:dm:2', [{ role: 'user', content: '2' }]);

      const telegramSessions = await store.list({ channel: 'telegram' });
      expect(telegramSessions.items).toHaveLength(1);
      expect(telegramSessions.items[0].sourceChannel).toBe('telegram');
    });

    it('should list sessions with status filter', async () => {
      await store.saveMessages('main:telegram:default:dm:1', [{ role: 'user', content: '1' }]);
      await store.saveMessages('main:telegram:default:dm:2', [{ role: 'user', content: '2' }]);

      await store.archive('main:telegram:default:dm:1');

      const activeSessions = await store.list({ status: 'active' });
      expect(activeSessions.items).toHaveLength(1);
      expect(activeSessions.items[0].key).toBe('main:telegram:default:dm:2');
    });
  });
});
