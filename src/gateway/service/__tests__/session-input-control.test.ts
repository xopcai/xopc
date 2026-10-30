import { resetSessionRecord } from '../../../storage/sqlite/session-repository.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionInputCoordinator } from '../session-input-coordinator.js';
import { closeXopcDatabase, ensureSessionRecord, openXopcDatabase, resetXopcDatabaseSingletonForTest, appendTranscriptEntry, loadTranscriptRowsForSession } from '../../../storage/sqlite/index.js';
import { claimNextSessionInput, finishSessionInputRun, getSessionInputState, insertSessionInput, mutateQueuedSessionInput, recoverSessionInputState } from '../../../storage/sqlite/session-input-repository.js';
import { acceptSessionInputControl, authorizeSessionInput, readSessionInputControl } from '../../../storage/sqlite/session-input-control-repository.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../../../storage/sqlite/transaction.js';
import { replaceLatestSessionTurnAndQueueInput } from '../../../storage/sqlite/session-turn-replace-repository.js';

const id = '20a27119-bb56-4acc-8cae-b6fab8300916';
const origin = { type: 'endpoint' as const, endpointId: 'test' };
let dir: string;
let transcriptId: string;
function enqueue(name: string) {
  return insertSessionInput({ id: name, conversationId: id, clientMessageId: name, status: 'queued',
    content: name, requestedDelivery: 'next', effectiveDelivery: 'next', origin });
}
function command(action: 'stop' | 'pause' | 'resume' | 'send' | 'steer', operationId = crypto.randomUUID()) {
  return { action, operationId, expectedTranscriptId: transcriptId, expectedVersion: readSessionInputControl(id).version };
}
function coordinator(overrides: Partial<ConstructorParameters<typeof SessionInputCoordinator>[0]> = {}) {
  return new SessionInputCoordinator({ sessionExists: async () => true, execute: async () => ({ status: 'ok', summary: '' }),
    prepareAttachments: async (_id, items) => items, prepareContexts: async () => [], steer: async () => false, emit: vi.fn(), ...overrides });
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'xopc-control-'));
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(dir, 'xopc.db') });
  ensureSessionRecord(id, '/tmp/workspace', { agentId: 'main' });
  transcriptId = (getSqliteDatabase().prepare('SELECT active_transcript_id AS id FROM sessions WHERE conversation_id = ?').get(id) as { id: string }).id;
});
afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(dir, { recursive: true, force: true }); });

describe('durable session input control', () => {
  it('fences the successor before aborting the active run and preserves the queue', async () => {
    let finish!: (value: { status: string; summary: string }) => void;
    const execute = vi.fn(async () => new Promise<{ status: string; summary: string }>(resolve => { finish = resolve; }));
    const interrupt = vi.fn(async () => {
      expect(readSessionInputControl(id)).toMatchObject({ paused: true, phase: 'stopping' });
      finish({ status: 'aborted', summary: '' });
    });
    const service = coordinator({ execute, interrupt });
    enqueue('first'); enqueue('next');
    const drain = service.drain(id);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    await service.control(id, command('stop'));
    await drain;
    expect(execute).toHaveBeenCalledOnce();
    expect(getSessionInputState(id).inputs).toMatchObject([{ id: 'next', status: 'queued' }]);
    expect(readSessionInputControl(id)).toMatchObject({ paused: true, phase: 'idle' });
    await service.control(id, command('resume'));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    finish({ status: 'ok', summary: '' });
    await service.drain(id);
    await vi.waitFor(() => expect(getSessionInputState(id).activeRunId).toBeUndefined());
  });

  it('does not execute an input stopped during asynchronous preflight', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const execute = vi.fn(async () => ({ status: 'ok', summary: '' }));
    const service = coordinator({ beforeExecute: async () => { await gate; return true; }, execute, interrupt: async () => {} });
    enqueue('first'); enqueue('next');
    const drain = service.drain(id);
    await service.control(id, command('stop'));
    release(); await drain;
    expect(execute).not.toHaveBeenCalled();
    expect(claimNextSessionInput(id, 'unwanted')).toBeUndefined();
  });

  it('never cancels a later run when an old stop request is retried', () => {
    enqueue('first'); enqueue('next'); claimNextSessionInput(id, 'old');
    const stop = command('stop');
    expect(acceptSessionInputControl(id, stop).runId).toBe('old');
    finishSessionInputRun(id, 'old', 'cancelled');
    acceptSessionInputControl(id, command('resume'));
    claimNextSessionInput(id, 'new');
    expect(acceptSessionInputControl(id, stop)).toEqual({ replay: true, runId: undefined });
    expect(getSessionInputState(id).activeRunId).toBe('new');
    expect(readSessionInputControl(id).paused).toBe(false);
  });

  it('keeps pause across database reopen and restart recovery', () => {
    enqueue('next'); acceptSessionInputControl(id, command('pause'));
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(dir, 'xopc.db') });
    recoverSessionInputState();
    expect(readSessionInputControl(id).paused).toBe(true);
    expect(claimNextSessionInput(id, 'restart')).toBeUndefined();
  });

  it('allows exactly the authorized input while paused, without coalescing another input', () => {
    enqueue('older'); acceptSessionInputControl(id, command('pause'));
    runSqliteWriteTransaction(() => {
      enqueue('single');
      authorizeSessionInput(id, 'single', readSessionInputControl(id).version, true);
    });
    expect(claimNextSessionInput(id, 'single-run')?.id).toBe('single');
    finishSessionInputRun(id, 'single-run', 'completed');
    expect(claimNextSessionInput(id, 'unwanted')).toBeUndefined();
    expect(getSessionInputState(id).inputs.map(item => item.id)).toEqual(['older']);
  });

  it('rejects late single-send authorization and a stale resume without changing the queue', () => {
    const version = readSessionInputControl(id).version;
    acceptSessionInputControl(id, command('pause'));
    expect(() => runSqliteWriteTransaction(() => {
      enqueue('late'); authorizeSessionInput(id, 'late', version, true);
    })).toThrow('Queue control changed');
    expect(getSessionInputState(id).inputs).toEqual([]);
    expect(() => acceptSessionInputControl(id, { ...command('resume'), expectedVersion: version })).toThrow('Queue control changed');
  });

  it('atomically pauses before follow-up editing, or rejects an already claimed target', () => {
    const target = enqueue('edit'); enqueue('next');
    acceptSessionInputControl(id, { ...command('pause'), inputId: target.id, inputVersion: target.version });
    expect(claimNextSessionInput(id, 'racing')).toBeUndefined();
    acceptSessionInputControl(id, command('resume'));
    claimNextSessionInput(id, 'claimed');
    expect(() => acceptSessionInputControl(id, { ...command('pause'), inputId: target.id, inputVersion: target.version })).toThrow('has started');
  });

  it('replaces the latest turn while preserving paused follow-ups and executes only the replacement', () => {
    appendTranscriptEntry(id, { role: 'user', content: 'original', turnId: 'old' } as never);
    appendTranscriptEntry(id, { role: 'assistant', content: 'partial', turnId: 'old' } as never);
    enqueue('followup'); acceptSessionInputControl(id, command('pause'));
    const result = replaceLatestSessionTurnAndQueueInput({ conversationId: id, targetTurnId: 'old',
      expectedTranscriptId: transcriptId, controlVersion: readSessionInputControl(id).version,
      clientMessageId: 'replacement', content: 'edited', origin });
    expect(result.ok).toBe(true);
    expect(loadTranscriptRowsForSession(id)).toEqual([]);
    const claimed = claimNextSessionInput(id, 'replacement-run');
    expect(claimed?.content).toBe('edited');
    finishSessionInputRun(id, 'replacement-run', 'completed');
    expect(claimNextSessionInput(id, 'unwanted')).toBeUndefined();
    expect(getSessionInputState(id).inputs.map(item => item.content)).toEqual(['followup']);
    expect(readSessionInputControl(id).reviewRequired).toBe(true);
  });
  it('sends an existing selected row once while leaving the other rows paused', async () => {
    enqueue('older'); const row = enqueue('selected');
    acceptSessionInputControl(id, command('pause'));
    const request = { ...command('send'), action: 'send' as const, inputId: row.id, inputVersion: row.version };
    acceptSessionInputControl(id, request);
    expect(claimNextSessionInput(id, 'selected-run')?.id).toBe(row.id);
    finishSessionInputRun(id, 'selected-run', 'completed');
    acceptSessionInputControl(id, request);
    expect(claimNextSessionInput(id, 'duplicate')).toBeUndefined();
    expect(getSessionInputState(id).inputs.map(input => input.id)).toEqual(['older']);
  });

  it('steers the existing row into its captured run without cloning or replaying it', async () => {
    enqueue('active'); claimNextSessionInput(id, 'active-run');
    const row = enqueue('steer');
    const steer = vi.fn(async () => true);
    const service = coordinator({ steer });
    const request = { ...command('pause'), action: 'steer' as const, inputId: row.id, inputVersion: row.version };
    await service.control(id, request);
    await service.control(id, request);
    expect(steer).toHaveBeenCalledExactlyOnceWith(id, 'steer', 'active-run');
    expect(getSessionInputState(id).inputs.filter(input => input.id === row.id)).toMatchObject([{ status: 'injecting', targetRunId: 'active-run' }]);
  });

  it('retains ambiguous steering without automatically replaying it', async () => {
    enqueue('active'); claimNextSessionInput(id, 'active-run');
    const row = enqueue('steer');
    const service = coordinator({ steer: async () => { throw new Error('Delivery unknown'); } });
    await service.control(id, { ...command('pause'), action: 'steer', inputId: row.id, inputVersion: row.version });
    finishSessionInputRun(id, 'active-run', 'cancelled');
    expect(getSessionInputState(id).inputs).toMatchObject([{ id: row.id, status: 'interrupted' }]);
    expect(claimNextSessionInput(id, 'duplicate')).toBeUndefined();
  });

  it('rejects an edit prepared before another device resumes, without cancelling the new run', async () => {
    appendTranscriptEntry(id, { role: 'user', content: 'old', turnId: 'old' } as never);
    enqueue('next'); acceptSessionInputControl(id, command('pause'));
    const version = readSessionInputControl(id).version;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let complete!: (value: { status: string; summary: string }) => void;
    const execute = vi.fn(async () => new Promise<{ status: string; summary: string }>(resolve => { complete = resolve; }));
    const cleanup = vi.fn(async () => {});
    const service = coordinator({ execute, prepareContexts: async () => { await gate; return []; } });
    const replacing = service.replaceLatestTurn({ conversationId: id, targetTurnId: 'old', expectedTranscriptId: transcriptId,
      controlVersion: version, clientMessageId: 'edit', content: 'edited', delivery: 'next', origin }, cleanup);
    await service.control(id, command('resume'));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    const rejection = expect(replacing).rejects.toThrow('Queue control changed');
    release(); await rejection;
    expect(cleanup).not.toHaveBeenCalled();
    expect(getSessionInputState(id).activeRunId).toBeDefined();
    expect(loadTranscriptRowsForSession(id)).toMatchObject([{ content: 'old' }]);
    complete({ status: 'ok', summary: '' });
    await vi.waitFor(() => expect(getSessionInputState(id).activeRunId).toBeUndefined());
  });

  it('advances snapshot revisions for controls before any input runtime exists', () => {
    expect(getSessionInputState(id).revision).toBe(0);
    acceptSessionInputControl(id, command('pause'));
    const paused = getSessionInputState(id);
    acceptSessionInputControl(id, command('resume'));
    expect(paused.revision).toBeGreaterThan(0);
    expect(getSessionInputState(id).revision).toBeGreaterThan(paused.revision);
  });

  it('replays a completed edit-stop after a newer turn without revalidating or stopping it', async () => {
    appendTranscriptEntry(id, { role: 'user', content: 'original', turnId: 'old-run' } as never);
    enqueue('original'); claimNextSessionInput(id, 'old-run');
    const interrupt = vi.fn(async (_id: string, runId: string) => { finishSessionInputRun(id, runId, 'cancelled'); });
    const service = coordinator({ interrupt });
    const stop = { ...command('stop'), turnId: 'old-run' };
    await service.control(id, stop);
    acceptSessionInputControl(id, command('resume'));
    enqueue('new'); claimNextSessionInput(id, 'new-run');
    appendTranscriptEntry(id, { role: 'user', content: 'new', turnId: 'new-run' } as never);
    await service.control(id, stop);
    expect(interrupt).toHaveBeenCalledOnce();
    expect(getSessionInputState(id).activeRunId).toBe('new-run');
    expect(readSessionInputControl(id).paused).toBe(false);
  });

  it('rejects mutation of a paused input belonging to an earlier transcript', () => {
    const row = insertSessionInput({ id: 'old-input', conversationId: id, clientMessageId: 'old-input', expectedTranscriptId: transcriptId,
      status: 'queued', content: 'Original', requestedDelivery: 'next', effectiveDelivery: 'next', origin });
    acceptSessionInputControl(id, command('pause'));
    resetSessionRecord(id, '/tmp/workspace');
    expect(mutateQueuedSessionInput({ conversationId: id, id: row.id, version: row.version, content: 'Wrong transcript' })).toBe(false);
  });

});
