import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionInputCommand } from '@xopcai/gateway-contract';

import { openXopcDatabase, closeXopcDatabase, resetXopcDatabaseSingletonForTest } from '../connection.js';
import { acceptSessionCommand, getSessionInputReceipt, claimSessionPreparation, finishSessionPreparation, getSessionPreparation, retrySessionPreparation } from '../session-creation-repository.js';
import { getSqliteDatabase } from '../transaction.js';
import { claimNextSessionInput } from '../session-input-repository.js';
import { deleteSessionRecord, getSessionMetadata, resetSessionRecord } from '../session-repository.js';

describe('durable session creation', () => {
  let dir: string;
  const conversationId = '99a232c3-48e8-48d0-b34d-296d7841e752';
  const command: Extract<SessionInputCommand, { kind: 'start' }> = {
    kind: 'start', clientMessageId: 'first', origin: { type: 'endpoint', endpointId: 'phone', token: 'proof' },
    creation: { agentId: 'main', projectId: null, execution: null, temporary: false, model: 'test/model', thinkingLevel: 'off' },
    input: { content: 'hello' },
  };
  const preparedInput = { status: 'queued' as const, requestedDelivery: 'next' as const, effectiveDelivery: 'next' as const,
    content: 'hello', origin: { type: 'endpoint' as const, endpointId: 'phone' } };
  const accept = (next = command, attachProject?: (id: string, projectId: string) => void) => acceptSessionCommand({ conversationId,
    principalId: 'owner', command: next, preparedInput, attachProject });
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-creation-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
  });
  afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); rmSync(dir, { recursive: true, force: true }); });

  it('atomically receives once and survives reopening the database', () => {
    const first = accept();
    closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: join(dir, 'xopc.db') });
    expect(accept()).toEqual(first);
    expect(claimNextSessionInput(conversationId, 'run')?.id).toBe(first.inputId);
    expect(getSessionInputReceipt(conversationId, 'first', 'owner')).toEqual(first);
  });
  it('preserves Embedded TUI routing when receiving its first input', () => {
    const receipt = acceptSessionCommand({ conversationId, principalId: 'local:tui', sourceChannel: 'tui',
      command: { ...command, origin: { type: 'system', source: 'cli' } },
      preparedInput: { ...preparedInput, origin: { type: 'system', source: 'cli' } },
      config: { modelOverride: 'test/model', fixedModel: true, workingDirectoryOverride: '/tmp/project' } });
    expect(getSessionMetadata(conversationId)).toMatchObject({ sourceChannel: 'tui', agentId: 'main' });
    expect(claimNextSessionInput(conversationId, 'local-run')?.id).toBe(receipt.inputId);
  });
  it('rejects changed payload or principal and does not overwrite the original session', () => {
    accept();
    expect(() => accept({ ...command, input: { content: 'changed' } })).toThrow('different content');
    expect(() => getSessionInputReceipt(conversationId, 'first', 'other')).toThrow('another principal');
    expect(() => accept({ ...command, clientMessageId: 'second' })).toThrow('already exists');
  });
  it('rolls back identity, configuration and receipt when project attachment fails', () => {
    expect(() => accept({ ...command, creation: { ...command.creation, projectId: 'project' } }, () => { throw new Error('attachment failed'); })).toThrow('attachment failed');
    expect(getSessionMetadata(conversationId)).toBeNull();
    expect(getSessionInputReceipt(conversationId, 'first', 'owner')).toBeUndefined();
    expect(accept().inputId).toBeTruthy();
  });
  it('cannot resurrect a deleted conversation by replaying either the same or a new start', () => {
    accept(); deleteSessionRecord(conversationId);
    expect(() => accept()).toThrow('deleted');
    expect(() => accept({ ...command, clientMessageId: 'different' })).toThrow('deleted');
  });
  it('returns the original receipt after reset without executing it in the new transcript', () => {
    const first = accept(); resetSessionRecord(conversationId, 'test');
    expect(accept()).toEqual(first);
    expect(claimNextSessionInput(conversationId, 'run')).toBeUndefined();
  });
  it('gates input execution until a claimed preparation has completed', () => {
    accept({ ...command, creation: { ...command.creation, projectId: 'project', execution: { mode: 'managed_worktree' } } }, () => {});
    expect(claimNextSessionInput(conversationId, 'early')).toBeUndefined();
    const operation = claimSessionPreparation(conversationId)!;
    expect(operation).toBeTruthy();
    expect(claimSessionPreparation(conversationId)).toBeUndefined();
    expect(finishSessionPreparation({ ...operation, revision: operation.revision - 1 })).toBe(false);
    expect(finishSessionPreparation(operation)).toBe(true);
    expect(claimNextSessionInput(conversationId, 'ready')?.content).toBe('hello');
  });
  it('persists orphan cleanup before deleting preparation state and fences the old worker', () => {
    accept({ ...command, creation: { ...command.creation, projectId: 'project', execution: { mode: 'managed_worktree' } } }, () => {});
    const operation = claimSessionPreparation(conversationId)!;
    deleteSessionRecord(conversationId);
    expect(finishSessionPreparation(operation)).toBe(false);
    expect(getSessionPreparation(conversationId)).toBeUndefined();
    const cleanup = getSqliteDatabase().prepare('SELECT * FROM session_preparation_cleanup WHERE conversation_id=?').get(conversationId);
    expect(cleanup).toMatchObject({ environment_id: operation.environmentId });
  });
  it('retries the same failed preparation exactly once without creating another input', () => {
    const receipt = accept({ ...command, creation: { ...command.creation, projectId: 'project', execution: { mode: 'managed_worktree' } } }, () => {});
    const operation = claimSessionPreparation(conversationId)!;
    finishSessionPreparation(operation, 'git unavailable');
    const failed = getSessionPreparation(conversationId)!;
    const request = { operationId: failed.operationId, expectedRevision: failed.revision, idempotencyKey: 'retry-one' };
    const next = retrySessionPreparation(conversationId, 'owner', request);
    expect(next.environmentId).toBe(operation.environmentId);
    expect(next.state).toBe('preparing');
    expect(retrySessionPreparation(conversationId, 'owner', request)).toEqual(next);
    expect(() => retrySessionPreparation(conversationId, 'owner', { ...request, expectedRevision: 999 })).toThrow('reused');
    expect(getSessionInputReceipt(conversationId, 'first', 'owner')?.inputId).toBe(receipt.inputId);
  });
  it('materializes explicitly without queueing an input and rejects a competing start', () => {
    const receipt = acceptSessionCommand({ conversationId, principalId: 'owner', command: {
      commandId: 'voice', creation: command.creation, purpose: 'voice',
    } });
    expect(receipt.inputId).toBeNull();
    expect(claimNextSessionInput(conversationId, 'run')).toBeUndefined();
    expect(() => accept()).toThrow('already exists');
  });
  it('accepts append only against the expected transcript and configuration', () => {
    const first = accept();
    const config = getSqliteDatabase().prepare('SELECT updated_at FROM session_config WHERE conversation_id=?').get(conversationId) as { updated_at: number };
    const append: SessionInputCommand = { kind: 'append', clientMessageId: 'next', expectedTranscriptId: first.transcriptId,
      configVersion: config.updated_at, delivery: 'next', input: { content: 'second' }, origin: command.origin };
    const submit = (next: SessionInputCommand) => acceptSessionCommand({ conversationId, principalId: 'owner', command: next, preparedInput });
    expect(() => submit({ ...append, configVersion: config.updated_at - 1 })).toThrow('configuration changed');
    expect(() => submit({ ...append, expectedTranscriptId: 'stale' })).toThrow('transcript changed');
    expect(submit(append).inputId).not.toBe(first.inputId);
  });
});
