import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSessionContextForLlm, buildSessionDisplayMessages } from '../../../session/session-context-for-llm.js';
import { loadTranscriptRowsForSession } from '../transcript-repository.js';
import { getSqliteDatabase } from '../transaction.js';

import {
  claimNextSessionInput,
  closeXopcDatabase,
  consumeClarificationResume,
  createClarificationWait,
  ensureSessionRecord,
  finishSessionInputRun,
  getActiveClarification,
  getClarification,
  insertSessionInput,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
  resolveClarification,
} from '../index.js';

describe('clarification wait repository', () => {
  let dir: string;
  const conversationId = "5f8923f9-52c1-47a6-8174-bfe092661681";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-clarification-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
    ensureSessionRecord(conversationId, dir, { agentId: "main" });
    insertSessionInput({
      id: 'origin-input',
      conversationId,
      clientMessageId: 'origin-client',
      requestedDelivery: 'next',
      effectiveDelivery: 'next',
      status: 'queued',
      content: 'Prepare the release',
      origin: { type: 'system', source: 'internal' },
    });
    claimNextSessionInput(conversationId, 'origin-run');
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  it('uses structured choice identity even with identical labels and persists a display-only answer summary', () => {
    const wait = createClarificationWait({ conversationId, runId: 'origin-run', toolCallId: 'batch', kind: 'input', question: 'Choose', schemaVersion: 2,
      questions: [{ id: 'q', type: 'single_choice', header: 'Choice', question: 'Choose the target', choices: [{ id: 'a', label: 'Same' }, { id: 'b', label: 'Same' }] }] });
    finishSessionInputRun(conversationId, 'origin-run', 'suspended');
    const command = { id: wait.id, schemaVersion: 2 as const, action: 'answer' as const, expectedVersion: wait.version, idempotencyKey: 'batch-key', answers: [{ questionId: 'q', choiceId: 'a' }] };
    expect(resolveClarification(command).ok).toBe(true);
    expect(resolveClarification({ ...command, answers: [{ questionId: 'q', choiceId: 'b' }] })).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(resolveClarification(command)).toMatchObject({ ok: true, idempotent: true });
    const rows = loadTranscriptRowsForSession(conversationId);
    expect(buildSessionDisplayMessages(rows).some(message => JSON.stringify(message).includes('Choose the target'))).toBe(true);
    expect(buildSessionContextForLlm(rows).some(message => JSON.stringify(message).includes('Choose the target'))).toBe(false);
  });

  it('rolls back the wait and summary if creating the resume input fails', () => {
    const wait = createClarificationWait({ conversationId, runId: 'origin-run', toolCallId: 'batch', kind: 'input', question: 'Details', schemaVersion: 2,
      questions: [{ id: 'details', type: 'text', header: 'Details', question: 'What should we create?' }] });
    finishSessionInputRun(conversationId, 'origin-run', 'suspended');
    getSqliteDatabase().exec("CREATE TEMP TRIGGER fail_clarify_resume BEFORE INSERT ON session_inputs WHEN NEW.kind = 'clarification_resume' BEGIN SELECT RAISE(ABORT, 'injected resume failure'); END");
    expect(() => resolveClarification({ id: wait.id, schemaVersion: 2, action: 'answer', expectedVersion: wait.version, idempotencyKey: 'rollback', answers: [{ questionId: 'details', text: 'A report' }] })).toThrow('injected resume failure');
    expect(getClarification(wait.id)).toMatchObject({ status: 'open', version: wait.version });
    expect(loadTranscriptRowsForSession(conversationId).some(row => 'customType' in row && row.customType === 'clarification_answers')).toBe(false);
  });

  it('persists an input wait and resumes it after an arbitrarily late answer', () => {
    const createdAt = 1_000;
    const wait = createClarificationWait({
      conversationId,
      runId: 'origin-run',
      toolCallId: 'tool-1',
      kind: 'input',
      question: 'Which environment?',
      choiceDetails: [{ id: 'staging', label: 'staging' }, { id: 'production', label: 'production' }],
      now: createdAt,
    });
    expect(wait.expiresAt).toBeUndefined();
    expect(getActiveClarification(conversationId)?.id).toBe(wait.id);

    finishSessionInputRun(conversationId, 'origin-run', 'suspended');
    const resolved = resolveClarification({
      id: wait.id,
      expectedVersion: wait.version,
      idempotencyKey: 'answer-1',
      action: 'answer',
      response: { text: 'staging' },
      now: createdAt + 7 * 24 * 60 * 60_000,
    });
    expect(resolved).toMatchObject({ ok: true, queued: true, idempotent: false });

    const resume = claimNextSessionInput(conversationId, 'resume-run');
    expect(resume).toMatchObject({ kind: 'clarification_resume' });
    expect(resume?.content).toContain('User response: staging');
    expect(consumeClarificationResume(resume!)).toBe(true);
    expect(getClarification(wait.id)).toMatchObject({ status: 'resolved', answer: 'staging' });
  });

  it('deduplicates tool retries and response retries', () => {
    const first = createClarificationWait({
      conversationId,
      runId: 'origin-run',
      toolCallId: 'tool-1',
      kind: 'input',
      question: 'Choose?',
    });
    const duplicate = createClarificationWait({
      conversationId,
      runId: 'origin-run',
      toolCallId: 'tool-1',
      kind: 'input',
      question: 'Choose?',
    });
    expect(duplicate.id).toBe(first.id);
    finishSessionInputRun(conversationId, 'origin-run', 'suspended');

    const firstResponse = resolveClarification({
      id: first.id,
      expectedVersion: first.version,
      idempotencyKey: 'same-response',
      action: 'answer',
      response: { text: 'A' },
    });
    const retry = resolveClarification({
      id: first.id,
      expectedVersion: first.version,
      idempotencyKey: 'same-response',
      action: 'answer',
      response: { text: 'A' },
    });
    expect(firstResponse).toMatchObject({ ok: true, idempotent: false });
    expect(retry).toMatchObject({ ok: true, idempotent: true });
  });

  it('expires approvals but never auto-approves them', () => {
    const wait = createClarificationWait({
      conversationId,
      runId: 'origin-run',
      toolCallId: 'approval-1',
      kind: 'approval',
      question: 'Allow delete?',
      approval: { operation: 'Run tool' },

      now: 1_000,
    });
    finishSessionInputRun(conversationId, 'origin-run', 'suspended');
    const result = resolveClarification({
      id: wait.id,
      expectedVersion: wait.version,
      idempotencyKey: 'late-approval',
      action: 'answer',
      decision: 'approve',
      now: wait.expiresAt! + 1,
    });
    expect(result).toMatchObject({ ok: false, code: 'EXPIRED' });
    expect(getClarification(wait.id)).toMatchObject({ status: 'expired', resolution: 'cancelled' });
  });

  it('rejects concurrent answers using the wait version', () => {
    const wait = createClarificationWait({
      conversationId,
      runId: 'origin-run',
      toolCallId: 'tool-1',
      kind: 'input',
      question: 'Choose?',
    });
    finishSessionInputRun(conversationId, 'origin-run', 'suspended');
    expect(resolveClarification({
      id: wait.id,
      expectedVersion: wait.version,
      idempotencyKey: 'answer-a',
      action: 'answer',
      response: { text: 'A' },
    })).toMatchObject({ ok: true });
    expect(resolveClarification({
      id: wait.id,
      expectedVersion: wait.version,
      idempotencyKey: 'answer-b',
      action: 'answer',
      response: { text: 'B' },
    })).toMatchObject({ ok: false, code: 'CONFLICT' });
  });

  it('keeps cancel separate from letting the agent decide', () => {
    const cancelled = createClarificationWait({
      conversationId,
      runId: 'origin-run',
      toolCallId: 'tool-cancel',
      kind: 'input',
      question: 'Choose?',

    });
    finishSessionInputRun(conversationId, 'origin-run', 'suspended');
    expect(resolveClarification({
      id: cancelled.id,
      expectedVersion: cancelled.version,
      idempotencyKey: 'cancel-1',
      action: 'cancel',
    })).toMatchObject({ ok: true, queued: false });
    expect(claimNextSessionInput(conversationId, 'after-cancel')).toBeUndefined();

    insertSessionInput({
      id: 'second-origin-input',
      conversationId,
      clientMessageId: 'second-origin-client',
      requestedDelivery: 'next',
      effectiveDelivery: 'next',
      status: 'queued',
      content: 'Continue planning',
      origin: { type: 'system', source: 'internal' },
    });
    claimNextSessionInput(conversationId, 'second-origin-run');
    const delegated = createClarificationWait({
      conversationId,
      runId: 'second-origin-run',
      toolCallId: 'tool-decide',
      kind: 'input',
      question: 'Choose again?',
    });
    finishSessionInputRun(conversationId, 'second-origin-run', 'suspended');
    expect(resolveClarification({
      id: delegated.id,
      expectedVersion: delegated.version,
      idempotencyKey: 'decide-1',
      action: 'agent_decide',
    })).toMatchObject({ ok: true, queued: true });
    expect(claimNextSessionInput(conversationId, 'after-decide')?.content)
      .toContain('Use your best judgment');
  });
});
