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
