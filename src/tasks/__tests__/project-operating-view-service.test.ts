import type { ProjectTaskCard } from '@xopcai/gateway-contract';
import { describe, expect, it } from 'vitest';

import { summarizeProjectOperatingView } from '../project-operating-view-service.js';

describe('project operating summary', () => {
  it('counts task lanes without requiring clients to fetch each task', () => {
    const tasks = [card('needs_user', 'active', 'waiting', [{ kind: 'input_required', summary: 'Approve' }]), card('moving', 'active', 'running'), card('done', 'closed', 'idle')];
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

function card(
  id: string,
  phase: ProjectTaskCard['phase'],
  operationalState: ProjectTaskCard['operationalState'],
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
    updatedAt: 20,
  };
}
