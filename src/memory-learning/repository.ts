import { createHash, randomUUID } from 'node:crypto';

import type { Config } from '../config/schema.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { resolveUserContextSessionAccess } from '../user-context/access-policy.js';

export interface LearningJob {
  job_id: string; conversation_id: string; transcript_id: string; through_seq: number;
  policy_hash: string; workspace_id: string; lease_token: string; attempts: number;
  start_seq?: number | null;
}

export function learningPolicyHash(config: Config): string {
  const catalog = getSqliteDatabase().prepare('SELECT revision FROM agent_catalog_settings WHERE singleton_id = 1').get();
  return createHash('sha256').update(JSON.stringify({ config, catalog })).digest('hex');
}

/** Recover learning intent from authoritative rows, including notifications lost in a crash. */
export function enqueueConversationLearning(config: Config, conversationId: string, workspaceId: string,
  force = false, now = Date.now()): string | undefined {
  const access = resolveUserContextSessionAccess(config, conversationId);
  if ((!access.userModel || config.userContext.userModel.writePolicy === 'deny')
    && (!access.knowledge || config.userContext.knowledgeMemory.writePolicy === 'deny')) return;
  const idleMs = config.userContext.knowledgeMemory.learning?.idleFlushMs ?? 60_000;
  return runSqliteWriteTransaction(db => {
    const transcript = db.prepare('SELECT active_transcript_id FROM sessions WHERE conversation_id = ?').get(conversationId) as { active_transcript_id: string } | undefined;
    if (!transcript?.active_transcript_id) return;
    const id = transcript.active_transcript_id;
    const last = db.prepare(`SELECT MAX(seq) AS seq, MAX(created_at) AS last_at FROM transcript_entries
      WHERE transcript_id = ? AND role = 'assistant'`).get(id) as { seq: number | null; last_at: number | null };
    if (!last.seq) return;
    db.prepare(`INSERT OR IGNORE INTO memory_learning_cursors(conversation_id, transcript_id, updated_at) VALUES (?, ?, ?)`)
      .run(conversationId, id, now);
    const cursor = db.prepare('SELECT processed_seq FROM memory_learning_cursors WHERE conversation_id = ? AND transcript_id = ?')
      .get(conversationId, id) as { processed_seq: number };
    if (!force && cursor.processed_seq >= last.seq) return;
    const count = db.prepare(`SELECT COUNT(*) AS n FROM transcript_entries WHERE transcript_id = ? AND seq > ? AND role = 'user'`)
      .get(id, cursor.processed_seq) as { n: number };
    const due = force || count.n >= config.userContext.userModel.extraction.reviewIntervalTurns
      || now - (last.last_at ?? now) >= idleMs;
    const jobId = randomUUID();
    const inserted = db.prepare(`INSERT OR IGNORE INTO memory_learning_jobs(job_id, conversation_id, transcript_id,
      through_seq, start_seq, extractor_version, policy_hash, workspace_id, state, next_attempt_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`).run(jobId, conversationId, id, last.seq,
        force ? 0 : null, force ? `rebuild:${jobId}` : `2:${cursor.processed_seq}`,
        learningPolicyHash(config), workspaceId, due ? now : (last.last_at ?? now) + idleMs, now, now);
    db.prepare(`UPDATE memory_learning_cursors SET observed_seq = MAX(observed_seq, ?), updated_at = ?
      WHERE conversation_id = ? AND transcript_id = ?`).run(last.seq, now, conversationId, id);
    return inserted.changes ? jobId : undefined;
  });
}

export function claimLearningJob(now = Date.now()): LearningJob | undefined {
  return runSqliteWriteTransaction(db => {
    db.prepare("UPDATE memory_learning_jobs SET state = 'failed', error_code = 'lease_expired', updated_at = ? WHERE state = 'running' AND attempts >= 3 AND lease_until < ?").run(now, now);
    const row = db.prepare(`SELECT * FROM memory_learning_jobs j WHERE
      ((state IN ('queued', 'retry_wait') AND next_attempt_at <= ?) OR (state = 'running' AND lease_until < ?))
      AND NOT EXISTS (SELECT 1 FROM memory_learning_jobs other WHERE other.conversation_id = j.conversation_id
        AND other.state = 'running' AND other.lease_until >= ? AND other.job_id != j.job_id)
      AND attempts < 3 ORDER BY created_at LIMIT 1`).get(now, now, now) as unknown as LearningJob | undefined;
    if (!row) return;
    const token = randomUUID();
    db.prepare(`UPDATE memory_learning_jobs SET state = 'running', lease_token = ?, lease_until = ?,
      attempts = attempts + 1, updated_at = ? WHERE job_id = ?`).run(token, now + 180_000, now, row.job_id);
    return { ...row, lease_token: token, attempts: row.attempts + 1 };
  });
}

export function renewLearningLease(job: LearningJob): boolean {
  return Boolean(getSqliteDatabase().prepare(`UPDATE memory_learning_jobs SET lease_until = ?
    WHERE job_id = ? AND state = 'running' AND lease_token = ?`).run(Date.now() + 180_000, job.job_id, job.lease_token).changes);
}

/** Apply model results and advance progress atomically under the current lease. */
export function finishLearningJob(job: LearningJob, apply: () => void, processedThrough = job.through_seq): boolean {
  return runSqliteWriteTransaction(db => {
    const current = db.prepare(`SELECT 1 FROM memory_learning_jobs WHERE job_id = ? AND state = 'running'
      AND lease_token = ? AND lease_until >= ?`).get(job.job_id, job.lease_token, Date.now());
    if (!current) return false;
    apply();
    db.prepare(`UPDATE memory_learning_cursors SET processed_seq = MAX(processed_seq, ?), updated_at = ?
      WHERE conversation_id = ? AND transcript_id = ?`).run(processedThrough, Date.now(), job.conversation_id, job.transcript_id);
    db.prepare(`UPDATE memory_learning_jobs SET state = 'succeeded', lease_token = NULL, lease_until = NULL, updated_at = ? WHERE job_id = ?`)
      .run(Date.now(), job.job_id);
    db.prepare(`UPDATE memory_learning_jobs SET state = 'canceled', updated_at = ? WHERE conversation_id = ?
      AND transcript_id = ? AND through_seq <= ? AND start_seq IS NULL AND state IN ('queued','retry_wait')`)
      .run(Date.now(), job.conversation_id, job.transcript_id, processedThrough);
    if (processedThrough < job.through_seq) {
      const nextId = randomUUID();
      db.prepare(`INSERT INTO memory_learning_jobs(job_id, conversation_id, transcript_id, through_seq,
        start_seq, extractor_version, policy_hash, workspace_id, state, next_attempt_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`).run(nextId, job.conversation_id,
          job.transcript_id, job.through_seq, job.start_seq == null ? null : processedThrough,
          job.start_seq == null ? `2:${processedThrough}` : `rebuild:${nextId}`, job.policy_hash,
          job.workspace_id, Date.now(), Date.now(), Date.now());
    }
    return true;
  });
}

export function failLearningJob(job: LearningJob, errorCode: string, canceled = false): void {
  getSqliteDatabase().prepare(`UPDATE memory_learning_jobs SET state = ?, error_code = ?, lease_token = NULL,
    lease_until = NULL, next_attempt_at = ?, updated_at = ? WHERE job_id = ? AND lease_token = ?`)
    .run(canceled ? 'canceled' : job.attempts >= 3 ? 'failed' : 'retry_wait', errorCode,
      Date.now() + 30_000 * 2 ** job.attempts, Date.now(), job.job_id, job.lease_token);
}

export function learningStatus(config?: Config): { jobs: unknown[]; coverage: unknown[] } {
  const db = getSqliteDatabase();
  return {
    jobs: db.prepare(`SELECT state, error_code AS errorCode, COUNT(*) AS count FROM (
      SELECT state, error_code, policy_hash FROM memory_learning_jobs UNION ALL SELECT state, error_code, policy_hash FROM memory_source_learning_jobs
    ) ${config ? 'WHERE policy_hash = ?' : ''} GROUP BY state, error_code`).all(...(config ? [learningPolicyHash(config)] : [])),
    coverage: db.prepare('SELECT record_class AS recordClass, status, verification, COUNT(*) AS count FROM knowledge_items GROUP BY record_class, status, verification').all(),
  };
}
