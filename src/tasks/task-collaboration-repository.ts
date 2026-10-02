import { randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

export type TaskCollaborationKind = 'progress' | 'question' | 'answer' | 'instruction' | 'ack' | 'result' | 'failure';
export type TaskCollaborationAuthor = 'main_agent' | 'worker_agent' | 'user' | 'system';

export interface TaskCollaborationEntry {
  id: string;
  taskId: string;
  taskRunId?: string;
  assignmentEpoch?: number;
  sequence: number;
  authorKind: TaskCollaborationAuthor;
  authorId: string;
  kind: TaskCollaborationKind;
  body: string;
  causationId?: string;
  createdAt: number;
  deliveryStatus?: 'pending' | 'delivered' | 'confirmed' | 'stale';
}

type EntryRow = {
  entry_id: string; task_id: string; task_run_id: string | null; assignment_epoch: number | null;
  sequence: number; author_kind: TaskCollaborationAuthor; author_id: string;
  kind: TaskCollaborationKind; body: string; causation_id: string | null; created_at: number;
  delivery_status: TaskCollaborationEntry['deliveryStatus'] | null;
};

function fromRow(row: EntryRow): TaskCollaborationEntry {
  return { id: row.entry_id, taskId: row.task_id, sequence: row.sequence,
    authorKind: row.author_kind, authorId: row.author_id, kind: row.kind, body: row.body,
    createdAt: row.created_at,
    ...(row.task_run_id ? { taskRunId: row.task_run_id } : {}),
    ...(row.assignment_epoch === null ? {} : { assignmentEpoch: row.assignment_epoch }),
    ...(row.causation_id ? { causationId: row.causation_id } : {}),
    ...(row.delivery_status ? { deliveryStatus: row.delivery_status } : {}),
  };
}

const ENTRY_SELECT = `SELECT entry.*, delivery.status AS delivery_status
  FROM task_collaboration_entries entry
  LEFT JOIN task_collaboration_deliveries delivery ON delivery.entry_id = entry.entry_id`;

export class TaskCollaborationRepository {
  list(taskId: string, afterSequence = 0, limit = 50): TaskCollaborationEntry[] {
    const rows = getSqliteDatabase().prepare(`${ENTRY_SELECT}
      WHERE entry.task_id = ? AND entry.sequence > ? ORDER BY entry.sequence LIMIT ?`)
      .all(taskId, Math.max(0, Math.floor(afterSequence)), Math.max(1, Math.min(100, Math.floor(limit)))) as unknown as EntryRow[];
    return rows.map(fromRow);
  }

  recent(taskId: string, beforeSequence?: number, limit = 50): TaskCollaborationEntry[] {
    const rows = getSqliteDatabase().prepare(`${ENTRY_SELECT}
      WHERE entry.task_id = ? AND (? IS NULL OR entry.sequence < ?)
      ORDER BY entry.sequence DESC LIMIT ?`)
      .all(taskId, beforeSequence ?? null, beforeSequence ?? null,
        Math.max(1, Math.min(100, Math.floor(limit)))) as unknown as EntryRow[];
    return rows.reverse().map(fromRow);
  }

  get(entryId: string): TaskCollaborationEntry | undefined {
    const row = getSqliteDatabase().prepare(`${ENTRY_SELECT} WHERE entry.entry_id = ?`)
      .get(entryId) as unknown as EntryRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  latest(taskId: string): TaskCollaborationEntry | undefined {
    const row = getSqliteDatabase().prepare(`${ENTRY_SELECT}
      WHERE entry.task_id = ? ORDER BY entry.sequence DESC LIMIT 1`)
      .get(taskId) as unknown as EntryRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  append(input: {
    taskId: string; taskRunId?: string; authorKind: TaskCollaborationAuthor; authorId: string;
    kind: TaskCollaborationKind; body: string; causationId?: string; idempotencyKey: string;
    deliverToWorker?: boolean;
  }): TaskCollaborationEntry {
    const body = input.body.trim();
    if (!body || body.length > 8000) throw new Error('Collaboration message must contain 1–8000 characters');
    if (!input.idempotencyKey.trim()) throw new Error('Idempotency key is required');
    return runSqliteWriteTransaction((db) => {
      const existing = db.prepare(`${ENTRY_SELECT} WHERE entry.task_id = ? AND entry.idempotency_key = ?`)
        .get(input.taskId, input.idempotencyKey) as unknown as EntryRow | undefined;
      if (existing) {
        if (existing.kind !== input.kind || existing.body !== body || existing.author_id !== input.authorId
          || existing.author_kind !== input.authorKind || existing.causation_id !== (input.causationId ?? null)) {
          throw new Error('Idempotency key was reused with different collaboration content');
        }
        return fromRow(existing);
      }
      const task = db.prepare('SELECT task_id FROM tasks WHERE task_id = ?')
        .get(input.taskId) as { task_id: string } | undefined;
      if (!task) throw new Error('Task not found');
      if (input.taskRunId) {
        const run = db.prepare('SELECT task_id FROM task_runs WHERE run_id = ?')
          .get(input.taskRunId) as { task_id: string } | undefined;
        if (run?.task_id !== input.taskId) throw new Error('TaskRun does not belong to Task');
      }
      const state = db.prepare(`SELECT assignment_epoch FROM task_conversation_state WHERE task_id = ?`)
        .get(input.taskId) as { assignment_epoch: number } | undefined;
      const next = db.prepare(`SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence
        FROM task_collaboration_entries WHERE task_id = ?`).get(input.taskId) as { sequence: number };
      const id = randomUUID();
      const now = Date.now();
      db.prepare(`INSERT INTO task_collaboration_entries (
        entry_id, task_id, task_run_id, assignment_epoch, sequence, author_kind,
        author_id, kind, body, causation_id, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, input.taskId, input.taskRunId ?? null, state?.assignment_epoch ?? null,
        next.sequence, input.authorKind, input.authorId, input.kind, body,
        input.causationId ?? null, input.idempotencyKey, now,
      );
      if (input.deliverToWorker) {
        db.prepare(`INSERT INTO task_collaboration_deliveries (
          entry_id, status, client_message_id, updated_at
        ) VALUES (?, 'pending', ?, ?)`).run(id, `task-collaboration:${id}`, now);
      }
      if ((input.authorKind === 'worker_agent' || input.authorKind === 'system')
        && (input.kind === 'progress' || input.kind === 'question'
          || input.kind === 'result' || input.kind === 'failure')) {
        db.prepare(`INSERT INTO task_main_update_deliveries (entry_id, conversation_id, status, updated_at)
          SELECT ?, conversation_id, 'pending', ? FROM task_origin_links WHERE task_id = ?`)
          .run(id, now, input.taskId);
      }
      db.prepare(`INSERT INTO domain_outbox (
        event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at
      ) VALUES (?, 'task.collaboration_entry_added', 'task', ?, ?, ?, ?)`).run(
        randomUUID(), input.taskId, input.causationId ?? id,
        JSON.stringify({ taskId: input.taskId, entryId: id, sequence: next.sequence, kind: input.kind }), now,
      );
      return this.get(id)!;
    });
  }

  pendingDeliveries(limit = 20): Array<{ entry: TaskCollaborationEntry; clientMessageId: string }> {
    const rows = getSqliteDatabase().prepare(`${ENTRY_SELECT}
      WHERE delivery.status = 'pending' AND delivery.updated_at <= ?
      ORDER BY delivery.updated_at, entry.entry_id LIMIT ?`)
      .all(Date.now(), Math.max(1, Math.min(100, Math.floor(limit)))) as unknown as EntryRow[];
    return rows.map((row) => ({ entry: fromRow(row), clientMessageId: `task-collaboration:${row.entry_id}` }));
  }

  pendingMainUpdates(limit = 20): Array<{
    entry: TaskCollaborationEntry; conversationId: string;
    decision?: 'notify' | 'silent'; decisionReason?: string;
  }> {
    const rows = getSqliteDatabase().prepare(`SELECT entry.*, main.conversation_id,
        main.decision, main.decision_reason,
        delivery.status AS delivery_status
      FROM task_collaboration_entries entry
      LEFT JOIN task_collaboration_deliveries delivery ON delivery.entry_id = entry.entry_id
      JOIN task_main_update_deliveries main ON main.entry_id = entry.entry_id
      WHERE main.status = 'pending' AND main.updated_at <= ?
      ORDER BY CASE entry.kind
        WHEN 'question' THEN 0 WHEN 'failure' THEN 1 WHEN 'result' THEN 2 ELSE 3 END,
        main.updated_at, entry.sequence, entry.entry_id LIMIT ?`)
      .all(Date.now(), Math.max(1, Math.min(100, Math.floor(limit)))) as unknown as Array<EntryRow & {
        conversation_id: string; decision: 'notify' | 'silent' | null; decision_reason: string | null;
      }>;
    return rows.map((row) => ({ entry: fromRow(row), conversationId: row.conversation_id,
      ...(row.decision ? { decision: row.decision } : {}),
      ...(row.decision_reason ? { decisionReason: row.decision_reason } : {}),
    }));
  }

  decideMainUpdate(entryId: string, decision: 'notify' | 'silent', reason: string): void {
    getSqliteDatabase().prepare(`UPDATE task_main_update_deliveries
      SET decision = ?, decision_reason = ?, decided_at = ?
      WHERE entry_id = ? AND status = 'pending' AND decision IS NULL`)
      .run(decision, reason.slice(0, 500), Date.now(), entryId);
  }

  hasNewerMainUpdate(taskId: string, sequence: number): boolean {
    return Boolean(getSqliteDatabase().prepare(`SELECT 1
      FROM task_collaboration_entries entry
      JOIN task_main_update_deliveries main ON main.entry_id = entry.entry_id
      WHERE entry.task_id = ? AND entry.sequence > ?
        AND entry.kind IN ('progress', 'result', 'failure') LIMIT 1`)
      .get(taskId, sequence));
  }

  hasSubmittedMainUpdate(entryId: string): boolean {
    const clientMessageId = `task-main-update:${entryId}`;
    return Boolean(getSqliteDatabase().prepare(`SELECT 1 FROM session_inputs
      WHERE client_message_id = ? OR client_message_id GLOB ? LIMIT 1`)
      .get(clientMessageId, `${clientMessageId}:retry:*`));
  }

  markMainUpdateDelivered(entryId: string): void {
    getSqliteDatabase().prepare(`UPDATE task_main_update_deliveries SET status = 'delivered', updated_at = ?
      WHERE entry_id = ? AND status = 'pending'`).run(Date.now(), entryId);
  }

  deferMainUpdate(entryId: string, delayMs = 1_000): void {
    getSqliteDatabase().prepare(`UPDATE task_main_update_deliveries SET updated_at = ?
      WHERE entry_id = ? AND status = 'pending'`).run(Date.now() + delayMs, entryId);
  }

  markDelivered(entryId: string, conversationId: string, assignmentEpoch: number): void {
    getSqliteDatabase().prepare(`UPDATE task_collaboration_deliveries
      SET status = 'delivered', conversation_id = ?, assignment_epoch = ?, attempts = attempts + 1,
        updated_at = ? WHERE entry_id = ? AND status = 'pending'`)
      .run(conversationId, assignmentEpoch, Date.now(), entryId);
  }

  markConfirmed(entryId: string): void {
    getSqliteDatabase().prepare(`UPDATE task_collaboration_deliveries SET status = 'confirmed', updated_at = ?
      WHERE entry_id = ? AND status = 'delivered'`).run(Date.now(), entryId);
  }

  markStale(entryId: string): void {
    getSqliteDatabase().prepare(`UPDATE task_collaboration_deliveries SET status = 'stale', updated_at = ?
      WHERE entry_id = ? AND status = 'pending'`).run(Date.now(), entryId);
  }

  defer(entryId: string): void {
    getSqliteDatabase().prepare(`UPDATE task_collaboration_deliveries
      SET attempts = attempts + 1, updated_at = ? WHERE entry_id = ? AND status = 'pending'`)
      .run(Date.now() + 1_000, entryId);
  }
}
