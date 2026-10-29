import { resetSessionRecord } from '../session-repository.js';
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
  getSqliteDatabase,
  insertSessionInput,
  listActiveSessionInputExecutions,
  listActiveSessionInputRuns,
  loadTranscriptRowsForSession,
  mutateQueuedSessionInput,
  openXopcDatabase,
  recoverSessionInputState,
  resetXopcDatabaseSingletonForTest,
} from '../index.js';
import { ensureXopcDatabaseSchema, setSchemaVersion } from '../schema.js';

describe('session input repository', () => {
  let dir: string;
  const conversationId = "78fcccd3-a14f-4a70-87d9-69d9471f63d7";
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
      id: 'server-1', conversationId, clientMessageId: 'client-1',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'one', origin,
    });
    const retry = insertSessionInput({
      id: 'server-other', conversationId, clientMessageId: 'client-1',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'duplicate', origin,
    });
    insertSessionInput({
      id: 'server-2', conversationId, clientMessageId: 'client-2',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'two', origin,
    });

    expect(retry.id).toBe(first.id);
    expect(claimNextSessionInput(conversationId, 'run-1')?.id).toBe('server-1');
    expect(listActiveSessionInputRuns()).toEqual([{ conversationId, runId: 'run-1' }]);
    expect(listActiveSessionInputExecutions()).toEqual([
      expect.objectContaining({ conversationId, runId: 'run-1', origin }),
    ]);
    expect(claimNextSessionInput(conversationId, 'run-overlap')).toBeUndefined();
    expect(finishSessionInputRun(conversationId, 'run-1', 'completed')).toBe(true);
    expect(listActiveSessionInputRuns()).toEqual([]);
    expect(claimNextSessionInput(conversationId, 'run-2')?.id).toBe('server-2');
  });

  it('uses row versions for edits and cancellation', () => {
    const row = insertSessionInput({
      id: 'server-1', conversationId, clientMessageId: 'client-1',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'before', origin,
    });
    expect(mutateQueuedSessionInput({ conversationId, id: row.id, version: 99, content: 'bad' })).toBe(false);
    expect(mutateQueuedSessionInput({
      conversationId, id: row.id, version: row.version, content: 'after', thinking: 'high',
    })).toBe(true);
    const updated = findSessionInput(conversationId, row.clientMessageId)!;
    expect(updated.content).toBe('after');
    expect(updated.thinking).toBe('high');
    expect(cancelQueuedSessionInput(conversationId, row.id, row.version)).toBe(false);
    expect(cancelQueuedSessionInput(conversationId, row.id, updated.version)).toBe(true);
  });

  it('keeps queued work and exposes uncertain in-flight work after restart', () => {
    insertSessionInput({
      id: 'running', conversationId, clientMessageId: 'running-client',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'running', origin,
    });
    insertSessionInput({
      id: 'queued', conversationId, clientMessageId: 'queued-client',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'queued', origin,
    });
    claimNextSessionInput(conversationId, 'run-1');

    expect(recoverSessionInputState()).toContain(conversationId);
    expect(getSessionInputState(conversationId).inputs.map((row) => [row.id, row.status])).toEqual([
      ['running', 'interrupted'],
      ['queued', 'queued'],
    ]);
  });

  it('upgrades retired task origins before recovering persisted inputs', () => {
    const db = getSqliteDatabase();
    const statuses = ['queued', 'running', 'injecting', 'interrupted', 'completed', 'failed', 'cancelled', 'suspended'] as const;
    for (const status of statuses) {
      insertSessionInput({
        id: status, conversationId, clientMessageId: `client-${status}`,
        requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued',
        content: `Keep ${status}`, origin: { type: 'system', source: 'task' },
        taskRunId: `task-${status}`,
      });
      db.prepare('UPDATE session_inputs SET status = ?, origin_json = ? WHERE id = ?')
        .run(status, JSON.stringify({ type: 'system', source: 'workflow' }), status);
    }
    insertSessionInput({
      id: 'endpoint', conversationId, clientMessageId: 'client-endpoint',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'Endpoint', origin,
    });
    // Recreate the schema immediately before the data migration without changing tables.
    setSchemaVersion(db, 260);
    ensureXopcDatabaseSchema(db);

    for (const status of statuses) {
      expect(findSessionInput(conversationId, `client-${status}`)).toMatchObject({
        origin: { type: 'system', source: 'task' }, status,
        content: `Keep ${status}`, taskRunId: `task-${status}`, version: 2,
      });
    }
    expect(findSessionInput(conversationId, 'client-endpoint')).toMatchObject({ origin, version: 1 });
    ensureXopcDatabaseSchema(db);
    expect(findSessionInput(conversationId, 'client-completed')?.version).toBe(2);
    expect(recoverSessionInputState()).toContain(conversationId);
    expect(getSessionInputState(conversationId).inputs.map(input => [input.id, input.status])).toEqual([
      ['queued', 'queued'], ['running', 'interrupted'], ['injecting', 'interrupted'],
      ['interrupted', 'interrupted'], ['endpoint', 'queued'],
    ]);
    expect(claimNextSessionInput(conversationId, 'recovered-run')?.origin).toEqual({ type: 'system', source: 'task' });
    expect(listActiveSessionInputExecutions()[0]?.origin).toEqual({ type: 'system', source: 'task' });
  });

  it('persists context snapshots without publishing their full text in queue state', () => {
    insertSessionInput({
      id: 'context-input', conversationId, clientMessageId: 'client-context',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'compare', origin,
      contextRefs: [{ kind: 'note', sourceId: 'note-1', version: '1', title: 'Plan' }],
      contextSnapshots: [{ kind: 'note', sourceId: 'note-1', version: '1', title: 'Plan', text: 'private note body' }],
    });

    expect(getSessionInputState(conversationId).inputs[0]).toMatchObject({
      contextRefs: [{ sourceId: 'note-1', title: 'Plan' }],
    });
    expect(getSessionInputState(conversationId).inputs[0]?.contextSnapshots).toBeUndefined();
    expect(claimNextSessionInput(conversationId, 'context-run')?.contextSnapshots?.[0]?.text)
      .toBe('private note body');
  });

  it('copies safe context summaries to the persisted user message', () => {
    ensureSessionRecord(conversationId, dir, { agentId: "main" });
    insertSessionInput({
      id: 'context-transcript', conversationId, clientMessageId: 'client-context-transcript',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'compare', origin,
      contextRefs: [{ kind: 'note', sourceId: 'note-1', version: '1', title: 'Plan' }],
      contextSnapshots: [{ kind: 'note', sourceId: 'note-1', version: '1', title: 'Plan', text: 'private note body' }],
    });
    claimNextSessionInput(conversationId, 'context-transcript-run');

    appendTranscriptEntry(conversationId, {
      role: 'user',
      content: 'compare',
      turnId: 'context-transcript-run',
    } as never);

    expect(loadTranscriptRowsForSession(conversationId)[0]).toMatchObject({
      metadata: {
        sourceContexts: [{ kind: 'note', sourceId: 'note-1', version: '1', title: 'Plan' }],
      },
    });
    expect(JSON.stringify(loadTranscriptRowsForSession(conversationId)[0])).not.toContain('private note body');
  });

  it('updates or clears frozen context snapshots with a queued edit', () => {
    const row = insertSessionInput({
      id: 'context-edit', conversationId, clientMessageId: 'client-context-edit',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'compare', origin,
      contextRefs: [{ kind: 'note', sourceId: 'note-1', version: '1', title: 'Old' }],
      contextSnapshots: [{ kind: 'note', sourceId: 'note-1', version: '1', title: 'Old', text: 'old body' }],
    });

    expect(mutateQueuedSessionInput({
      conversationId,
      id: row.id,
      version: row.version,
      contextRefs: [],
      contextSnapshots: [],
    })).toBe(true);
    const updated = findSessionInput(conversationId, row.clientMessageId);
    expect(updated?.contextRefs).toEqual([]);
    expect(updated?.contextSnapshots).toEqual([]);
  });
  it('refuses queued work bound to a different session instance', () => {
    ensureSessionRecord(conversationId, dir, { agentId: "main" });
    expect(() => insertSessionInput({
      id: 'stale-input', conversationId, clientMessageId: 'stale-client', expectedTranscriptId: 'old-session-instance',
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'stale work', origin,
    })).toThrow('Session instance changed');
    expect(findSessionInput(conversationId, 'stale-client')).toBeUndefined();
  });

  it('parks an accepted input if the session resets before execution', () => {
    const session = ensureSessionRecord(conversationId, dir, { agentId: "main" });
    insertSessionInput({ id: 'queued-old', conversationId, clientMessageId: 'queued-client', expectedTranscriptId: session.transcriptId,
      requestedDelivery: 'next', effectiveDelivery: 'next', status: 'queued', content: 'retained work', origin });
    resetSessionRecord(conversationId, dir);
    expect(claimNextSessionInput(conversationId, 'new-run')).toBeUndefined();
    expect(findSessionInput(conversationId, 'queued-client')).toMatchObject({ status: 'interrupted', content: 'retained work' });
  });

});
