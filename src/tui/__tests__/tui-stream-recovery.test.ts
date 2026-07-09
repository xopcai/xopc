import { describe, expect, it } from 'vitest';

import {
  isActiveRunStreamStale,
  markActiveRunStalled,
  markRunRecovering,
  markRunRecoveryComplete,
} from '../tui-run-state.js';
import { createInitialState } from '../tui-types.js';

describe('tui stream recovery helpers', () => {
  it('marks an active stale run as stalled without clearing the active run id', () => {
    const state = createInitialState('agent:main:main');
    state.activeRunId = 'run-1';
    state.activityStatus = 'streaming';
    state.runStatus = {
      ...state.runStatus,
      phase: 'streaming',
      runId: 'run-1',
      startedAt: 1_000,
      lastActivityAt: 1_000,
    };

    expect(isActiveRunStreamStale(state, 32_000, 30_000)).toBe(true);
    expect(markActiveRunStalled(state, 32_000)).toBe(true);

    expect(state.activeRunId).toBe('run-1');
    expect(state.runStatus.phase).toBe('stalled');
    expect(state.runStatus.startedAt).toBe(1_000);
    expect(state.runStatus.stalledAt).toBe(32_000);
  });

  it('does not repeatedly mark an already recovering run stale', () => {
    const state = createInitialState('agent:main:main');
    state.activeRunId = 'run-1';
    state.activityStatus = 'recovering';
    markRunRecovering(state, 10_000);

    expect(isActiveRunStreamStale(state, 50_000, 30_000)).toBe(false);
    markRunRecoveryComplete(state, 51_000);

    expect(state.activeRunId).toBe('run-1');
    expect(state.runStatus.phase).toBe('stalled');
    expect(state.runStatus.recoveredAt).toBe(51_000);
  });
});
