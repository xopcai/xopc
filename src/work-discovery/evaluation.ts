export interface WorkUnderstandingEvaluationCase {
  expectedThreadKeys: string[];
  inferredThreadKeys: string[];
  evidenceBackedThreadKeys: string[];
}

export function evaluateWorkUnderstandingCase(input: WorkUnderstandingEvaluationCase) {
  const expected = new Set(input.expectedThreadKeys);
  const inferred = new Set(input.inferredThreadKeys);
  const evidenceBacked = new Set(input.evidenceBackedThreadKeys);
  const truePositives = [...inferred].filter((key) => expected.has(key)).length;
  const precision = inferred.size ? truePositives / inferred.size : expected.size ? 0 : 1;
  const recall = expected.size ? truePositives / expected.size : 1;
  const evidenceCoverage = inferred.size
    ? [...inferred].filter((key) => evidenceBacked.has(key)).length / inferred.size
    : 1;
  return {
    precision,
    recall,
    evidenceCoverage,
    f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
  };
}

export interface QuickUnderstandingEvaluationCase extends WorkUnderstandingEvaluationCase {
  expectedSourceIds: string[];
  observedSourceIds: string[];
  startedAtMs: number;
  firstCandidateAtMs?: number;
  timeBudgetMs: number;
}

export type QuickUnderstandingGate = {
  minPrecision: number;
  minRecall: number;
  minEvidenceCoverage: number;
  minSourceCoverage: number;
};

export function evaluateQuickUnderstandingCase(input: QuickUnderstandingEvaluationCase) {
  const topic = evaluateWorkUnderstandingCase(input);
  const expectedSources = new Set(input.expectedSourceIds);
  const observedSources = new Set(input.observedSourceIds);
  const coveredSources = [...expectedSources].filter((sourceId) => observedSources.has(sourceId)).length;
  const sourceCoverage = expectedSources.size ? coveredSources / expectedSources.size : 1;
  const timeToFirstCandidateMs = input.firstCandidateAtMs === undefined
    ? null
    : Math.max(0, input.firstCandidateAtMs - input.startedAtMs);
  return {
    ...topic,
    sourceCoverage,
    timeToFirstCandidateMs,
    withinTimeBudget: timeToFirstCandidateMs !== null && timeToFirstCandidateMs <= input.timeBudgetMs,
  };
}

export function meetsQuickUnderstandingGate(
  metrics: ReturnType<typeof evaluateQuickUnderstandingCase>,
  gate: QuickUnderstandingGate,
): boolean {
  return metrics.precision >= gate.minPrecision
    && metrics.recall >= gate.minRecall
    && metrics.evidenceCoverage >= gate.minEvidenceCoverage
    && metrics.sourceCoverage >= gate.minSourceCoverage
    && metrics.withinTimeBudget;
}
