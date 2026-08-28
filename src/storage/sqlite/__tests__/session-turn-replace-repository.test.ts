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
  const sessionKey = 'agent:main:webchat:default:direct:replace-test';
  const origin = { type: 'endpoint' as const, endpointId: 'endpoint-test' };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-session-turn-replace-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    ensureSessionRecord(sessionKey, '/tmp/workspace');
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  function appendTurn(turnId: string, user: string, assistant: string): void {
    appendTranscriptEntry(sessionKey, { role: 'user', content: user, turnId } as never);
    appendTranscriptEntry(sessionKey, { role: 'assistant', content: assistant, turnId } as never);
  }

  it('atomically removes the latest turn and queues its replacement', () => {
    appendTurn('turn-1', 'first', 'answer one');
    appendTurn('turn-2', 'old text', 'partial answer');
    appendTranscriptEntry(sessionKey, {
      role: 'custom',
      customType: 'status',
      content: 'tool status',
      display: true,
    });
    appendTranscriptEntry(sessionKey, {
      kind: 'context',
      text: 'Webchat agent run aborted',
      data: { runId: 'turn-2' },
    });

    const result = replaceLatestSessionTurnAndQueueInput({
      sessionKey,
      targetTurnId: 'turn-2',
      clientMessageId: 'replacement-client',
      content: 'new text',
      thinking: 'medium',
      origin,
    });

    expect(result).toMatchObject({ ok: true, idempotent: false });
    expect(loadTranscriptRowsForSession(sessionKey)).toEqual([
      expect.objectContaining({ role: 'user', content: 'first', turnId: 'turn-1' }),
      expect.objectContaining({ role: 'assistant', content: 'answer one', turnId: 'turn-1' }),
    ]);
    expect(getSessionInputState(sessionKey).inputs).toEqual([
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
      sessionKey,
      targetTurnId: 'turn-1',
      clientMessageId: 'replacement-client',
      content: 'new text',
      origin,
    };

    expect(replaceLatestSessionTurnAndQueueInput(request)).toMatchObject({ ok: true, idempotent: false });
    expect(replaceLatestSessionTurnAndQueueInput(request)).toMatchObject({ ok: true, idempotent: true });
    expect(getSessionInputState(sessionKey).inputs).toHaveLength(1);
  });

  it('rejects historical turns and leaves the transcript unchanged', () => {
    appendTurn('turn-1', 'first', 'answer one');
    appendTurn('turn-2', 'second', 'answer two');
    const before = loadTranscriptRowsForSession(sessionKey);

    expect(replaceLatestSessionTurnAndQueueInput({
      sessionKey,
      targetTurnId: 'turn-1',
      clientMessageId: 'replacement-client',
      content: 'edited first',
      origin,
    })).toEqual({ ok: false, code: 'NOT_LATEST' });
    expect(loadTranscriptRowsForSession(sessionKey)).toEqual(before);
  });

  it('rolls back without deleting when another input is pending', () => {
    appendTurn('turn-1', 'old text', 'old answer');
    insertSessionInput({
      id: 'already-queued',
      sessionKey,
      clientMessageId: 'queued-client',
      requestedDelivery: 'next',
      effectiveDelivery: 'next',
      status: 'queued',
      content: 'queued',
      origin,
    });
    const before = loadTranscriptRowsForSession(sessionKey);

    expect(replaceLatestSessionTurnAndQueueInput({
      sessionKey,
      targetTurnId: 'turn-1',
      clientMessageId: 'replacement-client',
      content: 'new text',
      origin,
    })).toEqual({ ok: false, code: 'SESSION_BUSY' });
    expect(loadTranscriptRowsForSession(sessionKey)).toEqual(before);
  });
});
