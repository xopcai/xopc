import {
  deleteMemoryRecord,
  listMemoryRecords,
} from '../storage/sqlite/memory-records-repository.js';
import { requireXopcDatabase } from '../storage/sqlite/connection.js';
import { runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';

export interface WorkUnderstandingSourceLineage {
  sourceId: string;
  evidenceCount: number;
  threadCount: number;
  memoryRecordCount: number;
  discoveryRunCount: number;
}

function memoryRecordsForSource(sourceId: string, rootPath: string | null) {
  const { db } = requireXopcDatabase();
  const runIds = rootPath
    ? (db.prepare('SELECT id FROM work_discovery_runs WHERE root_path = ?').all(rootPath) as Array<{ id: string }>)
      .map((row) => row.id)
    : [];
  const runPaths = new Set(runIds.map((id) => `work-discovery://${id}`));
  const records = [];
  for (let offset = 0; ; offset += 500) {
    const page = listMemoryRecords({ limit: 500, offset });
    records.push(...page.filter((record) =>
      runPaths.has(record.source.path)));
    if (page.length < 500) break;
  }
  return records;
}

export function getWorkUnderstandingSourceLineage(sourceId: string): WorkUnderstandingSourceLineage | null {
  const { db } = requireXopcDatabase();
  const source = db.prepare('SELECT root_path FROM work_discovery_sources WHERE source_id = ?')
    .get(sourceId) as { root_path: string | null } | undefined;
  if (!source) return null;
  const evidenceCount = (db.prepare(
    'SELECT COUNT(*) AS count FROM work_understanding_evidence WHERE source_grant_id = ?',
  ).get(sourceId) as { count: number }).count;
  const threadCount = (db.prepare(
    `SELECT COUNT(DISTINCT te.thread_id) AS count
     FROM work_understanding_thread_evidence te
     JOIN work_understanding_evidence e ON e.evidence_id = te.evidence_id
     WHERE e.source_grant_id = ?`,
  ).get(sourceId) as { count: number }).count;
  const discoveryRunCount = source.root_path
    ? (db.prepare('SELECT COUNT(*) AS count FROM work_discovery_runs WHERE root_path = ?')
      .get(source.root_path) as { count: number }).count
    : 0;
  return {
    sourceId,
    evidenceCount,
    threadCount,
    memoryRecordCount: memoryRecordsForSource(sourceId, source.root_path).length,
    discoveryRunCount,
  };
}

export function deleteWorkUnderstandingDerivedData(sourceId: string) {
  const lineage = getWorkUnderstandingSourceLineage(sourceId);
  if (!lineage) return null;
  const { db } = requireXopcDatabase();
  const source = db.prepare('SELECT root_path FROM work_discovery_sources WHERE source_id = ?')
    .get(sourceId) as { root_path: string | null };
  const memoryRecords = memoryRecordsForSource(sourceId, source.root_path)
    .filter((record) => record.explicitness !== 'explicit');
  const affectedThreadIds = (db.prepare(
    `SELECT DISTINCT te.thread_id AS id
     FROM work_understanding_thread_evidence te
     JOIN work_understanding_evidence e ON e.evidence_id = te.evidence_id
     WHERE e.source_grant_id = ?`,
  ).all(sourceId) as Array<{ id: string }>).map((row) => row.id);
  const result = runSqliteWriteTransaction((transaction) => {
    transaction.prepare(
      `DELETE FROM work_understanding_thread_evidence
       WHERE evidence_id IN (SELECT evidence_id FROM work_understanding_evidence WHERE source_grant_id = ?)`,
    ).run(sourceId);
    const evidence = transaction.prepare('DELETE FROM work_understanding_evidence WHERE source_grant_id = ?').run(sourceId);
    let deletedThreads = 0;
    let retainedThreads = 0;
    for (const threadId of affectedThreadIds) {
      const remaining = (transaction.prepare(
        'SELECT COUNT(*) AS count FROM work_understanding_thread_evidence WHERE thread_id = ?',
      ).get(threadId) as { count: number }).count;
      if (remaining > 0) continue;
      const thread = transaction.prepare(
        'SELECT user_status, status FROM work_understanding_threads WHERE thread_id = ?',
      ).get(threadId) as { user_status: string; status: string } | undefined;
      if (!thread) continue;
      if (thread.user_status === 'confirmed' || thread.user_status === 'corrected') {
        transaction.prepare(
          `UPDATE work_understanding_threads SET confidence = MIN(confidence, 0.5),
           status = CASE WHEN status IN ('paused', 'completed') THEN status ELSE 'uncertain' END,
           updated_at = ? WHERE thread_id = ?`,
        ).run(Date.now(), threadId);
        retainedThreads += 1;
      } else {
        transaction.prepare('DELETE FROM work_understanding_threads WHERE thread_id = ?').run(threadId);
        deletedThreads += 1;
      }
    }
    return { evidenceCount: evidence.changes, deletedThreads, retainedThreads };
  });
  const deletedMemoryRecords = memoryRecords.filter((record) => deleteMemoryRecord(record.id)).length;
  return { ...result, deletedMemoryRecords };
}

export function getWorkUnderstandingMetrics() {
  const { db } = requireXopcDatabase();
  const scalar = (sql: string) => (db.prepare(sql).get() as { value: number }).value;
  const evidenceBySource = db.prepare(
    'SELECT source_type AS sourceType, COUNT(*) AS count FROM work_understanding_evidence GROUP BY source_type',
  ).all() as Array<{ sourceType: string; count: number }>;
  const recognition = db.prepare(
    `SELECT recognition_decision AS decision, COUNT(*) AS count
     FROM work_discovery_feedback GROUP BY recognition_decision`,
  ).all() as Array<{ decision: string; count: number }>;
  const reviewed = recognition.reduce((sum, item) => sum + (item.decision === 'dismissed' ? 0 : item.count), 0);
  const confirmed = recognition.find((item) => item.decision === 'confirmed')?.count ?? 0;
  return {
    completedInvestigations: scalar("SELECT COUNT(*) AS value FROM work_understanding_investigations WHERE status = 'completed'"),
    averageToolCalls: scalar('SELECT COALESCE(AVG(tool_call_count), 0) AS value FROM work_understanding_investigations'),
    activeThreads: scalar("SELECT COUNT(*) AS value FROM work_understanding_threads WHERE status IN ('active', 'blocked') AND user_status <> 'rejected'"),
    confirmedThreads: scalar("SELECT COUNT(*) AS value FROM work_understanding_threads WHERE user_status IN ('confirmed', 'corrected')"),
    recognitionConfirmationRate: reviewed ? confirmed / reviewed : 0,
    evidenceBySource,
  };
}
