import type { ProjectTaskCard } from '@xopcai/gateway-contract';
import { describe, expect, it } from 'vitest';

import { groupProjectTasks, taskActionForLane } from '../task-board-model';

function card(id: string, lane: ProjectTaskCard['lane']): ProjectTaskCard {
  return {
    id,
    title: id,
    lane,
    status: lane === 'done' ? 'completed' : 'pending',
    priority: 'normal',
    blockedBy: [],
    acceptanceCriteriaCount: 0,
    allowedActions: [],
    updatedAt: 1,
  };
}

describe('project task board model', () => {
  it('groups every task into exactly one lane', () => {
    const grouped = groupProjectTasks([
      card('one', 'ready'),
      card('two', 'moving'),
      card('three', 'needs_user'),
      card('four', 'done'),
    ]);
    expect(Object.values(grouped).flat().map((item) => item.id)).toEqual(['one', 'two', 'three', 'four']);
  });

  it('turns lane changes into domain commands instead of status writes', () => {
    const pending: ProjectTaskCard = { ...card('pending', 'ready'), allowedActions: ['run', 'cancel'] };
    const running: ProjectTaskCard = { ...card('running', 'moving'), allowedActions: ['pause', 'verify', 'cancel'] };
    expect(taskActionForLane(pending, 'moving')).toBe('run');
    expect(taskActionForLane(running, 'ready')).toBe('pause');
    expect(taskActionForLane(running, 'done')).toBe('verify');
    expect(taskActionForLane(running, 'needs_user')).toBeUndefined();
  });
});
