import { getCurrentTranscriptId } from './session-repository.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

export type SessionTaskPlanItemStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type SessionTaskPlanItem = {
  id: string;
  content: string;
  status: SessionTaskPlanItemStatus;
};

export type SessionTaskPlan = {
  transcriptId: string;
  planId: string;
  items: SessionTaskPlanItem[];
  revision: number;
  updatedAt: number;
};

type Row = {
  transcript_id: string;
  plan_id: string;
  items_json: string;
  revision: number;
  updated_at: number;
};

const VALID_STATUSES = new Set<SessionTaskPlanItemStatus>([
  'pending',
  'in_progress',
  'completed',
  'cancelled',
]);

function parseItems(value: string): SessionTaskPlanItem[] {
  try {
    const raw = JSON.parse(value) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const item = value as Record<string, unknown>;
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      const content = typeof item.content === 'string' ? item.content.trim() : '';
      const status = item.status;
      return id && content && VALID_STATUSES.has(status as SessionTaskPlanItemStatus)
        ? [{ id, content, status: status as SessionTaskPlanItemStatus }]
        : [];
    });
  } catch {
    return [];
  }
}

function fromRow(row: Row): SessionTaskPlan {
  return {
    transcriptId: row.transcript_id,
    planId: row.plan_id,
    items: parseItems(row.items_json),
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}

export function getSessionTaskPlan(
  conversationId: string,
  planId = 'todo',
): SessionTaskPlan | undefined {
  const transcriptId = getCurrentTranscriptId(conversationId);
  if (!transcriptId) return undefined;
  const row = getSqliteDatabase().prepare(
    `SELECT transcript_id, plan_id, items_json, revision, updated_at
     FROM session_task_plans
     WHERE transcript_id = ? AND plan_id = ?`,
  ).get(transcriptId, planId) as Row | undefined;
  return row ? fromRow(row) : undefined;
}

export function setSessionTaskPlan(input: {
  conversationId: string;
  planId?: string;
  items: SessionTaskPlanItem[];
  now?: number;
}): SessionTaskPlan | undefined {
  const planId = input.planId?.trim() || 'todo';
  const hasOpenItem = input.items.some(
    (item) => item.status === 'pending' || item.status === 'in_progress',
  );
  if (!hasOpenItem) {
    deleteSessionTaskPlan(input.conversationId, planId);
    return undefined;
  }
  const transcriptId = getCurrentTranscriptId(input.conversationId);
  if (!transcriptId) return undefined;
  const now = input.now ?? Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO session_task_plans (transcript_id, plan_id, items_json, revision, updated_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(transcript_id, plan_id) DO UPDATE SET
         items_json = excluded.items_json,
         revision = session_task_plans.revision + 1,
         updated_at = excluded.updated_at`,
    ).run(transcriptId, planId, JSON.stringify(input.items), now);
  });
  return getSessionTaskPlan(input.conversationId, planId);
}

function deleteSessionTaskPlan(
  conversationId: string,
  planId = 'todo',
): boolean {
  const transcriptId = getCurrentTranscriptId(conversationId);
  if (!transcriptId) return false;
  let deleted = false;
  runSqliteWriteTransaction((db) => {
    const result = db.prepare(
      `DELETE FROM session_task_plans
       WHERE transcript_id = ? AND plan_id = ?`,
    ).run(transcriptId, planId);
    deleted = result.changes > 0;
  });
  return deleted;
}
