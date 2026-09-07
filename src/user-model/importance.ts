import type { AssertionConsequence } from './domain.js';

const CONSEQUENCE_SCORE: Record<AssertionConsequence, number> = {
  low: 0.15,
  medium: 0.45,
  high: 0.75,
  critical: 1,
};

export interface ExecutionValueInput {
  declaredImportance?: number;
  inferredImportance: number;
  consequence: AssertionConsequence;
  actionability: number;
  taskRelevance: number;
  urgency: number;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Ranks eligible context. Confidence is deliberately absent: it is an admission signal. */
export function calculateExecutionValue(input: ExecutionValueInput): number {
  const importance = input.declaredImportance ?? input.inferredImportance;
  return clamp(
    0.28 * clamp(input.taskRelevance)
    + 0.22 * clamp(importance)
    + 0.2 * CONSEQUENCE_SCORE[input.consequence]
    + 0.18 * clamp(input.actionability)
    + 0.12 * clamp(input.urgency),
  );
}
