import { describe, expect, it } from 'vitest';

import type { ExecutionReceipt } from '../../../storage/sqlite/execution-receipt-repository.js';
import { replayExecutionEvaluation } from '../execution-evaluation.js';

function outcome(patch: Partial<ExecutionReceipt>): ExecutionReceipt {
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

describe('execution evaluation replay', () => {
  it('detects false completion, drift, and cross-channel gap', () => {
    const result = replayExecutionEvaluation([
      outcome({
        runId: 'web',
        channel: 'webchat',
        contract: {
          objective: 'ship',
          deliverables: [],
          acceptanceCriteria: ['tests pass'],
          constraints: [],
          approvalRequired: [],
          assumptions: [],
          risks: [],
          assumptions: [],
          risks: [],
        },
        evidence: [{
          kind: 'test',
          title: 'tests',
          summary: 'passed',
          verifies: ['tests pass'],
          provenance: 'tool',
          strength: 'verified',
          observedAt: Date.now(),
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
