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
    state.runStatus.directStreamRunId = 'old-run';
    state.runStatus.lastCompletedRunId = 'old-run';

    markRunSending(state, 1_000);

    expect(state.runStatus).toMatchObject({
      phase: 'sending',
      runId: null,
      directStreamRunId: null,
      lastCompletedRunId: null,
      source: 'unknown',
      lastEvent: 'send',
      lastActivityAt: 1_000,
      stalledAt: null,
    });
  });

  it('marks agent-response and agent-resume events as direct stream owners', () => {
    const state = createInitialState('agent:main:main');

    markRunEvent(state, 'waiting', 'run-1', 'status', 'agent-response', 2_000);
    expect(state.runStatus.directStreamRunId).toBe('run-1');

    markRunEvent(state, 'waiting', 'run-2', 'status', 'agent-resume', 3_000);
    expect(state.runStatus.directStreamRunId).toBe('run-2');
  });

  it('records completed runs without clearing direct ownership immediately', () => {
    const state = createInitialState('agent:main:main');
    markRunEvent(state, 'streaming', 'run-1', 'token', 'agent-response', 1_000);

    markRunIdleAfterCompletion(state, 'run-1', 'result', 'agent-response', 2_000);

    expect(state.runStatus.phase).toBe('idle');
    expect(state.runStatus.runId).toBeNull();
    expect(state.runStatus.lastCompletedRunId).toBe('run-1');
    expect(state.runStatus.directStreamRunId).toBe('run-1');
  });

  it('marks abort transitions and clears run status on reset', () => {
    const state = createInitialState('agent:main:main');

    markRunAborting(state, 'run-1', 1_000);
    expect(state.runStatus.phase).toBe('aborting');
    expect(state.runStatus.runId).toBe('run-1');

    markRunIdleAfterAbort(state, 2_000);
    expect(state.runStatus.phase).toBe('idle');
    expect(state.runStatus.lastEvent).toBe('abort');

    state.runStatus.directStreamRunId = 'run-1';
    state.runStatus.lastCompletedRunId = 'run-1';
    resetRunStatus(state);
    expect(state.runStatus.directStreamRunId).toBeNull();
    expect(state.runStatus.lastCompletedRunId).toBeNull();
  });
});
