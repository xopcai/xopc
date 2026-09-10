import type { ProjectTaskCard } from '@xopcai/gateway-contract';
import { describe, expect, it } from 'vitest';

import { selectOverviewTasks } from '@/features/projects/project-overview-model';

function task(overrides: Partial<ProjectTaskCard> & Pick<ProjectTaskCard, 'id'>): ProjectTaskCard {
  const { id, ...rest } = overrides;
  return {
    id,
    title: id,
    phase: 'backlog',
    operationalState: 'idle',
    priority: 'normal',
    acceptanceCriteriaCount: 0,
    attention: [],
    blockedBy: [],
    allowedCommands: [],
    updatedAt: 1,
    ...rest,
  };
}

describe('selectOverviewTasks', () => {
  it('prioritizes attention and moving work, excludes closed tasks, and limits the result', () => {
    const selected = selectOverviewTasks([
      task({ id: 'backlog-new', updatedAt: 20 }),
      task({ id: 'closed', phase: 'closed', updatedAt: 100 }),
      task({ id: 'running', phase: 'active', operationalState: 'running' }),
      task({ id: 'blocked', operationalState: 'blocked', attention: [{ kind: 'input_required', summary: 'Need input' }] }),
      task({ id: 'ready-high', phase: 'ready', priority: 'high' }),
      task({ id: 'backlog-old', updatedAt: 2 }),
    ], 4);

    expect(selected.map((item) => item.id)).toEqual(['blocked', 'running', 'ready-high', 'backlog-new']);
  });
});
