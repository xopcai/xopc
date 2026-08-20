export type MemoryReadinessReason =
  | 'insufficient_feedback'
  | 'low_helpful_rate'
  | 'high_record_error_rate'
  | 'sensitive_feedback_detected'
  | 'insufficient_dreaming_runs'
  | 'high_dreaming_failure_rate';

export interface MemoryReadinessMetrics {
  evaluatedTurns: number;
  helpfulTurns: number;
  recordFeedback: number;
  recordErrors: number;
  sensitiveFeedback: number;
  dreamingRuns: number;
  dreamingFailures: number;
}

export interface MemoryReadinessThresholds {
  minEvaluatedTurns: number;
  minHelpfulRate: number;
  maxRecordErrorRate: number;
  minDreamingRuns: number;
  maxDreamingFailureRate: number;
}

export interface MemoryReadiness {
  ready: boolean;
  reasons: MemoryReadinessReason[];
  metrics: MemoryReadinessMetrics & {
    helpfulRate: number | null;
    recordErrorRate: number | null;
    dreamingFailureRate: number | null;
  };
  thresholds: MemoryReadinessThresholds;
  evaluatedAt: string;
}

export const MEMORY_READINESS_THRESHOLDS: MemoryReadinessThresholds = {
  minEvaluatedTurns: 20,
  minHelpfulRate: 0.75,
  maxRecordErrorRate: 0.1,
  minDreamingRuns: 10,
  maxDreamingFailureRate: 0.1,
};

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 10_000 : null;
}

export function evaluateMemoryReadiness(
  metrics: MemoryReadinessMetrics,
  options: { thresholds?: Partial<MemoryReadinessThresholds>; nowMs?: number } = {},
): MemoryReadiness {
  const thresholds = { ...MEMORY_READINESS_THRESHOLDS, ...options.thresholds };
  const helpfulRate = rate(metrics.helpfulTurns, metrics.evaluatedTurns);
  const recordErrorRate = rate(metrics.recordErrors, metrics.recordFeedback);
  const dreamingFailureRate = rate(metrics.dreamingFailures, metrics.dreamingRuns);
  const reasons: MemoryReadinessReason[] = [];

  if (metrics.evaluatedTurns < thresholds.minEvaluatedTurns) reasons.push('insufficient_feedback');
  else if (helpfulRate === null || helpfulRate < thresholds.minHelpfulRate) reasons.push('low_helpful_rate');
  if (recordErrorRate !== null && recordErrorRate > thresholds.maxRecordErrorRate) reasons.push('high_record_error_rate');
  if (metrics.sensitiveFeedback > 0) reasons.push('sensitive_feedback_detected');
  if (metrics.dreamingRuns < thresholds.minDreamingRuns) reasons.push('insufficient_dreaming_runs');
  else if (dreamingFailureRate === null || dreamingFailureRate > thresholds.maxDreamingFailureRate) {
    reasons.push('high_dreaming_failure_rate');
  }

  return {
    ready: reasons.length === 0,
    reasons,
    metrics: { ...metrics, helpfulRate, recordErrorRate, dreamingFailureRate },
    thresholds,
    evaluatedAt: new Date(options.nowMs ?? Date.now()).toISOString(),
  };
}
