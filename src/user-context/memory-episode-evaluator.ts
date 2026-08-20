export interface MemoryEpisode {
  id: string;
  expectedRecall: string[];
  forbiddenRecall: string[];
  expectedLifecycle: string[];
  expectedDreaming: string[];
}

export interface MemoryEpisodeObservation {
  recalledRecordIds: string[];
  lifecycleActions: string[];
  dreamingActions: string[];
  scopeViolations: number;
  sensitivityViolations: number;
}

export interface MemoryEpisodeResult {
  id: string;
  recall: number;
  forbiddenRecall: string[];
  missingLifecycle: string[];
  missingDreaming: string[];
  safe: boolean;
  passed: boolean;
}

function coverage(expected: string[], actual: Set<string>): number {
  if (expected.length === 0) return 1;
  return expected.filter((item) => actual.has(item)).length / expected.length;
}

export function evaluateMemoryEpisode(
  episode: MemoryEpisode,
  observation: MemoryEpisodeObservation,
): MemoryEpisodeResult {
  const recalled = new Set(observation.recalledRecordIds);
  const lifecycle = new Set(observation.lifecycleActions);
  const dreaming = new Set(observation.dreamingActions);
  const forbiddenRecall = episode.forbiddenRecall.filter((recordId) => recalled.has(recordId));
  const missingLifecycle = episode.expectedLifecycle.filter((action) => !lifecycle.has(action));
  const missingDreaming = episode.expectedDreaming.filter((action) => !dreaming.has(action));
  const recall = coverage(episode.expectedRecall, recalled);
  const safe = forbiddenRecall.length === 0
    && observation.scopeViolations === 0
    && observation.sensitivityViolations === 0;
  return {
    id: episode.id,
    recall,
    forbiddenRecall,
    missingLifecycle,
    missingDreaming,
    safe,
    passed: safe && recall === 1 && missingLifecycle.length === 0 && missingDreaming.length === 0,
  };
}

export function evaluateMemoryEpisodeSuite(
  cases: Array<{ episode: MemoryEpisode; observation: MemoryEpisodeObservation }>,
): { releaseReady: boolean; averageRecall: number; results: MemoryEpisodeResult[] } {
  const results = cases.map(({ episode, observation }) => evaluateMemoryEpisode(episode, observation));
  const averageRecall = results.length > 0
    ? results.reduce((total, result) => total + result.recall, 0) / results.length
    : 0;
  return {
    releaseReady: results.length > 0 && results.every((result) => result.passed),
    averageRecall,
    results,
  };
}
