import type { ProjectTaskCard } from '@xopcai/gateway-contract';
import { describe, expect, it } from 'vitest';

import type { Project } from '../../../query/projects';
import {
  groupProjectTasks,
  projectPortfolioTotals,
  sortProjectPortfolio,
} from '../project-presentation';

function project(id: string, health: Project['operating']['health'], needsUser: number, moving: number, updatedAt: number): Project {
  return {
    id,
    name: id,
    operating: {
      health,
      summary: '',
      counts: { ready: 0, moving, waiting: 0, needsUser, done: 0 },
      updatedAt,
    },
  };
}

function task(id: string, lane: ProjectTaskCard['lane']): ProjectTaskCard {
  return {
    id,
    title: id,
    lane,
    phase: lane === 'done' ? 'closed' : 'active',
    operationalState: lane === 'moving' ? 'running' : 'idle',
    priority: 'normal',
    acceptanceCriteriaCount: 0,
    attention: [],
    blockedBy: [],
    allowedCommands: [],
    updatedAt: 1,
  };
}

describe('project mobile presentation', () => {
  it('orders attention before active and idle projects', () => {
    const result = sortProjectPortfolio([
      project('idle', 'idle', 0, 0, 3),
      project('active', 'healthy', 0, 2, 2),
      project('attention', 'attention', 1, 0, 1),
    ]);
    expect(result.map((item) => item.id)).toEqual(['attention', 'active', 'idle']);
    expect(projectPortfolioTotals(result)).toEqual({ needsUser: 1, moving: 2 });
  });

  it('separates user work and moving work from the remaining task list', () => {
    const result = groupProjectTasks([
      task('ready', 'ready'),
      task('moving', 'moving'),
      task('user', 'needs_user'),
      task('done', 'done'),
    ]);
    expect(result.needsUser.map((item) => item.id)).toEqual(['user']);
    expect(result.moving.map((item) => item.id)).toEqual(['moving']);
    expect(result.other.map((item) => item.id)).toEqual(['ready', 'done']);
  });
});
