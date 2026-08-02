import type { FocusWatchKind } from './types.js';

export interface ProactiveValueScore {
  score: number;
  reasons: string[];
  shouldDeliver: boolean;
}

export function scoreProactiveValue(input: {
  kind: FocusWatchKind;
  evidenceCount: number;
  hasNextAction: boolean;
  approvedCount: number;
  dismissedCount: number;
}): ProactiveValueScore {
  const reasons: string[] = [];
  let score = 0.15;
  if (input.evidenceCount > 0) { score += Math.min(0.25, input.evidenceCount * 0.1); reasons.push('evidence_backed'); }
  if (input.hasNextAction) { score += 0.25; reasons.push('actionable'); }
  const urgency = input.kind === 'deadline' ? 0.25 : input.kind === 'staleness' ? 0.2 : 0.15;
  score += urgency;
  reasons.push(input.kind === 'deadline' ? 'time_sensitive' : 'focus_relevant');
  const rated = input.approvedCount + input.dismissedCount;
  if (rated > 0) {
    const approvalRate = input.approvedCount / rated;
    score += (approvalRate - 0.5) * 0.4;
    reasons.push(approvalRate >= 0.5 ? 'historically_useful' : 'historically_dismissed');
  }
  score = Math.max(0, Math.min(1, score));
  return { score, reasons, shouldDeliver: score >= 0.65 };
}
