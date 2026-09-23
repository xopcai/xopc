import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import * as modelCalls from '../../providers/model-call.js';
import { seedTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { ConfigSchema } from '../../config/schema.js';
import { DurableState } from '../../storage/sqlite/durable-state.js';
import {
  closeXopcDatabase,
  getSessionConfig,
  openXopcDatabase,
  patchSessionMetadata,
  resetXopcDatabaseSingletonForTest,
  setSessionConfig,
} from '../../storage/sqlite/index.js';
import { SessionStore } from '../store.js';
import { isMediaUriReferencedByLiveSession } from '../../media/session-references.js';

function compactionResult(messages: any[], summary: string, firstKeptIndex: number, tokensBefore: number, tokensAfter: number) {
  return {
    summary,
    messages: [{ role: 'user' as const, content: summary }, ...messages.slice(firstKeptIndex)],
    firstKeptIndex,
    tokensBefore,
    tokensAfter,
    compacted: true,
    plannerVersion: 3 as const,
    summaryModelRef: 'test/model',
    qualityAudit: 'passed' as const,
    handover: { version: 1 as const, sourceThroughSeq: firstKeptIndex, items: [] },
    audit: { status: 'passed' as const, mode: 'structural' as const, missingItemsFound: 0, repaired: false },
  };
}

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
    seedTestAgentCatalog({
      defaults: {
        models: { chat: { primary: 'test/test-model', fallbacks: [] }, intents: {} },
        skills: { mode: 'all-enabled', exclude: [] },
        tools: {}, workflows: {}, runtime: {},
      },
      agents: [
        { id: 'coder', enabled: true, workspace: join(tempDir, 'coder') },
        { id: 'main', enabled: true, profile: { name: 'Main' }, workspace: join(tempDir, 'main') },
      ],
    });
    store = new SessionStore({
      config: ConfigSchema.parse({}),
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

  it('rejects late native voice writes after a session reset or deletion', async () => {
    const key = "bf90ce93-d857-48d5-8993-ac0938772d32";
    await store.saveMessages(key, [], { metadata: { agentId: "main" } });
    const expectedTranscriptId = (await store.getMetadata(key))!.transcriptId;
    const entry = { customType: 'voice_omni_transcript', content: 'Hello', expectedTranscriptId };
    await store.appendTranscriptCustomMessageEntry(key, entry);
    await store.reset(key);
    await expect(store.appendTranscriptCustomMessageEntry(key, entry)).rejects.toThrow('session changed');
    await store.delete(key);
    await expect(store.appendTranscriptCustomMessageEntry(key, entry)).rejects.toThrow('session changed');
    expect(await store.getMetadata(key)).toBeNull();
  });

  describe('routing metadata', () => {
    it('persists explicit routing metadata', async () => {
      const messages: any[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ];

      await store.saveMessages("54d65c33-c4f8-4326-855d-00c3540fcc3d", messages, {
        metadata: directMetadata('main', 'telegram', '123456'),
      });
      const metadata = await store.getMetadata("54d65c33-c4f8-4326-855d-00c3540fcc3d");

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

      await store.saveMessages("6b4d87b5-4b3c-410f-847a-b168d3ed6774", messages, { metadata: { agentId: "main" } });
      const metadata = await store.getMetadata("6b4d87b5-4b3c-410f-847a-b168d3ed6774");

      expect(metadata?.routing).toBeUndefined();
      expect(metadata?.sourceChannel).toBe('');
      expect(metadata?.sourceChatId).toBe('');
    });

    it('rejects non-UUID conversation identifiers', async () => {
      await expect(store.saveMessages('invalid-key', [{ role: 'user', content: 'Test' }], { metadata: { agentId: 'main' } })).rejects.toThrow();
    });
  });

  describe('message persistence (SQLite)', () => {
    it('removes a failed assistant row and resumes the persisted user row for model fallback', async () => {
      const key = "d6ac9492-a795-4128-899a-9dc8224e0143";
      await store.saveMessages(key, [
        { role: 'user', content: 'previous question', timestamp: 1 },
        { role: 'assistant', content: 'previous answer', timestamp: 2 },
      ] as any[], { metadata: { agentId: "main" } });
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
      const key = "fd9623c6-35c5-4ae6-8441-ebb7cbf0d091";
      await store.saveMessages(key, [{ role: 'user', content: 'hello', timestamp: Date.now() }], { metadata: { agentId: "main" } });

      const result = await store.list();

      expect(result.items[0]?.cwd).toBe(join(tempDir, 'main'));
    });

    it('should reset in place with archived transcript and new session id', async () => {
      const key = "90e3009c-8012-49ad-8383-451eba94fab1";
      await store.saveMessages(key, [{ role: 'user', content: 'hello', timestamp: Date.now() }], { metadata: { agentId: "main" } });
      const before = await store.getMetadata(key);
      const task = await store.reset(key);
      expect(task?.previousTranscriptId).toBe(before?.transcriptId);
      expect(task?.transcriptId).not.toBe(before?.transcriptId);
      const after = await store.getMetadata(key);
      expect(after?.key).toBe(key);
      expect(after?.transcriptId).toBe(task?.transcriptId);
      expect(await store.loadMessages(key)).toHaveLength(0);
    });

    it('should save and load messages', async () => {
      const key = "54d65c33-c4f8-4326-855d-00c3540fcc3d";
      const messages: any[] = [
        { role: 'user', content: 'Hello', timestamp: Date.now() },
        { role: 'assistant', content: 'Hi there!', timestamp: Date.now() },
      ];

      await store.saveMessages(key, messages, { metadata: { agentId: "main" } });
      const loaded = await store.loadMessages(key);

      expect(loaded).toHaveLength(2);
      expect(loaded[0].role).toBe('user');
      expect(loaded[1].role).toBe('assistant');
    });

    it('should preserve cache token usage on assistant transcript rows', async () => {
      const key = "c81adf4c-bacc-4308-8a8f-1ee23364f738";
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
      ] as any[], { metadata: { agentId: "main" } });

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
      const key = "f3a98a16-132a-445f-839f-7269a1a6bd96";
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

      await store.saveMessages(key, messages, { metadata: { agentId: "main" } });

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
      const key = "db8c8719-31b2-49aa-82c1-a218c9b2abd1";
      const messages: any[] = Array.from({ length: 5 }, (_, index) => ({
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `message-${index}`,
        timestamp: Date.now() + index,
      }));

      await store.saveMessages(key, messages, { metadata: { agentId: "main" } });
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
      await store.saveMessages("59f80d11-e306-490c-87ab-85331abb7a03", [{ role: 'user', content: '1' }], {
        metadata: directMetadata('main', 'telegram', '1'),
      });
      await store.saveMessages("af34adee-cf8a-4e10-86c0-454ff411e61e", [{ role: 'user', content: '2' }], {
        metadata: directMetadata('main', 'discord', '2'),
      });

      const telegramSessions = await store.list({ channel: 'telegram' });
      expect(telegramSessions.items).toHaveLength(1);
      expect(telegramSessions.items[0].sourceChannel).toBe('telegram');
    });

    it('does not list by channel when explicit sourceChannel is absent', async () => {
      const key = "08ff09ee-fb33-4ff2-87c1-e48af00f0b22";
      await store.saveMessages(key, [{ role: 'user', content: 'x', timestamp: Date.now() }], { metadata: { agentId: "main" } });

      const listed = await store.list({ channel: 'webchat,gateway' });
      expect(listed.items.some((s) => s.key === key)).toBe(false);
    });

    it('lists webchat sessions from other agents in the shared database', async () => {
      const key = "771292a2-3f40-4588-8bbe-2e9887cd9d11";
      await store.saveMessages(key, [{ role: 'user', content: 'x', timestamp: Date.now() }], {
        metadata: directMetadata('coder', 'webchat', 'standalone'),
      });

      const listed = await store.list({ channel: 'webchat,gateway' });
      expect(listed.items.some((session) => session.key === key)).toBe(true);
    });

    it('invalidates aggregate cache when a session is written through the same store', async () => {
      const before = await store.list({ channel: 'webchat' });
      expect(before.items).toHaveLength(0);

      const key = "b115d534-07be-41ed-8c1d-8ba8ccdacd28";
      await store.saveMessages(key, [{ role: 'user', content: 'x', timestamp: Date.now() }], {
        metadata: directMetadata('main', 'webchat', 'cache-write'),
      });

      const after = await store.list({ channel: 'webchat' });
      expect(after.items.some((session) => session.key === key)).toBe(true);
    });

    it('should list sessions with status filter', async () => {
      await store.saveMessages("59f80d11-e306-490c-87ab-85331abb7a03", [{ role: 'user', content: '1' }], { metadata: { agentId: "main" } });
      await store.saveMessages("c5e4d2ab-ee5b-4cdf-8f80-5491b9c42080", [{ role: 'user', content: '2' }], { metadata: { agentId: "main" } });

      await store.archive("59f80d11-e306-490c-87ab-85331abb7a03");

      const activeSessions = await store.list({ status: 'active' });
      expect(activeSessions.items).toHaveLength(1);
      expect(activeSessions.items[0].key).toBe("c5e4d2ab-ee5b-4cdf-8f80-5491b9c42080");
    });

    it('should list sessions by message content search', async () => {
      const targetKey = "bdcfec8d-3082-44bb-822f-32af29ee17b1";
      await store.saveMessages(targetKey, [
        { role: 'user', content: 'please remember alpha-session-keyword', timestamp: Date.now() },
      ], { metadata: { agentId: "main" } });
      await store.saveMessages("68e9b273-18e6-4779-861f-ccc6f67ab5a3", [
        { role: 'user', content: 'unrelated message', timestamp: Date.now() + 1 },
      ], { metadata: { agentId: "main" } });

      const result = await store.list({ search: 'alpha-session-keyword' });
      expect(result.items.map((session) => session.key)).toEqual([targetKey]);
    });

    it('matches any meaningful term in a multi-keyword session search', async () => {
      const targetKey = "79730afb-3268-4494-80ce-857cd7a5aaf8";
      await store.saveMessages(targetKey, [
        { role: 'user', content: '继续处理 xopc-platform 的部署工作', timestamp: Date.now() },
      ], { metadata: { agentId: "main" } });

      const result = await store.list({ search: 'xopc-platform 工作 用户' });

      expect(result.items.map((session) => session.key)).toContain(targetKey);
    });
  });

  describe('transcript document (synthetic)', () => {
    it('persists stable session id across saves', async () => {
      const key = "e23c0c53-db93-4c5b-8567-651443f4b6c6";
      await store.saveMessages(key, [{ role: 'user', content: 'a' }], { metadata: { agentId: "main" } });
      const doc1 = await store.loadTranscriptDocument(key);
      expect(doc1).not.toBeNull();
      expect(doc1?.type).toBe('xopc_session_transcript');
      expect(doc1?.id?.length).toBeGreaterThan(0);
      const id1 = doc1!.id;

      await store.saveMessages(key, [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ], { metadata: { agentId: "main" } });
      const doc2 = await store.loadTranscriptDocument(key);
      expect(doc2?.id).toBe(id1);
      const loaded = await store.loadMessages(key);
      expect(loaded).toHaveLength(2);
    });

    it('includes transcriptSummary on get when requested', async () => {
      const key = "8b656f05-7479-43e8-88d7-4b90cd5ca92b";
      await store.saveMessages(key, [{ role: 'user', content: 'z' }], { metadata: { agentId: "main" } });
      const detail = await store.get(key, { includeTranscriptSummary: true });
      expect(detail?.transcriptSummary?.id).toBeDefined();
      expect(detail?.transcriptSummary?.compactionCount).toBe(0);
      const bare = await store.get(key);
      expect(bare?.transcriptSummary).toBeUndefined();
    });

    it('persists model-visible refresh once with a full-history boundary and retains raw records', async () => {
      const key = '287932da-0911-4cac-b186-c1a784a4e6e1';
      const raw = [{ role: 'user' as const, content: 'Original request', timestamp: 1 }];
      await store.saveMessages(key, raw, { metadata: { agentId: 'main' } });
      const refreshModule = await import('../../agent/reply/post-compaction-context.js');
      const refresh = vi.spyOn(refreshModule, 'readPostCompactionContext').mockReturnValue('[Post-compaction context refresh] Follow the rules.');
      try {
        const result = compactionResult(raw, 'Summary', 1, 100, 10);
        await store.applyCompaction(key, result);
        const loaded = await store.loadMessages(key);
        expect(loaded).toHaveLength(2);
        expect(loaded[1]?.content).toContain('Follow the rules.');
        expect(await store.loadMessages(key)).toEqual(loaded);
        const rows = await store.loadTranscriptRows(key);
        expect(rows).toContainEqual(expect.objectContaining({ role: 'user', content: 'Original request' }));
        expect(rows.filter((row) => (row as any).type === 'compaction')).toHaveLength(1);
      } finally {
        refresh.mockRestore();
      }
    });

    it('appends compaction record when applyCompaction runs', async () => {
      const key = "0970cb0f-77c9-4e7f-8dd9-25aa0ad6506c";
      const msgs = Array.from({ length: 12 }, (_, i) => ({
        role: 'user' as const,
        content: `line-${i}`,
        timestamp: Date.now() + i,
      }));
      await store.saveMessages(key, msgs, { metadata: { agentId: "main" } });
      const result = compactionResult(msgs, 'condensed topic', 8, 9000, 1200);
      await store.applyCompaction(key, result);
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
      await expect(store.getCompactionStats(key)).resolves.toMatchObject({
        compactionCount: 1,
        auditPassedCount: 1,
        auditDegradedCount: 0,
        auditMissingItemsFound: 0,
      });
    });

    it('emits unified before and after hooks around a successful compaction', async () => {
      const key = "a6ad999c-cf3b-4ed3-81da-4c9d390d0462";
      const messages = Array.from({ length: 12 }, (_, index) => ({
        role: 'user' as const,
        content: `line-${index}`,
      }));
      await store.saveMessages(key, messages, { metadata: { agentId: "main" } });
      const before = vi.fn();
      const after = vi.fn();
      store.setCompactionHooks({ before, after });
      vi.spyOn((store as any).compactor, 'compact').mockResolvedValue({
        ...compactionResult(messages, 'condensed topic', 8, 9_000, 1_200),
      });

      await store.compact(key, messages, { provider: 'test', id: 'model' } as any);

      expect(before).toHaveBeenCalledWith(expect.objectContaining({
        conversationId: key,
        messageCount: 12,
      }));
      expect(after).toHaveBeenCalledWith({
        conversationId: key,
        messageCount: 5,
        tokenCount: 1_200,
        compactedCount: 8,
      });
    });

    it('persists chunk progress in SQLite and clears it only after the boundary is committed', async () => {
      const key = 'a31b9f8a-37b3-4c4a-a6d1-7d433f6d58ee';
      const messages = Array.from({ length: 12 }, (_, index) => ({
        role: 'user' as const,
        content: `line-${index}`,
      }));
      await store.saveMessages(key, messages, { metadata: { agentId: 'main' } });
      const state = new DurableState<unknown>('session-compaction-progress', key);
      vi.spyOn((store as any).compactor, 'compact').mockImplementation(async (...args: any[]) => {
        args[4].checkpoint.save({ marker: 'saved' });
        expect(state.get('active')).toEqual({ marker: 'saved' });
        return compactionResult(messages, 'condensed topic', 8, 9_000, 1_200);
      });

      await store.compact(key, messages, { provider: 'test', id: 'model' } as any);

      expect(state.get('active')).toBeUndefined();
      expect(await store.listCompactionBoundaries(key)).toHaveLength(1);
    });

    it('loads the configured cap and refreshes it for subsequent compactions', async () => {
      const config = ConfigSchema.parse({ userContext: { contextPlanning: { compaction: { summaryMaxTokens: 2_000 } } } });
      const configuredStore = new SessionStore({ config });
      const key = "7f161174-997c-4091-8a2c-43e23391c09f";
      const messages = Array.from({ length: 12 }, (_, index) => ({ role: 'user' as const, content: `item-${index}` }));
      await configuredStore.saveMessages(key, messages, { metadata: { agentId: "main" } });
      const completion = vi.spyOn(modelCalls, 'completeWithResolvedCredentials').mockResolvedValue({
        content: [], stopReason: 'length',
      } as never);
      const model = { provider: 'test', id: 'summary', reasoning: true, contextWindow: 128_000, maxTokens: 8_000 } as never;
      try {
        await expect(configuredStore.compact(key, messages, model, undefined, true)).rejects.toThrow('truncated');
        expect(completion.mock.calls.map((call) => call[2]?.maxTokens)).toEqual([2_000]);
        completion.mockClear();
        configuredStore.updateConfig(ConfigSchema.parse({ userContext: { contextPlanning: { compaction: { summaryMaxTokens: 8_000 } } } }));
        await expect(configuredStore.compact(key, messages, model, undefined, true)).rejects.toThrow('truncated');
        expect(completion.mock.calls.map((call) => call[2]?.maxTokens)).toEqual([4_000, 8_000]);
        expect(await configuredStore.listCompactionBoundaries(key)).toEqual([]);
      } finally {
        completion.mockRestore();
      }
    });

    it('preserves SQLite history and boundaries when every summary is truncated', async () => {
      const key = "62dc9c71-fb74-460e-853e-01d5ba8d75d8";
      const messages = Array.from({ length: 12 }, (_, index) => ({
        role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
        content: `line-${index}`,
      }));
      await store.saveMessages(key, messages, { metadata: { agentId: "main" } });
      const before = await store.loadTranscriptRows(key);
      const afterHook = vi.fn();
      store.setCompactionHooks({ after: afterHook });
      const completion = vi.spyOn(modelCalls, 'completeWithResolvedCredentials').mockResolvedValue({
        content: [{ type: 'text', text: '{"upserts":[' }], stopReason: 'length', usage: { output: 8_000 },
      } as never);
      try {
        await expect(store.compact(key, messages, {
          provider: 'test', id: 'summary', reasoning: true, contextWindow: 128_000, maxTokens: 8_000,
        } as never, undefined, true)).rejects.toThrow('truncated');
        expect(await store.loadTranscriptRows(key)).toEqual(before);
        expect(await store.listCompactionBoundaries(key)).toEqual([]);
        expect(afterHook).not.toHaveBeenCalled();
        expect(completion).toHaveBeenCalledTimes(2);
      } finally {
        completion.mockRestore();
      }
    });

    it('preserves the authoritative transcript while loading compacted LLM context', async () => {
      const key = "6a9005f4-dd13-4ac1-8483-92cc0e452bf9";
      const msgs = Array.from({ length: 12 }, (_, i) => ({
        role: 'user' as const,
        content: `m-${i}`,
        timestamp: Date.now() + i,
      }));
      await store.saveMessages(key, msgs, { metadata: { agentId: "main" } });
      const result = compactionResult(msgs, 's', 8, 8000, 500);
      await store.applyCompaction(key, result);

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
      const key = "77338d46-062d-4ce7-83b2-adbaa9c42e7f";
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
      await store.saveMessages(key, messages, { metadata: { agentId: "main" } });
      await store.applyCompaction(
        key,
        compactionResult(messages, 'includes deleted turn', 6, 8000, 500),
      );

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
      const key = "5469260f-3b2e-41a0-81a1-9ad26877a9a1";
      await expect(store.saveMessages(key, [
        { role: 'user', content: '<coding_context>derived</coding_context>', droppable: true },
      ] as any[], { metadata: { agentId: "main" } })).rejects.toThrow('Runtime-only messages cannot be persisted');
    });
  });

  describe('transcript context rows', () => {
    it('appendTranscriptContextEntry keeps row on disk but loadMessages returns LLM only', async () => {
      const key = "c2ffb633-6249-4b3b-86e9-a5e4047b068d";
      await store.saveMessages(key, [{ role: 'user', content: 'hi' }], { metadata: { agentId: "main" } });
      await store.appendTranscriptContextEntry(key, { text: 'audit', id: 'e1' });
      const llm = await store.loadMessages(key);
      expect(llm).toHaveLength(1);
      const doc = await store.loadTranscriptDocument(key);
      expect(doc?.messages.length).toBe(2);
      const row = doc!.messages[1] as { kind?: string };
      expect(row.kind).toBe('context');
    });

    it('appendTranscriptLabelEntry keeps row on disk but loadMessages returns LLM only', async () => {
      const key = "b2b0ef92-a0c3-4c54-8089-3b8e6290fdb7";
      await store.saveMessages(key, [{ id: 'u1', role: 'user', content: 'hi' }], { metadata: { agentId: "main" } });
      await store.appendTranscriptLabelEntry(key, { targetId: 'u1', label: 'important' });
      const llm = await store.loadMessages(key);
      expect(llm).toHaveLength(1);
      const rows = await store.loadTranscriptRows(key);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({ type: 'label', targetId: 'u1', label: 'important' });
    });

    it('appendTranscriptCustomEntry keeps extension state on disk but loadMessages returns LLM only', async () => {
      const key = "f54879a6-a703-42ce-8ecd-9ae14ca49d4d";
      await store.saveMessages(key, [{ role: 'user', content: 'hi' }], { metadata: { agentId: "main" } });
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
      const key = "77e17f84-d2d9-4efd-8e50-3d6cca82f024";
      await store.saveMessages(key, [{ role: 'user', content: 'hi' }], { metadata: { agentId: "main" } });
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
      const key = "ef6b5993-cdb5-4397-8985-c5c873f1490f";
      await store.saveMessages(key, [{ role: 'user', content: 'hi' }], { metadata: { agentId: "main" } });
      await store.appendTranscriptContextEntry(key, { text: 'export_note', id: 'n1' });
      const json = await store.exportSession(key, 'json');
      const parsed = JSON.parse(json) as { transcriptRows?: unknown[]; messages?: unknown[] };
      expect(parsed.transcriptRows?.length).toBe(2);
      expect(parsed.messages?.length).toBe(1);
    });

    it('importSessionExport restores transcript rows into a new session', async () => {
      const source = "a8b281c3-29fb-44bf-8fdf-7aa94e02380e";
      const target = "8796506e-37be-458e-8a44-303f0c414f15";
      await store.saveMessages(source, [{ role: 'user', content: 'hi' }], { metadata: { agentId: "main" } });
      await store.appendTranscriptContextEntry(source, { text: 'import_note', id: 'i1' });
      patchSessionMetadata(source, { name: 'Import Source', tags: ['demo'] });

      const json = await store.exportSession(source, 'json');
      const result = await store.importSessionExport(target, json);

      expect(result).toEqual({ conversationId: target, rowCount: 2 });
      expect(await store.loadMessages(target)).toHaveLength(1);
      const rows = await store.loadTranscriptRows(target);
      expect(rows).toHaveLength(2);
      const targetMeta = await store.getMetadata(target);
      expect(targetMeta?.name).toBe('Import of Import Source');
      expect(targetMeta?.tags).toContain('demo');
      expect(targetMeta?.tags).toContain('import');
      expect(targetMeta?.customData?.importedFromConversationId).toBe(source);
      expect(targetMeta?.customData?.importedAt).toEqual(expect.any(String));
    });

    it('forkSession clones transcript rows into a new session', async () => {
      const source = "66a6c7ce-15a4-4fd7-85c1-37ab14bcbf21";
      const target = "19a4c09e-fac1-4f18-8ac4-67bfaaa896d9";
      await store.saveMessages(source, [{ role: 'user', content: 'hi' }], { metadata: { agentId: "main" } });
      await store.appendTranscriptContextEntry(source, { text: 'fork_note', id: 'f1' });
      patchSessionMetadata(source, { name: 'Source Session', tags: ['demo'] });

      const result = await store.forkSession(source, target);

      expect(result).toEqual({ conversationId: target, rowCount: 2 });
      expect(await store.loadMessages(target)).toHaveLength(1);
      const targetDoc = await store.loadTranscriptDocument(target);
      expect(targetDoc?.messages).toHaveLength(2);
      const targetMeta = await store.getMetadata(target);
      expect(targetMeta?.name).toBe('Fork of Source Session');
      expect(targetMeta?.tags).toContain('demo');
      expect(targetMeta?.tags).toContain('fork');
      expect(targetMeta?.customData?.forkedFromConversationId).toBe(source);
      expect(targetMeta?.customData?.forkedFromTranscriptId).toBeTruthy();
      expect(targetMeta?.customData?.forkedAt).toEqual(expect.any(String));
    });

    it('createSessionFromRows atomically stores hidden origin context, visible messages, and config', async () => {
      const target = '128565a4-35a8-4a20-b3bd-0b53d8851595';
      const parent = { role: 'user', content: 'parent context' } as const;
      const sideUser = { role: 'user', content: 'side question' } as const;
      const sideAssistant = { role: 'assistant', content: 'side answer' } as const;

      const result = await store.createSessionFromRows({
        targetKey: target,
        cwd: tempDir,
        metadata: {
          ...directMetadata('main', 'webchat', 'promoted-side-chat'),
          agentId: 'main',
          parentConversationId: '3384531d-0277-47d1-99ea-52da74f0a9ca',
        },
        rows: [{
          type: 'side_chat_origin',
          version: 1,
          parentConversationId: '3384531d-0277-47d1-99ea-52da74f0a9ca',
          parentTranscriptId: 'parent-transcript',
          createdAt: '2026-09-23T00:00:00.000Z',
          contentHash: 'hash',
          contextMessages: [parent],
        }, sideUser, sideAssistant],
        config: { modelOverride: 'test/model', thinkingLevel: 'high' },
      });

      expect(result).toEqual({ conversationId: target, rowCount: 3 });
      expect(await store.loadMessages(target)).toEqual([parent, sideUser, sideAssistant]);
      expect((await store.get(target))?.messages).toEqual([sideUser, sideAssistant]);
      expect(getSessionConfig(target)).toMatchObject({ modelOverride: 'test/model', thinkingLevel: 'high' });
    });

    it('forkSessionRows clones transcript rows through the selected row', async () => {
      const source = "ebb80a63-9bcd-494c-83dc-df198a0c48c2";
      const target = "856a74d8-261e-4005-865d-0d3c718c8da6";
      await store.saveMessages(source, [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'answer' },
        { role: 'user', content: 'second' },
      ], { metadata: { agentId: "main" } });

      const result = await store.forkSessionRows(source, target, { throughRow: 2 });

      expect(result).toEqual({ conversationId: target, rowCount: 2 });
      const rows = await store.loadTranscriptRows(target);
      expect(rows).toHaveLength(2);
      expect(await store.loadMessages(target)).toHaveLength(2);
      const targetMeta = await store.getMetadata(target);
      expect(targetMeta?.customData?.forkedFromConversationId).toBe(source);
      expect(targetMeta?.customData?.forkedFromRow).toBe(2);
    });

    it('forkSessionAtTurn atomically copies a completed turn and inherited provenance', async () => {
      const source = "050a46a5-7661-40af-8e6a-ecf2b03e74fb";
      const target = "e86ad038-f894-4032-88d2-5e3e7ac4b0fe";
      await store.saveMessages(source, [
        { role: 'user', content: 'first', turnId: 'turn-1' },
        { role: 'assistant', content: 'answer one', turnId: 'turn-1' },
        { role: 'user', content: 'second', turnId: 'turn-2' },
        { role: 'assistant', content: 'answer two', turnId: 'turn-2' },
      ], { metadata: directMetadata('main', 'webchat', 'fork-turn-source') });
      patchSessionMetadata(source, {
        name: 'Source Session',
        tags: ['demo'],
        projectId: 'project-1',
        customData: { retained: true },
      });
      setSessionConfig(source, {
        thinkingLevel: 'high',
        modelOverride: 'test/fork-model',
        workingDirectoryOverride: join(tempDir, 'fork-workspace'),
        responseLanguage: 'zh',
      }, join(tempDir, 'main'));

      const result = await store.forkSessionAtTurn(source, {
        targetKey: target,
        lastTurnId: 'turn-1',
        targetMetadata: directMetadata('main', 'webchat', 'fork-turn-target'),
      });

      expect(result).toEqual({ conversationId: target, rowCount: 2, lastTurnId: 'turn-1' });
      expect((await store.loadTranscriptRows(target)).map((row) => (row as { turnId?: string }).turnId))
        .toEqual(['turn-1', 'turn-1']);
      const targetMeta = await store.getMetadata(target);
      expect(targetMeta).toMatchObject({
        parentConversationId: source,
        projectId: 'project-1',
        hiddenFromSessionList: false,
      });
      expect(targetMeta?.routing?.peerId).toBe('fork-turn-target');
      expect(targetMeta?.customData).toMatchObject({
        retained: true,
        genericNewChatShell: false,
        forkedFromConversationId: source,
        forkedFromTurnId: 'turn-1',
      });
      expect(getSessionConfig(target)).toMatchObject({
        thinkingLevel: 'high',
        modelOverride: 'test/fork-model',
        workingDirectoryOverride: join(tempDir, 'fork-workspace'),
        responseLanguage: 'zh',
      });
    });

    it('forkSessionAtTurn rolls back when the selected turn is not complete', async () => {
      const source = "d56dcc3e-2e0e-4397-8a7b-c3c2ade8e628";
      const target = "8ecce82a-b6ee-4730-8cff-7335208a25c8";
      await store.saveMessages(source, [
        { role: 'user', content: 'still running', turnId: 'turn-running' },
      ], { metadata: { agentId: "main" } });

      await expect(store.forkSessionAtTurn(source, {
        targetKey: target,
        lastTurnId: 'turn-running',
        targetMetadata: directMetadata('main', 'webchat', 'fork-incomplete-target'),
      })).rejects.toThrow('Completed turn not found');
      expect(await store.getMetadata(target)).toBeNull();
    });

    it('forkSessionAtTurn can select a turn retained before an in-place reset', async () => {
      const source = "b6358794-b412-4d8f-8794-d53130f35f1e";
      const target = "5707b0ea-54d3-489d-86a4-47fd3ab3e056";
      await store.saveMessages(source, [
        { role: 'user', content: 'before reset', turnId: 'turn-before-reset' },
        { role: 'assistant', content: 'old answer', turnId: 'turn-before-reset' },
      ], { metadata: { agentId: "main" } });
      await store.reset(source);
      await store.saveMessages(source, [
        { role: 'user', content: 'after reset', turnId: 'turn-after-reset' },
        { role: 'assistant', content: 'new answer', turnId: 'turn-after-reset' },
      ], { metadata: { agentId: "main" } });

      const result = await store.forkSessionAtTurn(source, {
        targetKey: target,
        lastTurnId: 'turn-before-reset',
        targetMetadata: directMetadata('main', 'webchat', 'fork-reset-target'),
      });

      expect(result.rowCount).toBe(2);
      expect(await store.loadMessages(target)).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', content: 'old answer' }),
      ]));
    });

    it('keeps shared media live until every fork is deleted', async () => {
      const source = "0d5347fa-a445-4d88-8787-c412f6fe88cf";
      const target = "575edf7f-430a-4bc6-857d-6d933c1b70c7";
      const uri = 'media://outbound/shared-fork-image.png';
      await store.saveMessages(source, [
        { role: 'user', content: 'make an image', turnId: 'turn-media' },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'done' }],
          attachments: [{ uri }],
          turnId: 'turn-media',
        },
      ], { metadata: { agentId: "main" } });
      await store.forkSessionAtTurn(source, {
        targetKey: target,
        lastTurnId: 'turn-media',
        targetMetadata: directMetadata('main', 'webchat', 'fork-media-target'),
      });

      expect(isMediaUriReferencedByLiveSession(uri)).toBe(true);
      await store.delete(source);
      expect(isMediaUriReferencedByLiveSession(uri)).toBe(true);
      await store.delete(target);
      expect(isMediaUriReferencedByLiveSession(uri)).toBe(false);
    });
  });
});
