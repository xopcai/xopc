import { getKnowledgeSourceItem } from '../storage/sqlite/knowledge-repository.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';

const MAX_SOURCE_AGE_MS = 30 * 60_000;

/** Only a successful pull of this collection proves its observed coverage. */
export function sourceFreshness(itemId: string, notBefore?: string, now = Date.now()) {
  const item = getKnowledgeSourceItem(itemId);
  const row = item ? getSqliteDatabase().prepare(`SELECT run_id, status, started_at, finished_at FROM knowledge_sync_runs
    WHERE source_instance_id = ? AND collection_scope = ? ORDER BY started_at DESC, rowid DESC LIMIT 1`)
    .get(item.sourceInstanceId, item.collectionScope) as { run_id: string; status: string; started_at: number; finished_at: number | null } | undefined : undefined;
  const lastSuccess = item ? getSqliteDatabase().prepare("SELECT MAX(finished_at) AS at FROM knowledge_sync_runs WHERE source_instance_id = ? AND collection_scope = ? AND status = 'succeeded'").get(item.sourceInstanceId, item.collectionScope) as { at: number | null } : undefined;
  const fresh = Boolean(row?.status === 'succeeded' && row.finished_at && row.started_at <= now
    && now - row.started_at <= MAX_SOURCE_AGE_MS && (!notBefore || row.started_at >= Date.parse(notBefore)));
  return { fresh, lastSyncedAt: lastSuccess?.at ? new Date(lastSuccess.at).toISOString() : null,
    syncFailed: Boolean(row && ['failed', 'partial', 'cancelled'].includes(row.status)), version: row?.run_id ?? 'unknown' };
}

export function evidenceSourcesFresh(ids: string[], context?: Record<string, unknown>): boolean {
  const follow = context?.follow_up as { dueAt?: string; deadlinePassed?: boolean } | undefined;
  return ids.every(id => !id.startsWith('source-item:') || sourceFreshness(id.slice(12), follow?.deadlinePassed ? follow.dueAt : undefined).fresh);
}
