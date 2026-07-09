import { describe, expect, it } from 'vitest';

import { formatActiveRunStatus, formatRunDuration } from '../tui-run-status-format.js';
import { createInitialState } from '../tui-types.js';

describe('formatRunDuration', () => {
  it('formats seconds and minutes', () => {
    expect(formatRunDuration(12_900)).toBe('12s');
    expect(formatRunDuration(216_000)).toBe('3m 36s');
  });
});

describe('formatActiveRunStatus', () => {
  it('renders a working run with elapsed time and interrupt hint', () => {
    const state = createInitialState('agent:main:main');
    state.activeRunId = 'run-1';
    state.activityStatus = 'streaming';
    state.runStatus = {
      ...state.runStatus,
      phase: 'streaming',
      runId: 'run-1',
      startedAt: 1_000,
      lastActivityAt: 200_000,
    };

    expect(formatActiveRunStatus(state, 217_000)).toBe(
      'Working (3m 36s • esc to interrupt)',
    );
  });

  it('renders reconnecting output with last update age', () => {
    const state = createInitialState('agent:main:main');
    state.activeRunId = 'run-1';
    state.activityStatus = 'recovering';
    state.runStatus = {
      ...state.runStatus,
      phase: 'recovering',
      runId: 'run-1',
      startedAt: 1_000,
      lastActivityAt: 31_000,
    };

    expect(formatActiveRunStatus(state, 91_000)).toBe(
      'Reconnecting output (1m 30s • last update 1m 0s ago • esc to interrupt)',
    );
  });
});
