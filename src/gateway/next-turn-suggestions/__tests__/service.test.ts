import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NextTurnSuggestionService } from '../service.js';
import { readSuggestionSnapshot } from '../snapshot.js';
import { parseSuggestionOutput, generateNextTurnSuggestion } from '../generator.js';
import { ConfigSchema } from '../../../config/schema.js';
import { appendTranscriptEntry, claimNextSessionInput, closeXopcDatabase, ensureSessionRecord, finishSessionInputRun,
  getCurrentTranscriptId, insertSessionInput, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../storage/sqlite/index.js';
import { deleteSessionRecord, resetSessionRecord } from '../../../storage/sqlite/session-repository.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { recordNextTurnSuggestionFeedback } from '../../../storage/sqlite/next-turn-suggestion-repository.js';

describe('next turn suggestions', () => {
  let dir: string;
  let service: NextTurnSuggestionService;
  const conversationId = '78fcccd3-a14f-4a70-87d9-69d9471f63d7';
  const emit = vi.fn();
  const generate = vi.fn<typeof generateNextTurnSuggestion>();
  const origin = { type: 'endpoint' as const, endpointId: 'test-endpoint' };
  function completed(status: 'completed' | 'failed' | 'cancelled' | 'suspended' = 'completed') {
    ensureSessionRecord(conversationId, '', { agentId: 'main', sessionType: 'chat' });
    const runId = randomUUID();
    insertSessionInput({ conversationId, id: randomUUID(), clientMessageId: randomUUID(),
      expectedTranscriptId: getCurrentTranscriptId(conversationId)!, requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: '先给方案，不要实现', origin });
    claimNextSessionInput(conversationId, runId);
    appendTranscriptEntry(conversationId, { role: 'user', content: '先给方案，不要实现', timestamp: 1 });
    appendTranscriptEntry(conversationId, { role: 'assistant', content: [{ type: 'text', text: '方案完成，第一阶段需要确认范围。' }] } as never);
    finishSessionInputRun(conversationId, runId, status);
    return runId;
  }
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-next-turn-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    generate.mockReset().mockResolvedValue('把第一阶段拆成可评审的任务');
    emit.mockReset();
    service = new NextTurnSuggestionService({ getConfig: () => ConfigSchema.parse({}), emit,
      isAcceptingInput: () => false, generate, resolveModel: () => 'test/fast', timeoutMs: 30 });
  });
  afterEach(() => {
    service.dispose();
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  it('generates once for a successful idle version, persists across service instances, and keeps predictions out of transcript', async () => {
    const runId = completed();
    const before = getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM transcript_entries').get();
    expect(service.get(conversationId, 'zh')).toEqual({ status: 'pending' });
    expect(service.get(conversationId, 'zh')).toEqual({ status: 'pending' });
    await vi.waitFor(() => expect(service.get(conversationId, 'zh').status).toBe('ready'));
    const result = service.get(conversationId, 'zh');
    expect(result.suggestion).toMatchObject({ sourceRunId: runId, locale: 'zh', prompt: '把第一阶段拆成可评审的任务' });
    expect(generate).toHaveBeenCalledOnce();
    expect(getSqliteDatabase().prepare('SELECT COUNT(*) AS n FROM transcript_entries').get()).toEqual(before);
    const second = new NextTurnSuggestionService({ getConfig: () => ConfigSchema.parse({}), emit,
      isAcceptingInput: () => false, generate, resolveModel: () => 'test/fast' });
    expect(second.get(conversationId, 'zh')).toEqual(result);
    second.dispose();
  });

  it.each(['failed', 'cancelled', 'suspended'] as const)('does not predict after %s', status => {
    completed(status);
    expect(service.get(conversationId, 'zh').status).toBe('none');
    expect(generate).not.toHaveBeenCalled();
  });

  it('does not predict while a queued input or active run exists', () => {
    completed();
    insertSessionInput({ conversationId, id: randomUUID(), clientMessageId: randomUUID(), requestedDelivery: 'next',
      effectiveDelivery: 'next', status: 'queued', content: '继续', origin });
    expect(service.get(conversationId, 'zh').status).toBe('none');
    claimNextSessionInput(conversationId, randomUUID());
    expect(service.get(conversationId, 'zh').status).toBe('none');
    expect(generate).not.toHaveBeenCalled();
  });

  it('discards an old prediction when reset rotates the transcript', async () => {
    completed();
    let resolve!: (prompt: string) => void;
    generate.mockImplementation(() => new Promise(done => { resolve = done; }));
    service.get(conversationId, 'zh');
    resetSessionRecord(conversationId, '');
    resolve('这是旧建议');
    await vi.waitFor(() => expect(service.get(conversationId, 'zh').status).toBe('none'));
    await Promise.resolve();
    expect(getSqliteDatabase().prepare('SELECT * FROM next_turn_suggestions').all()).toHaveLength(0);
  });

  it('invalidates cached suggestions on a new turn and a transcript append', async () => {
    completed();
    service.get(conversationId, 'zh');
    await vi.waitFor(() => expect(service.get(conversationId, 'zh').status).toBe('ready'));
    const first = service.get(conversationId, 'zh').suggestion!.id;
    completed();
    expect(service.get(conversationId, 'zh').status).toBe('pending');
    await vi.waitFor(() => {
      expect(service.get(conversationId, 'zh').status).toBe('ready');
      expect(service.get(conversationId, 'zh').suggestion?.id).not.toBe(first);
    });
    appendTranscriptEntry(conversationId, { role: 'assistant', content: [{ type: 'text', text: '补充：范围已调整。' }] } as never);
    expect(service.get(conversationId, 'zh').status).toBe('pending');
  });

  it('bounds even a provider that ignores abort and caches timeout as none', async () => {
    completed();
    generate.mockImplementation(() => new Promise(() => {}));
    service.get(conversationId, 'zh');
    await vi.waitFor(() => expect(service.get(conversationId, 'zh').status).toBe('none'));
    expect(generate).toHaveBeenCalledOnce();
    expect(service.get(conversationId, 'zh').status).toBe('none');
  });

  it('drops a late prediction when a new input arrives and reclaims the cancelled slot', async () => {
    completed();
    let resolve!: (prompt: string) => void;
    generate.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    service.get(conversationId, 'zh');
    insertSessionInput({ conversationId, id: randomUUID(), clientMessageId: randomUUID(), requestedDelivery: 'next',
      effectiveDelivery: 'next', status: 'queued', content: '改一下范围', origin });
    service.changed(conversationId);
    resolve('旧方案的下一步');
    await Promise.resolve();
    await Promise.resolve();
    expect(service.get(conversationId, 'zh').status).toBe('none');
    expect(getSqliteDatabase().prepare('SELECT * FROM next_turn_suggestions').all()).toHaveLength(0);
  });

  it('separates locale caches and regenerates after TTL expiry', async () => {
    completed();
    service.get(conversationId, 'zh');
    await vi.waitFor(() => expect(service.get(conversationId, 'zh').status).toBe('ready'));
    expect(service.get(conversationId, 'en').status).toBe('pending');
    await vi.waitFor(() => expect(service.get(conversationId, 'en').status).toBe('ready'));
    expect(generate).toHaveBeenCalledTimes(2);
    getSqliteDatabase().prepare("UPDATE next_turn_suggestions SET expires_at = 0 WHERE locale = 'zh'").run();
    expect(service.get(conversationId, 'zh').status).toBe('pending');
    await vi.waitFor(() => expect(service.get(conversationId, 'zh').status).toBe('ready'));
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it('does not send tool output, thinking or audit rows to the predictor', () => {
    completed();
    appendTranscriptEntry(conversationId, { kind: 'context', text: 'AUDIT_SECRET' });
    appendTranscriptEntry(conversationId, { role: 'toolResult', content: [{ type: 'text', text: 'TOOL_SECRET' }] } as never);
    appendTranscriptEntry(conversationId, { role: 'assistant', content: [{ type: 'thinking', thinking: 'THINKING_SECRET' }, { type: 'text', text: '结果完成' }] } as never);
    const snapshot = readSuggestionSnapshot(conversationId);
    expect(JSON.stringify(snapshot)).not.toMatch(/AUDIT_SECRET|TOOL_SECRET|THINKING_SECRET/);
    expect(snapshot?.messages.at(-1)?.text).toBe('结果完成');
  });

  it('deduplicates local feedback, permits submitted after acceptance, and cascades deletion', async () => {
    completed();
    service.get(conversationId, 'zh');
    await vi.waitFor(() => expect(service.get(conversationId, 'zh').status).toBe('ready'));
    const suggestionId = service.get(conversationId, 'zh').suggestion!.id;
    const impressionId = randomUUID();
    expect(recordNextTurnSuggestionFeedback(conversationId, { suggestionId, impressionId, event: 'accepted' })).toBe(true);
    expect(recordNextTurnSuggestionFeedback(conversationId, { suggestionId, impressionId, event: 'accepted' })).toBe(true);
    expect(getSqliteDatabase().prepare('SELECT * FROM next_turn_suggestion_feedback').all()).toHaveLength(1);
    expect(recordNextTurnSuggestionFeedback(randomUUID(), { suggestionId, impressionId, event: 'submitted' })).toBe(false);
    deleteSessionRecord(conversationId);
    expect(getSqliteDatabase().prepare('SELECT * FROM next_turn_suggestions').all()).toHaveLength(0);
    expect(getSqliteDatabase().prepare('SELECT * FROM next_turn_suggestion_feedback').all()).toHaveLength(0);
  });

  it.each(['nonsense', '{"prompt":null}', '{"prompt":"/publish"}', '{"prompt":"https://evil.test"}', '{"prompt":"a\\nb"}', '{"prompt":"<script>bad</script>"}'])('rejects unusable model output %s', raw => {
    expect(parseSuggestionOutput(raw)).toBeNull();
  });
});
