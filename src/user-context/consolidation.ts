import type { Config } from '../config/schema.js';
import {
  createUnderstanding,
  finishContextConsolidationRun,
  listUnderstandingEvidence,
  listUnderstandings,
  linkUnderstandingEvidence,
  recordContextConsolidationDecision,
  setUnderstandingStatus,
  startContextConsolidationRun,
  type ContextConsolidationRun,
} from '../storage/sqlite/index.js';
import type { UserUnderstanding } from './domain.js';

export const USER_CONTEXT_CONSOLIDATION_TOKEN = '__xopc_user_context_consolidation__';
export const USER_CONTEXT_CONSOLIDATION_AUTOMATION_ID = 'system-user-context-consolidation';

type ConsolidationMetrics = {
  scanned: number;
  needsReview: number;
  stale: number;
  globalCandidates: number;
};

const GLOBAL_CANDIDATE_KINDS = new Set<UserUnderstanding['kind']>(['preference', 'routine']);

function stricterSensitivity(items: UserUnderstanding[]): UserUnderstanding['sensitivity'] {
  const order: UserUnderstanding['sensitivity'][] = ['normal', 'personal', 'secret', 'regulated'];
  return order[Math.max(...items.map((item) => order.indexOf(item.sensitivity)))] ?? 'personal';
}

function stricterDisclosurePolicy(items: UserUnderstanding[]): UserUnderstanding['disclosurePolicy'] {
  if (items.some((item) => item.disclosurePolicy === 'silent')) return 'silent';
  if (items.some((item) => item.disclosurePolicy === 'ask_before_reference')) return 'ask_before_reference';
  return 'referenceable';
}

function createCrossProjectGlobalCandidates(minProjects: number): number {
  const all = listUnderstandings();
  const existingGlobalKeys = new Set(all
    .filter((item) => item.scope.type === 'global' && item.status !== 'archived' && item.status !== 'rejected')
    .map((item) => item.canonicalKey));
  const groups = new Map<string, UserUnderstanding[]>();
  for (const item of all) {
    if (item.status !== 'active' || item.scope.type !== 'project' || !item.scope.id
      || !GLOBAL_CANDIDATE_KINDS.has(item.kind)) continue;
    const normalizedStatement = item.statement.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
    const groupKey = `${item.canonicalKey}\u0000${normalizedStatement}`;
    const group = groups.get(groupKey) ?? [];
    group.push(item);
    groups.set(groupKey, group);
  }

  let created = 0;
  for (const items of groups.values()) {
    const canonicalKey = items[0]!.canonicalKey;
    const projectCount = new Set(items.map((item) => item.scope.id)).size;
    if (projectCount < Math.max(2, minProjects) || existingGlobalKeys.has(canonicalKey)) continue;
    const exemplar = [...items].sort((left, right) => right.confidence - left.confidence)[0]!;
    const global = createUnderstanding({
      kind: exemplar.kind,
      canonicalKey,
      status: 'candidate',
      scope: { type: 'global' },
      explicitness: 'inferred',
      durability: exemplar.durability,
      sensitivity: stricterSensitivity(items),
      disclosurePolicy: stricterDisclosurePolicy(items),
      confidence: items.reduce((sum, item) => sum + item.confidence, 0) / items.length,
      statement: exemplar.statement,
      createdBy: 'consolidation',
      changeReason: `Repeated across ${projectCount} projects`,
    });
    const linked = new Set<string>();
    for (const item of items) {
      for (const evidence of listUnderstandingEvidence(item.id, 'supports')) {
        if (linked.has(evidence.id)) continue;
        linkUnderstandingEvidence(global.versionId, evidence.id, 'supports', item.confidence);
        linked.add(evidence.id);
      }
    }
    existingGlobalKeys.add(canonicalKey);
    created += 1;
  }
  return created;
}

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
  const metrics: ConsolidationMetrics = { scanned: 0, needsReview: 0, stale: 0, globalCandidates: 0 };
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
    metrics.globalCandidates = createCrossProjectGlobalCandidates(resolved.minEvidenceSources);
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
