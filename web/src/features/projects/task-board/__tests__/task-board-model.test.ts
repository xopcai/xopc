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
    const backlog: ProjectTaskCard = { ...card('backlog', 'backlog'), allowedCommands: ['move', 'mark_ready', 'close'] };
    const ready: ProjectTaskCard = { ...card('ready', 'ready'), allowedCommands: ['move', 'start', 'close'] };
    const active: ProjectTaskCard = { ...card('active', 'active'), allowedCommands: ['move', 'request_review', 'close'] };
    const review: ProjectTaskCard = { ...card('review', 'review'), allowedCommands: ['close'] };
    const closed: ProjectTaskCard = { ...card('closed', 'closed'), allowedCommands: ['reopen'] };
    expect(taskActionForPhase(backlog, 'ready')).toBe('move_ready');
    expect(taskActionForPhase(ready, 'active')).toBe('move_active');
    expect(taskActionForPhase(active, 'review')).toBe('move_review');
    expect(taskActionForPhase(review, 'closed')).toBe('complete');
    expect(taskActionForPhase(closed, 'backlog')).toBe('reopen_backlog');
    expect(taskActionForPhase(closed, 'review')).toBe('reopen_review');
    expect(taskActionForPhase(active, 'closed')).toBeUndefined();
  });
});
