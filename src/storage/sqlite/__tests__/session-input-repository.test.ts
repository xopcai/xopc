import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  appendTranscriptEntry,
  cancelQueuedSessionInput,
  claimNextSessionInput,
  closeXopcDatabase,
  ensureSessionRecord,
  findSessionInput,
  finishSessionInputRun,
  getSessionInputState,
  insertSessionInput,
  loadTranscriptRowsForSession,
  mutateQueuedSessionInput,
  openXopcDatabase,
  recoverSessionInputState,
  resetXopcDatabaseSingletonForTest,
} from '../index.js';

describe('session input repository', () => {
  let dir: string;
  const sessionKey = 'agent:main:webchat:default:direct:test';
  const origin = { type: 'endpoint' as const, endpointId: 'endpoint-test' };

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
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'one', origin,
    });
    const retry = insertSessionInput({
      id: 'server-other', sessionKey, clientMessageId: 'client-1',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'duplicate', origin,
    });
    insertSessionInput({
      id: 'server-2', sessionKey, clientMessageId: 'client-2',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'two', origin,
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
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'before', origin,
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
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'running', origin,
    });
    insertSessionInput({
      id: 'queued', sessionKey, clientMessageId: 'queued-client',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'queued', origin,
    });
    claimNextSessionInput(sessionKey, 'run-1');

    expect(recoverSessionInputState()).toContain(sessionKey);
    expect(getSessionInputState(sessionKey).inputs.map((row) => [row.id, row.status])).toEqual([
      ['running', 'interrupted'],
      ['queued', 'queued'],
    ]);
  });

  it('persists context snapshots without publishing their full text in queue state', () => {
    insertSessionInput({
      id: 'context-input', sessionKey, clientMessageId: 'client-context',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'compare', origin,
      contextRefs: [{ kind: 'note', sourceId: 'note-1', version: '1', title: 'Plan' }],
      contextSnapshots: [{ kind: 'note', sourceId: 'note-1', version: '1', title: 'Plan', text: 'private note body' }],
    });

    expect(getSessionInputState(sessionKey).inputs[0]).toMatchObject({
      contextRefs: [{ sourceId: 'note-1', title: 'Plan' }],
    });
    expect(getSessionInputState(sessionKey).inputs[0]?.contextSnapshots).toBeUndefined();
    expect(claimNextSessionInput(sessionKey, 'context-run')?.contextSnapshots?.[0]?.text)
      .toBe('private note body');
  });

  it('copies safe context summaries to the persisted user message', () => {
    ensureSessionRecord(sessionKey, dir);
    insertSessionInput({
      id: 'context-transcript', sessionKey, clientMessageId: 'client-context-transcript',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'compare', origin,
      contextRefs: [{ kind: 'note', sourceId: 'note-1', version: '1', title: 'Plan' }],
      contextSnapshots: [{ kind: 'note', sourceId: 'note-1', version: '1', title: 'Plan', text: 'private note body' }],
    });
    claimNextSessionInput(sessionKey, 'context-transcript-run');

    appendTranscriptEntry(sessionKey, {
      role: 'user',
      content: 'compare',
      turnId: 'context-transcript-run',
    } as never);

    expect(loadTranscriptRowsForSession(sessionKey)[0]).toMatchObject({
      metadata: {
        sourceContexts: [{ kind: 'note', sourceId: 'note-1', version: '1', title: 'Plan' }],
      },
    });
    expect(JSON.stringify(loadTranscriptRowsForSession(sessionKey)[0])).not.toContain('private note body');
  });

  it('updates or clears frozen context snapshots with a queued edit', () => {
    const row = insertSessionInput({
      id: 'context-edit', sessionKey, clientMessageId: 'client-context-edit',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'compare', origin,
      contextRefs: [{ kind: 'note', sourceId: 'note-1', version: '1', title: 'Old' }],
      contextSnapshots: [{ kind: 'note', sourceId: 'note-1', version: '1', title: 'Old', text: 'old body' }],
    });

    expect(mutateQueuedSessionInput({
      sessionKey,
      id: row.id,
      version: row.version,
      contextRefs: [],
      contextSnapshots: [],
    })).toBe(true);
    const updated = findSessionInput(sessionKey, row.clientMessageId);
    expect(updated?.contextRefs).toEqual([]);
    expect(updated?.contextSnapshots).toEqual([]);
  });
});
