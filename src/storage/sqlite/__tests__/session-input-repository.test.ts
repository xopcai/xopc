import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  cancelQueuedSessionInput,
  claimNextSessionInput,
  closeXopcDatabase,
  findSessionInput,
  finishSessionInputRun,
  getSessionInputState,
  insertSessionInput,
  mutateQueuedSessionInput,
  openXopcDatabase,
  recoverSessionInputState,
  resetXopcDatabaseSingletonForTest,
} from '../index.js';

describe('session input repository', () => {
  let dir: string;
  const sessionKey = 'agent:main:webchat:default:direct:test';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-session-input-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  it('deduplicates client retries and serializes execution per session', () => {
    const first = insertSessionInput({
      id: 'server-1', sessionKey, clientMessageId: 'client-1',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'one',
    });
    const retry = insertSessionInput({
      id: 'server-other', sessionKey, clientMessageId: 'client-1',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'duplicate',
    });
    insertSessionInput({
      id: 'server-2', sessionKey, clientMessageId: 'client-2',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'two',
    });

    expect(retry.id).toBe(first.id);
    expect(claimNextSessionInput(sessionKey, 'run-1')?.id).toBe('server-1');
    expect(claimNextSessionInput(sessionKey, 'run-overlap')).toBeUndefined();
    expect(finishSessionInputRun(sessionKey, 'run-1', 'completed')).toBe(true);
    expect(claimNextSessionInput(sessionKey, 'run-2')?.id).toBe('server-2');
  });

  it('uses row versions for edits and cancellation', () => {
    const row = insertSessionInput({
      id: 'server-1', sessionKey, clientMessageId: 'client-1',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'before',
    });
    expect(mutateQueuedSessionInput({ sessionKey, id: row.id, version: 99, content: 'bad' })).toBe(false);
    expect(mutateQueuedSessionInput({
      sessionKey, id: row.id, version: row.version, content: 'after', thinking: 'high',
    })).toBe(true);
    const updated = findSessionInput(sessionKey, row.clientMessageId)!;
    expect(updated.content).toBe('after');
    expect(updated.thinking).toBe('high');
    expect(cancelQueuedSessionInput(sessionKey, row.id, row.version)).toBe(false);
    expect(cancelQueuedSessionInput(sessionKey, row.id, updated.version)).toBe(true);
  });

  it('keeps queued work and exposes uncertain in-flight work after restart', () => {
    insertSessionInput({
      id: 'running', sessionKey, clientMessageId: 'running-client',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'running',
    });
    insertSessionInput({
      id: 'queued', sessionKey, clientMessageId: 'queued-client',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'queued',
    });
    claimNextSessionInput(sessionKey, 'run-1');

    expect(recoverSessionInputState()).toContain(sessionKey);
    expect(getSessionInputState(sessionKey).inputs.map((row) => [row.id, row.status])).toEqual([
      ['running', 'interrupted'],
      ['queued', 'queued'],
    ]);
  });
});
