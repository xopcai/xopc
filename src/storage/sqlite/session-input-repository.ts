import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';
import { turnOriginSchema, type TurnOrigin } from '@xopcai/endpoint-tools-protocol';

import type { AgentSourceContext, SourceContextRefSummary } from '../../agent/source-context/types.js';

export type SessionInputDelivery = 'next' | 'steer';
export type SessionInputStatus =
  | 'queued' | 'running' | 'injecting'
  | 'completed' | 'cancelled' | 'failed' | 'interrupted';

export type SessionInput = {
  id: string;
  sessionKey: string;
  clientMessageId: string;
  requestedDelivery: SessionInputDelivery;
  effectiveDelivery: SessionInputDelivery;
  status: SessionInputStatus;
  content: string;
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
  sessionKey: string;
  revision: number;
  activeRunId?: string;
  activeInputId?: string;
  inputs: SessionInput[];
};

type InputRow = {
  id: string; session_key: string; client_message_id: string;
  requested_delivery: SessionInputDelivery; effective_delivery: SessionInputDelivery;
  status: SessionInputStatus; content: string; attachments_json: string | null;
  context_refs_json: string | null; context_snapshots_json: string | null;
  thinking: string | null; origin_json: string; position: number; target_run_id: string | null;
  run_id: string | null; version: number; error: string | null;
  created_at_ms: number; updated_at_ms: number;
};

function mapInput(row: InputRow): SessionInput {
  return {
    id: row.id, sessionKey: row.session_key, clientMessageId: row.client_message_id,
    requestedDelivery: row.requested_delivery, effectiveDelivery: row.effective_delivery,
    status: row.status, content: row.content,
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

const SELECT_INPUTS = `SELECT id, session_key, client_message_id, requested_delivery,
  effective_delivery, status, content, attachments_json, context_refs_json, context_snapshots_json,
  thinking, origin_json, position,
  target_run_id, run_id, version, error, created_at_ms, updated_at_ms
  FROM session_inputs`;

function ensureRuntime(db: ReturnType<typeof getSqliteDatabase>, sessionKey: string): void {
  db.prepare(`INSERT INTO session_input_runtime(session_key, revision, updated_at_ms)
    VALUES (?, 0, ?) ON CONFLICT(session_key) DO NOTHING`).run(sessionKey, Date.now());
}

function bumpRevision(db: ReturnType<typeof getSqliteDatabase>, sessionKey: string): number {
  ensureRuntime(db, sessionKey);
  db.prepare(`UPDATE session_input_runtime SET revision = revision + 1, updated_at_ms = ?
    WHERE session_key = ?`).run(Date.now(), sessionKey);
  return (db.prepare(`SELECT revision FROM session_input_runtime WHERE session_key = ?`)
    .get(sessionKey) as { revision: number }).revision;
}

export function getSessionInputState(sessionKey: string): SessionInputState {
  const db = getSqliteDatabase();
  const runtime = db.prepare(`SELECT revision, active_run_id, active_input_id
    FROM session_input_runtime WHERE session_key = ?`).get(sessionKey) as
      { revision: number; active_run_id: string | null; active_input_id: string | null } | undefined;
  const rows = db.prepare(`${SELECT_INPUTS} WHERE session_key = ? AND status IN
    ('queued','running','injecting','interrupted') ORDER BY position, created_at_ms, id`)
    .all(sessionKey) as InputRow[];
  return {
    sessionKey,
    revision: runtime?.revision ?? 0,
    activeRunId: runtime?.active_run_id ?? undefined,
    activeInputId: runtime?.active_input_id ?? undefined,
    inputs: rows.map((row) => {
      const { contextSnapshots: _contextSnapshots, ...input } = mapInput(row);
      return input;
    }),
  };
}

export function findSessionInput(sessionKey: string, clientMessageId: string): SessionInput | undefined {
  const row = getSqliteDatabase().prepare(`${SELECT_INPUTS} WHERE session_key = ? AND client_message_id = ?`)
    .get(sessionKey, clientMessageId) as InputRow | undefined;
  return row ? mapInput(row) : undefined;
}

export function getSessionInputById(sessionKey: string, id: string): SessionInput | undefined {
  const row = getSqliteDatabase().prepare(`${SELECT_INPUTS} WHERE session_key = ? AND id = ?`)
    .get(sessionKey, id) as InputRow | undefined;
  return row ? mapInput(row) : undefined;
}

export function insertSessionInput(input: {
  id: string; sessionKey: string; clientMessageId: string;
  requestedDelivery: SessionInputDelivery; effectiveDelivery: SessionInputDelivery;
  status: 'queued' | 'injecting'; content: string; attachments?: unknown[];
  contextRefs?: SourceContextRefSummary[]; contextSnapshots?: AgentSourceContext[];
  thinking?: string; origin: TurnOrigin; targetRunId?: string;
}): SessionInput {
  return runSqliteWriteTransaction((db) => {
    const existing = db.prepare(`${SELECT_INPUTS} WHERE session_key = ? AND client_message_id = ?`)
      .get(input.sessionKey, input.clientMessageId) as InputRow | undefined;
    if (existing) return mapInput(existing);
    const now = Date.now();
    const max = db.prepare(`SELECT COALESCE(MAX(position), 0) AS value FROM session_inputs
      WHERE session_key = ? AND status IN ('queued','running','injecting','interrupted')`)
      .get(input.sessionKey) as { value: number };
    db.prepare(`INSERT INTO session_inputs(id, session_key, client_message_id,
      requested_delivery, effective_delivery, status, content, attachments_json,
      context_refs_json, context_snapshots_json, thinking, origin_json, position,
      target_run_id, version, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
      .run(input.id, input.sessionKey, input.clientMessageId, input.requestedDelivery,
        input.effectiveDelivery, input.status, input.content,
        input.attachments ? JSON.stringify(input.attachments) : null,
        input.contextRefs ? JSON.stringify(input.contextRefs) : null,
        input.contextSnapshots ? JSON.stringify(input.contextSnapshots) : null,
        input.thinking ?? null, JSON.stringify(input.origin), max.value + 1,
        input.targetRunId ?? null, now, now);
    bumpRevision(db, input.sessionKey);
    return mapInput(db.prepare(`${SELECT_INPUTS} WHERE id = ?`).get(input.id) as InputRow);
  });
}

export function claimNextSessionInput(sessionKey: string, runId: string): SessionInput | undefined {
  return runSqliteWriteTransaction((db) => {
    ensureRuntime(db, sessionKey);
    const runtime = db.prepare(`SELECT active_run_id FROM session_input_runtime WHERE session_key = ?`)
      .get(sessionKey) as { active_run_id: string | null };
    if (runtime.active_run_id) return undefined;
    const row = db.prepare(`${SELECT_INPUTS} WHERE session_key = ? AND effective_delivery = 'next'
      AND status = 'queued' ORDER BY position, created_at_ms, id LIMIT 1`).get(sessionKey) as InputRow | undefined;
    if (!row) return undefined;
    const now = Date.now();
    db.prepare(`UPDATE session_inputs SET status = 'running', run_id = ?, version = version + 1,
      updated_at_ms = ? WHERE id = ?`).run(runId, now, row.id);
    db.prepare(`UPDATE session_input_runtime SET active_run_id = ?, active_input_id = ?,
      revision = revision + 1, updated_at_ms = ? WHERE session_key = ?`)
      .run(runId, row.id, now, sessionKey);
    return mapInput(db.prepare(`${SELECT_INPUTS} WHERE id = ?`).get(row.id) as InputRow);
  });
}

export function finishSessionInputRun(sessionKey: string, runId: string, status: 'completed' | 'failed' | 'cancelled', error?: string): boolean {
  return runSqliteWriteTransaction((db) => {
    const runtime = db.prepare(`SELECT active_input_id, active_run_id FROM session_input_runtime WHERE session_key = ?`)
      .get(sessionKey) as { active_input_id: string | null; active_run_id: string | null } | undefined;
    if (!runtime || runtime.active_run_id !== runId) return false;
    const now = Date.now();
    if (runtime.active_input_id) db.prepare(`UPDATE session_inputs SET status = ?, error = ?,
      version = version + 1, updated_at_ms = ? WHERE id = ?`)
      .run(status, error ?? null, now, runtime.active_input_id);
    db.prepare(`UPDATE session_inputs SET status = ?, error = ?, version = version + 1,
      updated_at_ms = ? WHERE session_key = ? AND target_run_id = ? AND status = 'injecting'`)
      .run(status === 'completed' ? 'completed' : 'interrupted',
        status === 'completed' ? null : 'Current reply ended before steer delivery was confirmed',
        now, sessionKey, runId);
    db.prepare(`UPDATE session_input_runtime SET active_run_id = NULL, active_input_id = NULL,
      revision = revision + 1, updated_at_ms = ?
      WHERE session_key = ?`).run(now, sessionKey);
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
    bumpRevision(db, row.session_key);
    return true;
  });
}

export function mutateQueuedSessionInput(input: {
  sessionKey: string;
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
    const row = db.prepare(`${SELECT_INPUTS} WHERE id = ? AND session_key = ?`).get(input.id, input.sessionKey) as InputRow | undefined;
    if (!row || row.status !== 'queued' || row.version !== input.version) return false;
    const now = Date.now();
    if (input.position !== undefined) {
      const rows = db.prepare(`${SELECT_INPUTS} WHERE session_key = ? AND status = 'queued' ORDER BY position, created_at_ms, id`)
        .all(input.sessionKey) as InputRow[];
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
    bumpRevision(db, input.sessionKey);
    return true;
  });
}

export function cancelQueuedSessionInput(sessionKey: string, id: string, version: number): boolean {
  return runSqliteWriteTransaction((db) => {
    const result = db.prepare(`UPDATE session_inputs SET status = 'cancelled', version = version + 1,
      updated_at_ms = ? WHERE id = ? AND session_key = ? AND version = ? AND status IN ('queued','interrupted')`)
      .run(Date.now(), id, sessionKey, version);
    if (Number(result.changes) === 0) return false;
    bumpRevision(db, sessionKey);
    return true;
  });
}

export function recoverSessionInputState(): string[] {
  return runSqliteWriteTransaction((db) => {
    const keys = db.prepare(`SELECT DISTINCT session_key FROM session_inputs WHERE status IN ('queued','running','injecting')`)
      .all() as Array<{ session_key: string }>;
    const now = Date.now();
    db.prepare(`UPDATE session_inputs SET status = 'interrupted', error = 'Gateway restarted during delivery',
      version = version + 1, updated_at_ms = ? WHERE status IN ('running','injecting')`).run(now);
    db.prepare(`UPDATE session_input_runtime SET active_run_id = NULL, active_input_id = NULL,
      revision = revision + 1, updated_at_ms = ?`).run(now);
    return keys.map((row) => row.session_key);
  });
}
