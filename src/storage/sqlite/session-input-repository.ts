import { readCurrentTranscriptId } from './session-instance-repository.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';
import { turnOriginSchema, type TurnOrigin } from '@xopcai/endpoint-tools-protocol';

import type { AgentSourceContext, SourceContextRefSummary } from '../../agent/source-context/types.js';

export type SessionInputDelivery = 'next' | 'steer';
export type SessionInputStatus =
  | 'queued' | 'running' | 'injecting'
  | 'completed' | 'cancelled' | 'failed' | 'interrupted' | 'suspended';

export type SessionInputPayload =
  | { waitId: string; objectiveRevision: number; resolution: 'continued' | 'skipped' }
  | { waitId: string; objectiveRevision: number; resolution: 'answered' | 'agent_decide' | 'cancelled' };

export type SessionInput = {
  id: string;
  conversationId: string;
  clientMessageId: string;
  expectedTranscriptId?: string;
  requestedDelivery: SessionInputDelivery;
  effectiveDelivery: SessionInputDelivery;
  status: SessionInputStatus;
  content: string;
  taskRunId?: string;
  kind: 'message' | 'connection_resume' | 'clarification_resume';
  payload?: SessionInputPayload;
  attachments?: unknown[];
  contextRefs?: SourceContextRefSummary[];
  contextSnapshots?: AgentSourceContext[];
  thinking?: string;
  origin: TurnOrigin;
  position: number;
  targetRunId?: string;
  runId?: string;
  version: number;
  error?: string;
  createdAtMs: number;
  updatedAtMs: number;
};

export type SessionInputState = {
  conversationId: string;
  revision: number;
  activeRunId?: string;
  activeInputId?: string;
  inputs: SessionInput[];
};

type InputRow = {
  id: string; conversation_id: string; client_message_id: string; expected_transcript_id: string | null;
  requested_delivery: SessionInputDelivery; effective_delivery: SessionInputDelivery;
  task_run_id: string | null;
  kind: SessionInput['kind']; payload_json: string | null;
  status: SessionInputStatus; content: string; attachments_json: string | null;
  context_refs_json: string | null; context_snapshots_json: string | null;
  thinking: string | null; origin_json: string; position: number; target_run_id: string | null;
  run_id: string | null; version: number; error: string | null;
  created_at_ms: number; updated_at_ms: number;
};

function mapInput(row: InputRow): SessionInput {
  return {
    id: row.id, conversationId: row.conversation_id, clientMessageId: row.client_message_id,
    expectedTranscriptId: row.expected_transcript_id ?? undefined,
    requestedDelivery: row.requested_delivery, effectiveDelivery: row.effective_delivery,
    status: row.status, content: row.content, kind: row.kind,
    taskRunId: row.task_run_id ?? undefined,
    payload: row.payload_json ? JSON.parse(row.payload_json) : undefined,
    attachments: row.attachments_json ? JSON.parse(row.attachments_json) as unknown[] : undefined,
    contextRefs: row.context_refs_json ? JSON.parse(row.context_refs_json) as SourceContextRefSummary[] : undefined,
    contextSnapshots: row.context_snapshots_json ? JSON.parse(row.context_snapshots_json) as AgentSourceContext[] : undefined,
    thinking: row.thinking ?? undefined, position: row.position,
    origin: turnOriginSchema.parse(JSON.parse(row.origin_json)),
    targetRunId: row.target_run_id ?? undefined, runId: row.run_id ?? undefined,
    version: row.version, error: row.error ?? undefined,
    createdAtMs: row.created_at_ms, updatedAtMs: row.updated_at_ms,
  };
}

const SELECT_INPUTS = `SELECT id, conversation_id, client_message_id, expected_transcript_id, requested_delivery,
  effective_delivery, status, content, attachments_json, context_refs_json, context_snapshots_json,
  thinking, origin_json, position, kind, payload_json, task_run_id,
  target_run_id, run_id, version, error, created_at_ms, updated_at_ms
  FROM session_inputs`;

function ensureRuntime(db: ReturnType<typeof getSqliteDatabase>, conversationId: string): void {
  db.prepare(`INSERT INTO session_input_runtime(conversation_id, revision, updated_at_ms)
    VALUES (?, 0, ?) ON CONFLICT(conversation_id) DO NOTHING`).run(conversationId, Date.now());
}

export function bumpSessionInputRevision(db: ReturnType<typeof getSqliteDatabase>, conversationId: string): number {
  ensureRuntime(db, conversationId);
  db.prepare(`UPDATE session_input_runtime SET revision = revision + 1, updated_at_ms = ?
    WHERE conversation_id = ?`).run(Date.now(), conversationId);
  return (db.prepare(`SELECT revision FROM session_input_runtime WHERE conversation_id = ?`)
    .get(conversationId) as { revision: number }).revision;
}

export function getSessionInputState(conversationId: string): SessionInputState {
  const db = getSqliteDatabase();
  const runtime = db.prepare(`SELECT revision, active_run_id, active_input_id
    FROM session_input_runtime WHERE conversation_id = ?`).get(conversationId) as
      { revision: number; active_run_id: string | null; active_input_id: string | null } | undefined;
  const rows = db.prepare(`${SELECT_INPUTS} WHERE conversation_id = ? AND status IN
    ('queued','running','injecting','interrupted') ORDER BY position, created_at_ms, id`)
    .all(conversationId) as InputRow[];
  return {
    conversationId,
    revision: runtime?.revision ?? 0,
    activeRunId: runtime?.active_run_id ?? undefined,
    activeInputId: runtime?.active_input_id ?? undefined,
    inputs: rows.filter(row => row.kind === 'message').map((row) => {
      const { contextSnapshots: _contextSnapshots, ...input } = mapInput(row);
      return input;
    }),
  };
}

/** Durable active webchat runs claimed by the session-input coordinator. */
export function listActiveSessionInputRuns(): Array<{ conversationId: string; runId: string }> {
  const rows = getSqliteDatabase().prepare(`SELECT conversation_id, active_run_id
    FROM session_input_runtime WHERE active_run_id IS NOT NULL`).all() as Array<{
      conversation_id: string;
      active_run_id: string;
    }>;
  return rows.map((row) => ({ conversationId: row.conversation_id, runId: row.active_run_id }));
}

export function findSessionInput(conversationId: string, clientMessageId: string): SessionInput | undefined {
  const row = getSqliteDatabase().prepare(`${SELECT_INPUTS} WHERE conversation_id = ? AND client_message_id = ?`)
    .get(conversationId, clientMessageId) as InputRow | undefined;
  return row ? mapInput(row) : undefined;
}

export function getSessionInputById(conversationId: string, id: string): SessionInput | undefined {
  const row = getSqliteDatabase().prepare(`${SELECT_INPUTS} WHERE conversation_id = ? AND id = ?`)
    .get(conversationId, id) as InputRow | undefined;
  return row ? mapInput(row) : undefined;
}

export class SessionInstanceChangedError extends Error {
  constructor() { super('Session instance changed'); }
}

export function insertSessionInput(input: {
  id: string; conversationId: string; clientMessageId: string; expectedTranscriptId?: string;
  requestedDelivery: SessionInputDelivery; effectiveDelivery: SessionInputDelivery;
  status: 'queued' | 'injecting'; content: string; attachments?: unknown[];
  taskRunId?: string;
  kind?: SessionInput['kind']; payload?: SessionInput['payload'];
  contextRefs?: SourceContextRefSummary[]; contextSnapshots?: AgentSourceContext[];
  thinking?: string; origin: TurnOrigin; targetRunId?: string;
}): SessionInput {
  return runSqliteWriteTransaction((db) => {
    const existing = db.prepare(`${SELECT_INPUTS} WHERE conversation_id = ? AND client_message_id = ?`)
      .get(input.conversationId, input.clientMessageId) as InputRow | undefined;
    if (existing) return mapInput(existing);
    if (input.expectedTranscriptId && readCurrentTranscriptId(db, input.conversationId) !== input.expectedTranscriptId) throw new SessionInstanceChangedError();
    const now = Date.now();
    const max = db.prepare(`SELECT COALESCE(MAX(position), 0) AS value FROM session_inputs
      WHERE conversation_id = ? AND status IN ('queued','running','injecting','interrupted')`)
      .get(input.conversationId) as { value: number };
    db.prepare(`INSERT INTO session_inputs(id, conversation_id, client_message_id, expected_transcript_id,
      requested_delivery, effective_delivery, status, content, attachments_json,
      context_refs_json, context_snapshots_json, thinking, origin_json, position,
      target_run_id, version, created_at_ms, updated_at_ms, kind, payload_json, task_run_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`)
      .run(input.id, input.conversationId, input.clientMessageId, input.expectedTranscriptId ?? null, input.requestedDelivery,
        input.effectiveDelivery, input.status, input.content,
        input.attachments ? JSON.stringify(input.attachments) : null,
        input.contextRefs ? JSON.stringify(input.contextRefs) : null,
        input.contextSnapshots ? JSON.stringify(input.contextSnapshots) : null,
        input.thinking ?? null, JSON.stringify(input.origin), max.value + 1,
        input.targetRunId ?? null, now, now, input.kind ?? 'message', input.payload ? JSON.stringify(input.payload) : null, input.taskRunId ?? null);
    bumpSessionInputRevision(db, input.conversationId);
    return mapInput(db.prepare(`${SELECT_INPUTS} WHERE id = ?`).get(input.id) as InputRow);
  });
}

export function claimNextSessionInput(conversationId: string, runId: string): SessionInput | undefined {
  return runSqliteWriteTransaction((db) => {
    ensureRuntime(db, conversationId);
    const runtime = db.prepare(`SELECT active_run_id FROM session_input_runtime WHERE conversation_id = ?`)
      .get(conversationId) as { active_run_id: string | null };
    if (runtime.active_run_id) return undefined;
    const changed = db.prepare(`UPDATE session_inputs SET status = 'interrupted', error = 'Session changed before delivery',
      version = version + 1, updated_at_ms = ? WHERE conversation_id = ? AND status = 'queued'
      AND expected_transcript_id IS NOT NULL AND expected_transcript_id IS NOT ?`)
      .run(Date.now(), conversationId, readCurrentTranscriptId(db, conversationId)).changes;
    if (changed) bumpSessionInputRevision(db, conversationId);
    const row = db.prepare(`${SELECT_INPUTS} WHERE conversation_id = ? AND effective_delivery = 'next'
      AND status = 'queued' ORDER BY position, created_at_ms, id LIMIT 1`).get(conversationId) as InputRow | undefined;
    if (!row) return undefined;
    const now = Date.now();
    db.prepare(`UPDATE session_inputs SET status = 'running', run_id = ?, version = version + 1,
      updated_at_ms = ? WHERE id = ?`).run(runId, now, row.id);
    db.prepare(`UPDATE session_input_runtime SET active_run_id = ?, active_input_id = ?,
      revision = revision + 1, updated_at_ms = ? WHERE conversation_id = ?`)
      .run(runId, row.id, now, conversationId);
    return mapInput(db.prepare(`${SELECT_INPUTS} WHERE id = ?`).get(row.id) as InputRow);
  });
}

export function finishSessionInputRun(conversationId: string, runId: string, status: 'completed' | 'failed' | 'cancelled' | 'suspended', error?: string): boolean {
  return runSqliteWriteTransaction((db) => {
    const runtime = db.prepare(`SELECT active_input_id, active_run_id FROM session_input_runtime WHERE conversation_id = ?`)
      .get(conversationId) as { active_input_id: string | null; active_run_id: string | null } | undefined;
    if (!runtime || runtime.active_run_id !== runId) return false;
    const now = Date.now();
    if (runtime.active_input_id) db.prepare(`UPDATE session_inputs SET status = ?, error = ?,
      version = version + 1, updated_at_ms = ? WHERE id = ?`)
      .run(status, error ?? null, now, runtime.active_input_id);
    db.prepare(`UPDATE session_inputs SET status = ?, error = ?, version = version + 1,
      updated_at_ms = ? WHERE conversation_id = ? AND target_run_id = ? AND status = 'injecting'`)
      .run(status === 'completed' ? 'completed' : 'interrupted',
        status === 'completed' ? null : 'Current reply ended before steer delivery was confirmed',
        now, conversationId, runId);
    db.prepare(`UPDATE session_input_runtime SET active_run_id = NULL, active_input_id = NULL,
      revision = revision + 1, updated_at_ms = ?
      WHERE conversation_id = ?`).run(now, conversationId);
    return true;
  });
}

export function setSessionInputStatus(id: string, status: SessionInputStatus, patch?: { effectiveDelivery?: SessionInputDelivery; targetRunId?: string | null; error?: string }): boolean {
  return runSqliteWriteTransaction((db) => {
    const row = db.prepare(`${SELECT_INPUTS} WHERE id = ?`).get(id) as InputRow | undefined;
    if (!row) return false;
    db.prepare(`UPDATE session_inputs SET status = ?, effective_delivery = ?, target_run_id = ?,
      error = ?, version = version + 1, updated_at_ms = ? WHERE id = ?`)
      .run(status, patch?.effectiveDelivery ?? row.effective_delivery,
        patch?.targetRunId !== undefined ? patch.targetRunId : row.target_run_id,
        patch?.error ?? row.error, Date.now(), id);
    bumpSessionInputRevision(db, row.conversation_id);
    return true;
  });
}

export function mutateQueuedSessionInput(input: {
  conversationId: string;
  id: string;
  version: number;
  content?: string;
  attachments?: unknown[];
  contextRefs?: SourceContextRefSummary[];
  contextSnapshots?: AgentSourceContext[];
  thinking?: string;
  position?: number;
}): boolean {
  return runSqliteWriteTransaction((db) => {
    const row = db.prepare(`${SELECT_INPUTS} WHERE id = ? AND conversation_id = ?`).get(input.id, input.conversationId) as InputRow | undefined;
    if (!row || row.kind !== 'message' || row.status !== 'queued' || row.version !== input.version) return false;
    const now = Date.now();
    if (input.position !== undefined) {
      const rows = db.prepare(`${SELECT_INPUTS} WHERE conversation_id = ? AND status = 'queued' ORDER BY position, created_at_ms, id`)
        .all(input.conversationId) as InputRow[];
      const ordered = rows.filter((item) => item.id !== input.id);
      ordered.splice(Math.max(0, Math.min(input.position, ordered.length)), 0, row);
      const stmt = db.prepare(`UPDATE session_inputs SET position = ?, version = version + 1, updated_at_ms = ? WHERE id = ?`);
      ordered.forEach((item, index) => stmt.run(index + 1, now, item.id));
    } else {
      db.prepare(`UPDATE session_inputs SET content = ?, attachments_json = ?, context_refs_json = ?,
        context_snapshots_json = ?, thinking = ?, version = version + 1,
        updated_at_ms = ? WHERE id = ?`).run(input.content ?? row.content,
          input.attachments ? JSON.stringify(input.attachments) : row.attachments_json,
          input.contextRefs ? JSON.stringify(input.contextRefs) : row.context_refs_json,
          input.contextSnapshots ? JSON.stringify(input.contextSnapshots) : row.context_snapshots_json,
          input.thinking ?? row.thinking, now, input.id);
    }
    bumpSessionInputRevision(db, input.conversationId);
    return true;
  });
}

export function cancelQueuedSessionInput(conversationId: string, id: string, version: number): boolean {
  return runSqliteWriteTransaction((db) => {
    const result = db.prepare(`UPDATE session_inputs SET status = 'cancelled', version = version + 1,
      updated_at_ms = ? WHERE id = ? AND conversation_id = ? AND version = ? AND kind = 'message' AND status IN ('queued','interrupted')`)
      .run(Date.now(), id, conversationId, version);
    if (Number(result.changes) === 0) return false;
    bumpSessionInputRevision(db, conversationId);
    return true;
  });
}

export function recoverSessionInputState(): string[] {
  return runSqliteWriteTransaction((db) => {
    const keys = db.prepare(`SELECT DISTINCT conversation_id FROM session_inputs WHERE status IN ('queued','running','injecting')`)
      .all() as Array<{ conversation_id: string }>;
    const now = Date.now();
    db.prepare(`UPDATE session_inputs SET status = 'interrupted', error = 'Gateway restarted during delivery',
      version = version + 1, updated_at_ms = ? WHERE status IN ('running','injecting')`).run(now);
    db.prepare(`UPDATE session_input_runtime SET active_run_id = NULL, active_input_id = NULL,
      revision = revision + 1, updated_at_ms = ?`).run(now);
    return keys.map((row) => row.conversation_id);
  });
}
