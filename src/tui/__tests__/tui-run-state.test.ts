import { describe, expect, it } from 'vitest';

import {
  markRunAborting,
  markRunEvent,
  markRunIdleAfterAbort,
  markRunIdleAfterCompletion,
  markRunSending,
  resetRunStatus,
} from '../tui-run-state.js';
import { createInitialState } from '../tui-types.js';

describe('tui run state transitions', () => {
  it('marks a new send and clears previous direct stream ownership', () => {
    const state = createInitialState('agent:main:main');
    state.runStatus.lastCompletedRunId = 'old-run';

    markRunSending(state, 1_000);

    expect(state.runStatus).toMatchObject({
      phase: 'sending',
      runId: null,
      lastCompletedRunId: null,
      source: 'unknown',
      lastEvent: 'send',
      startedAt: 1_000,
      lastActivityAt: 1_000,
      stalledAt: null,
    });
  });

  it('tracks realtime run identity and start time', () => {
    const state = createInitialState('agent:main:main');

    markRunEvent(state, 'waiting', 'run-1', 'status', 'realtime-run', 2_000);
    expect(state.runStatus.runId).toBe('run-1');
    expect(state.runStatus.startedAt).toBe(2_000);

    markRunEvent(state, 'waiting', 'run-2', 'status', 'realtime-run', 3_000);
    expect(state.runStatus.runId).toBe('run-2');
    expect(state.runStatus.startedAt).toBe(2_000);
  });

  it('preserves run start time while updating last activity', () => {
    const state = createInitialState('agent:main:main');
    markRunSending(state, 1_000);

    markRunEvent(state, 'streaming', 'run-1', 'message_update', 'realtime-run', 4_000);

    expect(state.runStatus.startedAt).toBe(1_000);
    expect(state.runStatus.lastActivityAt).toBe(4_000);
  });

  it('records completed runs without clearing direct ownership immediately', () => {
    const state = createInitialState('agent:main:main');
    markRunEvent(state, 'streaming', 'run-1', 'message_update', 'realtime-run', 1_000);

    markRunIdleAfterCompletion(state, 'run-1', 'result', 'realtime-run', 2_000);

    expect(state.runStatus.phase).toBe('idle');
    expect(state.runStatus.runId).toBeNull();
    expect(state.runStatus.lastCompletedRunId).toBe('run-1');
  });

  it('marks abort transitions and clears run status on reset', () => {
    const state = createInitialState('agent:main:main');

    markRunAborting(state, 'run-1', 1_000);
    expect(state.runStatus.phase).toBe('aborting');
    expect(state.runStatus.runId).toBe('run-1');

    markRunIdleAfterAbort(state, 2_000);
    expect(state.runStatus.phase).toBe('idle');
    expect(state.runStatus.lastEvent).toBe('abort');
    expect(state.runStatus.startedAt).toBeNull();

    state.runStatus.lastCompletedRunId = 'run-1';
    resetRunStatus(state);
    expect(state.runStatus.lastCompletedRunId).toBeNull();
  });
});
