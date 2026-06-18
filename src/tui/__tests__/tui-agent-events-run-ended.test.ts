import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearPendingToolCallIds, dispatchAgentSSE } from '../tui-agent-events.js';
import { createInitialState } from '../tui-types.js';

beforeEach(() => {
  clearPendingToolCallIds();
});

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
    const chatLog = {
      finalizeAssistant: vi.fn(),
      addSystem: vi.fn(),
    };
    dispatchAgentSSE(
      'error',
      { content: 'fail' },
      state,
      chatLog as never,
      { finalize: vi.fn(() => null) } as never,
      { requestRender: vi.fn() } as never,
      vi.fn(),
      undefined,
      onRunEnded,
    );
    expect(onRunEnded).toHaveBeenCalledTimes(1);
    expect(state.activeRunId).toBeNull();
    expect(chatLog.finalizeAssistant).toHaveBeenCalledWith('', 'r1', {
      stopReason: 'error',
      errorMessage: 'fail',
    });
    expect(chatLog.addSystem).not.toHaveBeenCalled();
  });
});

describe('dispatchAgentSSE tool updates', () => {
  it('routes tool_update details to the pending tool when toolCallId is omitted', () => {
    const state = createInitialState('sk');
    state.activeRunId = 'r1';
    const chatLog = {
      startTool: vi.fn(),
      updateToolDetails: vi.fn(),
      updateToolArgs: vi.fn(),
    };
    const tui = { requestRender: vi.fn() };
    const setActivityStatus = vi.fn();

    dispatchAgentSSE(
      'tool_start',
      { toolName: 'workflow', toolCallId: 'tc1', args: {} },
      state,
      chatLog as never,
      {} as never,
      tui as never,
      setActivityStatus,
    );
    dispatchAgentSSE(
      'tool_update',
      { toolName: 'workflow', details: { phase: 'build' } },
      state,
      chatLog as never,
      {} as never,
      tui as never,
      setActivityStatus,
    );

    expect(chatLog.updateToolDetails).toHaveBeenCalledWith('tc1', { phase: 'build' });
  });

  it('routes streamed tool args updates to the pending tool', () => {
    const state = createInitialState('sk');
    state.activeRunId = 'r1';
    const chatLog = {
      startTool: vi.fn(),
      updateToolDetails: vi.fn(),
      updateToolArgs: vi.fn(),
    };
    const tui = { requestRender: vi.fn() };
    const setActivityStatus = vi.fn();

    dispatchAgentSSE(
      'tool_start',
      { toolName: 'edit', toolCallId: 'tc1', args: { file: 'old.ts' } },
      state,
      chatLog as never,
      {} as never,
      tui as never,
      setActivityStatus,
    );
    dispatchAgentSSE(
      'tool_update',
      { toolName: 'edit', args: { file: 'new.ts' }, details: { phase: 'args' } },
      state,
      chatLog as never,
      {} as never,
      tui as never,
      setActivityStatus,
    );

    expect(chatLog.updateToolArgs).toHaveBeenCalledWith('tc1', { file: 'new.ts' });
    expect(chatLog.updateToolDetails).toHaveBeenCalledWith('tc1', { phase: 'args' });
  });

  it('does not route omitted-id updates to a completed explicit-id tool', () => {
    const state = createInitialState('sk');
    state.activeRunId = 'r1';
    const chatLog = {
      startTool: vi.fn(),
      updateToolResult: vi.fn(),
      updateToolDetails: vi.fn(),
      updateToolArgs: vi.fn(),
    };
    const tui = { requestRender: vi.fn() };
    const setActivityStatus = vi.fn();

    dispatchAgentSSE(
      'tool_start',
      { toolName: 'workflow', toolCallId: 'tc1', args: {} },
      state,
      chatLog as never,
      {} as never,
      tui as never,
      setActivityStatus,
    );
    dispatchAgentSSE(
      'tool_end',
      { toolName: 'workflow', toolCallId: 'tc1', result: 'done' },
      state,
      chatLog as never,
      {} as never,
      tui as never,
      setActivityStatus,
    );
    dispatchAgentSSE(
      'tool_update',
      { toolName: 'workflow', details: { phase: 'late' } },
      state,
      chatLog as never,
      {} as never,
      tui as never,
      setActivityStatus,
    );

    expect(chatLog.updateToolResult).toHaveBeenCalledWith('tc1', 'done', false);
    expect(chatLog.updateToolDetails).not.toHaveBeenCalledWith('tc1', { phase: 'late' });
  });
});
