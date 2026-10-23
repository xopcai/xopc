import { describe, expect, it } from 'vitest';

import type { ProjectTask } from '../project-loop.js';
import type { ProjectWithDetails } from '../types.js';
import { buildProjectLoopOverview } from '../project-loop.js';

const now = Date.parse('2026-07-06T00:00:00.000Z');

const project: ProjectWithDetails = {
  id: 'project-1',
  name: 'xopc',
  slug: 'xopc',
  status: 'active',
  createdAt: now,
  updatedAt: now,
  sessionCount: 1,
  taskCount: 2,
  activeTaskCount: 2,
  recentSessions: [
    {
      key: 'agent:main:webchat:default:direct:s1',
      name: 'Planning',
      agentId: 'main',
      updatedAt: '2026-07-05T00:00:00.000Z',
    },
  ],
};

function task(patch: Partial<ProjectTask>): ProjectTask {
  return {
    id: 'task-1',
    title: 'Ship Project Loop',
    phase: 'active',
    operationalState: 'running',
    priority: 'normal',
    updatedAt: now,
    ...patch,
  };
}

describe('buildProjectLoopOverview', () => {
  it('keeps blocked and stale tasks actionable without an extra execution catalog', () => {
    const view = buildProjectLoopOverview({ project, nowMs: now, tasks: [
      task({ id: 'blocked', operationalState: 'blocked', attention: ['Missing source access'] }),
      task({ id: 'stale', updatedAt: now - 10 * 86_400_000 }),
    ] });
    expect(view.blockedTasks.map(item => item.id)).toEqual(['blocked']);
    expect(view.staleTasks.map(item => item.id)).toEqual(['stale']);
    expect(view.attentionItems.map(item => item.kind)).toEqual(['blocked_task', 'stale_task']);
    expect(view.timeline.some(item => item.kind === 'session')).toBe(true);
    expect(view.digest.status).toBe('attention');
  });
  it('reports empty work when a project has no tasks or sessions', () => {
    const view = buildProjectLoopOverview({ project: { ...project, recentSessions: [] }, tasks: [], nowMs: now });
    expect(view.activeTasks).toEqual([]);
    expect(view.timeline).toEqual([]);
    expect(view.digest.status).toBe('empty');
  });
});
