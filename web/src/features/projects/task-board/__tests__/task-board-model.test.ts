import type { ProjectTaskCard } from '@xopcai/gateway-contract';
import { describe, expect, it } from 'vitest';

import { groupProjectTasks, taskActionForLane } from '../task-board-model';

function card(id: string, lane: ProjectTaskCard['lane']): ProjectTaskCard {
  return {
    id,
    title: id,
    lane,
    phase: lane === 'done' ? 'closed' : lane === 'ready' ? 'ready' : 'active',
    ...(lane === 'done' ? { resolution: 'done' as const } : {}),
    operationalState: lane === 'moving' ? 'running' : lane === 'needs_user' ? 'waiting' : 'idle',
    priority: 'normal',
    blockedBy: [],
    acceptanceCriteriaCount: 0,
    attention: [],
    allowedCommands: [],
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
    const pending: ProjectTaskCard = { ...card('pending', 'ready'), allowedCommands: ['start', 'close'] };
    const running: ProjectTaskCard = { ...card('running', 'moving'), allowedCommands: ['add_wait', 'request_review', 'close'] };
    expect(taskActionForLane(pending, 'moving')).toBe('run');
    expect(taskActionForLane(running, 'ready')).toBe('pause');
    expect(taskActionForLane(running, 'done')).toBe('verify');
    expect(taskActionForLane(running, 'needs_user')).toBeUndefined();
  });
});
