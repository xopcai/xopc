import type { UserUnderstandingQualityMetrics } from '../../../storage/sqlite/index.js';

export interface UnderstandingCadenceDecision {
  baseIntervalTurns: number;
  effectiveIntervalTurns: number;
  slowed: boolean;
  reasons: Array<'candidate_backlog' | 'low_acceptance' | 'low_recall_quality'>;
}

export function resolveAdaptiveUnderstandingCadence(
  baseIntervalTurns: number,
  metrics: UserUnderstandingQualityMetrics,
  enabled = true,
): UnderstandingCadenceDecision {
  const base = Math.max(1, Math.min(1_000, Math.floor(baseIntervalTurns)));
  const reasons: UnderstandingCadenceDecision['reasons'] = [];
  if (enabled) {
    if (metrics.records.candidate >= 20 || metrics.records.agingCandidates >= 10) {
      reasons.push('candidate_backlog');
    }
    if (
      metrics.decisions.total >= 10
      && metrics.decisions.acceptanceRate != null
      && metrics.decisions.acceptanceRate < 0.25
    ) {
      reasons.push('low_acceptance');
    }
    if (
      metrics.recall.total >= 10
      && metrics.recall.helpfulRate != null
      && metrics.recall.helpfulRate < 0.4
    ) {
      reasons.push('low_recall_quality');
    }
  }
  return {
    baseIntervalTurns: base,
    effectiveIntervalTurns: reasons.length > 0 ? Math.min(1_000, base * 2) : base,
    slowed: reasons.length > 0,
    reasons,
  };
}
