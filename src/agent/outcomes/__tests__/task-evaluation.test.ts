import { describe, expect, it } from 'vitest';

import type { TaskOutcome } from '../../../storage/sqlite/task-outcome-repository.js';
import { replayTaskEvaluation } from '../task-evaluation.js';

function outcome(patch: Partial<TaskOutcome>): TaskOutcome {
  return {
    runId: 'run',
    sessionKey: 'agent:main:webchat:dm:1',
    channel: 'webchat',
    objective: 'ship',
    status: 'succeeded',
    evidence: [],
    verification: { status: 'passed', checks: [] },
    startedAt: 1,
    updatedAt: 2,
    ...patch,
  };
}

describe('task evaluation replay', () => {
  it('detects false completion, drift, and cross-channel gap', () => {
    const result = replayTaskEvaluation([
      outcome({
        runId: 'web',
        channel: 'webchat',
        contract: {
          objective: 'ship',
          deliverables: [],
          acceptanceCriteria: ['tests pass'],
          constraints: [],
          approvalRequired: [],
        },
        evidence: [{
          kind: 'test',
          title: 'tests',
          summary: 'passed',
          verifies: ['tests pass'],
        }],
      }),
      outcome({
        runId: 'telegram',
        channel: 'telegram',
        contract: {
          objective: 'ship',
          deliverables: [],
          acceptanceCriteria: ['tests pass'],
          constraints: [],
          approvalRequired: [],
        },
      }),
    ]);
    expect(result.falseCompletions).toBe(1);
    expect(result.verificationDrift).toBe(1);
    expect(result.channelConsistencyGap).toBe(1);
  });
});
