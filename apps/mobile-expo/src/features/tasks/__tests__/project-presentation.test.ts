import type { ProjectTaskCard } from '@xopcai/gateway-contract';
import { describe, expect, it } from 'vitest';

import type { Project } from '../../../query/projects';
import type { TaskListItem } from '../../../query/tasks';
import {
  formatProjectRelativeTime,
  groupProjectTasks,
  projectPortfolioTotals,
  selectWorkOverviewProjects,
  selectWorkOverviewTasks,
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

function task(
  id: string,
  phase: ProjectTaskCard['phase'],
  operationalState: ProjectTaskCard['operationalState'] = 'idle',
  attention: ProjectTaskCard['attention'] = [],
): ProjectTaskCard {
  return {
    id,
    title: id,
    phase,
    ...(phase === 'closed' ? { resolution: 'done' as const } : {}),
    operationalState,
    priority: 'normal',
    acceptanceCriteriaCount: 0,
    attention,
    blockedBy: [],
    allowedCommands: [],
    updatedAt: 1,
  };
}

function taskListItem(
  id: string,
  phase: TaskListItem['task']['phase'],
  operationalState: TaskListItem['operationalState'],
): TaskListItem {
  return {
    task: {
      id,
      title: id,
      phase,
      ...(phase === 'closed' ? { resolution: 'done' as const } : {}),
      priority: 'normal',
      source: 'api',
      latestContractVersion: 1,
      boardRank: 0,
      version: 1,
      createdAt: 1,
      updatedAt: 1,
    },
    operationalState,
    attention: [],
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
      task('moving', 'active', 'running'),
      task('user', 'active', 'waiting', [{ kind: 'input_required', summary: 'Choose' }]),
      task('done', 'closed'),
    ]);
    expect(result.needsUser.map((item) => item.id)).toEqual(['user']);
    expect(result.moving.map((item) => item.id)).toEqual(['moving']);
    expect(result.other.map((item) => item.id)).toEqual(['ready', 'done']);
  });

  it('keeps non-running work visible in the overview', () => {
    const projects = [
      { ...project('idle-project', 'idle', 0, 0, 3), status: 'active' },
      { ...project('archived-project', 'healthy', 0, 1, 4), status: 'archived' },
      { ...project('completed-project', 'healthy', 0, 1, 5), status: 'completed' },
    ];
    const tasks = [
      taskListItem('waiting', 'active', 'waiting'),
      taskListItem('planned', 'backlog', 'idle'),
      taskListItem('done', 'closed', 'idle'),
    ];

    expect(selectWorkOverviewProjects(projects).map((item) => item.id)).toEqual(['idle-project']);
    expect(selectWorkOverviewTasks(tasks).map((item) => item.task.id)).toEqual(['waiting', 'planned']);
  });

  it('falls back without throwing when the runtime rejects the locale', () => {
    const now = Date.UTC(2026, 7, 25, 12);
    expect(formatProjectRelativeTime(now - 5 * 60_000, 'not_a_locale', now)).toBe('5m');
  });

  it('does not pass invalid timestamps into Intl during render', () => {
    expect(formatProjectRelativeTime(Number.NaN, 'zh-CN')).toBe('');
  });
});
