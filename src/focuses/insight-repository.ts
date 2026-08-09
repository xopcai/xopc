import { createHash, randomUUID } from 'node:crypto';

import { requireXopcDatabase } from '../storage/sqlite/connection.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import type {
  FocusEvidence,
  FocusInsight,
  FocusInsightStatus,
  FocusMonitorKind,
} from './types.js';

interface InsightRow {
  insight_id: string;
  focus_id: string;
  monitor_id: string;
  run_id: string;
  kind: FocusMonitorKind;
  title: string;
  summary: string;
  why_it_matters: string;
  next_action: string;
  evidence_json: string;
  status: FocusInsightStatus;
  value_score: number;
  value_reasons_json: string;
  created_at: number;
  updated_at: number;
}

function parseArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function insightFromRow(row: InsightRow): FocusInsight {
  return {
    id: row.insight_id,
    focusId: row.focus_id,
    monitorId: row.monitor_id,
    runId: row.run_id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    whyItMatters: row.why_it_matters,
    nextAction: row.next_action,
    evidence: parseArray<FocusEvidence>(row.evidence_json),
    status: row.status,
    valueScore: row.value_score,
    valueReasons: parseArray<string>(row.value_reasons_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getFocusInsight(id: string): FocusInsight | null {
  const { db } = requireXopcDatabase();
  const row = db.prepare('SELECT * FROM focus_insights WHERE insight_id = ?')
    .get(id) as unknown as InsightRow | undefined;
  return row ? insightFromRow(row) : null;
}

export function listFocusInsights(input: {
  focusId: string;
  statuses?: FocusInsightStatus[];
  limit?: number;
}): FocusInsight[] {
  const statuses = input.statuses ?? ['unread', 'approved'];
  if (statuses.length === 0) return [];
  const { db } = requireXopcDatabase();
  const rows = db.prepare(
    `SELECT * FROM focus_insights WHERE focus_id = ?
     AND status IN (${statuses.map(() => '?').join(', ')})
     ORDER BY created_at DESC LIMIT ?`,
  ).all(input.focusId, ...statuses, Math.max(1, Math.min(100, input.limit ?? 20))) as unknown as InsightRow[];
  return rows.map(insightFromRow);
}

export function createFocusInsight(input: {
  focusId: string;
  monitorId: string;
  runId: string;
  kind: FocusMonitorKind;
  title: string;
  summary: string;
  whyItMatters: string;
  nextAction: string;
  evidence: FocusEvidence[];
  valueScore?: number;
  valueReasons?: string[];
  nowMs?: number;
}): FocusInsight | null {
  const now = input.nowMs ?? Date.now();
  const id = randomUUID();
  const normalized = JSON.stringify({
    kind: input.kind,
    title: input.title.trim().toLocaleLowerCase(),
    evidence: input.evidence.map((item) => [
      item.label.trim().toLocaleLowerCase(),
      item.source?.trim().toLocaleLowerCase() ?? '',
      item.publishedAt ?? '',
    ]),
  });
  const contentHash = createHash('sha256').update(normalized).digest('hex');
  let created = false;
  runSqliteWriteTransaction((db) => {
    created = db.prepare(
      `INSERT OR IGNORE INTO focus_insights (
        insight_id, focus_id, monitor_id, run_id, kind, title, summary,
        why_it_matters, next_action, evidence_json, content_hash, status,
        value_score, value_reasons_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unread', ?, ?, ?, ?)`,
    ).run(
      id,
      input.focusId,
      input.monitorId,
      input.runId,
      input.kind,
      input.title.trim().slice(0, 200),
      input.summary.trim().slice(0, 2_000),
      input.whyItMatters.trim().slice(0, 2_000),
      input.nextAction.trim().slice(0, 2_000),
      JSON.stringify(input.evidence),
      contentHash,
      input.valueScore ?? 0,
      JSON.stringify(input.valueReasons ?? []),
      now,
      now,
    ).changes > 0;
  });
  return created ? getFocusInsight(id) : null;
}

export function setFocusInsightStatus(
  id: string,
  status: FocusInsightStatus,
  expectedStatus?: FocusInsightStatus,
  nowMs = Date.now(),
): FocusInsight | null {
  let changed = false;
  runSqliteWriteTransaction((db) => {
    changed = db.prepare(
      `UPDATE focus_insights SET status = ?, updated_at = ? WHERE insight_id = ?
       ${expectedStatus ? 'AND status = ?' : ''}`,
    ).run(status, nowMs, id, ...(expectedStatus ? [expectedStatus] : [])).changes > 0;
  });
  return changed ? getFocusInsight(id) : null;
}
