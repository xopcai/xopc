import { createHash } from 'node:crypto';

import { inferMemorySensitivity } from '../agent/memory/sensitivity.js';
import type { Config } from '../config/schema.js';
import { writeKnowledgeItem } from '../knowledge-memory/index.js';
import { createContextEvidence } from '../storage/sqlite/context-evidence-repository.js';
import { getSessionMetadata } from '../storage/sqlite/session-repository.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { projectUnadmittedForgottenFields } from './forgotten-history.js';
import { resolveKnowledgeReadPolicy } from '../user-context/config.js';
import { OWNER_LEARNING_SESSION_SQL } from './transcript-source.js';
import { resolveUserContextSessionAccess } from '../user-context/access-policy.js';

type Receipt = {
  run_id: string; conversation_id: string; project_id: string | null; title: string;
  status: string; summary: string; verification_json: string; remaining_work_json: string;
  next_action: string | null; completion_verdict: string | null; finalized_at: number;
};

/** Learn host-recorded outcomes independently of transcript length or model availability. */
export function learnTaskReceipts(config: Config, workspaceForSession: (id: string) => string): number {
  if (!config.userContext.enabled || !config.userContext.knowledgeMemory.enabled || config.userContext.knowledgeMemory.writePolicy !== 'allow') return 0;
  const policy = resolveKnowledgeReadPolicy(config.userContext.knowledgeMemory);
  if (!policy.contentSources.includes('memory')) return 0;
  const rows = getSqliteDatabase().prepare(`SELECT receipt.*, origin.conversation_id, task.project_id, task.title
    FROM task_run_receipts receipt JOIN task_runs run ON run.run_id = receipt.run_id
    JOIN tasks task ON task.task_id = run.task_id JOIN task_origin_links origin ON origin.task_id = task.task_id
    JOIN sessions s ON s.conversation_id = origin.conversation_id
    LEFT JOIN session_config cfg ON cfg.conversation_id = s.conversation_id
    WHERE COALESCE(cfg.user_context_mode, 'enabled') = 'enabled'
    AND ${OWNER_LEARNING_SESSION_SQL}
    AND ((task.project_id IS NULL AND ? = 1) OR (task.project_id IS NOT NULL AND ? = 1))
    AND NOT EXISTS (SELECT 1 FROM memory_learning_receipts learned WHERE learned.run_id = receipt.run_id)
    ORDER BY receipt.finalized_at LIMIT 100`).all(policy.scopes.includes('workspace') ? 1 : 0,
      policy.scopes.includes('project') ? 1 : 0) as Receipt[];
  let learned = 0;
  for (const row of rows) {
    const access = resolveUserContextSessionAccess(config, row.conversation_id);
    if (!access.knowledge || config.userContext.knowledgeMemory.writePolicy !== 'allow'
      || !access.knowledgePolicy.contentSources.includes('memory')) continue;
    const scope = row.project_id ? { type: 'project' as const, id: row.project_id }
      : { type: 'workspace' as const, id: workspaceForSession(row.conversation_id) };
    if (!access.knowledgePolicy.scopes.includes(scope.type)) continue;
    const content = [
      `Execution receipt for ${row.title}: status=${row.status}; verdict=${row.completion_verdict ?? 'unverified'}.`,
      `Reported summary: ${row.summary.slice(0, 1600)}`,
      `Verification: ${row.verification_json.slice(0, 1200)}`,
      `Remaining work: ${row.remaining_work_json.slice(0, 1200)}`,
      row.next_action ? `Next action: ${row.next_action.slice(0, 600)}` : undefined,
    ].filter(Boolean).join('\n');
    const sensitivity = inferMemorySensitivity(content);
    const context = { conversationId: row.conversation_id, agentId: getSessionMetadata(row.conversation_id)?.agentId ?? 'main',
      workspaceId: workspaceForSession(row.conversation_id), projectId: row.project_id ?? undefined };
    const forgotten = projectUnadmittedForgottenFields(content, context) !== content;
    runSqliteWriteTransaction(db => {
      let knowledgeId: string | undefined;
      if (!forgotten && sensitivity !== 'secret' && sensitivity !== 'regulated') {
        const hash = createHash('sha256').update(content).digest('hex');
        const evidence = createContextEvidence({ sourceType: 'runtime', sourceRef: `task-run:${row.run_id}`,
          conversationId: row.conversation_id, contentHash: hash, trustLevel: 'trusted', observedAt: row.finalized_at });
        const result = writeKnowledgeItem({ kind: row.status === 'failed' ? 'task_lesson' : 'episode', scope,
          content, canonicalKey: `task-run:${row.run_id}`, status: 'active', verification: 'supported',
          claimMode: 'reported', sensitivity, confidence: 0.9, importance: 0.7, originClass: 'agent',
          sourceAgentId: getSessionMetadata(row.conversation_id)?.agentId,
          sourceConversationId: row.conversation_id, source: { provider: 'task-receipt', runId: row.run_id },
          evidence: [{ id: evidence.id, contentHash: hash }], replaceExisting: true,
          reviewAt: row.finalized_at + 90 * 86_400_000 });
        knowledgeId = result.item?.id;
      }
      db.prepare('INSERT OR IGNORE INTO memory_learning_receipts(run_id, learned_at, knowledge_id) VALUES (?, ?, ?)')
        .run(row.run_id, Date.now(), knowledgeId ?? null);
    });
    learned += 1;
  }
  return learned;
}
