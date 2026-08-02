import type { WorkDiscoveryCandidate, WorkDiscoveryRun } from './api';

const TERMINAL_STATUSES = new Set<WorkDiscoveryRun['status']>(['completed', 'failed', 'canceled']);

export interface WorkDiscoveryBatchDependencies {
  grantDirectory: (rootPath: string) => Promise<unknown>;
  startRun: (rootPath: string) => Promise<WorkDiscoveryRun>;
  fetchRun: (runId: string) => Promise<WorkDiscoveryRun>;
  onRun: (run: WorkDiscoveryRun, index: number, total: number) => void;
  onError?: (error: unknown, candidate: WorkDiscoveryCandidate, index: number) => void;
  shouldStop?: () => boolean;
  wait?: () => Promise<void>;
}

function defaultWait(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 1_200));
}

/** Runs each selected folder independently so project content never crosses run boundaries. */
export async function runWorkDiscoveryBatch(
  candidates: WorkDiscoveryCandidate[],
  dependencies: WorkDiscoveryBatchDependencies,
): Promise<WorkDiscoveryRun[]> {
  const results: WorkDiscoveryRun[] = [];
  const wait = dependencies.wait ?? defaultWait;

  for (let index = 0; index < candidates.length; index += 1) {
    if (dependencies.shouldStop?.()) break;
    const candidate = candidates[index];
    if (!candidate) continue;

    try {
      await dependencies.grantDirectory(candidate.rootPath);
      let run = await dependencies.startRun(candidate.rootPath);
      dependencies.onRun(run, index, candidates.length);

      while (!TERMINAL_STATUSES.has(run.status) && !dependencies.shouldStop?.()) {
        await wait();
        run = await dependencies.fetchRun(run.id);
        dependencies.onRun(run, index, candidates.length);
      }

      results.push(run);
      if (run.status === 'canceled' || dependencies.shouldStop?.()) break;
    } catch (error) {
      dependencies.onError?.(error, candidate, index);
      if (dependencies.shouldStop?.()) break;
    }
  }

  return results;
}
