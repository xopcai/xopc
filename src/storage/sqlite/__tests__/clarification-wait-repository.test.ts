import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

  it('persists an input wait and resumes it after an arbitrarily late answer', () => {
    const createdAt = 1_000;
    const wait = createClarificationWait({
      conversationId,
      runId: 'origin-run',
      toolCallId: 'tool-1',
      kind: 'input',
      question: 'Which environment?',
      choices: ['staging', 'production'],
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
      answer: 'staging',
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
      answer: 'A',
    });
    const retry = resolveClarification({
      id: first.id,
      expectedVersion: first.version,
      idempotencyKey: 'same-response',
      action: 'answer',
      answer: 'A',
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
      choices: ['Allow once', 'Deny'],
      suggestedAnswer: 'Deny',
      now: 1_000,
    });
    finishSessionInputRun(conversationId, 'origin-run', 'suspended');
    const result = resolveClarification({
      id: wait.id,
      expectedVersion: wait.version,
      idempotencyKey: 'late-approval',
      action: 'answer',
      answer: 'Allow once',
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
      answer: 'A',
    })).toMatchObject({ ok: true });
    expect(resolveClarification({
      id: wait.id,
      expectedVersion: wait.version,
      idempotencyKey: 'answer-b',
      action: 'answer',
      answer: 'B',
    })).toMatchObject({ ok: false, code: 'CONFLICT' });
  });

  it('keeps cancel separate from letting the agent decide', () => {
    const cancelled = createClarificationWait({
      conversationId,
      runId: 'origin-run',
      toolCallId: 'tool-cancel',
      kind: 'input',
      question: 'Choose?',
      suggestedAnswer: 'A',
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
