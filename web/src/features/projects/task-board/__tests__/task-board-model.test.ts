import type { ProjectTaskCard } from '@xopcai/gateway-contract';
import { describe, expect, it } from 'vitest';

import { groupProjectTasks, taskActionForPhase } from '../task-board-model';

function card(id: string, phase: ProjectTaskCard['phase']): ProjectTaskCard {
  return {
    id,
    title: id,
    phase,
    ...(phase === 'closed' ? { resolution: 'done' as const } : {}),
    operationalState: phase === 'active' ? 'running' : 'idle',
    priority: 'normal',
    blockedBy: [],
    acceptanceCriteriaCount: 0,
    attention: [],
    allowedCommands: [],
    updatedAt: 1,
  };
}

describe('project task board model', () => {
  it('groups every task into exactly one durable phase', () => {
    const grouped = groupProjectTasks([
      card('zero', 'backlog'),
      card('one', 'ready'),
      card('two', 'active'),
      card('three', 'review'),
      card('four', 'closed'),
    ]);
    expect(Object.values(grouped).flat().map((item) => item.id)).toEqual(['zero', 'one', 'two', 'three', 'four']);
  });

  it('turns phase changes into matching domain commands', () => {
    const backlog: ProjectTaskCard = { ...card('backlog', 'backlog'), allowedCommands: ['mark_ready', 'close'] };
    const ready: ProjectTaskCard = { ...card('ready', 'ready'), allowedCommands: ['start', 'close'] };
    const active: ProjectTaskCard = { ...card('active', 'active'), allowedCommands: ['add_wait', 'request_review', 'close'] };
    const review: ProjectTaskCard = { ...card('review', 'review'), allowedCommands: ['close'] };
    expect(taskActionForPhase(backlog, 'ready')).toBe('ready');
    expect(taskActionForPhase(ready, 'active')).toBe('run');
    expect(taskActionForPhase(active, 'review')).toBe('review');
    expect(taskActionForPhase(review, 'closed')).toBe('complete');
    expect(taskActionForPhase(active, 'closed')).toBeUndefined();
  });
});
