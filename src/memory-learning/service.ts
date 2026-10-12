import { repairLegacyKnowledgeEvidence } from '../knowledge-memory/repair-evidence.js';
import type { Config } from '../config/schema.js';
import { isXopcDatabaseOpen } from '../storage/sqlite/index.js';
import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { createLogger } from '../utils/logger.js';
import { claimLearningJob, enqueueConversationLearning, failLearningJob, renewLearningLease, type LearningJob } from './repository.js';
import { learnTaskReceipts } from './task-receipts.js';
import { pruneSourceRetention, recoverKnowledgeIndexes, recoverSourceLearning, runSourceLearning } from './source-learning.js';

const log = createLogger('MemoryLearning');

export class MemoryLearningService {
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;
  private lastRetentionSweep = 0;
  constructor(private readonly options: {
    getConfig: () => Config | undefined;
    workspaceForSession: (id: string) => string;
    execute: (job: LearningJob) => Promise<void>;
  }) {}

  start(): void {
    this.timer = setInterval(() => { void this.runNow(); }, 10_000);
    this.timer.unref();
  }

  stop(): void { this.stopped = true; clearInterval(this.timer); }

  async runNow(): Promise<void> {
    const config = this.options.getConfig();
    if (this.stopped || this.running || !config || !isXopcDatabaseOpen()) return;
    this.running = true;
    try {
      repairLegacyKnowledgeEvidence();
      if (Date.now() - this.lastRetentionSweep >= 3_600_000) {
        pruneSourceRetention(config);
        this.lastRetentionSweep = Date.now();
      }
      learnTaskReceipts(config, this.options.workspaceForSession);
      await recoverKnowledgeIndexes(config);
      recoverSourceLearning(config);
      const sessions = getSqliteDatabase().prepare(`SELECT s.conversation_id FROM sessions s
        LEFT JOIN session_config cfg ON cfg.conversation_id = s.conversation_id
        WHERE s.updated_at >= ? AND COALESCE(cfg.user_context_mode, 'enabled') = 'enabled'
        AND json_extract(s.routing_json, '$.peerKind') = 'direct'
        AND (json_extract(s.routing_json, '$.source') IN ('webchat','cli','tui') OR EXISTS (
          SELECT 1 FROM owner_identity_bindings b WHERE b.revoked_at IS NULL
          AND b.channel = json_extract(s.routing_json, '$.source')
          AND b.account_id = json_extract(s.routing_json, '$.accountId')
          AND b.peer_id = json_extract(s.routing_json, '$.peerId')))
        AND EXISTS (SELECT 1 FROM transcript_entries e WHERE e.transcript_id = s.active_transcript_id
          AND e.role = 'assistant' AND e.seq > COALESCE((SELECT processed_seq FROM memory_learning_cursors c
            WHERE c.conversation_id = s.conversation_id AND c.transcript_id = s.active_transcript_id), 0))
        ORDER BY COALESCE((SELECT MAX(j.updated_at) FROM memory_learning_jobs j
          WHERE j.conversation_id = s.conversation_id), 0), s.updated_at DESC LIMIT 200`)
        .all(Date.now() - 30 * 86_400_000) as Array<{ conversation_id: string }>;
      for (const session of sessions) enqueueConversationLearning(config, session.conversation_id,
        this.options.workspaceForSession(session.conversation_id));
      const dayStart = Date.now() - (Date.now() % 86_400_000);
      const batches = getSqliteDatabase().prepare(`SELECT COUNT(*) AS n FROM context_extraction_runs
        WHERE extractor_id IN ('transcript-synthesis', 'source-work-synthesis') AND started_at >= ?`).get(dayStart) as { n: number };
      const remaining = Math.max(0, (config.userContext.knowledgeMemory.learning?.maxDailyBatches ?? 100) - batches.n);
      for (let n = 0; n < Math.min(3, remaining) && !this.stopped; n += 1) {
        if (n === 2 && await runSourceLearning(this.options.getConfig)) continue;
        const job = claimLearningJob();
        if (!job) { await runSourceLearning(this.options.getConfig); break; }
        const renew = setInterval(() => {
          try { renewLearningLease(job); } catch { clearInterval(renew); }
        }, 30_000);
        renew.unref();
        try { await this.options.execute(job); }
        catch (err) {
          failLearningJob(job, 'extraction_failed');
          log.warn({ err, jobId: job.job_id, conversationId: job.conversation_id, phase: 'extract' }, 'Memory learning failed; retry queued');
        } finally { clearInterval(renew); }
      }
    } catch (err) {
      log.warn({ err, phase: 'recover' }, 'Memory learning recovery failed');
    } finally { this.running = false; }
  }
}
