export type RetrievalEvaluationCase = {
  id: string;
  expectedIds: string[];
  shouldAbstain?: boolean;
  retrieve: () => string[];
};

export type RetrievalEvaluationMetrics = {
  cases: number;
  recallAtK: number;
  precisionAtK: number;
  abstentionAccuracy: number;
};

export function evaluateRetrievalCases(
  cases: RetrievalEvaluationCase[],
  k = 3,
): RetrievalEvaluationMetrics {
  let expected = 0;
  let recalled = 0;
  let returned = 0;
  let relevantReturned = 0;
  let abstentionCases = 0;
  let correctAbstentions = 0;
  for (const item of cases) {
    const results = [...new Set(item.retrieve())].slice(0, Math.max(1, k));
    const expectedIds = new Set(item.expectedIds);
    if (item.shouldAbstain) {
      abstentionCases += 1;
      if (results.length === 0) correctAbstentions += 1;
      continue;
    }
    expected += expectedIds.size;
    returned += results.length;
    const matches = results.filter((id) => expectedIds.has(id)).length;
    recalled += matches;
    relevantReturned += matches;
  }
  return {
    cases: cases.length,
    recallAtK: expected ? recalled / expected : 1,
    precisionAtK: returned ? relevantReturned / returned : 1,
    abstentionAccuracy: abstentionCases ? correctAbstentions / abstentionCases : 1,
  };
}
