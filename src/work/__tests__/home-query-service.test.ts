import { describe, expect, it } from 'vitest';

import type { GoalWithDetails } from '../../goals/index.js';
import { decisionFromGoal } from '../home-query-service.js';

function goal(patch: Partial<GoalWithDetails> = {}): GoalWithDetails {
  return {
    id: 'goal/1',
    outcomeId: 'outcome/1',
    outcomeContractVersion: 1,
    title: 'Review the blocked outcome',
    status: 'blocked',
    agentId: 'main',
    priority: 'normal',
    createdAt: 1,
    updatedAt: 2,
    maxTurns: 10,
    turnsUsed: 1,
    source: 'api',
    checklist: [],
    ...patch,
  };
}

describe('decisionFromGoal', () => {
  it('links goal decisions to the user-facing outcome route', () => {
    expect(decisionFromGoal(goal())?.href).toBe('/work/outcome%2F1');
  });

  it('omits goals that do not need user input', () => {
    expect(decisionFromGoal(goal({ status: 'active' }))).toBeNull();
  });
});
