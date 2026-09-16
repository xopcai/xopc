import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  appendTranscriptEntry,
  closeXopcDatabase,
  ensureSessionRecord,
  getSessionInputState,
  insertSessionInput,
  loadTranscriptRowsForSession,
  openXopcDatabase,
  replaceLatestSessionTurnAndQueueInput,
  resetXopcDatabaseSingletonForTest,
} from '../index.js';

describe('session turn replacement repository', () => {
  let dir: string;
  const conversationId = "3f827b2d-fd3b-4b29-80ae-f69bdf895104";
  const origin = { type: 'endpoint' as const, endpointId: 'endpoint-test' };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-session-turn-replace-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    ensureSessionRecord(conversationId, '/tmp/workspace', { agentId: "main" });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  function appendTurn(turnId: string, user: string, assistant: string): void {
    appendTranscriptEntry(conversationId, { role: 'user', content: user, turnId } as never);
    appendTranscriptEntry(conversationId, { role: 'assistant', content: assistant, turnId } as never);
  }

  it('atomically removes the latest turn and queues its replacement', () => {
    appendTurn('turn-1', 'first', 'answer one');
    appendTurn('turn-2', 'old text', 'partial answer');
    appendTranscriptEntry(conversationId, {
      role: 'custom',
      customType: 'status',
      content: 'tool status',
      display: true,
    });
    appendTranscriptEntry(conversationId, {
      kind: 'context',
      text: 'Webchat agent run aborted',
      data: { runId: 'turn-2' },
    });

    const result = replaceLatestSessionTurnAndQueueInput({
      conversationId,
      targetTurnId: 'turn-2',
      clientMessageId: 'replacement-client',
      content: 'new text',
      thinking: 'medium',
      origin,
    });

    expect(result).toMatchObject({ ok: true, idempotent: false });
    expect(loadTranscriptRowsForSession(conversationId)).toEqual([
      expect.objectContaining({ role: 'user', content: 'first', turnId: 'turn-1' }),
      expect.objectContaining({ role: 'assistant', content: 'answer one', turnId: 'turn-1' }),
    ]);
    expect(getSessionInputState(conversationId).inputs).toEqual([
      expect.objectContaining({
        clientMessageId: 'replacement-client',
        content: 'new text',
        status: 'queued',
      }),
    ]);
  });

  it('is idempotent when the client retries after the transaction committed', () => {
    appendTurn('turn-1', 'old text', 'old answer');
    const request = {
      conversationId,
      targetTurnId: 'turn-1',
      clientMessageId: 'replacement-client',
      content: 'new text',
      origin,
    };

    expect(replaceLatestSessionTurnAndQueueInput(request)).toMatchObject({ ok: true, idempotent: false });
    expect(replaceLatestSessionTurnAndQueueInput(request)).toMatchObject({ ok: true, idempotent: true });
    expect(getSessionInputState(conversationId).inputs).toHaveLength(1);
  });

  it('rejects historical turns and leaves the transcript unchanged', () => {
    appendTurn('turn-1', 'first', 'answer one');
    appendTurn('turn-2', 'second', 'answer two');
    const before = loadTranscriptRowsForSession(conversationId);

    expect(replaceLatestSessionTurnAndQueueInput({
      conversationId,
      targetTurnId: 'turn-1',
      clientMessageId: 'replacement-client',
      content: 'edited first',
      origin,
    })).toEqual({ ok: false, code: 'NOT_LATEST' });
    expect(loadTranscriptRowsForSession(conversationId)).toEqual(before);
  });

  it('rolls back without deleting when another input is pending', () => {
    appendTurn('turn-1', 'old text', 'old answer');
    insertSessionInput({
      id: 'already-queued',
      conversationId,
      clientMessageId: 'queued-client',
      requestedDelivery: 'next',
      effectiveDelivery: 'next',
      status: 'queued',
      content: 'queued',
      origin,
    });
    const before = loadTranscriptRowsForSession(conversationId);

    expect(replaceLatestSessionTurnAndQueueInput({
      conversationId,
      targetTurnId: 'turn-1',
      clientMessageId: 'replacement-client',
      content: 'new text',
      origin,
    })).toEqual({ ok: false, code: 'SESSION_BUSY' });
    expect(loadTranscriptRowsForSession(conversationId)).toEqual(before);
  });
});
