import { describe, expect, it } from 'vitest';

import type { ProjectOutcome } from '../project-loop.js';
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
  outcomeCount: 2,
  activeOutcomeCount: 2,
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

function outcome(patch: Partial<ProjectOutcome>): ProjectOutcome {
  return {
    id: 'outcome-1',
    objective: 'Ship Project Loop',
    status: 'running',
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
      outcomes: [
        outcome({ id: 'fresh', objective: 'Fresh outcome', nextAction: 'Keep shipping.', updatedAt: now }),
        outcome({
          id: 'stale',
          objective: 'Stale outcome',
          nextAction: 'Needs review.',
          updatedAt: now - 3 * 24 * 60 * 60 * 1000,
        }),
        outcome({
          id: 'blocked',
          objective: 'Blocked outcome',
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

    expect(overview.nextActions[0]?.outcomeId).toBe('fresh');
    expect(overview.staleOutcomes.map((item) => item.id)).toContain('stale');
    expect(overview.failedWorkflowRuns[0]?.runId).toBe('run-1');
    expect(overview.attentionItems.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['blocked_outcome', 'stale_outcome', 'failed_workflow']),
    );
    expect(overview.attentionItems.find((item) => item.kind === 'blocked_outcome')?.href).toBe('/work/blocked');
    expect(overview.timeline.find((item) => item.kind === 'outcome')?.href).toBe('/work/fresh');
    expect(overview.digest.status).toBe('attention');
    expect(overview.timeline.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['session', 'outcome', 'workflow']),
    );
  });
});
