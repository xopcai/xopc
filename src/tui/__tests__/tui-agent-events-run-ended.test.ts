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
    expect(state.runStatus.phase).toBe('idle');
    expect(state.runStatus.runId).toBeNull();
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
    expect(state.runStatus.phase).toBe('idle');
    expect(chatLog.finalizeAssistant).toHaveBeenCalledWith('', 'r1', {
      stopReason: 'error',
      errorMessage: 'fail',
    });
    expect(chatLog.addSystem).not.toHaveBeenCalled();
  });
});

describe('dispatchAgentSSE run status', () => {
  it('tracks direct stream ownership from status and token events', () => {
    const state = createInitialState('sk');
    const chatLog = {
      updateAssistant: vi.fn(),
    };
    const tui = { requestRender: vi.fn() };
    const setActivityStatus = vi.fn();

    dispatchAgentSSE(
      'status',
      { runId: 'r1' },
      state,
      chatLog as never,
      { ingestToken: vi.fn(() => 'hi') } as never,
      tui as never,
      setActivityStatus,
      undefined,
      undefined,
      undefined,
      'agent-response',
    );
    dispatchAgentSSE(
      'token',
      { content: 'hi' },
      state,
      chatLog as never,
      { ingestToken: vi.fn(() => 'hi') } as never,
      tui as never,
      setActivityStatus,
      undefined,
      undefined,
      undefined,
      'agent-response',
    );

    expect(state.activeRunId).toBe('r1');
    expect(state.runStatus.phase).toBe('streaming');
    expect(state.runStatus.runId).toBe('r1');
    expect(state.runStatus.directStreamRunId).toBe('r1');
    expect(state.runStatus.source).toBe('agent-response');
    expect(state.runStatus.lastEvent).toBe('token');
    expect(state.runStatus.lastActivityAt).toEqual(expect.any(Number));
  });

  it('skips duplicate broadcast stream events for a run owned by the direct response stream', () => {
    const state = createInitialState('sk');
    state.activeRunId = 'r1';
    state.runStatus = {
      ...state.runStatus,
      phase: 'streaming',
      runId: 'r1',
      directStreamRunId: 'r1',
      source: 'agent-response',
    };
    const chatLog = {
      updateAssistant: vi.fn(),
    };
    const assembler = {
      ingestToken: vi.fn(() => 'duplicate'),
    };
    const tui = { requestRender: vi.fn() };
    const setActivityStatus = vi.fn();
    const touchStreamingActivity = vi.fn();

    dispatchAgentSSE(
      'token',
      { content: 'duplicate' },
      state,
      chatLog as never,
      assembler as never,
      tui as never,
      setActivityStatus,
      touchStreamingActivity,
      undefined,
      undefined,
      'broadcast',
    );

    expect(assembler.ingestToken).not.toHaveBeenCalled();
    expect(chatLog.updateAssistant).not.toHaveBeenCalled();
    expect(setActivityStatus).not.toHaveBeenCalled();
    expect(touchStreamingActivity).not.toHaveBeenCalled();
    expect(state.runStatus.source).toBe('agent-response');
  });

  it('skips duplicate sequenced stream events across sources', () => {
    const state = createInitialState('sk');
    state.activeRunId = 'r1';
    const chatLog = {
      updateAssistant: vi.fn(),
    };
    const assembler = {
      ingestToken: vi.fn((runId: string, token: string) => token),
    };
    const tui = { requestRender: vi.fn() };
    const setActivityStatus = vi.fn();

    dispatchAgentSSE(
      'token',
      { runId: 'r1', seq: 2, content: 'hello' },
      state,
      chatLog as never,
      assembler as never,
      tui as never,
      setActivityStatus,
      undefined,
      undefined,
      undefined,
      'agent-response',
    );
    dispatchAgentSSE(
      'token',
      { runId: 'r1', seq: 2, content: 'hello' },
      state,
      chatLog as never,
      assembler as never,
      tui as never,
      setActivityStatus,
      undefined,
      undefined,
      undefined,
      'broadcast',
    );

    expect(assembler.ingestToken).toHaveBeenCalledTimes(1);
    expect(chatLog.updateAssistant).toHaveBeenCalledTimes(1);
  });

  it('allows broadcast stream events when no direct response stream owns the run', () => {
    const state = createInitialState('sk');
    state.activeRunId = 'r1';
    const chatLog = {
      updateAssistant: vi.fn(),
    };
    const assembler = {
      ingestToken: vi.fn(() => 'from broadcast'),
    };
    const tui = { requestRender: vi.fn() };
    const setActivityStatus = vi.fn();

    dispatchAgentSSE(
      'token',
      { content: 'from broadcast' },
      state,
      chatLog as never,
      assembler as never,
      tui as never,
      setActivityStatus,
      undefined,
      undefined,
      undefined,
      'broadcast',
    );

    expect(assembler.ingestToken).toHaveBeenCalledWith('r1', 'from broadcast', false);
    expect(chatLog.updateAssistant).toHaveBeenCalledWith('from broadcast', 'r1');
    expect(state.runStatus.source).toBe('broadcast');
  });

  it('treats resumed agent streams as direct stream owners', () => {
    const state = createInitialState('sk');
    const chatLog = {
      updateAssistant: vi.fn(),
    };
    const assembler = {
      ingestToken: vi.fn(() => 'resumed'),
    };
    const tui = { requestRender: vi.fn() };
    const setActivityStatus = vi.fn();

    dispatchAgentSSE(
      'status',
      { runId: 'r1' },
      state,
      chatLog as never,
      assembler as never,
      tui as never,
      setActivityStatus,
      undefined,
      undefined,
      undefined,
      'agent-resume',
    );
    dispatchAgentSSE(
      'token',
      { content: 'resumed' },
      state,
      chatLog as never,
      assembler as never,
      tui as never,
      setActivityStatus,
      undefined,
      undefined,
      undefined,
      'agent-resume',
    );

    expect(state.runStatus.directStreamRunId).toBe('r1');
    expect(state.runStatus.source).toBe('agent-resume');
    expect(assembler.ingestToken).toHaveBeenCalledWith('r1', 'resumed', false);
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
