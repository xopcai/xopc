import { describe, expect, it } from 'vitest';

import type { GoalWithDetails } from '../../goals/index.js';
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
  goalCount: 2,
  activeGoalCount: 2,
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

function goal(patch: Partial<GoalWithDetails>): GoalWithDetails {
  return {
    id: 'goal-1',
    outcomeId: 'outcome-1',
    outcomeContractVersion: 1,
    title: 'Ship Project Loop',
    status: 'active',
    agentId: 'main',
    priority: 'normal',
    createdAt: now,
    updatedAt: now,
    maxTurns: 10,
    turnsUsed: 0,
    source: 'api',
    checklist: [],
    ...patch,
  };
}

describe('buildProjectLoopOverview', () => {
  it('summarizes next actions, stale goals, failed workflows, and timeline', () => {
    const overview = buildProjectLoopOverview({
      project,
      nowMs: now,
      staleAfterMs: 24 * 60 * 60 * 1000,
      goals: [
        goal({ id: 'fresh', title: 'Fresh goal', nextAction: 'Keep shipping.', updatedAt: now }),
        goal({
          id: 'stale',
          title: 'Stale goal',
          nextAction: 'Needs review.',
          updatedAt: now - 3 * 24 * 60 * 60 * 1000,
        }),
        goal({
          id: 'blocked',
          title: 'Blocked goal',
          status: 'blocked',
          blockedReason: 'Waiting for credentials.',
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

    expect(overview.nextActions[0]?.goalId).toBe('fresh');
    expect(overview.staleGoals.map((item) => item.id)).toContain('stale');
    expect(overview.failedWorkflowRuns[0]?.runId).toBe('run-1');
    expect(overview.attentionItems.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['blocked_goal', 'stale_goal', 'failed_workflow']),
    );
    expect(overview.attentionItems.find((item) => item.kind === 'blocked_goal')?.href).toBe('/work/outcome-1');
    expect(overview.timeline.find((item) => item.kind === 'goal')?.href).toBe('/work/outcome-1');
    expect(overview.digest.status).toBe('attention');
    expect(overview.timeline.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['session', 'goal', 'workflow']),
    );
  });
});
