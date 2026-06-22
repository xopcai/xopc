import { randomUUID } from 'node:crypto';

import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import type {
  CreateGoalInput,
  Goal,
  GoalChecklistAddedBy,
  GoalChecklistItem,
  GoalChecklistStatus,
  GoalEvent,
  GoalEvidence,
  GoalListQuery,
  GoalPriority,
  GoalRun,
  GoalRunStatus,
  GoalRunVerdict,
  GoalSource,
  GoalStatus,
  GoalUiLocale,
} from './types.js';

type GoalRow = {
  goal_id: string;
  title: string;
  description: string | null;
  status: string;
  agent_id: string;
  priority: string;
  deadline_at: number | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  archived_at: number | null;
  active_session_key: string | null;
  current_run_id: string | null;
  next_action: string | null;
  blocked_reason: string | null;
  judge_model_ref: string | null;
  max_turns: number;
  turns_used: number;
  ui_locale: string | null;
  source: string;
};

type ChecklistRow = {
  item_id: string;
  goal_id: string;
  text: string;
  status: string;
  added_by: string;
  added_at: number;
  completed_at: number | null;
  evidence_summary: string | null;
  sort_order: number;
};

type GoalRunRow = {
  run_id: string;
  goal_id: string;
  session_key: string;
  source: string;
  status: string;
  started_at: number;
  finished_at: number | null;
  verdict: string | null;
  reason: string | null;
  next_action: string | null;
  assistant_preview: string | null;
  checklist_done: number | null;
  checklist_total: number | null;
  confidence: number | null;
  missing_evidence_json: string | null;
  user_question: string | null;
  completed_checklist_item_ids_json: string | null;
};

type EventRow = {
  event_id: string;
  goal_id: string;
  run_id: string | null;
  kind: string;
  message: string;
  data_json: string | null;
  created_at: number;
};

type EvidenceRow = {
  evidence_id: string;
  goal_id: string;
  run_id: string | null;
  kind: GoalEvidence['kind'];
  title: string;
  summary: string | null;
  uri: string | null;
  data_json: string | null;
  created_at: number;
};

function goalFromRow(row: GoalRow): Goal {
  return {
    id: row.goal_id,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status as GoalStatus,
    agentId: row.agent_id,
    priority: row.priority as GoalPriority,
    deadlineAt: row.deadline_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
    archivedAt: row.archived_at ?? undefined,
    activeSessionKey: row.active_session_key ?? undefined,
    currentRunId: row.current_run_id ?? undefined,
    nextAction: row.next_action ?? undefined,
    blockedReason: row.blocked_reason ?? undefined,
    judgeModelRef: row.judge_model_ref ?? undefined,
    maxTurns: row.max_turns,
    turnsUsed: row.turns_used,
    uiLocale: row.ui_locale === 'en' || row.ui_locale === 'zh' ? row.ui_locale : undefined,
    source: row.source as GoalSource,
  };
}

function checklistFromRow(row: ChecklistRow): GoalChecklistItem {
  return {
    id: row.item_id,
    goalId: row.goal_id,
    text: row.text,
    status: row.status as GoalChecklistStatus,
    addedBy: row.added_by as GoalChecklistAddedBy,
    addedAt: row.added_at,
    completedAt: row.completed_at ?? undefined,
    evidenceSummary: row.evidence_summary ?? undefined,
    sortOrder: row.sort_order,
  };
}

function runFromRow(row: GoalRunRow): GoalRun {
  return {
    id: row.run_id,
    goalId: row.goal_id,
    sessionKey: row.session_key,
    source: row.source as GoalSource,
    status: row.status as GoalRunStatus,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    verdict: row.verdict ? (row.verdict as GoalRunVerdict) : undefined,
    reason: row.reason ?? undefined,
    nextAction: row.next_action ?? undefined,
    assistantPreview: row.assistant_preview ?? undefined,
    checklistProgress:
      row.checklist_done != null && row.checklist_total != null
        ? { done: row.checklist_done, total: row.checklist_total }
        : undefined,
    confidence: row.confidence ?? undefined,
    missingEvidence: parseJsonStringArray(row.missing_evidence_json),
    userQuestion: row.user_question ?? undefined,
    completedChecklistItemIds: parseJsonStringArray(row.completed_checklist_item_ids_json),
  };
}

function parseJsonField(raw: string | null): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function parseJsonStringArray(raw: string | null): string[] | undefined {
  const value = parseJsonField(raw);
  if (!Array.isArray(value)) return undefined;
  const rows = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return rows.length ? rows : undefined;
}

function eventFromRow(row: EventRow): GoalEvent {
  return {
    id: row.event_id,
    goalId: row.goal_id,
    runId: row.run_id ?? undefined,
    kind: row.kind,
    message: row.message,
    data: parseJsonField(row.data_json),
    createdAt: row.created_at,
  };
}

function evidenceFromRow(row: EvidenceRow): GoalEvidence {
  return {
    id: row.evidence_id,
    goalId: row.goal_id,
    runId: row.run_id ?? undefined,
    kind: row.kind,
    title: row.title,
    summary: row.summary ?? undefined,
    uri: row.uri ?? undefined,
    data: parseJsonField(row.data_json),
    createdAt: row.created_at,
  };
}

function clampLimit(n: number | undefined, fallback: number): number {
  return Math.min(500, Math.max(1, Math.floor(n ?? fallback)));
}

function insertGoalEvent(db: ReturnType<typeof getSqliteDatabase>, input: {
  goalId: string;
  runId?: string;
  kind: string;
  message: string;
  data?: unknown;
  createdAt?: number;
}): GoalEvent {
  const event: GoalEvent = {
    id: randomUUID(),
    goalId: input.goalId,
    runId: input.runId,
    kind: input.kind,
    message: input.message,
    data: input.data,
    createdAt: input.createdAt ?? Date.now(),
  };
  db.prepare(
    `INSERT INTO goal_events (event_id, goal_id, run_id, kind, message, data_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.id,
    event.goalId,
    event.runId ?? null,
    event.kind,
    event.message,
    event.data === undefined ? null : JSON.stringify(event.data),
    event.createdAt,
  );
  return event;
}

export class GoalStore {
  create(input: CreateGoalInput): Goal {
    const now = Date.now();
    const goal: Goal = {
      id: randomUUID(),
      title: input.title.trim(),
      description: input.description?.trim() || undefined,
      status: 'active',
      agentId: input.agentId,
      priority: input.priority ?? 'normal',
      deadlineAt: input.deadlineAt,
      createdAt: now,
      updatedAt: now,
      activeSessionKey: input.sessionKey,
      judgeModelRef: input.judgeModelRef?.trim() || undefined,
      maxTurns: Math.max(1, Math.min(500, Math.floor(input.maxTurns))),
      turnsUsed: 0,
      uiLocale: input.uiLocale,
      source: input.source ?? 'chat',
    };

    runSqliteWriteTransaction((db) => {
      db.prepare(
        `INSERT INTO goals (
          goal_id, title, description, status, agent_id, priority, deadline_at,
          created_at, updated_at, active_session_key, judge_model_ref,
          max_turns, turns_used, ui_locale, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        goal.id,
        goal.title,
        goal.description ?? null,
        goal.status,
        goal.agentId,
        goal.priority,
        goal.deadlineAt ?? null,
        goal.createdAt,
        goal.updatedAt,
        goal.activeSessionKey ?? null,
        goal.judgeModelRef ?? null,
        goal.maxTurns,
        goal.turnsUsed,
        goal.uiLocale ?? null,
        goal.source,
      );
      if (goal.activeSessionKey) {
        db.prepare(
          `INSERT OR REPLACE INTO goal_session_links (goal_id, session_key, linked_at)
           VALUES (?, ?, ?)`,
        ).run(goal.id, goal.activeSessionKey, now);
      }
      insertGoalEvent(db, { goalId: goal.id, kind: 'created', message: 'Goal created', createdAt: now });
    });

    return goal;
  }

  get(goalId: string): Goal | null {
    const row = getSqliteDatabase()
      .prepare(`SELECT * FROM goals WHERE goal_id = ?`)
      .get(goalId) as GoalRow | undefined;
    return row ? goalFromRow(row) : null;
  }

  getActiveForSession(sessionKey: string): Goal | null {
    const row = getSqliteDatabase()
      .prepare(
        `SELECT * FROM goals
         WHERE active_session_key = ?
           AND status IN ('active', 'paused', 'blocked', 'needs_input', 'done')
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .get(sessionKey) as GoalRow | undefined;
    return row ? goalFromRow(row) : null;
  }

  list(query: GoalListQuery = {}): Goal[] {
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status];
      conditions.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }
    if (query.agentId) {
      conditions.push(`agent_id = ?`);
      params.push(query.agentId);
    }
    if (query.sessionKey) {
      conditions.push(`goal_id IN (SELECT goal_id FROM goal_session_links WHERE session_key = ?)`);
      params.push(query.sessionKey);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = clampLimit(query.limit, 50);
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    const rows = getSqliteDatabase()
      .prepare(`SELECT * FROM goals ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as GoalRow[];
    return rows.map(goalFromRow);
  }

  update(goalId: string, patch: Partial<Pick<
    Goal,
    | 'title'
    | 'description'
    | 'status'
    | 'priority'
    | 'deadlineAt'
    | 'completedAt'
    | 'archivedAt'
    | 'activeSessionKey'
    | 'currentRunId'
    | 'nextAction'
    | 'blockedReason'
    | 'judgeModelRef'
    | 'maxTurns'
    | 'turnsUsed'
    | 'uiLocale'
  >>): Goal | null {
    const before = this.get(goalId);
    if (!before) return null;
    const next = { ...before, ...patch, updatedAt: Date.now() };
    runSqliteWriteTransaction((db) => {
      db.prepare(
        `UPDATE goals SET
          title = ?, description = ?, status = ?, priority = ?, deadline_at = ?,
          updated_at = ?, completed_at = ?, archived_at = ?, active_session_key = ?,
          current_run_id = ?, next_action = ?, blocked_reason = ?, judge_model_ref = ?,
          max_turns = ?, turns_used = ?, ui_locale = ?
         WHERE goal_id = ?`,
      ).run(
        next.title,
        next.description ?? null,
        next.status,
        next.priority,
        next.deadlineAt ?? null,
        next.updatedAt,
        next.completedAt ?? null,
        next.archivedAt ?? null,
        next.activeSessionKey ?? null,
        next.currentRunId ?? null,
        next.nextAction ?? null,
        next.blockedReason ?? null,
        next.judgeModelRef ?? null,
        next.maxTurns,
        next.turnsUsed,
        next.uiLocale ?? null,
        goalId,
      );
      if (next.activeSessionKey) {
        db.prepare(
          `INSERT OR REPLACE INTO goal_session_links (goal_id, session_key, linked_at)
           VALUES (?, ?, ?)`,
        ).run(goalId, next.activeSessionKey, next.updatedAt);
      }
    });
    return this.get(goalId);
  }

  listChecklist(goalId: string): GoalChecklistItem[] {
    const rows = getSqliteDatabase()
      .prepare(`SELECT * FROM goal_checklist_items WHERE goal_id = ? ORDER BY sort_order ASC, added_at ASC`)
      .all(goalId) as ChecklistRow[];
    return rows.map(checklistFromRow);
  }

  addChecklistItem(input: {
    goalId: string;
    text: string;
    addedBy: GoalChecklistAddedBy;
    status?: GoalChecklistStatus;
  }): GoalChecklistItem {
    return runSqliteWriteTransaction((db) => {
      const maxRow = db
        .prepare(`SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM goal_checklist_items WHERE goal_id = ?`)
        .get(input.goalId) as { max_sort: number };
      const now = Date.now();
      const item: GoalChecklistItem = {
        id: randomUUID(),
        goalId: input.goalId,
        text: input.text.trim(),
        status: input.status ?? 'pending',
        addedBy: input.addedBy,
        addedAt: now,
        sortOrder: maxRow.max_sort + 1,
      };
      db.prepare(
        `INSERT INTO goal_checklist_items (
          item_id, goal_id, text, status, added_by, added_at, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(item.id, item.goalId, item.text, item.status, item.addedBy, item.addedAt, item.sortOrder);
      insertGoalEvent(db, {
        goalId: input.goalId,
        kind: 'checklist_added',
        message: item.text,
        data: { itemId: item.id, addedBy: item.addedBy },
        createdAt: now,
      });
      return item;
    });
  }

  updateChecklistItem(
    itemId: string,
    patch: Partial<Pick<GoalChecklistItem, 'text' | 'status' | 'evidenceSummary'>>,
  ): GoalChecklistItem | null {
    return runSqliteWriteTransaction((db) => {
      const row = db
        .prepare(`SELECT * FROM goal_checklist_items WHERE item_id = ?`)
        .get(itemId) as ChecklistRow | undefined;
      if (!row) return null;
      const before = checklistFromRow(row);
      const status = patch.status ?? before.status;
      const completedAt =
        status === 'completed' || status === 'impossible'
          ? (before.completedAt ?? Date.now())
          : null;
      db.prepare(
        `UPDATE goal_checklist_items SET text = ?, status = ?, completed_at = ?, evidence_summary = ?
         WHERE item_id = ?`,
      ).run(
        patch.text?.trim() || before.text,
        status,
        completedAt,
        patch.evidenceSummary ?? before.evidenceSummary ?? null,
        itemId,
      );
      insertGoalEvent(db, {
        goalId: before.goalId,
        kind: 'checklist_updated',
        message: patch.text?.trim() || before.text,
        data: { itemId, status },
      });
      const next = db
        .prepare(`SELECT * FROM goal_checklist_items WHERE item_id = ?`)
        .get(itemId) as ChecklistRow;
      return checklistFromRow(next);
    });
  }

  removeChecklistItem(itemId: string): boolean {
    return runSqliteWriteTransaction((db) => {
      const row = db
        .prepare(`SELECT goal_id, text FROM goal_checklist_items WHERE item_id = ?`)
        .get(itemId) as { goal_id: string; text: string } | undefined;
      if (!row) return false;
      db.prepare(`DELETE FROM goal_checklist_items WHERE item_id = ?`).run(itemId);
      insertGoalEvent(db, {
        goalId: row.goal_id,
        kind: 'checklist_removed',
        message: row.text,
        data: { itemId },
      });
      return true;
    });
  }

  clearChecklist(goalId: string): void {
    runSqliteWriteTransaction((db) => {
      db.prepare(`DELETE FROM goal_checklist_items WHERE goal_id = ?`).run(goalId);
      insertGoalEvent(db, { goalId, kind: 'checklist_cleared', message: 'Checklist cleared' });
    });
  }

  replaceChecklist(goalId: string, items: Array<{
    text: string;
    status: GoalChecklistStatus;
    addedBy: GoalChecklistAddedBy;
    addedAt?: number;
    completedAt?: number;
    evidenceSummary?: string;
  }>): GoalChecklistItem[] {
    return runSqliteWriteTransaction((db) => {
      db.prepare(`DELETE FROM goal_checklist_items WHERE goal_id = ?`).run(goalId);
      const now = Date.now();
      const next: GoalChecklistItem[] = [];
      for (let i = 0; i < items.length; i++) {
        const raw = items[i]!;
        const item: GoalChecklistItem = {
          id: randomUUID(),
          goalId,
          text: raw.text.trim(),
          status: raw.status,
          addedBy: raw.addedBy,
          addedAt: raw.addedAt ?? now,
          completedAt: raw.completedAt,
          evidenceSummary: raw.evidenceSummary,
          sortOrder: i + 1,
        };
        if (!item.text) continue;
        db.prepare(
          `INSERT INTO goal_checklist_items (
            item_id, goal_id, text, status, added_by, added_at, completed_at, evidence_summary, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          item.id,
          item.goalId,
          item.text,
          item.status,
          item.addedBy,
          item.addedAt,
          item.completedAt ?? null,
          item.evidenceSummary ?? null,
          item.sortOrder,
        );
        next.push(item);
      }
      insertGoalEvent(db, {
        goalId,
        kind: 'checklist_replaced',
        message: `Checklist replaced (${next.length} items)`,
      });
      return next;
    });
  }

  appendRun(run: Omit<GoalRun, 'id' | 'startedAt'> & { id?: string; startedAt?: number }): GoalRun {
    const record: GoalRun = {
      id: run.id ?? randomUUID(),
      goalId: run.goalId,
      sessionKey: run.sessionKey,
      source: run.source,
      status: run.status,
      startedAt: run.startedAt ?? Date.now(),
      finishedAt: run.finishedAt,
      verdict: run.verdict,
      reason: run.reason,
      nextAction: run.nextAction,
      assistantPreview: run.assistantPreview,
      checklistProgress: run.checklistProgress,
    };
    runSqliteWriteTransaction((db) => {
      db.prepare(
        `INSERT INTO goal_runs (
          run_id, goal_id, session_key, source, status, started_at, finished_at,
          verdict, reason, next_action, assistant_preview, checklist_done, checklist_total,
          confidence, missing_evidence_json, user_question, completed_checklist_item_ids_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        record.id,
        record.goalId,
        record.sessionKey,
        record.source,
        record.status,
        record.startedAt,
        record.finishedAt ?? null,
        record.verdict ?? null,
        record.reason ?? null,
        record.nextAction ?? null,
        record.assistantPreview ?? null,
        record.checklistProgress?.done ?? null,
        record.checklistProgress?.total ?? null,
        record.confidence ?? null,
        record.missingEvidence ? JSON.stringify(record.missingEvidence) : null,
        record.userQuestion ?? null,
        record.completedChecklistItemIds ? JSON.stringify(record.completedChecklistItemIds) : null,
      );
      db.prepare(`UPDATE goals SET current_run_id = ?, updated_at = ? WHERE goal_id = ?`).run(
        record.id,
        record.finishedAt ?? record.startedAt,
        record.goalId,
      );
      insertGoalEvent(db, {
        goalId: record.goalId,
        runId: record.id,
        kind: 'run_recorded',
        message: record.reason ?? record.status,
        data: {
          verdict: record.verdict,
          status: record.status,
          confidence: record.confidence,
          missingEvidence: record.missingEvidence,
          userQuestion: record.userQuestion,
          completedChecklistItemIds: record.completedChecklistItemIds,
        },
        createdAt: record.finishedAt ?? record.startedAt,
      });
    });
    return record;
  }

  listRuns(goalId: string, limit?: number): GoalRun[] {
    const rows = getSqliteDatabase()
      .prepare(`SELECT * FROM goal_runs WHERE goal_id = ? ORDER BY started_at DESC LIMIT ?`)
      .all(goalId, clampLimit(limit, 50)) as GoalRunRow[];
    return rows.map(runFromRow);
  }

  listRunsForSession(sessionKey: string, limit?: number): GoalRun[] {
    const rows = getSqliteDatabase()
      .prepare(`SELECT * FROM goal_runs WHERE session_key = ? ORDER BY started_at DESC LIMIT ?`)
      .all(sessionKey, clampLimit(limit, 50)) as GoalRunRow[];
    return rows.map(runFromRow);
  }

  listEvents(goalId: string, limit?: number): GoalEvent[] {
    const rows = getSqliteDatabase()
      .prepare(`SELECT * FROM goal_events WHERE goal_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(goalId, clampLimit(limit, 100)) as EventRow[];
    return rows.map(eventFromRow);
  }

  addEvidence(input: Omit<GoalEvidence, 'id' | 'createdAt'> & { id?: string; createdAt?: number }): GoalEvidence {
    const evidence: GoalEvidence = {
      id: input.id ?? randomUUID(),
      goalId: input.goalId,
      runId: input.runId,
      kind: input.kind,
      title: input.title,
      summary: input.summary,
      uri: input.uri,
      data: input.data,
      createdAt: input.createdAt ?? Date.now(),
    };
    runSqliteWriteTransaction((db) => {
      db.prepare(
        `INSERT INTO goal_evidence (
          evidence_id, goal_id, run_id, kind, title, summary, uri, data_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        evidence.id,
        evidence.goalId,
        evidence.runId ?? null,
        evidence.kind,
        evidence.title,
        evidence.summary ?? null,
        evidence.uri ?? null,
        evidence.data === undefined ? null : JSON.stringify(evidence.data),
        evidence.createdAt,
      );
      insertGoalEvent(db, {
        goalId: evidence.goalId,
        runId: evidence.runId,
        kind: 'evidence_added',
        message: evidence.title,
        data: { evidenceId: evidence.id, kind: evidence.kind },
        createdAt: evidence.createdAt,
      });
    });
    return evidence;
  }

  listEvidence(goalId: string, limit?: number): GoalEvidence[] {
    const rows = getSqliteDatabase()
      .prepare(`SELECT * FROM goal_evidence WHERE goal_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(goalId, clampLimit(limit, 100)) as EvidenceRow[];
    return rows.map(evidenceFromRow);
  }
}
