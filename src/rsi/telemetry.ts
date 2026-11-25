import { AsyncLocalStorage } from 'node:async_hooks';

import type { TaskRunReceipt } from '@xopcai/gateway-contract';

import { AgentCatalogRepository } from '../agent-catalog/repository.js';
import { personalAgentId } from '../personal-agent/identity.js';
import { saveProactiveItem } from '../proactive-hub/repository.js';
import { isXopcDatabaseOpen } from '../storage/sqlite/connection.js';
import { afterSqliteCommit, getSqliteDatabase, runSqliteWriteTransaction } from '../storage/sqlite/transaction.js';
import { createLogger } from '../utils/logger.js';
import { markRsiTelemetryDegradationAlerted, recordRsiTelemetryEvent } from './repository.js';
import { resolveRsiSkillVersion, rsiSkillContentHash, type RsiSkillVersion } from './skill-installations.js';

const log = createLogger('RSI:Telemetry');
const skillTurn = new AsyncLocalStorage<{ conversationId: string; runId: string; active: boolean }>();
const qualityAlertListeners = new Set<(itemId: string) => void>();

type TelemetryEvent = Parameters<typeof recordRsiTelemetryEvent>[0];
type InvocationOutcome = TelemetryEvent['outcome'] | 'ignored';

export function onRsiQualityAlert(listener: (itemId: string) => void): () => void {
  qualityAlertListeners.add(listener);
  return () => { qualityAlertListeners.delete(listener); };
}

export function recordCapabilityOutcome(input: TelemetryEvent & { ownerId: string }) {
  return runSqliteWriteTransaction(() => {
    const now = input.now ?? Date.now();
    const stats = recordRsiTelemetryEvent({ ...input, now });
    const { capabilityKind, targetId, version, ownerId } = input;
    if (stats.invocations >= 3 && (stats.failures + stats.humanEdits) / stats.invocations >= 0.6 && !stats.degradationAlerted) {
      markRsiTelemetryDegradationAlerted(capabilityKind, targetId, version);
      const ref = `telemetry:${capabilityKind}:${targetId}:v${version}`;
      const item = saveProactiveItem({
        ownerId,
        agentId: new AgentCatalogRepository().get(personalAgentId(ownerId))?.id ?? 'main',
        coalesceKey: `rsi:degradation:${capabilityKind}:${targetId}:v${version}`,
        sourceEventIds: [ref],
        tier: 'tier_a_inbox',
        category: 'skill_candidate',
        title: `能力质量预警：建议检查 ${targetId} (v${version})`,
        summary: `该版本的 ${stats.invocations} 次执行中有 ${stats.failures} 次失败、${stats.humanEdits} 次人工要求修改结果，可在能力库回滚。`,
        provenance: {
          source: 'rsi:telemetry',
          eventType: 'rsi.telemetry.degraded',
          trust: 'system',
          coalescedCount: stats.invocations,
          reason: 'Run failure or human revision rate reached 60%',
          evidenceRefs: [ref],
          score: { actionability: 3, urgency: 2, novelty: 2, preparedness: 2, disruptionPenalty: 0, netScore: 14 },
        },
        state: 'ready',
        idempotencyKey: `rsi:degradation_alert:${capabilityKind}:${targetId}:v${version}`,
        validUntil: now + 7 * 86_400_000,
        now,
      });
      afterSqliteCommit(() => {
        for (const listener of qualityAlertListeners) {
          try { listener(item.id); }
          catch (err) { log.warn({ err, itemId: item.id }, 'Could not publish RSI quality alert'); }
        }
      });
      return { ...stats, degradationAlerted: true };
    }
    return stats;
  });
}

export async function withRsiSkillTurn<T>(conversationId: string, runId: string, run: () => Promise<T>): Promise<T> {
  const context = { conversationId, runId, active: true };
  try {
    return await skillTurn.run(context, run);
  } finally {
    context.active = false;
  }
}

export function recordRsiSkillRead(name: string, path: string, markdown: string): void {
  if (!skillTurn.getStore()?.active || !isXopcDatabaseOpen()) return;
  try {
    const version = resolveRsiSkillVersion(name, path, rsiSkillContentHash(markdown));
    if (version) registerRsiSkillInvocation(version);
  } catch (err) {
    log.warn({ err, phase: 'identify_skill_version' }, 'Could not identify RSI skill version');
  }
}

export function registerRsiSkillInvocation(version: RsiSkillVersion): void {
  const context = skillTurn.getStore();
  if (!context?.active || !isXopcDatabaseOpen()) return;
  const { conversationId, runId } = context;
  try {
    getSqliteDatabase().prepare(`
      INSERT OR IGNORE INTO rsi_skill_invocations (conversation_id, run_id, candidate_id, task_run_id)
      VALUES (?, ?, ?, COALESCE(
        (SELECT task_run_id FROM session_inputs
         WHERE conversation_id = ? AND run_id = ? AND task_run_id IS NOT NULL LIMIT 1),
        (SELECT run_id FROM task_runs WHERE conversation_id = ? AND run_id = ?)
      ))
    `).run(conversationId, runId, version.candidateId, conversationId, runId, conversationId, runId);
  } catch (err) {
    log.warn({ err, conversationId, runId, candidateId: version.candidateId }, 'Could not record RSI skill invocation');
  }
}

type Invocation = {
  conversation_id: string;
  run_id: string;
  candidate_id: string;
  outcome: InvocationOutcome | null;
  owner_id: string;
  target_id: string;
  adopted_version: number;
};

function settleInvocations(
  scope: { conversationId: string; runId: string } | { taskRunId: string },
  outcome: InvocationOutcome,
): void {
  if (!isXopcDatabaseOpen()) return;
  try {
    const task = 'taskRunId' in scope;
    const rows = getSqliteDatabase().prepare(`
      SELECT i.*, c.owner_id, c.target_id, c.adopted_version
      FROM rsi_skill_invocations i JOIN rsi_capability_candidates c ON c.id = i.candidate_id
      WHERE ${task ? 'i.task_run_id = ?' : 'i.conversation_id = ? AND i.run_id = ? AND i.task_run_id IS NULL'}
        AND ${outcome === 'human_edited' ? "i.outcome IN ('verified_success', 'unverified')" : 'i.outcome IS NULL'}
    `).all(...(task ? [scope.taskRunId] : [scope.conversationId, scope.runId])) as Invocation[];
    if (!rows.length) return;
    runSqliteWriteTransaction(db => {
      const update = db.prepare(`UPDATE rsi_skill_invocations
        SET outcome = ? WHERE conversation_id = ? AND run_id = ? AND candidate_id = ? AND outcome IS ?`);
      for (const row of rows) {
        const changed = update.run(outcome, row.conversation_id, row.run_id, row.candidate_id, row.outcome).changes;
        if (changed && outcome !== 'ignored') {
          recordCapabilityOutcome({
            ownerId: row.owner_id,
            capabilityKind: 'skill',
            targetId: row.target_id,
            version: row.adopted_version,
            outcome,
            revises: row.outcome === 'verified_success' || row.outcome === 'unverified' ? row.outcome : undefined,
          });
        }
      }
    });
  } catch (err) {
    log.warn({ err, ...scope, phase: 'settle_skill_invocations' }, 'Could not settle RSI skill telemetry');
  }
}

export function recordRsiTurnOutcome(conversationId: string, runId: string, outcome: InvocationOutcome): void {
  settleInvocations({ conversationId, runId }, outcome);
}

export function recordRsiTaskOutcome(taskRunId: string, receipt: Pick<TaskRunReceipt, 'status' | 'completionVerdict' | 'verification'>): void {
  const outcome = receipt.status === 'cancelled' ? 'ignored'
    : receipt.status === 'failed' || receipt.completionVerdict === 'not_achieved' || receipt.verification.status === 'failed' ? 'failure'
      : receipt.status === 'succeeded' && receipt.completionVerdict === 'achieved' ? 'verified_success' : 'unverified';
  settleInvocations({ taskRunId }, outcome);
}

export function recordRsiTaskRevision(taskRunId: string): void {
  settleInvocations({ taskRunId }, 'human_edited');
}
