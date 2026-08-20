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
  recentWorkflowRuns: [],
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
  it('summarizes next actions, stale goals, failed workflows, and timeline', () => {
    const overview = buildProjectLoopOverview({
      project,
      nowMs: now,
      staleAfterMs: 24 * 60 * 60 * 1000,
      tasks: [
        task({ id: 'fresh', title: 'Fresh task', attention: ['Keep shipping.'], updatedAt: now }),
        task({
          id: 'stale',
          title: 'Stale task',
          attention: ['Needs review.'],
          updatedAt: now - 3 * 24 * 60 * 60 * 1000,
        }),
        task({
          id: 'blocked',
          title: 'Blocked task',
          operationalState: 'blocked',
          attention: ['Waiting for credentials.'],
          updatedAt: now - 60 * 1000,
        }),
      ],
      recentWorkflowRuns: [
        {
          runId: 'run-1',
          definitionId: 'repo-audit',
          status: 'failed',
          createdAt: now - 2 * 60 * 1000,
          errorMessage: 'test failed',
        },
      ],
    });

    expect(overview.nextActions[0]?.taskId).toBe('fresh');
    expect(overview.staleTasks.map((item) => item.id)).toContain('stale');
    expect(overview.failedWorkflowRuns[0]?.runId).toBe('run-1');
    expect(overview.attentionItems.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['blocked_task', 'stale_task', 'failed_workflow']),
    );
    expect(overview.attentionItems.find((item) => item.kind === 'blocked_task')?.href).toBe('/tasks/blocked');
    expect(overview.timeline.find((item) => item.kind === 'task')?.href).toBe('/tasks/fresh');
    expect(overview.digest.status).toBe('attention');
    expect(overview.timeline.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['session', 'task', 'workflow']),
    );
  });
});
