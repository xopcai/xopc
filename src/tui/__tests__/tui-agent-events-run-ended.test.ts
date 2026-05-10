import { describe, expect, it, vi } from 'vitest';

import { dispatchAgentSSE } from '../tui-agent-events.js';
import { createInitialState } from '../tui-types.js';

describe('dispatchAgentSSE onRunEnded', () => {
  it('invokes onRunEnded when result clears the run', () => {
    const state = createInitialState('sk');
    state.activeRunId = 'r1';
    const onRunEnded = vi.fn();
    const setActivityStatus = vi.fn();
    dispatchAgentSSE(
      'result',
      {},
      state,
      { finalizeAssistant: vi.fn() } as never,
      { finalize: vi.fn(() => null) } as never,
      { requestRender: vi.fn() } as never,
      setActivityStatus,
      undefined,
      onRunEnded,
    );
    expect(onRunEnded).toHaveBeenCalledTimes(1);
    expect(state.activeRunId).toBeNull();
  });

  it('invokes onRunEnded on error', () => {
    const state = createInitialState('sk');
    state.activeRunId = 'r1';
    const onRunEnded = vi.fn();
    dispatchAgentSSE(
      'error',
      { content: 'fail' },
      state,
      { finalizeAssistant: vi.fn(), addSystem: vi.fn() } as never,
      { finalize: vi.fn(() => null) } as never,
      { requestRender: vi.fn() } as never,
      vi.fn(),
      undefined,
      onRunEnded,
    );
    expect(onRunEnded).toHaveBeenCalledTimes(1);
    expect(state.activeRunId).toBeNull();
  });
});
