import { randomUUID } from 'node:crypto';

import type { SearchCacheEntry } from '../../agent/tools/search/cache.js';
import { mergeResearchCheckpoint, type ResearchCheckpoint, type ResearchCheckpointUpdate, type ResearchEvidence } from '../../agent/orchestration/research-checkpoint.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

export interface StoredResearchCheckpoint {
  id: string;
  conversationId: string;
  workspace: string;
  goal: string;
  checkpoint: ResearchCheckpoint;
  status: 'running' | 'partial' | 'completed' | 'failed' | 'cancelled';
  attempts: number;
  stopReason?: string;
  summary: string;
  leaseToken?: string;
  leaseExpiresAt?: number;
}
type Row = { id: string; conversation_id: string; workspace: string; goal: string; checkpoint_json: string;
  status: StoredResearchCheckpoint['status']; attempts: number; stop_reason: string | null; summary: string;
  lease_token: string | null; lease_expires_at: number | null };
function decode(row: Row): StoredResearchCheckpoint {
  return { id: row.id, conversationId: row.conversation_id, workspace: row.workspace, goal: row.goal,
    checkpoint: JSON.parse(row.checkpoint_json), status: row.status, attempts: row.attempts,
    stopReason: row.stop_reason ?? undefined, summary: row.summary,
    leaseToken: row.lease_token ?? undefined, leaseExpiresAt: row.lease_expires_at ?? undefined };
}
export function getResearchCheckpoint(id: string, conversationId: string, workspace: string): StoredResearchCheckpoint | undefined {
  const row = getSqliteDatabase().prepare('SELECT * FROM research_checkpoints WHERE id = ? AND conversation_id = ? AND workspace = ?')
    .get(id, conversationId, workspace) as Row | undefined;
  return row ? decode(row) : undefined;
}
export function createResearchCheckpoint(conversationId: string, workspace: string, goal: string): StoredResearchCheckpoint {
  const id = randomUUID();
  const checkpoint: ResearchCheckpoint = { findings: [], evidence: [], nextSteps: [goal.slice(0, 500)] };
  runSqliteWriteTransaction(db => db.prepare(`INSERT INTO research_checkpoints
    (id, conversation_id, workspace, goal, checkpoint_json, status, updated_at) VALUES (?, ?, ?, ?, ?, 'partial', ?)`)
    .run(id, conversationId, workspace, goal, JSON.stringify(checkpoint), Date.now()));
  return getResearchCheckpoint(id, conversationId, workspace)!;
}
/** Lease ownership fences late tool callbacks and competing resume requests. */
export function claimResearchCheckpoint(record: StoredResearchCheckpoint, timeoutMs: number, now = Date.now()): StoredResearchCheckpoint {
  return runSqliteWriteTransaction(db => {
    const token = randomUUID();
    const result = db.prepare(`UPDATE research_checkpoints SET status = 'running', attempts = attempts + 1,
      lease_token = ?, lease_expires_at = ?, updated_at = ? WHERE id = ? AND conversation_id = ? AND workspace = ?
      AND status != 'completed' AND (lease_token IS NULL OR lease_expires_at <= ?)`)
      .run(token, now + timeoutMs, now, record.id, record.conversationId, record.workspace, now);
    if (!result.changes) throw new Error('Research checkpoint is complete or already running');
    return getResearchCheckpoint(record.id, record.conversationId, record.workspace)!;
  });
}
function mutate(record: StoredResearchCheckpoint, transform: (current: ResearchCheckpoint) => ResearchCheckpoint): ResearchCheckpoint {
  return runSqliteWriteTransaction(db => {
    const current = getResearchCheckpoint(record.id, record.conversationId, record.workspace);
    if (!current || !record.leaseToken || current.leaseToken !== record.leaseToken || current.status !== 'running'
      || (current.leaseExpiresAt ?? 0) <= Date.now()) throw new Error('Research checkpoint lease expired');
    const checkpoint = transform(current.checkpoint);
    db.prepare('UPDATE research_checkpoints SET checkpoint_json = ?, updated_at = ? WHERE id = ? AND lease_token = ?')
      .run(JSON.stringify(checkpoint), Date.now(), record.id, record.leaseToken);
    return checkpoint;
  });
}
export function saveResearchCheckpoint(record: StoredResearchCheckpoint, update: ResearchCheckpointUpdate): ResearchCheckpoint {
  return mutate(record, current => mergeResearchCheckpoint(current, update));
}
export function recordResearchEvidence(record: StoredResearchCheckpoint, evidence: ResearchEvidence): void {
  mutate(record, current => ({ ...current, evidence: [...current.evidence.filter(item => item.toolCallId !== evidence.toolCallId || item.runId !== evidence.runId),
    { ...evidence, excerpt: evidence.excerpt.slice(0, 2000) }].slice(-30) }));
}
export function finishResearchCheckpoint(record: StoredResearchCheckpoint, status: StoredResearchCheckpoint['status'], stopReason: string, summary: string): void {
  const result = runSqliteWriteTransaction(db => db.prepare(`UPDATE research_checkpoints SET status = ?, stop_reason = ?, summary = ?,
    lease_token = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND lease_token = ?`)
    .run(status, stopReason, summary.slice(0, 8000), Date.now(), record.id, record.leaseToken ?? ''));
  if (!result.changes) throw new Error('Research checkpoint lease was replaced');
}

/** Keep successful public search results with the same task lease and a bounded envelope. */
export function recordResearchSearch(record: StoredResearchCheckpoint, entry: SearchCacheEntry): void {
  mutate(record, current => {
    const searches = [...(current.searches ?? []).filter(item => item.key !== entry.key), entry].slice(-20);
    while (searches.length && JSON.stringify({ ...current, searches }).length > 200_000) searches.shift();
    return { ...current, searches };
  });
}
