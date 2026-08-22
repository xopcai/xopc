import type { Config } from '../config/schema.js';
import {
  finishContextConsolidationRun,
  listUnderstandingEvidence,
  listUnderstandings,
  recordContextConsolidationDecision,
  setUnderstandingStatus,
  startContextConsolidationRun,
  type ContextConsolidationRun,
} from '../storage/sqlite/index.js';

export const USER_CONTEXT_CONSOLIDATION_TOKEN = '__xopc_user_context_consolidation__';
export const USER_CONTEXT_CONSOLIDATION_AUTOMATION_ID = 'system-user-context-consolidation';

type ConsolidationMetrics = {
  scanned: number;
  needsReview: number;
  stale: number;
};

function distinctEvidenceCount(
  understandingId: string,
  relation: 'supports' | 'contradicts',
): number {
  return new Set(listUnderstandingEvidence(understandingId, relation).map((evidence) =>
    `${evidence.sourceType}:${evidence.sourceInstanceId ?? ''}:${evidence.sourceRef}`)).size;
}

export function resolveContextConsolidationConfig(config: Config): {
  enabled: boolean;
  timezone: string;
  time: string;
  minEvidenceSources: number;
  limit: number;
} {
  const dreaming = config.userContext.dreaming;
  return {
    enabled: config.userContext.enabled && dreaming.mode === 'review',
    timezone: dreaming.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
    time: dreaming.schedule.time,
    minEvidenceSources: dreaming.minEvidenceSources,
    limit: dreaming.limit,
  };
}

export function compileContextConsolidationCron(time: string): string {
  const [hour, minute] = time.split(':').map(Number);
  return `${minute} ${hour} * * *`;
}

export async function runContextConsolidation(input: {
  config: Config;
  triggerKind: 'schedule' | 'manual';
  now?: number;
}): Promise<{ run: ContextConsolidationRun; metrics: ConsolidationMetrics }> {
  const resolved = resolveContextConsolidationConfig(input.config);
  if (input.triggerKind === 'schedule' && !resolved.enabled) throw new Error('User context consolidation is off');
  const now = input.now ?? Date.now();
  const run = startContextConsolidationRun(input.triggerKind, now);
  const metrics: ConsolidationMetrics = { scanned: 0, needsReview: 0, stale: 0 };
  try {
    const understandings = listUnderstandings(['candidate', 'active']).slice(0, resolved.limit);
    for (const understanding of understandings) {
      metrics.scanned += 1;
      const evidenceCount = distinctEvidenceCount(understanding.id, 'supports');
      const contradictionCount = distinctEvidenceCount(understanding.id, 'contradicts');
      const expired = (understanding.validTo != null && understanding.validTo <= now)
        || (understanding.expiresAt != null && understanding.expiresAt <= now);
      if (expired) {
        setUnderstandingStatus(understanding.id, 'stale');
        recordContextConsolidationDecision({
          runId: run.runId, understandingId: understanding.id, action: 'stale',
          reasonCode: 'validity_expired', evidenceCount, now,
        });
        metrics.stale += 1;
        continue;
      }
      if (contradictionCount > 0) {
        setUnderstandingStatus(understanding.id, 'needs_review');
        recordContextConsolidationDecision({
          runId: run.runId, understandingId: understanding.id, action: 'needs_review',
          reasonCode: 'contradictory_evidence', evidenceCount: contradictionCount, now,
        });
        metrics.needsReview += 1;
        continue;
      }
      if (understanding.status === 'active' && understanding.reviewAt != null && understanding.reviewAt <= now) {
        setUnderstandingStatus(understanding.id, 'needs_review');
        recordContextConsolidationDecision({
          runId: run.runId, understandingId: understanding.id, action: 'needs_review',
          reasonCode: 'review_due', evidenceCount, now,
        });
        metrics.needsReview += 1;
        continue;
      }
      if (understanding.status === 'candidate' && evidenceCount >= resolved.minEvidenceSources) {
        setUnderstandingStatus(understanding.id, 'needs_review');
        recordContextConsolidationDecision({
          runId: run.runId, understandingId: understanding.id, action: 'needs_review',
          reasonCode: 'independent_evidence_threshold', evidenceCount, now,
        });
        metrics.needsReview += 1;
      }
    }
    const completed = finishContextConsolidationRun({
      runId: run.runId, ok: true, reason: 'completed', metrics, now,
    });
    return { run: completed ?? run, metrics };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    finishContextConsolidationRun({ runId: run.runId, ok: false, reason, metrics, now });
    throw error;
  }
}
