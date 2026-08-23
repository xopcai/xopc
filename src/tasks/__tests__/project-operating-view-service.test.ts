import type { ProjectTaskCard } from '@xopcai/gateway-contract';
import { describe, expect, it } from 'vitest';

import { projectTaskLane } from '../project-operating-view-service.js';

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
