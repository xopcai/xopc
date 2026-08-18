import { describe, expect, it } from 'vitest';

import type { Outcome } from '@xopcai/gateway-contract';
import type { OutcomeExecutionState } from '../outcome-execution-state.js';
import { decisionFromOutcome } from '../home-query-service.js';

function outcome(patch: Partial<Outcome> = {}): Outcome {
  return {
    id: 'outcome/1',
    objective: 'Review the blocked outcome',
    userStatus: 'needs_user',
    internalStatus: 'blocked',
    importance: 'normal',
    latestContractVersion: 1,
    createdAt: 1,
    updatedAt: 2,
    ...patch,
  };
}

const execution: OutcomeExecutionState = {
  outcomeId: 'outcome/1', agentId: 'main', priority: 'normal', source: 'api',
  createdAt: 1, updatedAt: 2, blockedReason: 'Needs approval',
};

describe('decisionFromOutcome', () => {
  it('links outcome decisions to the user-facing outcome route', () => {
    expect(decisionFromOutcome(outcome(), execution)?.href).toBe('/work/outcome%2F1');
  });

  it('omits outcomes that do not need user input', () => {
    expect(decisionFromOutcome(outcome({ userStatus: 'running', internalStatus: 'running' }), execution)).toBeNull();
  });
});
