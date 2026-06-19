import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearSeenStreamEvents, dispatchAgentEvent } from '../tui-agent-events.js';
import { createInitialState } from '../tui-types.js';

function assistantMessage(text: string, extra: Partial<AgentMessage> = {}): AgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    timestamp: 1,
    ...extra,
  } as AgentMessage;
}

beforeEach(() => {
  clearSeenStreamEvents();
});

describe('dispatchAgentEvent lifecycle', () => {
  it('tracks structured assistant messages through agent_start and message_update', () => {
    const state = createInitialState('sk');
    const chatLog = {
      startAssistant: vi.fn(),
      updateAssistant: vi.fn(),
      finalizeAssistant: vi.fn(),
    };
    const tui = { requestRender: vi.fn() };
    const setActivityStatus = vi.fn();

    dispatchAgentEvent(
      'agent_start',
      { runId: 'r1' },
      state,
      chatLog as never,
      tui as never,
      setActivityStatus,
      undefined,
      undefined,
      undefined,
      'agent-response',
    );
    dispatchAgentEvent(
      'message_update',
      { runId: 'r1', message: assistantMessage('hello') },
      state,
      chatLog as never,
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
    expect(state.runStatus.lastEvent).toBe('message_update');
    expect(chatLog.updateAssistant).toHaveBeenCalledWith(assistantMessage('hello'), 'r1');
  });

  it('finalizes the run on agent_end', () => {
    const state = createInitialState('sk');
    state.activeRunId = 'r1';
    const onRunEnded = vi.fn();
    const setActivityStatus = vi.fn();

    dispatchAgentEvent(
      'agent_end',
      { runId: 'r1' },
      state,
      {} as never,
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

  it('renders structured errors as assistant messages and ends the run', () => {
    const state = createInitialState('sk');
    state.activeRunId = 'r1';
    const onRunEnded = vi.fn();
    const chatLog = {
      finalizeAssistant: vi.fn(),
    };

    dispatchAgentEvent(
      'error',
      { runId: 'r1', content: 'fail' },
      state,
      chatLog as never,
      { requestRender: vi.fn() } as never,
      vi.fn(),
      undefined,
      onRunEnded,
    );

    expect(onRunEnded).toHaveBeenCalledTimes(1);
    expect(state.activeRunId).toBeNull();
    expect(chatLog.finalizeAssistant).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'assistant', stopReason: 'error', errorMessage: 'fail' }),
      'r1',
    );
  });
});

describe('dispatchAgentEvent de-duplication', () => {
  it('skips duplicate broadcast stream events for a run owned by the direct stream', () => {
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

    dispatchAgentEvent(
      'message_update',
      { runId: 'r1', message: assistantMessage('duplicate') },
      state,
      chatLog as never,
      { requestRender: vi.fn() } as never,
      vi.fn(),
      vi.fn(),
      undefined,
      undefined,
      'broadcast',
    );

    expect(chatLog.updateAssistant).not.toHaveBeenCalled();
    expect(state.runStatus.source).toBe('agent-response');
  });

  it('skips duplicate sequenced events across sources', () => {
    const state = createInitialState('sk');
    state.activeRunId = 'r1';
    const chatLog = {
      updateAssistant: vi.fn(),
    };

    dispatchAgentEvent(
      'message_update',
      { runId: 'r1', seq: 2, message: assistantMessage('hello') },
      state,
      chatLog as never,
      { requestRender: vi.fn() } as never,
      vi.fn(),
      undefined,
      undefined,
      undefined,
      'agent-response',
    );
    dispatchAgentEvent(
      'message_update',
      { runId: 'r1', seq: 2, message: assistantMessage('hello') },
      state,
      chatLog as never,
      { requestRender: vi.fn() } as never,
      vi.fn(),
      undefined,
      undefined,
      undefined,
      'broadcast',
    );

    expect(chatLog.updateAssistant).toHaveBeenCalledTimes(1);
  });
});

describe('dispatchAgentEvent tool execution', () => {
  it('starts tools from assistant tool-call blocks and marks args complete on message_end', () => {
    const state = createInitialState('sk');
    state.activeRunId = 'r1';
    const message = assistantMessage('', {
      content: [{ type: 'toolCall', id: 'tc1', name: 'read_file', arguments: { path: 'a.ts' } }],
    });
    const chatLog = {
      updateAssistant: vi.fn(),
      startTool: vi.fn(),
      markToolArgsComplete: vi.fn(),
      finalizeAssistant: vi.fn(),
    };

    dispatchAgentEvent(
      'message_update',
      { runId: 'r1', message },
      state,
      chatLog as never,
      { requestRender: vi.fn() } as never,
      vi.fn(),
    );
    dispatchAgentEvent(
      'message_end',
      { runId: 'r1', message },
      state,
      chatLog as never,
      { requestRender: vi.fn() } as never,
      vi.fn(),
    );

    expect(chatLog.startTool).toHaveBeenCalledWith('tc1', 'read_file', { path: 'a.ts' }, 'r1');
    expect(chatLog.markToolArgsComplete).toHaveBeenCalledWith('tc1');
  });

  it('updates tool lifecycle from tool_execution events', () => {
    const state = createInitialState('sk');
    state.activeRunId = 'r1';
    const chatLog = {
      startTool: vi.fn(),
      markToolExecutionStarted: vi.fn(),
      updateToolResult: vi.fn(),
    };
    const partialResult = { content: [{ type: 'text', text: 'running' }], details: { phase: 'run' } };
    const finalResult = { content: [{ type: 'text', text: 'done' }], details: { phase: 'done' } };

    dispatchAgentEvent(
      'tool_execution_start',
      { runId: 'r1', toolName: 'workflow', toolCallId: 'tc1', args: { step: 'build' } },
      state,
      chatLog as never,
      { requestRender: vi.fn() } as never,
      vi.fn(),
    );
    dispatchAgentEvent(
      'tool_execution_update',
      { runId: 'r1', toolName: 'workflow', toolCallId: 'tc1', args: {}, partialResult },
      state,
      chatLog as never,
      { requestRender: vi.fn() } as never,
      vi.fn(),
    );
    dispatchAgentEvent(
      'tool_execution_end',
      { runId: 'r1', toolName: 'workflow', toolCallId: 'tc1', result: finalResult, isError: false },
      state,
      chatLog as never,
      { requestRender: vi.fn() } as never,
      vi.fn(),
    );

    expect(chatLog.startTool).toHaveBeenCalledWith('tc1', 'workflow', { step: 'build' }, 'r1');
    expect(chatLog.markToolExecutionStarted).toHaveBeenCalledWith('tc1');
    expect(chatLog.updateToolResult).toHaveBeenCalledWith('tc1', partialResult, false, true);
    expect(chatLog.updateToolResult).toHaveBeenCalledWith('tc1', finalResult, false, false);
  });
});
