import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { ConfigSchema } from '../../config/schema.js';
import { SessionStore } from '../store.js';
import { resolveSessionShardRelativePath } from '../shard-path.js';

const testConfig = ConfigSchema.parse({});

describe('SessionStore', () => {
  let tempDir: string;
  let store: SessionStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'xopc-session-test-'));
    store = new SessionStore({ config: testConfig, sessionsDir: join(tempDir, '.sessions') });
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

    it('should tag cron isolated session keys with sessionType and cronJobId', async () => {
      const messages: any[] = [
        { role: 'user', content: 'Run report' },
        { role: 'assistant', content: 'Done.' },
      ];

      await store.saveMessages('main:cron:default:dm:abc12def', messages);
      const metadata = await store.getMetadata('main:cron:default:dm:abc12def');

      expect(metadata?.sourceChannel).toBe('cron');
      expect(metadata?.sourceChatId).toBe('abc12def');
      expect(metadata?.sessionType).toBe('cron');
      expect(metadata?.customData).toMatchObject({ cronJobId: 'abc12def' });
    });

    it('should tag heartbeat session keys with sessionType and heartbeatTarget', async () => {
      const messages: any[] = [
        { role: 'user', content: 'Poll HEARTBEAT.md' },
        { role: 'assistant', content: 'HEARTBEAT_OK' },
      ];

      await store.saveMessages('heartbeat:main', messages);
      const metadata = await store.getMetadata('heartbeat:main');

      expect(metadata?.sourceChannel).toBe('heartbeat');
      expect(metadata?.sourceChatId).toBe('main');
      expect(metadata?.sessionType).toBe('heartbeat');
      expect(metadata?.customData).toMatchObject({ heartbeatTarget: 'main' });
    });

    it('stores cron and routing sessions in separate shard directories', async () => {
      await store.saveMessages('main:cron:default:dm:job1', [{ role: 'user', content: 'c' }]);
      await store.saveMessages('main:webchat:default:direct:u1', [{ role: 'user', content: 'w' }]);

      expect(
        existsSync(
          join(
            tempDir,
            '.sessions',
            'users',
            'main',
            'cron',
            'default',
            'dm',
            'job1',
            'main_cron_default_dm_job1.json',
          ),
        ),
      ).toBe(true);
      expect(
        existsSync(
          join(tempDir, '.sessions', 'users', 'main', 'web', 'u1', 'main_webchat_default_direct_u1.json')
        )
      ).toBe(true);
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

    it('should list sessions matching any channel when channel is comma-separated', async () => {
      await store.saveMessages('main:telegram:default:dm:1', [{ role: 'user', content: '1' }]);
      await store.saveMessages('main:weixin:default:dm:2', [{ role: 'user', content: '2' }]);
      await store.saveMessages('main:discord:default:dm:3', [{ role: 'user', content: '3' }]);

      const im = await store.list({ channel: 'telegram,weixin' });
      expect(im.items.map((s) => s.sourceChannel).sort()).toEqual(['telegram', 'weixin']);
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

  describe('transcript envelope (pi-style)', () => {
    it('persists versioned document with stable id across saves', async () => {
      const key = 'main:telegram:default:dm:envtest';
      await store.saveMessages(key, [{ role: 'user', content: 'a' }]);
      const doc1 = await store.loadTranscriptDocument(key);
      expect(doc1).not.toBeNull();
      expect(doc1?.type).toBe('xopc_session_transcript');
      expect(doc1?.version).toBe(1);
      expect(doc1?.id?.length).toBeGreaterThan(0);
      const id1 = doc1!.id;

      await store.saveMessages(key, [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ]);
      const doc2 = await store.loadTranscriptDocument(key);
      expect(doc2?.id).toBe(id1);
      const loaded = await store.loadMessages(key);
      expect(loaded).toHaveLength(2);
    });

    it('writes OpenClaw-style lifecycle fields on the session index', async () => {
      const key = 'main:telegram:default:dm:lifecycleidx';
      await store.saveMessages(key, [{ role: 'user', content: 'one' }]);
      const meta1 = await store.getMetadata(key);
      expect(meta1?.transcriptId).toBeDefined();
      expect(meta1?.transcriptId).toBe((await store.loadTranscriptDocument(key))?.id);
      expect(meta1?.sessionStartedAt).toBeDefined();
      expect(meta1?.lastInteractionAt).toBeDefined();
      const started = meta1!.sessionStartedAt!;

      await store.saveMessages(key, [
        { role: 'user', content: 'one' },
        { role: 'assistant', content: 'two' },
      ]);
      const meta2 = await store.getMetadata(key);
      expect(meta2?.transcriptId).toBe(meta1?.transcriptId);
      expect(meta2?.sessionStartedAt).toBe(started);
      expect(typeof meta2?.lastInteractionAt).toBe('string');
    });

    it('includes transcriptSummary on get when requested', async () => {
      const key = 'main:telegram:default:dm:sumtest';
      await store.saveMessages(key, [{ role: 'user', content: 'z' }]);
      const detail = await store.get(key, { includeTranscriptSummary: true });
      expect(detail?.transcriptSummary?.id).toBeDefined();
      expect(detail?.transcriptSummary?.compactionCount).toBe(0);
      const bare = await store.get(key);
      expect(bare?.transcriptSummary).toBeUndefined();
    });

    it('ignores bare-array transcript files on disk (not a wrapped document)', async () => {
      const key = 'main:telegram:default:dm:bareonly';
      const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
      const jsonPath = join(
        tempDir,
        '.sessions',
        resolveSessionShardRelativePath(key),
        `${safeKey}.json`,
      );
      mkdirSync(dirname(jsonPath), { recursive: true });
      writeFileSync(jsonPath, JSON.stringify([{ role: 'user', content: 'ignored' }]));

      const loaded = await store.loadMessages(key);
      expect(loaded).toHaveLength(0);
      expect(await store.loadTranscriptDocument(key)).toBeNull();
    });

    it('appends compaction record when applyCompaction runs', async () => {
      const key = 'main:telegram:default:dm:comptest';
      const msgs = Array.from({ length: 12 }, (_, i) => ({
        role: 'user' as const,
        content: `line-${i}`,
        timestamp: Date.now() + i,
      }));
      await store.saveMessages(key, msgs);
      const result = {
        summary: 'condensed topic',
        firstKeptIndex: 8,
        tokensBefore: 9000,
        tokensAfter: 1200,
        compacted: true,
      };
      await store.applyCompaction(key, msgs, result);
      const doc = await store.loadTranscriptDocument(key);
      expect(doc?.compactions).toHaveLength(1);
      expect(doc?.compactions?.[0]).toMatchObject({
        summary: 'condensed topic',
        firstKeptIndex: 8,
        tokensBefore: 9000,
        tokensAfter: 1200,
      });
      expect(doc?.messages.length).toBeLessThan(msgs.length);
    });

    it('lists and restores compaction checkpoints', async () => {
      const key = 'main:telegram:default:dm:cpapi';
      const msgs = Array.from({ length: 12 }, (_, i) => ({
        role: 'user' as const,
        content: `m-${i}`,
        timestamp: Date.now() + i,
      }));
      await store.saveMessages(key, msgs);
      const result = {
        summary: 's',
        firstKeptIndex: 8,
        tokensBefore: 8000,
        tokensAfter: 500,
        compacted: true,
      };
      await store.applyCompaction(key, msgs, result);
      const list = await store.listCompactionCheckpoints(key);
      expect(list.length).toBeGreaterThanOrEqual(1);
      const cpId = list[0]!.id;
      const detail = await store.getCompactionCheckpointDetail(key, cpId);
      expect(detail?.messageCount).toBe(msgs.length);

      const afterCompact = await store.loadMessages(key);
      expect(afterCompact.length).toBeLessThan(msgs.length);

      await store.restoreCompactionCheckpoint(key, cpId);
      const restored = await store.loadMessages(key);
      expect(restored.length).toBe(msgs.length);
    });
  });

  describe('transcript context rows', () => {
    it('appendTranscriptContextEntry keeps row on disk but loadMessages returns LLM only', async () => {
      const key = 'main:webchat:default:direct:ctxrow1';
      await store.saveMessages(key, [{ role: 'user', content: 'hi' }]);
      await store.appendTranscriptContextEntry(key, { text: 'audit', id: 'e1' });
      const llm = await store.loadMessages(key);
      expect(llm).toHaveLength(1);
      const doc = await store.loadTranscriptDocument(key);
      expect(doc?.messages.length).toBe(2);
      const row = doc!.messages[1] as { kind?: string };
      expect(row.kind).toBe('context');
    });

    it('saveMessages preserves context positions when updating LLM tail', async () => {
      const key = 'main:webchat:default:direct:ctxrow2';
      await store.saveMessages(key, [{ role: 'user', content: 'u' }]);
      await store.appendTranscriptContextEntry(key, { text: 'mid' });
      await store.saveMessages(key, [
        { role: 'user', content: 'u' },
        { role: 'assistant', content: 'a' },
      ]);
      const doc = await store.loadTranscriptDocument(key);
      expect(doc?.messages).toHaveLength(3);
      expect((doc!.messages[0] as { role: string }).role).toBe('user');
      expect((doc!.messages[1] as { kind: string }).kind).toBe('context');
      expect((doc!.messages[2] as { role: string }).role).toBe('assistant');
    });

    it('get(..., includeTranscriptRows) returns full rows while messages stay LLM-only', async () => {
      const key = 'main:webchat:default:direct:ctxrow3';
      await store.saveMessages(key, [{ role: 'user', content: 'x' }]);
      await store.appendTranscriptContextEntry(key, { text: 'note' });
      const detail = await store.get(key, { includeTranscriptRows: true });
      expect(detail?.messages).toHaveLength(1);
      expect(detail?.transcriptRows?.length).toBe(2);
      expect((detail!.transcriptRows![1] as { kind: string }).kind).toBe('context');
    });

    it('json exportSession includes transcriptRows', async () => {
      const key = 'main:webchat:default:direct:exportctx';
      await store.saveMessages(key, [{ role: 'user', content: 'hi' }]);
      await store.appendTranscriptContextEntry(key, { text: 'export_note', id: 'n1' });
      const json = await store.exportSession(key, 'json');
      const parsed = JSON.parse(json) as { transcriptRows?: unknown[]; messages?: unknown[] };
      expect(Array.isArray(parsed.transcriptRows)).toBe(true);
      expect(parsed.transcriptRows!.length).toBe(2);
      expect((parsed.transcriptRows![1] as { kind: string }).kind).toBe('context');
      expect(parsed.messages).toHaveLength(1);
    });
  });

});
