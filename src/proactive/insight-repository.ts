import { createHash, randomUUID } from 'node:crypto';

import { requireXopcDatabase } from '../storage/sqlite/connection.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

import type {
  FocusWatchKind,
  ProactiveEvidence,
  ProactiveInsight,
  ProactiveInsightStatus,
} from './types.js';

interface ProactiveInsightRow {
  insight_id: string;
  watch_id: string;
  run_id: string;
  kind: FocusWatchKind;
  title: string;
  summary: string;
  why_it_matters: string;
  next_action: string;
  evidence_json: string;
  content_hash: string;
  status: ProactiveInsightStatus;
  created_at: number;
  updated_at: number;
}

function insightFromRow(row: ProactiveInsightRow): ProactiveInsight {
  return {
    id: row.insight_id,
    watchId: row.watch_id,
    runId: row.run_id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    whyItMatters: row.why_it_matters,
    nextAction: row.next_action,
    evidence: JSON.parse(row.evidence_json) as ProactiveEvidence[],
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getProactiveInsight(id: string): ProactiveInsight | null {
  const { db } = requireXopcDatabase();
  const row = db.prepare('SELECT * FROM proactive_insights WHERE insight_id = ?')
    .get(id) as unknown as ProactiveInsightRow | undefined;
  return row ? insightFromRow(row) : null;
}

export function listProactiveInsights(options: {
  status?: ProactiveInsightStatus[];
  limit?: number;
} = {}): ProactiveInsight[] {
  const statuses = options.status ?? ['unread', 'read'];
  if (statuses.length === 0) return [];
  const limit = Math.max(1, Math.min(100, options.limit ?? 20));
  const { db } = requireXopcDatabase();
  const rows = db.prepare(
    `SELECT * FROM proactive_insights
     WHERE status IN (${statuses.map(() => '?').join(', ')})
     ORDER BY created_at DESC LIMIT ?`,
  ).all(...statuses, limit) as unknown as ProactiveInsightRow[];
  return rows.map(insightFromRow);
}

export function createProactiveInsight(input: {
  watchId: string;
  runId: string;
  kind: FocusWatchKind;
  title: string;
  summary: string;
  whyItMatters: string;
  nextAction: string;
  evidence: ProactiveEvidence[];
  nowMs?: number;
}): ProactiveInsight | null {
  const id = randomUUID();
  const now = input.nowMs ?? Date.now();
  const canonicalSources = input.evidence.map((item) => canonicalSource(item.source)).filter(Boolean).toSorted();
  const fingerprint = input.kind === 'intelligence' && canonicalSources.length > 0
    ? JSON.stringify({ kind: input.kind, sources: canonicalSources })
    : JSON.stringify({
        kind: input.kind,
        title: input.title.toLocaleLowerCase().trim(),
        summary: input.summary.toLocaleLowerCase().trim(),
        evidence: input.evidence.map((item) => [
          item.label.toLocaleLowerCase().trim(),
          canonicalSource(item.source),
          item.publishedAt ?? '',
        ]),
      });
  const contentHash = createHash('sha256').update(fingerprint).digest('hex');
  let created = false;
  runSqliteWriteTransaction((db) => {
    created = db.prepare(
      `INSERT OR IGNORE INTO proactive_insights (
        insight_id, watch_id, run_id, kind, title, summary, why_it_matters,
        next_action, evidence_json, content_hash, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unread', ?, ?)`,
    ).run(
      id,
      input.watchId,
      input.runId,
      input.kind,
      input.title,
      input.summary,
      input.whyItMatters,
      input.nextAction,
      JSON.stringify(input.evidence),
      contentHash,
      now,
      now,
    ).changes > 0;
  });
  return created ? listProactiveInsights({ limit: 100 }).find((item) => item.id === id) ?? null : null;
}

function canonicalSource(source: string | undefined): string {
  const value = source?.trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_') || key === 'ref' || key === 'source') url.searchParams.delete(key);
    }
    url.pathname = url.pathname.replace(/\/$/, '');
    return url.toString().toLocaleLowerCase();
  } catch {
    return value.toLocaleLowerCase();
  }
}

export function setProactiveInsightStatus(
  id: string,
  status: ProactiveInsightStatus,
  nowMs = Date.now(),
  expectedStatus?: ProactiveInsightStatus,
): ProactiveInsight | null {
  let changed = false;
  runSqliteWriteTransaction((db) => {
    changed = db.prepare(
      `UPDATE proactive_insights SET status = ?, updated_at = ? WHERE insight_id = ?
       ${expectedStatus ? 'AND status = ?' : ''}`,
    ).run(status, nowMs, id, ...(expectedStatus ? [expectedStatus] : [])).changes > 0;
  });
  if (!changed) return null;
  const { db } = requireXopcDatabase();
  const row = db.prepare('SELECT * FROM proactive_insights WHERE insight_id = ?')
    .get(id) as unknown as ProactiveInsightRow;
  return insightFromRow(row);
}

export function claimProactiveInsightApproval(id: string, nowMs = Date.now()): ProactiveInsight | null {
  let claimed = false;
  runSqliteWriteTransaction((db) => {
    claimed = db.prepare(
      `UPDATE proactive_insights SET status = 'approved', updated_at = ?
       WHERE insight_id = ? AND status = 'unread'`,
    ).run(nowMs, id).changes > 0;
  });
  return claimed ? getProactiveInsight(id) : null;
}
