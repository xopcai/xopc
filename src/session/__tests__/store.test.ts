import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { ConfigSchema } from '../../config/schema.js';
import { SessionStore } from '../store.js';

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

    it('should handle invalid session key', async () => {
      const messages: any[] = [{ role: 'user', content: 'Test' }];

      await store.saveMessages('invalid-key', messages);
      const metadata = await store.getMetadata('invalid-key');

      expect(metadata?.routing).toBeUndefined();
      expect(metadata?.sourceChannel).toBe('unknown');
    });
  });

  describe('message persistence (JSONL + sessions.json)', () => {
    it('should save and load messages', async () => {
      const key = 'main:telegram:default:dm:123456';
      const messages: any[] = [
        { role: 'user', content: 'Hello', timestamp: Date.now() },
        { role: 'assistant', content: 'Hi there!', timestamp: Date.now() },
      ];

      await store.saveMessages(key, messages);
      const loaded = await store.loadMessages(key);

      expect(loaded).toHaveLength(2);
      expect(loaded[0].role).toBe('user');
      expect(loaded[1].role).toBe('assistant');
    });

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

  describe('transcript document (synthetic)', () => {
    it('persists stable session id across saves', async () => {
      const key = 'main:telegram:default:dm:envtest';
      await store.saveMessages(key, [{ role: 'user', content: 'a' }]);
      const doc1 = await store.loadTranscriptDocument(key);
      expect(doc1).not.toBeNull();
      expect(doc1?.type).toBe('xopc_session_transcript');
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

    it('includes transcriptSummary on get when requested', async () => {
      const key = 'main:telegram:default:dm:sumtest';
      await store.saveMessages(key, [{ role: 'user', content: 'z' }]);
      const detail = await store.get(key, { includeTranscriptSummary: true });
      expect(detail?.transcriptSummary?.id).toBeDefined();
      expect(detail?.transcriptSummary?.compactionCount).toBe(0);
      const bare = await store.get(key);
      expect(bare?.transcriptSummary).toBeUndefined();
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

    it('json exportSession includes transcriptRows', async () => {
      const key = 'main:webchat:default:direct:exportctx';
      await store.saveMessages(key, [{ role: 'user', content: 'hi' }]);
      await store.appendTranscriptContextEntry(key, { text: 'export_note', id: 'n1' });
      const json = await store.exportSession(key, 'json');
      const parsed = JSON.parse(json) as { transcriptRows?: unknown[]; messages?: unknown[] };
      expect(parsed.transcriptRows?.length).toBe(2);
      expect(parsed.messages?.length).toBe(1);
    });
  });
});
