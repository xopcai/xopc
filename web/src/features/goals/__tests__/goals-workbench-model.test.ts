import { describe, expect, it } from 'vitest';

import {
  actionableCounts,
  latestQueueForGoals,
  type GoalItem,
  type GoalQueueItem,
  workbenchSectionForGoal,
} from '../goals-workbench-model';

function goal(overrides: Partial<GoalItem> = {}): GoalItem {
  return {
    id: 'goal-1',
    title: 'Ship the goal workbench',
    status: 'active',
    agentId: 'main',
    priority: 'normal',
    createdAt: 1,
    updatedAt: 2,
    turnsUsed: 0,
    maxTurns: 10,
    checklist: [],
    ...overrides,
  };
}

function queue(overrides: Partial<GoalQueueItem> = {}): GoalQueueItem {
  return {
    id: 'queue-1',
    goalId: 'goal-1',
    status: 'queued',
    source: 'api',
    enqueuedAt: 10,
    attempts: 0,
    maxRetries: 2,
    ...overrides,
  };
}

describe('latestQueueForGoals', () => {
  it('uses the latest execution instead of preserving an older higher-severity result', () => {
    const latest = latestQueueForGoals([
      queue({ id: 'old-failure', status: 'failed', finishedAt: 20 }),
      queue({ id: 'new-success', status: 'succeeded', finishedAt: 30 }),
    ]);

    expect(latest.get('goal-1')?.id).toBe('new-success');
  });
});

describe('workbenchSectionForGoal', () => {
  it('prioritizes a user blocker over a live execution', () => {
    expect(workbenchSectionForGoal(goal({ status: 'needs_input' }), queue({ status: 'running' }))).toBe('attention');
  });

  it('keeps historical goals out of the workbench', () => {
    expect(workbenchSectionForGoal(goal({ status: 'done' }), queue({ status: 'succeeded' }))).toBeNull();
    expect(workbenchSectionForGoal(goal({ status: 'archived' }))).toBeNull();
  });
});

describe('actionableCounts', () => {
  it('counts each goal once even when a failed execution also needs attention', () => {
    const goals = [goal({ status: 'blocked' })];
    const queueByGoal = latestQueueForGoals([queue({ status: 'failed' })]);

    expect(actionableCounts(goals, queueByGoal)).toEqual({
      attention: 1,
      running: 0,
      ready: 0,
      later: 0,
      history: 0,
    });
  });
});
