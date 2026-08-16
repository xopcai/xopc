import { describe, expect, it } from 'vitest';

import type { ExecutionReceipt } from '../../storage/sqlite/index.js';
import { toOutcomeReceipt } from '../outcome-receipt-service.js';

function outcome(patch: Partial<ExecutionReceipt> = {}): ExecutionReceipt {
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

describe('toOutcomeReceipt', () => {
  it('marks contracted work partial until its criteria are verified', () => {
    const receipt = toOutcomeReceipt(outcome({
      contract: {
        objective: 'Ship',
        deliverables: [],
        acceptanceCriteria: ['Tests pass'],
        constraints: [],
        approvalRequired: [],
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
    expect(toOutcomeReceipt(outcome({ needsUser: true })).status).toBe('needs_user');
  });
});
