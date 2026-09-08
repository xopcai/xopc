import { randomUUID } from 'node:crypto';

import type {
  ClarificationKind,
  ClarificationResolution,
  ClarificationResponseAction,
  ClarificationWait,
  ClarificationWaitSnapshot,
} from '@xopcai/gateway-contract';

import { TaskRunRepository } from '../../tasks/task-run-repository.js';
import { isXopcDatabaseOpen } from './connection.js';
import { readCurrentSessionId } from './session-instance-repository.js';
import {
  bumpSessionInputRevision,
  getSessionInputById,
  getSessionInputState,
  insertSessionInput,
  type SessionInput,
} from './session-input-repository.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

const APPROVAL_TTL_MS = 10 * 60_000;
const STALE_CONTEXT_MS = 24 * 60 * 60_000;

type ClarificationRow = {
  id: string;
  session_key: string;
  session_id: string;
  status: ClarificationWait['status'];
  version: number;
  data_json: string;
};

export type CreateClarificationInput = {
  sessionKey: string;
  runId: string;
  toolCallId: string;
  kind: ClarificationKind;
  question: string;
  choices?: string[];
  suggestedAnswer?: string;
  approvalKey?: string;
  now?: number;
};

export type ResolveClarificationInput = {
  id: string;
  expectedVersion: number;
  idempotencyKey: string;
  action: ClarificationResponseAction;
  answer?: string;
  now?: number;
};

export type ResolveClarificationResult =
  | { ok: true; clarification: ClarificationWait; idempotent: boolean; queued: boolean }
  | { ok: false; code: 'NOT_FOUND' | 'CONFLICT' | 'EXPIRED' | 'INVALID'; clarification?: ClarificationWait };

function rowToWait(row: ClarificationRow): ClarificationWait {
  return JSON.parse(row.data_json) as ClarificationWait;
}

function getRow(id: string): ClarificationRow | undefined {
  return getSqliteDatabase().prepare(
    `SELECT id, session_key, session_id, status, version, data_json
     FROM session_clarification_waits WHERE id = ?`,
  ).get(id) as ClarificationRow | undefined;
}

function writeWait(wait: ClarificationWait, expectedVersion: number): ClarificationWait | undefined {
  const next = { ...wait, version: expectedVersion + 1, updatedAt: wait.updatedAt || Date.now() };
  const changed = getSqliteDatabase().prepare(
    `UPDATE session_clarification_waits
     SET status = ?, version = ?, data_json = ?
     WHERE id = ? AND version = ?`,
  ).run(next.status, next.version, JSON.stringify(next), next.id, expectedVersion).changes;
  return changed ? next : undefined;
}

function taskWaitsForClarification(taskId: string, clarificationId: string) {
  const runs = new TaskRunRepository();
  return runs.listActiveWaits(taskId).filter(
    (wait) => wait.condition.clarificationId === clarificationId,
  );
}

function resolveTaskWait(wait: ClarificationWait, resolution: unknown): void {
  if (!wait.taskRunId) return;
  const runs = new TaskRunRepository();
  const run = runs.get(wait.taskRunId);
  if (!run) return;
  for (const taskWait of taskWaitsForClarification(run.taskId, wait.id)) {
    runs.resolveWait({ waitId: taskWait.id, actor: { kind: 'user', id: wait.principalId }, resolution });
  }
}

function cancelTaskRun(wait: ClarificationWait, reason: string, now: number): void {
  if (!wait.taskRunId) return;
  const runs = new TaskRunRepository();
  const run = runs.get(wait.taskRunId);
  if (!run || !['queued', 'running', 'waiting', 'verifying'].includes(run.status)) return;
  runs.finalize({
    runId: run.id,
    expectedVersion: run.version,
    actor: { kind: 'user', id: wait.principalId },
    terminalCode: 'clarification_cancelled',
    terminalMessage: reason,
    now,
    receipt: {
      status: 'cancelled',
      summary: reason,
      changes: [],
      evidence: [],
      verification: { status: 'unverified', checks: [] },
      remainingWork: [wait.checkpoint.objectiveSummary],
      needsUser: false,
      completionVerdict: 'not_achieved',
    },
  });
}

function markTaskWaiting(wait: ClarificationWait): void {
  if (!wait.taskRunId) return;
  const runs = new TaskRunRepository();
  const run = runs.get(wait.taskRunId);
  if (!run || run.status !== 'running') return;
  runs.createWait({
    taskId: run.taskId,
    taskRunId: run.id,
    kind: wait.kind === 'approval' ? 'approval' : 'user_input',
    reason: wait.question,
    condition: { type: 'clarification', clarificationId: wait.id },
  });
  runs.setStatus({
    runId: run.id,
    expectedVersion: run.version,
    from: ['running'],
    to: 'waiting',
    actor: { kind: 'system' },
  });
}

export function getClarification(id: string): ClarificationWait | undefined {
  if (!isXopcDatabaseOpen()) return undefined;
  const row = getRow(id);
  return row ? rowToWait(row) : undefined;
}

export function getActiveClarification(sessionKey: string): ClarificationWait | undefined {
  if (!isXopcDatabaseOpen()) return undefined;
  const sessionId = readCurrentSessionId(getSqliteDatabase(), sessionKey);
  if (!sessionId) return undefined;
  const row = getSqliteDatabase().prepare(
    `SELECT id, session_key, session_id, status, version, data_json
     FROM session_clarification_waits
     WHERE session_key = ? AND session_id = ? AND status IN ('open', 'queued')
     ORDER BY version DESC LIMIT 1`,
  ).get(sessionKey, sessionId) as ClarificationRow | undefined;
  return row ? rowToWait(row) : undefined;
}

export function getClarificationSnapshot(sessionKey: string): ClarificationWaitSnapshot | undefined {
  if (!isXopcDatabaseOpen()) return undefined;
  const sessionId = readCurrentSessionId(getSqliteDatabase(), sessionKey);
  if (!sessionId) return undefined;
  const state = getSessionInputState(sessionKey);
  const now = Date.now();
  const active = getActiveClarification(sessionKey);
  const clarification = active?.kind === 'approval'
    && active.expiresAt !== undefined
    && active.expiresAt <= now
    ? expireApproval(active, now)
    : active;
  return {
    sessionId,
    revision: state.revision,
    serverTime: now,
    clarification: clarification?.status === 'open' || clarification?.status === 'queued'
      ? clarification
      : null,
  };
}

export function createClarificationWait(input: CreateClarificationInput): ClarificationWait {
  return runSqliteWriteTransaction((db) => {
    const sessionId = readCurrentSessionId(db, input.sessionKey);
    if (!sessionId) throw new Error('Clarification requires a persisted session.');

    const duplicate = db.prepare(
      `SELECT id, session_key, session_id, status, version, data_json
       FROM session_clarification_waits
       WHERE session_id = ? AND origin_run_id = ? AND origin_tool_call_id = ?`,
    ).get(sessionId, input.runId, input.toolCallId) as ClarificationRow | undefined;
    if (duplicate) return rowToWait(duplicate);

    const now = input.now ?? Date.now();
    const runtime = getSessionInputState(input.sessionKey);
    const origin = runtime.activeInputId
      ? getSessionInputById(input.sessionKey, runtime.activeInputId)
      : undefined;
    const active = getActiveClarification(input.sessionKey);
    if (active) {
      const superseded: ClarificationWait = {
        ...active,
        status: 'superseded',
        resolution: 'cancelled',
        resolvedAt: now,
        updatedAt: now,
      };
      writeWait(superseded, active.version);
      resolveTaskWait(active, { superseded: true });
      cancelTaskRun(active, 'Task superseded by a newer clarification request.', now);
    }

    const lastEntry = db.prepare(
      'SELECT entry_id FROM transcript_entries WHERE session_id = ? ORDER BY seq DESC LIMIT 1',
    ).get(sessionId) as { entry_id: string } | undefined;
    const wait: ClarificationWait = {
      id: randomUUID(),
      principalId: 'local-owner',
      sessionKey: input.sessionKey,
      sessionId,
      objectiveId: origin?.id ?? input.runId,
      objectiveRevision: (active?.objectiveRevision ?? 0) + 1,
      originRunId: input.runId,
      originInputId: origin?.id ?? input.runId,
      originToolCallId: input.toolCallId,
      taskRunId: origin?.taskRunId,
      kind: input.kind,
      status: 'open',
      question: input.question.trim(),
      choices: input.choices,
      suggestedAnswer: input.suggestedAnswer,
      checkpoint: {
        transcriptEntryId: lastEntry?.entry_id,
        objectiveSummary: origin?.content ?? input.question.trim(),
        completedSteps: [],
        pendingSteps: [input.question.trim()],
        originalRequestAt: origin?.createdAtMs ?? now,
      },
      expiresAt: input.kind === 'approval' ? now + APPROVAL_TTL_MS : undefined,
      approvalKey: input.approvalKey,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    db.prepare(
      `INSERT INTO session_clarification_waits (
        id, principal_id, session_key, session_id, status, version, data_json,
        origin_run_id, origin_tool_call_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      wait.id,
      wait.principalId,
      wait.sessionKey,
      wait.sessionId,
      wait.status,
      wait.version,
      JSON.stringify(wait),
      wait.originRunId,
      wait.originToolCallId,
    );
    markTaskWaiting(wait);
    bumpSessionInputRevision(db, input.sessionKey);
    return wait;
  });
}

export function isClarificationSuspended(sessionKey: string, runId: string): boolean {
  const wait = getActiveClarification(sessionKey);
  return Boolean(wait?.status === 'open' && wait.originRunId === runId);
}

function expireApproval(wait: ClarificationWait, now: number): ClarificationWait {
  const expired: ClarificationWait = {
    ...wait,
    status: 'expired',
    resolution: 'cancelled',
    resolvedAt: now,
    updatedAt: now,
  };
  const updated = writeWait(expired, wait.version) ?? getClarification(wait.id) ?? expired;
  resolveTaskWait(updated, { expired: true });
  cancelTaskRun(updated, 'Approval expired before the task could continue.', now);
  bumpSessionInputRevision(getSqliteDatabase(), wait.sessionKey);
  return updated;
}

export function resolveClarification(input: ResolveClarificationInput): ResolveClarificationResult {
  return runSqliteWriteTransaction((db) => {
    const wait = getClarification(input.id);
    if (!wait || readCurrentSessionId(db, wait.sessionKey) !== wait.sessionId) {
      return { ok: false, code: 'NOT_FOUND' };
    }
    const now = input.now ?? Date.now();
    if (wait.kind === 'approval' && wait.expiresAt !== undefined && wait.expiresAt <= now) {
      return { ok: false, code: 'EXPIRED', clarification: expireApproval(wait, now) };
    }
    const existingInput = db.prepare(
      'SELECT id FROM session_inputs WHERE session_key = ? AND client_message_id = ?',
    ).get(wait.sessionKey, input.idempotencyKey) as { id: string } | undefined;
    if (existingInput) {
      return { ok: true, clarification: wait, idempotent: true, queued: wait.status === 'queued' };
    }
    if (wait.responseIdempotencyKey === input.idempotencyKey) {
      return { ok: true, clarification: wait, idempotent: true, queued: wait.status === 'queued' };
    }
    if (wait.version !== input.expectedVersion || wait.status !== 'open') {
      return { ok: false, code: 'CONFLICT', clarification: wait };
    }
    const trimmed = input.answer?.trim() ?? '';
    if (input.action === 'answer' && !trimmed) return { ok: false, code: 'INVALID' };
    if (input.action === 'agent_decide' && wait.kind === 'approval') return { ok: false, code: 'INVALID' };

    const resolution: ClarificationResolution = input.action === 'answer'
      ? 'answered'
      : input.action === 'agent_decide'
        ? 'agent_decide'
        : 'cancelled';
    if (input.action === 'cancel') {
      const cancelled = writeWait({
        ...wait,
        status: 'cancelled',
        resolution,
        responseIdempotencyKey: input.idempotencyKey,
        resolvedAt: now,
        updatedAt: now,
      }, wait.version);
      if (!cancelled) return { ok: false, code: 'CONFLICT', clarification: getClarification(wait.id) };
      resolveTaskWait(cancelled, { cancelled: true });
      cancelTaskRun(cancelled, 'Task cancelled while waiting for clarification.', now);
      bumpSessionInputRevision(db, wait.sessionKey);
      return { ok: true, clarification: cancelled, idempotent: false, queued: false };
    }

    const answer = input.action === 'agent_decide'
      ? 'Use your best judgment and continue without additional user input.'
      : trimmed;
    const queued = writeWait({
      ...wait,
      status: 'queued',
      answer,
      resolution,
      responseIdempotencyKey: input.idempotencyKey,
      updatedAt: now,
    }, wait.version);
    if (!queued) return { ok: false, code: 'CONFLICT', clarification: getClarification(wait.id) };

    const stale = now - wait.checkpoint.originalRequestAt >= STALE_CONTEXT_MS;
    const content = [
      'Resume the objective that was waiting for clarification.',
      `Original objective: ${wait.checkpoint.objectiveSummary}`,
      `Clarification question: ${wait.question}`,
      `User response: ${answer}`,
      stale ? 'The request is over 24 hours old. Re-check mutable state before acting.' : '',
      'Do not repeat completed side effects. Continue from the stored transcript and current state.',
    ].filter(Boolean).join('\n');
    const origin = getSessionInputById(wait.sessionKey, wait.originInputId);
    insertSessionInput({
      id: randomUUID(),
      sessionKey: wait.sessionKey,
      expectedSessionId: wait.sessionId,
      clientMessageId: input.idempotencyKey,
      requestedDelivery: 'next',
      effectiveDelivery: 'next',
      status: 'queued',
      content,
      kind: 'clarification_resume',
      payload: { waitId: wait.id, objectiveRevision: wait.objectiveRevision, resolution },
      taskRunId: wait.taskRunId,
      contextRefs: origin?.contextRefs,
      contextSnapshots: origin?.contextSnapshots,
      thinking: origin?.thinking,
      origin: { type: 'system', source: 'internal' },
    });
    return { ok: true, clarification: queued, idempotent: false, queued: true };
  });
}

export function getClarificationResumeInput(sessionKey: string, runId: string): SessionInput | undefined {
  if (!isXopcDatabaseOpen()) return undefined;
  const state = getSessionInputState(sessionKey);
  if (state.activeRunId !== runId || !state.activeInputId) return undefined;
  const input = getSessionInputById(sessionKey, state.activeInputId);
  return input?.kind === 'clarification_resume' ? input : undefined;
}

export function consumeClarificationResume(input: SessionInput): boolean {
  if (input.kind !== 'clarification_resume') return true;
  return runSqliteWriteTransaction((db) => {
    const wait = input.payload ? getClarification(input.payload.waitId) : undefined;
    if (!wait || wait.status !== 'queued' || wait.objectiveRevision !== input.payload?.objectiveRevision) {
      return false;
    }
    if (readCurrentSessionId(db, input.sessionKey) !== wait.sessionId) return false;
    if (wait.taskRunId) {
      const runs = new TaskRunRepository();
      const run = runs.get(wait.taskRunId);
      if (!run || run.status !== 'waiting') return false;
      const activeWaits = runs.listActiveWaits(run.taskId).filter((item) => item.taskRunId === run.id);
      if (activeWaits.some((item) => item.condition.clarificationId !== wait.id)) return false;
      resolveTaskWait(wait, { clarificationId: wait.id, resolution: wait.resolution });
      runs.setStatus({
        runId: run.id,
        expectedVersion: run.version,
        from: ['waiting'],
        to: 'running',
        actor: { kind: 'system' },
      });
    } else {
      resolveTaskWait(wait, { clarificationId: wait.id, resolution: wait.resolution });
    }
    const resolved = writeWait({
      ...wait,
      status: 'resolved',
      resolvedAt: Date.now(),
      updatedAt: Date.now(),
    }, wait.version);
    if (!resolved) return false;
    bumpSessionInputRevision(db, wait.sessionKey);
    return true;
  });
}

export function consumeClarificationApproval(
  sessionKey: string,
  approvalKey: string,
): 'approved' | 'denied' | undefined {
  return runSqliteWriteTransaction(() => {
    const state = getSessionInputState(sessionKey);
    if (!state.activeInputId) return undefined;
    const input = getSessionInputById(sessionKey, state.activeInputId);
    if (input?.kind !== 'clarification_resume' || !input.payload) return undefined;
    const wait = getClarification(input.payload.waitId);
    if (!wait || wait.kind !== 'approval' || wait.approvalKey !== approvalKey || wait.approvalConsumedAt) {
      return undefined;
    }
    const approved = wait.answer === 'Allow once';
    writeWait({ ...wait, approvalConsumedAt: Date.now(), updatedAt: Date.now() }, wait.version);
    return approved ? 'approved' : 'denied';
  });
}

export function supersedeActiveClarification(sessionKey: string, now = Date.now()): ClarificationWait | undefined {
  return runSqliteWriteTransaction((db) => {
    const wait = getActiveClarification(sessionKey);
    if (!wait) return undefined;
    if (wait.status === 'queued') {
      const queued = db.prepare(
        `SELECT id FROM session_inputs
         WHERE session_key = ? AND kind = 'clarification_resume'
           AND status = 'queued' AND json_extract(payload_json, '$.waitId') = ?`,
      ).get(sessionKey, wait.id) as { id: string } | undefined;
      if (queued) {
        db.prepare(
          `UPDATE session_inputs SET status = 'cancelled', version = version + 1, updated_at_ms = ?
           WHERE id = ? AND status = 'queued'`,
        ).run(now, queued.id);
      }
    }
    const updated = writeWait({
      ...wait,
      status: 'superseded',
      resolution: 'cancelled',
      resolvedAt: now,
      updatedAt: now,
    }, wait.version);
    if (!updated) return undefined;
    resolveTaskWait(updated, { superseded: true });
    cancelTaskRun(updated, 'Task superseded by a newer instruction.', now);
    bumpSessionInputRevision(db, sessionKey);
    return updated;
  });
}
