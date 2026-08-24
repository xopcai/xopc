import type { ProjectTaskCard } from '@xopcai/gateway-contract';
import { describe, expect, it } from 'vitest';

import { projectTaskLane, summarizeProjectOperatingView } from '../project-operating-view-service.js';

function laneFor(
  operationalState: ProjectTaskCard['operationalState'],
  attention: ProjectTaskCard['attention'] = [],
  phase: ProjectTaskCard['phase'] = 'active',
) {
  return projectTaskLane({ phase, operationalState, attention });
}

describe('project task lane', () => {
  it('separates passive waits from work that needs the user', () => {
    expect(laneFor('blocked', [{ kind: 'dependency_blocked', summary: 'Waiting for setup' }])).toBe('waiting');
    expect(laneFor('waiting', [{ kind: 'input_required', summary: 'Choose a target' }])).toBe('needs_user');
    expect(laneFor('waiting', [{ kind: 'approval_required', summary: 'Approve deployment' }])).toBe('needs_user');
  });

  it('keeps execution and completion states authoritative', () => {
    expect(laneFor('running')).toBe('moving');
    expect(laneFor('idle', [], 'ready')).toBe('ready');
    expect(laneFor('blocked', [{ kind: 'input_required', summary: 'No longer relevant' }], 'closed')).toBe('done');
  });
});

describe('project operating summary', () => {
  it('counts task lanes without requiring clients to fetch each task', () => {
    const tasks = [laneForCard('needs_user'), laneForCard('moving'), laneForCard('done')];
    const summary = summarizeProjectOperatingView({
      project: { id: 'p', name: 'Project', status: 'active', updatedAt: 10 },
      tasks,
      dependencyEdges: [],
      blockers: [],
      running: [],
      recentResults: [],
      digest: { health: 'attention', summary: 'Needs attention', recommendedAction: 'Approve' },
      monitoring: {
        projectId: 'p',
        mode: 'observe',
        allowedActions: [],
        confidenceThreshold: 1,
        scenarios: [],
        configured: false,
      },
    });

    expect(summary.counts).toEqual({ ready: 0, moving: 1, waiting: 0, needsUser: 1, done: 1 });
    expect(summary.recommendedAction).toBe('Approve');
  });
});

function laneForCard(lane: ProjectTaskCard['lane']): ProjectTaskCard {
  return {
    id: lane,
    title: lane,
    lane,
    phase: lane === 'done' ? 'closed' : 'active',
    operationalState: lane === 'moving' ? 'running' : 'idle',
    priority: 'normal',
    acceptanceCriteriaCount: 0,
    attention: [],
    blockedBy: [],
    allowedCommands: [],
    updatedAt: 20,
  };
}
