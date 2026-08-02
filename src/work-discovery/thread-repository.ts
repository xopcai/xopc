import { randomUUID } from 'node:crypto';

import { requireXopcDatabase } from '../storage/sqlite/connection.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import type { WorkUnderstandingThread } from './types.js';

interface ThreadRow {
  thread_id: string;
  canonical_key: string;
  title: string;
  summary: string;
  status: string;
  horizon: string;
  focus_score: number;
  confidence: number;
  user_status: string;
  parent_thread_id: string | null;
  first_observed_at: number;
  last_observed_at: number;
  created_at: number;
  updated_at: number;
}

function idsForThread(table: 'work_understanding_thread_projects' | 'work_understanding_thread_evidence', column: 'project_id' | 'evidence_id', id: string): string[] {
  const { db } = requireXopcDatabase();
  const rows = db.prepare(`SELECT ${column} AS id FROM ${table} WHERE thread_id = ? ORDER BY created_at ASC`)
    .all(id) as unknown as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

function threadFromRow(row: ThreadRow): WorkUnderstandingThread {
  return {
    id: row.thread_id,
    canonicalKey: row.canonical_key,
    title: row.title,
    summary: row.summary,
    status: row.status as WorkUnderstandingThread['status'],
    horizon: row.horizon as WorkUnderstandingThread['horizon'],
    focusScore: row.focus_score,
    confidence: row.confidence,
    userStatus: row.user_status as WorkUnderstandingThread['userStatus'],
    projectIds: idsForThread('work_understanding_thread_projects', 'project_id', row.thread_id),
    evidenceIds: idsForThread('work_understanding_thread_evidence', 'evidence_id', row.thread_id),
    ...(row.parent_thread_id ? { parentThreadId: row.parent_thread_id } : {}),
    firstObservedAt: row.first_observed_at,
    lastObservedAt: row.last_observed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getWorkUnderstandingThread(id: string): WorkUnderstandingThread | null {
  const { db } = requireXopcDatabase();
  const row = db.prepare('SELECT * FROM work_understanding_threads WHERE thread_id = ?')
    .get(id) as unknown as ThreadRow | undefined;
  return row ? threadFromRow(row) : null;
}

export function getWorkUnderstandingThreadByCanonicalKey(key: string): WorkUnderstandingThread | null {
  const { db } = requireXopcDatabase();
  const row = db.prepare('SELECT * FROM work_understanding_threads WHERE canonical_key = ?')
    .get(key) as unknown as ThreadRow | undefined;
  return row ? threadFromRow(row) : null;
}

export function listWorkUnderstandingThreads(options: {
  projectId?: string;
  includeRejected?: boolean;
  limit?: number;
} = {}): WorkUnderstandingThread[] {
  const { db } = requireXopcDatabase();
  const clauses: string[] = [];
  const args: Array<string | number> = [];
  if (!options.includeRejected) clauses.push("t.user_status <> 'rejected'");
  if (options.projectId) {
    clauses.push('EXISTS (SELECT 1 FROM work_understanding_thread_projects p WHERE p.thread_id = t.thread_id AND p.project_id = ?)');
    args.push(options.projectId);
  }
  args.push(Math.max(1, Math.min(200, options.limit ?? 50)));
  const rows = db.prepare(
    `SELECT t.* FROM work_understanding_threads t
     ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY t.focus_score DESC, t.last_observed_at DESC LIMIT ?`,
  ).all(...args) as unknown as ThreadRow[];
  return rows.map(threadFromRow);
}

export function upsertWorkUnderstandingThread(input: {
  canonicalKey: string;
  title: string;
  summary: string;
  status: WorkUnderstandingThread['status'];
  horizon: WorkUnderstandingThread['horizon'];
  focusScore: number;
  confidence: number;
  projectIds: string[];
  evidenceIds: string[];
  observedAt?: number;
  nowMs?: number;
}): WorkUnderstandingThread {
  const now = input.nowMs ?? Date.now();
  const observedAt = input.observedAt ?? now;
  const existing = getWorkUnderstandingThreadByCanonicalKey(input.canonicalKey);
  const id = existing?.id ?? randomUUID();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO work_understanding_threads (
        thread_id, canonical_key, title, summary, status, horizon, focus_score,
        confidence, user_status, first_observed_at, last_observed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unreviewed', ?, ?, ?, ?)
      ON CONFLICT(canonical_key) DO UPDATE SET
        title = CASE WHEN work_understanding_threads.user_status = 'corrected' THEN work_understanding_threads.title ELSE excluded.title END,
        summary = CASE WHEN work_understanding_threads.user_status = 'corrected' THEN work_understanding_threads.summary ELSE excluded.summary END,
        status = CASE WHEN work_understanding_threads.status IN ('paused', 'completed') THEN work_understanding_threads.status ELSE excluded.status END,
        horizon = excluded.horizon,
        focus_score = CASE WHEN work_understanding_threads.user_status = 'confirmed'
          THEN MIN(100, excluded.focus_score + 12) ELSE excluded.focus_score END,
        confidence = CASE WHEN work_understanding_threads.user_status IN ('confirmed', 'corrected')
          THEN MAX(work_understanding_threads.confidence, excluded.confidence) ELSE excluded.confidence END,
        last_observed_at = excluded.last_observed_at,
        updated_at = excluded.updated_at`,
    ).run(
      id,
      input.canonicalKey,
      input.title.slice(0, 200),
      input.summary.slice(0, 2_000),
      input.status,
      input.horizon,
      Math.max(0, Math.min(100, input.focusScore)),
      Math.max(0, Math.min(1, input.confidence)),
      observedAt,
      observedAt,
      now,
      now,
    );
    const row = db.prepare('SELECT thread_id FROM work_understanding_threads WHERE canonical_key = ?')
      .get(input.canonicalKey) as unknown as { thread_id: string };
    const projectInsert = db.prepare(
      'INSERT OR IGNORE INTO work_understanding_thread_projects (thread_id, project_id, created_at) VALUES (?, ?, ?)',
    );
    for (const projectId of [...new Set(input.projectIds)].slice(0, 20)) projectInsert.run(row.thread_id, projectId, now);
    const evidenceInsert = db.prepare(
      `INSERT OR IGNORE INTO work_understanding_thread_evidence (thread_id, evidence_id, relation, created_at)
       VALUES (?, ?, 'supports', ?)`,
    );
    for (const evidenceId of [...new Set(input.evidenceIds)].slice(0, 50)) evidenceInsert.run(row.thread_id, evidenceId, now);
  });
  return getWorkUnderstandingThreadByCanonicalKey(input.canonicalKey)!;
}

export function addWorkUnderstandingThreadFeedback(input: {
  threadId: string;
  decision: 'confirmed' | 'corrected' | 'rejected' | 'paused' | 'completed';
  correctedTitle?: string;
  correctedSummary?: string;
  nowMs?: number;
}): WorkUnderstandingThread | null {
  const thread = getWorkUnderstandingThread(input.threadId);
  if (!thread) return null;
  const now = input.nowMs ?? Date.now();
  const userStatus = input.decision === 'confirmed'
    ? 'confirmed'
    : input.decision === 'corrected'
      ? 'corrected'
      : input.decision === 'rejected'
        ? 'rejected'
        : thread.userStatus;
  const status = input.decision === 'paused' || input.decision === 'completed'
    ? input.decision
    : thread.status;
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT INTO work_understanding_thread_feedback (
        feedback_id, thread_id, decision, corrected_title, corrected_summary, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), thread.id, input.decision, input.correctedTitle ?? null, input.correctedSummary ?? null, now);
    db.prepare(
      `UPDATE work_understanding_threads SET title = ?, summary = ?, status = ?, user_status = ?,
       focus_score = ?, confidence = ?, updated_at = ? WHERE thread_id = ?`,
    ).run(
      input.decision === 'corrected' && input.correctedTitle?.trim() ? input.correctedTitle.trim().slice(0, 200) : thread.title,
      input.decision === 'corrected' && input.correctedSummary?.trim() ? input.correctedSummary.trim().slice(0, 2_000) : thread.summary,
      status,
      userStatus,
      input.decision === 'confirmed' ? Math.min(100, thread.focusScore + 12) : thread.focusScore,
      input.decision === 'confirmed' || input.decision === 'corrected' ? 1 : thread.confidence,
      now,
      thread.id,
    );
  });
  return getWorkUnderstandingThread(thread.id);
}

export function attachWorkUnderstandingThreadEvidence(input: {
  threadId: string;
  evidenceId: string;
  projectId?: string;
  nowMs?: number;
}): WorkUnderstandingThread | null {
  const thread = getWorkUnderstandingThread(input.threadId);
  if (!thread) return null;
  const now = input.nowMs ?? Date.now();
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `INSERT OR IGNORE INTO work_understanding_thread_evidence (thread_id, evidence_id, relation, created_at)
       VALUES (?, ?, 'supports', ?)`,
    ).run(thread.id, input.evidenceId, now);
    if (input.projectId) {
      db.prepare(
        'INSERT OR IGNORE INTO work_understanding_thread_projects (thread_id, project_id, created_at) VALUES (?, ?, ?)',
      ).run(thread.id, input.projectId, now);
    }
    db.prepare(
      `UPDATE work_understanding_threads SET confidence = MIN(1, confidence + 0.05),
       focus_score = MIN(100, focus_score + 4), last_observed_at = MAX(last_observed_at, ?), updated_at = ?
       WHERE thread_id = ?`,
    ).run(now, now, thread.id);
  });
  return getWorkUnderstandingThread(thread.id);
}
