import { describe, expect, it } from 'vitest';

import type { ExecutionReceipt } from '../../storage/sqlite/index.js';
import { toTaskReceipt } from '../task-receipt-service.js';

function task(patch: Partial<ExecutionReceipt> = {}): ExecutionReceipt {
  return {
    runId: 'run-1',
    sessionKey: 'session-1',
    channel: 'webchat',
    objective: 'Ship a verified release',
    status: 'succeeded',
    summary: 'Release prepared',
    evidence: [],
    verification: { status: 'unverified', checks: [] },
    context: {},
    needsUser: false,
    startedAt: 100,
    completedAt: 200,
    updatedAt: 200,
    ...patch,
  };
}

describe('toTaskReceipt', () => {
  it('marks contracted work partial until its criteria are verified', () => {
    const receipt = toTaskReceipt(task({
      contract: {
        objective: 'Ship',
        expectedOutputs: [],
        acceptanceCriteria: ['Tests pass'],
        constraints: [],
        approvalRequired: [],
        assumptions: [],
        risks: [],
      },
      nextAction: 'Run the release job',
      verification: {
        status: 'unverified',
        checks: [{ criterion: 'Tests pass', status: 'unverified', evidenceTitles: [] }],
      },
      completionVerdict: 'partial',
    }));

    expect(receipt.status).toBe('partial');
    expect(receipt.remainingWork).toEqual(['Tests pass', 'Run the release job']);
  });

  it('keeps user decisions distinct from failures', () => {
    expect(toTaskReceipt(task({ needsUser: true })).status).toBe('needs_user');
  });
});
