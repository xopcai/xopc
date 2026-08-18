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
    attempt: 1,
    evidence: [],
    verification: { status: 'passed', checks: [] },
    context: {},
    needsUser: false,
    projectionVersion: 0,
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

  it('measures recovery, judgment coverage, and required user effort', () => {
    const result = replayExecutionEvaluation([
      outcome({
        runId: 'recovered',
        context: { triggerKind: 'retry' },
        completionVerdict: 'achieved',
        judgment: {
          recommendation: 'Ship the verified result',
          reasons: ['All criteria passed'],
          rejectedAlternatives: [],
          confidence: 0.9,
        },
      }),
      outcome({
        runId: 'needs-user',
        context: {},
        needsUser: true,
      }),
    ]);

    expect(result).toMatchObject({
      recoverySuccessRate: 1,
      judgmentCoverage: 0.5,
      userInterventionRate: 0.5,
    });
  });
});
