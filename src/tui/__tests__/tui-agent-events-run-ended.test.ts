import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearSeenStreamEvents, dispatchAgentEvent } from '../tui-agent-events.js';
import { createInitialState } from '../tui-types.js';

function envelope(type: string, runId: string, payload: Record<string, unknown>, seq?: number) {
  return {
    type,
    runId,
    sessionKey: 'sk',
    timestamp: 1,
    ...(seq !== undefined ? { seq } : {}),
    payload,
  };
}

beforeEach(() => {
  clearSeenStreamEvents();
});

describe('dispatchAgentEvent lifecycle', () => {
  it('tracks assistant messages through run_start and assistant_delta', () => {
    const state = createInitialState('sk');
    const chatLog = {
      startAssistant: vi.fn(),
      updateAssistant: vi.fn(),
      finalizeAssistant: vi.fn(),
    };
    const tui = { requestRender: vi.fn() };
    const setActivityStatus = vi.fn();

    dispatchAgentEvent('run_start', envelope('run_start', 'r1', { channel: 'webchat' }), state, chatLog as never, tui as never, setActivityStatus, undefined, undefined, undefined, 'agent-response');
    dispatchAgentEvent('assistant_message_start', envelope('assistant_message_start', 'r1', { messageId: 'm1' }), state, chatLog as never, tui as never, setActivityStatus, undefined, undefined, undefined, 'agent-response');
    dispatchAgentEvent('assistant_delta', envelope('assistant_delta', 'r1', { messageId: 'm1', delta: 'hello' }), state, chatLog as never, tui as never, setActivityStatus, undefined, undefined, undefined, 'agent-response');

    expect(state.activeRunId).toBe('r1');
    expect(state.runStatus.phase).toBe('streaming');
    expect(state.runStatus.runId).toBe('r1');
    expect(state.runStatus.directStreamRunId).toBe('r1');
    expect(state.runStatus.source).toBe('agent-response');
    expect(state.runStatus.lastEvent).toBe('assistant_delta');
    expect(chatLog.updateAssistant).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'assistant', content: [expect.objectContaining({ type: 'text', text: 'hello' })] }),
      'r1',
    );
  });

  it('finalizes the run on run_end', () => {
    const state = createInitialState('sk');
    state.activeRunId = 'r1';
    const onRunEnded = vi.fn();
    const setActivityStatus = vi.fn();

    dispatchAgentEvent('run_end', envelope('run_end', 'r1', { status: 'success' }), state, {} as never, { requestRender: vi.fn() } as never, setActivityStatus, undefined, onRunEnded);

    expect(onRunEnded).toHaveBeenCalledTimes(1);
    expect(state.activeRunId).toBeNull();
    expect(state.runStatus.phase).toBe('idle');
    expect(state.runStatus.runId).toBeNull();
  });

  it('renders protocol errors as assistant messages and ends the run', () => {
    const state = createInitialState('sk');
    state.activeRunId = 'r1';
    const onRunEnded = vi.fn();
    const chatLog = { finalizeAssistant: vi.fn() };

    dispatchAgentEvent('error', envelope('error', 'r1', { code: 'X', message: 'fail' }), state, chatLog as never, { requestRender: vi.fn() } as never, vi.fn(), undefined, onRunEnded);

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
    state.runStatus = { ...state.runStatus, phase: 'streaming', runId: 'r1', directStreamRunId: 'r1', source: 'agent-response' };
    const chatLog = { updateAssistant: vi.fn() };

    dispatchAgentEvent('assistant_delta', envelope('assistant_delta', 'r1', { messageId: 'm1', delta: 'duplicate' }), state, chatLog as never, { requestRender: vi.fn() } as never, vi.fn(), vi.fn(), undefined, undefined, 'broadcast');

    expect(chatLog.updateAssistant).not.toHaveBeenCalled();
    expect(state.runStatus.source).toBe('agent-response');
  });

  it('skips duplicate sequenced events across sources', () => {
    const state = createInitialState('sk');
    state.activeRunId = 'r1';
    const chatLog = { updateAssistant: vi.fn() };

    dispatchAgentEvent('assistant_delta', envelope('assistant_delta', 'r1', { messageId: 'm1', delta: 'hello' }, 2), state, chatLog as never, { requestRender: vi.fn() } as never, vi.fn(), undefined, undefined, undefined, 'agent-response');
    dispatchAgentEvent('assistant_delta', envelope('assistant_delta', 'r1', { messageId: 'm1', delta: 'hello' }, 2), state, chatLog as never, { requestRender: vi.fn() } as never, vi.fn(), undefined, undefined, undefined, 'broadcast');

    expect(chatLog.updateAssistant).toHaveBeenCalledTimes(1);
  });
});

describe('dispatchAgentEvent tool execution', () => {
  it('updates tool lifecycle from protocol events', () => {
    const state = createInitialState('sk');
    state.activeRunId = 'r1';
    const chatLog = {
      startTool: vi.fn(),
      markToolExecutionStarted: vi.fn(),
      updateToolDetails: vi.fn(),
      updateToolResult: vi.fn(),
    };
    const details = { phase: 'run' };
    const finalResult = { content: [{ type: 'text', text: 'done' }], details: { phase: 'done' } };

    dispatchAgentEvent('tool_start', envelope('tool_start', 'r1', { messageId: 'm1', toolName: 'workflow', toolCallId: 'tc1', args: { step: 'build' } }), state, chatLog as never, { requestRender: vi.fn() } as never, vi.fn());
    dispatchAgentEvent('tool_update', envelope('tool_update', 'r1', { messageId: 'm1', toolName: 'workflow', toolCallId: 'tc1', details }), state, chatLog as never, { requestRender: vi.fn() } as never, vi.fn());
    dispatchAgentEvent('tool_end', envelope('tool_end', 'r1', { messageId: 'm1', toolName: 'workflow', toolCallId: 'tc1', result: finalResult, status: 'success' }), state, chatLog as never, { requestRender: vi.fn() } as never, vi.fn());

    expect(chatLog.startTool).toHaveBeenCalledWith('tc1', 'workflow', { step: 'build' }, 'r1');
    expect(chatLog.markToolExecutionStarted).toHaveBeenCalledWith('tc1');
    expect(chatLog.updateToolDetails).toHaveBeenCalledWith('tc1', details);
    expect(chatLog.updateToolResult).toHaveBeenCalledWith('tc1', finalResult, false, false);
  });
});
