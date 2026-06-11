import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { ConfigSchema } from '../../config/schema.js';
import { FILENAMES } from '../../config/paths.js';
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

      await store.saveMessages('agent:main:telegram:default:direct:123456', messages);
      const metadata = await store.getMetadata('agent:main:telegram:default:direct:123456');

      expect(metadata?.routing).toEqual({
        agentId: 'main',
        source: 'telegram',
        accountId: 'default',
        peerKind: 'direct',
        peerId: '123456',
      });
    });

    it('should extract routing with thread', async () => {
      const messages: any[] = [{ role: 'user', content: 'Thread message' }];

      await store.saveMessages('agent:main:discord:channel:987654:thread:789', messages);
      const metadata = await store.getMetadata('agent:main:discord:channel:987654:thread:789');

      expect(metadata?.routing).toEqual({
        agentId: 'main',
        source: 'discord',
        accountId: 'default',
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
    it('should reset in place with archived transcript and new session id', async () => {
      const key = 'agent:main:webchat:default:direct:reset-test';
      await store.saveMessages(key, [{ role: 'user', content: 'hello', timestamp: Date.now() }]);
      const before = await store.getMetadata(key);
      const outcome = await store.reset(key);
      expect(outcome?.previousSessionId).toBe(before?.transcriptId);
      expect(outcome?.sessionId).not.toBe(before?.transcriptId);
      const after = await store.getMetadata(key);
      expect(after?.key).toBe(key);
      expect(after?.transcriptId).toBe(outcome?.sessionId);
      expect(await store.loadMessages(key)).toHaveLength(0);
    });

    it('should save and load messages', async () => {
      const key = 'agent:main:telegram:default:direct:123456';
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

    it('should hide compaction summary messages from display history', async () => {
      const key = 'agent:main:webchat:default:direct:compaction-summary';
      const messages: any[] = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '[Previous conversation summary]: Previous conversation covered: old turns...',
            },
          ],
          timestamp: Date.now(),
        },
        { role: 'user', content: 'Visible user message', timestamp: Date.now() + 1 },
        { role: 'assistant', content: 'Visible assistant message', timestamp: Date.now() + 2 },
      ];

      await store.saveMessages(key, messages);

      const llmMessages = await store.loadMessages(key);
      const detail = await store.get(key);
      const page = await store.getMessagePage(key, { offset: 0, limit: 50 });

      expect(llmMessages).toHaveLength(3);
      expect(detail?.messages.map((message) => message.content)).toEqual([
        'Visible user message',
        'Visible assistant message',
      ]);
      expect(page?.session.messages.map((message) => message.content)).toEqual([
        'Visible user message',
        'Visible assistant message',
      ]);
      expect(page?.pagination.total).toBe(2);
    });

    it('should page messages from the newest tail while preserving chronological order', async () => {
      const key = 'agent:main:webchat:default:direct:history-page';
      const messages: any[] = Array.from({ length: 5 }, (_, index) => ({
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `message-${index}`,
        timestamp: Date.now() + index,
      }));

      await store.saveMessages(key, messages);
      const firstPage = await store.getMessagePage(key, { offset: 0, limit: 2 });
      const secondPage = await store.getMessagePage(key, { offset: 2, limit: 2 });
      const finalPage = await store.getMessagePage(key, { offset: 4, limit: 2 });

      expect(firstPage?.session.messages.map((message) => message.content)).toEqual([
        'message-3',
        'message-4',
      ]);
      expect(firstPage?.pagination).toEqual({
        total: 5,
        limit: 2,
        offset: 0,
        hasMore: true,
        nextBeforeCursor: '3',
      });
      expect(secondPage?.session.messages.map((message) => message.content)).toEqual([
        'message-1',
        'message-2',
      ]);
      expect(secondPage?.pagination).toEqual({
        total: 5,
        limit: 2,
        offset: 2,
        hasMore: true,
        nextBeforeCursor: '1',
      });
      expect(finalPage?.session.messages.map((message) => message.content)).toEqual(['message-0']);
      expect(finalPage?.pagination).toEqual({ total: 5, limit: 2, offset: 4, hasMore: false });

      const cursorPage = await store.getMessagePage(key, {
        before: firstPage?.pagination.nextBeforeCursor,
        limit: 2,
      });

      expect(cursorPage?.session.messages.map((message) => message.content)).toEqual([
        'message-1',
        'message-2',
      ]);
      expect(cursorPage?.pagination).toEqual({
        total: 5,
        limit: 2,
        offset: 0,
        hasMore: true,
        before: '3',
        nextBeforeCursor: '1',
      });
    });

    it('should list sessions with channel filter', async () => {
      await store.saveMessages('agent:main:telegram:default:direct:1', [{ role: 'user', content: '1' }]);
      await store.saveMessages('agent:main:discord:default:direct:2', [{ role: 'user', content: '2' }]);

      const telegramSessions = await store.list({ channel: 'telegram' });
      expect(telegramSessions.items).toHaveLength(1);
      expect(telegramSessions.items[0].sourceChannel).toBe('telegram');
    });

    it('lists webchat when sessions.json metadata omits sourceChannel (rehydrate from session key)', async () => {
      const key = 'agent:main:webchat:default:direct:meta-gap';
      await store.saveMessages(key, [{ role: 'user', content: 'x', timestamp: Date.now() }]);
      const mapPath = join(store.getSessionsRoot(), FILENAMES.SESSIONS_MAP);
      const raw = JSON.parse(await readFile(mapPath, 'utf-8')) as Record<string, { pluginExtensions?: { xopc?: { metadata?: Record<string, unknown> } } }>;
      const meta = raw[key]?.pluginExtensions?.xopc?.metadata;
      expect(meta).toBeDefined();
      delete meta!.sourceChannel;
      await writeFile(mapPath, JSON.stringify(raw));

      const listed = await store.list({ channel: 'webchat,gateway' });
      expect(listed.items.some((s) => s.key === key)).toBe(true);
    });

    it('lists webchat sessions from standalone agent directories outside agents.list', async () => {
      const previousStateDir = process.env.XOPC_STATE_DIR;
      process.env.XOPC_STATE_DIR = join(tempDir, '.state');
      try {
        const aggregateStore = new SessionStore({ config: testConfig });
        await aggregateStore.initialize();
        await mkdir(join(tempDir, '.state', 'agents', 'empty-agent', 'sessions'), { recursive: true });

        const standaloneStore = new SessionStore({ config: testConfig, agentId: 'coder' });
        await standaloneStore.initialize();
        const key = 'agent:coder:webchat:default:direct:standalone';
        await standaloneStore.saveMessages(key, [{ role: 'user', content: 'x', timestamp: Date.now() }]);

        const listed = await aggregateStore.list({ channel: 'webchat,gateway' });
        expect(listed.items.some((session) => session.key === key)).toBe(true);
      } finally {
        if (previousStateDir === undefined) {
          delete process.env.XOPC_STATE_DIR;
        } else {
          process.env.XOPC_STATE_DIR = previousStateDir;
        }
      }
    });

    it('invalidates aggregate cache when a session is written through the same store', async () => {
      const previousStateDir = process.env.XOPC_STATE_DIR;
      process.env.XOPC_STATE_DIR = join(tempDir, '.state');
      try {
        const aggregateStore = new SessionStore({ config: testConfig });
        await aggregateStore.initialize();
        const before = await aggregateStore.list({ channel: 'webchat' });
        expect(before.items).toHaveLength(0);

        const key = 'agent:main:webchat:default:direct:cache-write';
        await aggregateStore.saveMessages(key, [{ role: 'user', content: 'x', timestamp: Date.now() }]);

        const after = await aggregateStore.list({ channel: 'webchat' });
        expect(after.items.some((session) => session.key === key)).toBe(true);
      } finally {
        if (previousStateDir === undefined) {
          delete process.env.XOPC_STATE_DIR;
        } else {
          process.env.XOPC_STATE_DIR = previousStateDir;
        }
      }
    });

    it('should list sessions with status filter', async () => {
      await store.saveMessages('agent:main:telegram:default:direct:1', [{ role: 'user', content: '1' }]);
      await store.saveMessages('agent:main:telegram:default:direct:2', [{ role: 'user', content: '2' }]);

      await store.archive('agent:main:telegram:default:direct:1');

      const activeSessions = await store.list({ status: 'active' });
      expect(activeSessions.items).toHaveLength(1);
      expect(activeSessions.items[0].key).toBe('agent:main:telegram:default:direct:2');
    });

    it('should list sessions by message content search', async () => {
      const targetKey = 'agent:main:webchat:default:direct:content-search';
      await store.saveMessages(targetKey, [
        { role: 'user', content: 'please remember alpha-session-keyword', timestamp: Date.now() },
      ]);
      await store.saveMessages('agent:main:webchat:default:direct:content-miss', [
        { role: 'user', content: 'unrelated message', timestamp: Date.now() + 1 },
      ]);

      const result = await store.list({ search: 'alpha-session-keyword' });
      expect(result.items.map((session) => session.key)).toEqual([targetKey]);
    });
  });

  describe('transcript document (synthetic)', () => {
    it('persists stable session id across saves', async () => {
      const key = 'agent:main:telegram:default:direct:envtest';
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
      const key = 'agent:main:telegram:default:direct:sumtest';
      await store.saveMessages(key, [{ role: 'user', content: 'z' }]);
      const detail = await store.get(key, { includeTranscriptSummary: true });
      expect(detail?.transcriptSummary?.id).toBeDefined();
      expect(detail?.transcriptSummary?.compactionCount).toBe(0);
      const bare = await store.get(key);
      expect(bare?.transcriptSummary).toBeUndefined();
    });

    it('appends compaction record when applyCompaction runs', async () => {
      const key = 'agent:main:telegram:default:direct:comptest';
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
      const key = 'agent:main:telegram:default:direct:cpapi';
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
      const displayAfterCompact = await store.get(key);
      const displayPageAfterCompact = await store.getMessagePage(key, { offset: 0, limit: 50 });
      expect(afterCompact.length).toBeLessThan(msgs.length);
      expect(displayAfterCompact?.messages.map((message) => message.content)).toEqual(
        msgs.map((message) => message.content),
      );
      expect(displayPageAfterCompact?.session.messages.map((message) => message.content)).toEqual(
        msgs.map((message) => message.content),
      );
      expect(displayPageAfterCompact?.pagination.total).toBe(msgs.length);

      await store.restoreCompactionCheckpoint(key, cpId);
      const restored = await store.loadMessages(key);
      expect(restored.length).toBe(msgs.length);
    });
  });

  describe('transcript context rows', () => {
    it('appendTranscriptContextEntry keeps row on disk but loadMessages returns LLM only', async () => {
      const key = 'agent:main:webchat:default:direct:ctxrow1';
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
      const key = 'agent:main:webchat:default:direct:exportctx';
      await store.saveMessages(key, [{ role: 'user', content: 'hi' }]);
      await store.appendTranscriptContextEntry(key, { text: 'export_note', id: 'n1' });
      const json = await store.exportSession(key, 'json');
      const parsed = JSON.parse(json) as { transcriptRows?: unknown[]; messages?: unknown[] };
      expect(parsed.transcriptRows?.length).toBe(2);
      expect(parsed.messages?.length).toBe(1);
    });
  });
});
