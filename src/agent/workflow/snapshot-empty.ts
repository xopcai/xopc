import type { WorkflowSnapshot } from './types.js';

export function emptySnapshotFor(
  name: string,
  description?: string,
  phaseTitles?: string[],
): WorkflowSnapshot {
  return {
    name,
    description,
    phases: phaseTitles ? [...phaseTitles] : [],
    logs: [],
    agents: [],
    agentCount: 0,
    runningCount: 0,
    doneCount: 0,
    errorCount: 0,
    skippedCount: 0,
  };
}
