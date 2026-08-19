import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { ConfigSchema } from '../../config/schema.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  patchSessionMetadata,
  resetXopcDatabaseSingletonForTest,
} from '../../storage/sqlite/index.js';
import { SessionStore } from '../store.js';

function directMetadata(agentId: string, source: string, peerId: string) {
  return {
    sourceChannel: source,
    sourceChatId: `default:direct:${peerId}`,
    routing: {
      agentId,
      source,
      accountId: 'default',
      peerKind: 'direct',
      peerId,
    },
  };
}

describe('SessionStore', () => {
  let tempDir: string;
  let store: SessionStore;
  let previousStateDir: string | undefined;

  beforeEach(async () => {
    previousStateDir = process.env.XOPC_STATE_DIR;
    tempDir = await mkdtemp(join(tmpdir(), 'xopc-session-test-'));
    process.env.XOPC_STATE_DIR = tempDir;
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(tempDir, 'xopc.db') });
    store = new SessionStore({
      config: ConfigSchema.parse({
        agents: {
          default: 'main',
          defaultPreset: 'default',
          capabilityPresets: {
            default: {
              id: 'default',
              name: 'Global defaults',
              models: { defaultRole: 'deep', roles: { deep: { model: 'test/test-model' } } },
            },
          },
          list: [
            {
              id: 'main',
              identity: { name: 'Main', role: 'General assistant' },
              responsibilities: { primary: ['Help the user complete tasks'] },
              workspace: { root: join(tempDir, 'main') },
              tools: { builtin: {} },
              skills: { mode: 'all' },
              workflows: {},
              boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
            },
          ],
        },
      }),
    });
    await store.initialize();
  });

  afterEach(async () => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    if (previousStateDir === undefined) {
      delete process.env.XOPC_STATE_DIR;
    } else {
      process.env.XOPC_STATE_DIR = previousStateDir;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('routing metadata', () => {
    it('persists explicit routing metadata', async () => {
      const messages: any[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ];

      await store.saveMessages('agent:main:telegram:default:direct:123456', messages, {
        metadata: directMetadata('main', 'telegram', '123456'),
      });
      const metadata = await store.getMetadata('agent:main:telegram:default:direct:123456');

      expect(metadata?.routing).toEqual({
        agentId: 'main',
        source: 'telegram',
        accountId: 'default',
        peerKind: 'direct',
        peerId: '123456',
      });
    });

    it('does not infer routing from session key', async () => {
      const messages: any[] = [{ role: 'user', content: 'Thread message' }];

      await store.saveMessages('agent:main:discord:channel:987654:thread:789', messages);
      const metadata = await store.getMetadata('agent:main:discord:channel:987654:thread:789');

      expect(metadata?.routing).toBeUndefined();
      expect(metadata?.sourceChannel).toBe('');
      expect(metadata?.sourceChatId).toBe('');
    });

    it('keeps empty metadata for arbitrary keys without fallback parsing', async () => {
      const messages: any[] = [{ role: 'user', content: 'Test' }];

      await store.saveMessages('invalid-key', messages);
      const metadata = await store.getMetadata('invalid-key');

      expect(metadata?.routing).toBeUndefined();
      expect(metadata?.sourceChannel).toBe('');
      expect(metadata?.sourceChatId).toBe('');
    });
  });

  describe('message persistence (SQLite)', () => {
    it('removes a failed assistant row and resumes the persisted user row for model fallback', async () => {
      const key = 'agent:main:webchat:default:direct:model-fallback';
      await store.saveMessages(key, [
        { role: 'user', content: 'previous question', timestamp: 1 },
        { role: 'assistant', content: 'previous answer', timestamp: 2 },
      ] as any[]);
      const rowsBeforeAttempt = await store.loadTranscriptRows(key);
      await store.appendTranscriptMessage(key, { role: 'user', content: 'ppp', timestamp: 3 });
      await store.appendTranscriptMessage(key, {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: 'OAuth auth derivation failed',
        timestamp: 4,
      } as any);

      await expect(store.prepareModelFallback(key, rowsBeforeAttempt)).resolves.toBe('resume');

      const rows = await store.loadTranscriptRows(key);
      expect(rows.map((row) => (row as { role?: string }).role).filter(Boolean)).toEqual([
        'user',
        'assistant',
        'user',
      ]);
      expect(rows.filter((row) => (row as { role?: string }).role === 'user')).toHaveLength(2);
      expect(JSON.stringify(rows)).not.toContain('OAuth auth derivation failed');
    });

    it('includes active transcript cwd in listed metadata', async () => {
      const key = 'agent:main:webchat:default:direct:cwd-list';
      await store.saveMessages(key, [{ role: 'user', content: 'hello', timestamp: Date.now() }]);

      const result = await store.list({ search: 'cwd-list' });

      expect(result.items[0]?.cwd).toBe(join(tempDir, 'main'));
    });

    it('should reset in place with archived transcript and new session id', async () => {
      const key = 'agent:main:webchat:default:direct:reset-test';
      await store.saveMessages(key, [{ role: 'user', content: 'hello', timestamp: Date.now() }]);
      const before = await store.getMetadata(key);
      const task = await store.reset(key);
      expect(task?.previousSessionId).toBe(before?.sessionId);
      expect(task?.sessionId).not.toBe(before?.sessionId);
      const after = await store.getMetadata(key);
      expect(after?.key).toBe(key);
      expect(after?.sessionId).toBe(task?.sessionId);
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

    it('should preserve cache token usage on assistant transcript rows', async () => {
      const key = 'agent:main:webchat:default:direct:usage-cache';
      await store.saveMessages(key, [
        {
          role: 'assistant',
          content: 'cached response',
          usage: {
            input: 10,
            output: 5,
            cacheRead: 3,
            cacheWrite: 2,
            total: 20,
          },
        },
      ] as any[]);

      const rows = await store.loadTranscriptRows(key);

      expect((rows[0] as { usage?: unknown }).usage).toEqual({
        input: 10,
        output: 5,
        cacheRead: 3,
        cacheWrite: 2,
        total: 20,
      });
    });

    it('does not derive or persist synthetic coding context', async () => {
      const key = 'agent:main:webchat:default:direct:coding-context-display';
      const messages: any[] = [
        { role: 'user', content: 'inspect repo', timestamp: Date.now() },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'cmd-1', name: 'exec_command', input: { cmd: 'git log --oneline -20' } },
          ],
          timestamp: Date.now() + 1,
        },
        {
          role: 'toolResult',
          toolCallId: 'cmd-1',
          content: JSON.stringify({
            details: {
              command: 'git log --oneline -20',
              status: 'success',
              exitCode: 0,
            },
          }),
          timestamp: Date.now() + 2,
        },
      ];

      await store.saveMessages(key, messages);

      const llmMessages = await store.loadMessages(key);
      const detail = await store.get(key);
      const page = await store.getMessagePage(key, { offset: 0, limit: 50 });
      const llmText = JSON.stringify(llmMessages);
      const detailText = JSON.stringify(detail?.messages);
      const pageText = JSON.stringify(page?.session.messages);

      expect(llmMessages).toHaveLength(3);
      expect(detail?.messages).toHaveLength(3);
      expect(page?.pagination.total).toBe(3);
      expect(llmText).not.toContain('<coding_context>');
      expect(detailText).not.toContain('<coding_context>');
      expect(pageText).not.toContain('<coding_context>');
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

      await expect(
        store.getMessagePage(key, { before: 'cursor_3', limit: 2 }),
      ).rejects.toThrow('Invalid session history cursor');
    });

    it('should list sessions with channel filter', async () => {
      await store.saveMessages('agent:main:telegram:default:direct:1', [{ role: 'user', content: '1' }], {
        metadata: directMetadata('main', 'telegram', '1'),
      });
      await store.saveMessages('agent:main:discord:default:direct:2', [{ role: 'user', content: '2' }], {
        metadata: directMetadata('main', 'discord', '2'),
      });

      const telegramSessions = await store.list({ channel: 'telegram' });
      expect(telegramSessions.items).toHaveLength(1);
      expect(telegramSessions.items[0].sourceChannel).toBe('telegram');
    });

    it('does not list by channel when explicit sourceChannel is absent', async () => {
      const key = 'agent:main:webchat:default:direct:meta-gap';
      await store.saveMessages(key, [{ role: 'user', content: 'x', timestamp: Date.now() }]);

      const listed = await store.list({ channel: 'webchat,gateway' });
      expect(listed.items.some((s) => s.key === key)).toBe(false);
    });

    it('lists webchat sessions from other agents in the shared database', async () => {
      const key = 'agent:coder:webchat:default:direct:standalone';
      await store.saveMessages(key, [{ role: 'user', content: 'x', timestamp: Date.now() }], {
        metadata: directMetadata('coder', 'webchat', 'standalone'),
      });

      const listed = await store.list({ channel: 'webchat,gateway' });
      expect(listed.items.some((session) => session.key === key)).toBe(true);
    });

    it('invalidates aggregate cache when a session is written through the same store', async () => {
      const before = await store.list({ channel: 'webchat' });
      expect(before.items).toHaveLength(0);

      const key = 'agent:main:webchat:default:direct:cache-write';
      await store.saveMessages(key, [{ role: 'user', content: 'x', timestamp: Date.now() }], {
        metadata: directMetadata('main', 'webchat', 'cache-write'),
      });

      const after = await store.list({ channel: 'webchat' });
      expect(after.items.some((session) => session.key === key)).toBe(true);
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
      expect(doc?.messages.filter((row) => (row as { role?: string }).role === 'user')).toHaveLength(12);
      expect(await store.loadMessages(key)).toHaveLength(5);
    });

    it('emits unified before and after hooks around a successful compaction', async () => {
      const key = 'agent:main:telegram:default:direct:hooktest';
      const messages = Array.from({ length: 12 }, (_, index) => ({
        role: 'user' as const,
        content: `line-${index}`,
      }));
      await store.saveMessages(key, messages);
      const before = vi.fn();
      const after = vi.fn();
      store.setCompactionHooks({ before, after });
      vi.spyOn((store as any).compactor, 'compact').mockResolvedValue({
        summary: 'condensed topic',
        firstKeptIndex: 8,
        tokensBefore: 9_000,
        tokensAfter: 1_200,
        compacted: true,
      });

      await store.compact(key, messages, { provider: 'test', id: 'model' } as any);

      expect(before).toHaveBeenCalledWith(expect.objectContaining({
        sessionKey: key,
        messageCount: 12,
      }));
      expect(after).toHaveBeenCalledWith({
        sessionKey: key,
        messageCount: 5,
        tokenCount: 1_200,
        compactedCount: 8,
      });
    });

    it('preserves the authoritative transcript while loading compacted LLM context', async () => {
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
      expect(await store.listCompactionBoundaries(key)).toHaveLength(1);
    });

    it('deletes a raw user turn and invalidates later compaction boundaries', async () => {
      const key = 'agent:main:webchat:default:direct:delete-compacted-round';
      const messages: any[] = [
        { role: 'user', content: 'u0' },
        { role: 'assistant', content: 'a0' },
        { role: 'user', content: 'u1' },
        {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'call-1', name: 'exec_command', arguments: { cmd: 'false' } }],
        },
        { role: 'toolResult', toolCallId: 'call-1', content: 'failed' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'u2' },
        { role: 'assistant', content: 'a2' },
      ];
      await store.saveMessages(key, messages);
      await store.applyCompaction(key, messages, {
        summary: 'includes deleted turn',
        firstKeptIndex: 6,
        tokensBefore: 8000,
        tokensAfter: 500,
        compacted: true,
      });

      const deleted = await store.deleteUserRound(key, 1);
      const rows = await store.loadTranscriptRows(key);
      const llm = await store.loadMessages(key);

      expect(deleted?.deleted).toBe(4);
      expect(rows.some((row) => (row as { type?: string }).type === 'compaction')).toBe(false);
      expect(llm.map((message) => message.content)).toEqual(['u0', 'a0', 'u2', 'a2']);
      expect(JSON.stringify(rows)).not.toContain('call-1');
      expect(JSON.stringify(rows)).not.toContain('includes deleted turn');
    });

    it('rejects runtime-only messages at the persistence boundary', async () => {
      const key = 'agent:main:webchat:default:direct:reject-runtime-only';
      await expect(store.saveMessages(key, [
        { role: 'user', content: '<coding_context>derived</coding_context>', droppable: true },
      ] as any[])).rejects.toThrow('Runtime-only messages cannot be persisted');
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

    it('appendTranscriptLabelEntry keeps row on disk but loadMessages returns LLM only', async () => {
      const key = 'agent:main:webchat:default:direct:labelrow1';
      await store.saveMessages(key, [{ id: 'u1', role: 'user', content: 'hi' }]);
      await store.appendTranscriptLabelEntry(key, { targetId: 'u1', label: 'important' });
      const llm = await store.loadMessages(key);
      expect(llm).toHaveLength(1);
      const rows = await store.loadTranscriptRows(key);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({ type: 'label', targetId: 'u1', label: 'important' });
    });

    it('appendTranscriptCustomEntry keeps extension state on disk but loadMessages returns LLM only', async () => {
      const key = 'agent:main:webchat:default:direct:customrow1';
      await store.saveMessages(key, [{ role: 'user', content: 'hi' }]);
      await store.appendTranscriptCustomEntry(key, { customType: 'preset-state', data: { name: 'fast' } });
      const llm = await store.loadMessages(key);
      expect(llm).toHaveLength(1);
      const rows = await store.loadTranscriptRows(key);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        type: 'custom',
        customType: 'preset-state',
        data: { name: 'fast' },
      });
    });

    it('appendTranscriptCustomMessageEntry keeps visible custom message on disk and injects LLM context', async () => {
      const key = 'agent:main:webchat:default:direct:custommsg1';
      await store.saveMessages(key, [{ role: 'user', content: 'hi' }]);
      await store.appendTranscriptCustomMessageEntry(key, {
        customType: 'status-update',
        content: 'ready',
        details: { level: 'info' },
      });
      const llm = await store.loadMessages(key);
      expect(llm).toEqual([
        { role: 'user', content: 'hi' },
        { role: 'user', content: [{ type: 'text', text: 'ready' }], timestamp: expect.any(Number) },
      ]);
      const rows = await store.loadTranscriptRows(key);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        role: 'custom',
        customType: 'status-update',
        content: 'ready',
        display: true,
        details: { level: 'info' },
      });
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

    it('importSessionExport restores transcript rows into a new session', async () => {
      const source = 'agent:main:webchat:default:direct:import-source';
      const target = 'agent:main:webchat:default:direct:import-target';
      await store.saveMessages(source, [{ role: 'user', content: 'hi' }]);
      await store.appendTranscriptContextEntry(source, { text: 'import_note', id: 'i1' });
      patchSessionMetadata(source, { name: 'Import Source', tags: ['demo'] });

      const json = await store.exportSession(source, 'json');
      const result = await store.importSessionExport(target, json);

      expect(result).toEqual({ sessionKey: target, rowCount: 2 });
      expect(await store.loadMessages(target)).toHaveLength(1);
      const rows = await store.loadTranscriptRows(target);
      expect(rows).toHaveLength(2);
      const targetMeta = await store.getMetadata(target);
      expect(targetMeta?.name).toBe('Import of Import Source');
      expect(targetMeta?.tags).toContain('demo');
      expect(targetMeta?.tags).toContain('import');
      expect(targetMeta?.customData?.importedFromSessionKey).toBe(source);
      expect(targetMeta?.customData?.importedAt).toEqual(expect.any(String));
    });

    it('forkSession clones transcript rows into a new session', async () => {
      const source = 'agent:main:webchat:default:direct:fork-source';
      const target = 'agent:main:webchat:default:direct:fork-target';
      await store.saveMessages(source, [{ role: 'user', content: 'hi' }]);
      await store.appendTranscriptContextEntry(source, { text: 'fork_note', id: 'f1' });
      patchSessionMetadata(source, { name: 'Source Session', tags: ['demo'] });

      const result = await store.forkSession(source, target);

      expect(result).toEqual({ sessionKey: target, rowCount: 2 });
      expect(await store.loadMessages(target)).toHaveLength(1);
      const targetDoc = await store.loadTranscriptDocument(target);
      expect(targetDoc?.messages).toHaveLength(2);
      const targetMeta = await store.getMetadata(target);
      expect(targetMeta?.name).toBe('Fork of Source Session');
      expect(targetMeta?.tags).toContain('demo');
      expect(targetMeta?.tags).toContain('fork');
      expect(targetMeta?.customData?.forkedFromSessionKey).toBe(source);
      expect(targetMeta?.customData?.forkedFromSessionId).toBeTruthy();
      expect(targetMeta?.customData?.forkedAt).toEqual(expect.any(String));
    });

    it('forkSessionRows clones transcript rows through the selected row', async () => {
      const source = 'agent:main:webchat:default:direct:fork-row-source';
      const target = 'agent:main:webchat:default:direct:fork-row-target';
      await store.saveMessages(source, [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'answer' },
        { role: 'user', content: 'second' },
      ]);

      const result = await store.forkSessionRows(source, target, { throughRow: 2 });

      expect(result).toEqual({ sessionKey: target, rowCount: 2 });
      const rows = await store.loadTranscriptRows(target);
      expect(rows).toHaveLength(2);
      expect(await store.loadMessages(target)).toHaveLength(2);
      const targetMeta = await store.getMetadata(target);
      expect(targetMeta?.customData?.forkedFromSessionKey).toBe(source);
      expect(targetMeta?.customData?.forkedFromRow).toBe(2);
    });
  });
});
