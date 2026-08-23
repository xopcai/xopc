import type { ProjectTaskCard, ProjectTaskDependencyEdge } from '@xopcai/gateway-contract';
import { describe, expect, it } from 'vitest';

import { blockedChainTaskIds, layoutTaskGraph, relatedTaskIds } from '../task-dependency-graph-model';

function task(id: string, blockedBy: ProjectTaskCard['blockedBy'] = []): ProjectTaskCard {
  return {
    id, title: id, lane: blockedBy.length ? 'waiting' : 'ready', phase: 'ready', operationalState: blockedBy.length ? 'blocked' : 'idle',
    priority: 'normal', acceptanceCriteriaCount: 0, attention: [], blockedBy, allowedCommands: [], updatedAt: 1,
  };
}

const edges: ProjectTaskDependencyEdge[] = [
  { dependencyTaskId: 'a', dependentTaskId: 'b' },
  { dependencyTaskId: 'b', dependentTaskId: 'c' },
];

describe('task dependency graph model', () => {
  it('lays dependencies before their dependents', () => {
    const positions = layoutTaskGraph([task('a'), task('b'), task('c')], edges);
    expect(positions.get('a')!.x).toBeLessThan(positions.get('b')!.x);
    expect(positions.get('b')!.x).toBeLessThan(positions.get('c')!.x);
  });

  it('keeps the upstream chain for blocked tasks', () => {
    const blocked = task('c', [{ id: 'b', title: 'b', phase: 'ready', operationalState: 'idle' }]);
    expect([...blockedChainTaskIds([task('a'), task('b'), blocked], edges)].sort()).toEqual(['a', 'b', 'c']);
  });

  it('does not treat completed tasks with historical dependencies as blocked', () => {
    const completed = {
      ...task('c', [{ id: 'b', title: 'b', phase: 'ready', operationalState: 'idle' }]),
      lane: 'done' as const,
      phase: 'closed' as const,
      resolution: 'done' as const,
    };
    expect([...blockedChainTaskIds([task('a'), task('b'), completed], edges)]).toEqual([]);
  });

  it('finds ancestors and descendants without pulling in sibling branches', () => {
    const withSibling = [...edges, { dependencyTaskId: 'a', dependentTaskId: 'd' }];
    expect([...relatedTaskIds('b', withSibling)].sort()).toEqual(['a', 'b', 'c']);
    expect([...relatedTaskIds('isolated', edges)]).toEqual(['isolated']);
  });
});
