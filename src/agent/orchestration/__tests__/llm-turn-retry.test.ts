import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import {
  classifyLlmFailure,
  getAssistantTurnErrorMessage,
  isTransientLlmErrorMessage,
  stripTrailingErrorAssistantMessages,
  maybeRetryTurnAfterTransientLlmFailure,
  isAssistantTurnFailed,
  isAssistantTurnAborted,
} from '../llm-turn-retry.js';

describe('llm-turn-retry', () => {
  afterEach(() => vi.useRealTimers());

  it('cancels during backoff without issuing another model request', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const agent = { state: { messages: [{ role: 'assistant', content: [], stopReason: 'error', errorMessage: '429 Too Many Requests' }] },
      continue: vi.fn(), waitForIdle: vi.fn() } as unknown as import('@earendil-works/pi-agent-core').Agent;
    const pending = maybeRetryTurnAfterTransientLlmFailure(agent, { conversationId: 'test', log: { warn: vi.fn() }, signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(500);
    controller.abort(new DOMException('User cancelled', 'AbortError'));
    await rejected;expect(agent.continue).not.toHaveBeenCalled();
  });
  it('detects transient provider errors', () => {
    expect(classifyLlmFailure('Connection error.')).toBe('transient_network');
    expect(isTransientLlmErrorMessage('TypeError: fetch failed')).toBe(true);
    expect(isTransientLlmErrorMessage('ECONNRESET')).toBe(true);
    expect(isTransientLlmErrorMessage('502: {"code":"provider_error"}')).toBe(true);
    expect(isTransientLlmErrorMessage('503 Service Unavailable')).toBe(true);
    expect(isTransientLlmErrorMessage('Invalid API key')).toBe(false);
  });

  it('classifies retry and recovery decisions', () => {
    expect(classifyLlmFailure('TypeError: fetch failed')).toBe('transient_network');
    expect(classifyLlmFailure('502: {"code":"provider_error"}')).toBe('transient_network');
    expect(classifyLlmFailure('maximum context length exceeded')).toBe('context_overflow');
    expect(classifyLlmFailure(
      'Codex error: Your input exceeds the context window of this model. Please adjust your input and try again.',
    )).toBe('context_overflow');
    expect(classifyLlmFailure('AbortError')).toBe('aborted');
    expect(classifyLlmFailure('Invalid API key')).toBe('permanent');
  });

  it('strips trailing error assistant messages', () => {
    const user: AgentMessage = { role: 'user', content: 'hi', timestamp: 1 };
    const errAssistant: AgentMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      stopReason: 'error',
      errorMessage: 'fetch failed',
      timestamp: 2,
    } as AgentMessage;
    const out = stripTrailingErrorAssistantMessages([user, errAssistant]);
    expect(out).toEqual([user]);
  });

  it.each([false, true])('recovers a connection error only with confirmed tool results (failed=%s)', async (failed) => {
    const controller = new AbortController();
    const toolCall = { role: 'assistant', stopReason: 'toolUse', content: [
      { type: 'toolCall', id: 'input', name: 'computer_use', arguments: { keys: '123+945' } },
    ] };
    const toolResult = { role: 'toolResult', toolCallId: 'input', toolName: 'computer_use',
      isError: failed, content: [{ type: 'text', text: failed ? 'Outcome unknown' : 'Completed' }] };
    const failedMessage = { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'Connection error.' };
    const history = [{ role: 'user', content: 'Calculate', timestamp: 1 }, toolCall, toolResult];
    const success = { role: 'assistant', content: [{ type: 'text', text: '1068' }], stopReason: 'stop' };
    const agent = { state: { messages: [...history, failedMessage] },
      continue: vi.fn(async () => { agent.state.messages.push(success); }), waitForIdle: vi.fn() } as any;
    const log = { warn: vi.fn() };
    await maybeRetryTurnAfterTransientLlmFailure(agent, { conversationId: 'test', log,
      signal: controller.signal, baseDelayMs: 0 });
    expect(agent.continue).toHaveBeenCalledTimes(failed ? 0 : 1);
    expect(agent.state.messages).toEqual([...history, failed ? failedMessage : success]);
    if (failed) expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({
      errorMessage: 'Connection error.', failureKind: 'transient_network',
      recoveryBlockedReason: 'unconfirmed_tool_outcome',
    }), expect.any(String));
  });

  it('bounds persistent connection failures with exponential backoff', async () => {
    vi.useFakeTimers();
    const failure = { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'Connection error.' };
    const user = { role: 'user', content: 'Hello', timestamp: 1 };
    const agent = { state: { messages: [user, failure] },
      continue: vi.fn(async () => { agent.state.messages.push(failure); }), waitForIdle: vi.fn() } as any;
    const budget = { continues: 0 };
    const pending = maybeRetryTurnAfterTransientLlmFailure(agent, { conversationId: 'test', log: { warn: vi.fn() }, budget });
    await vi.advanceTimersByTimeAsync(999);
    expect(agent.continue).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(agent.continue).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(agent.continue).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(agent.continue).toHaveBeenCalledTimes(2);
    expect(budget.continues).toBe(2);
    expect(agent.state.messages).toEqual([user, failure]);
  });

  it('retries via continue when last turn is transient error', async () => {
    const user: AgentMessage = { role: 'user', content: 'hi', timestamp: 1 };
    const errAssistant: AgentMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      stopReason: 'error',
      errorMessage: 'fetch failed',
      timestamp: 2,
    } as AgentMessage;

    const continueFn = vi.fn().mockResolvedValue(undefined);
    const waitForIdle = vi.fn().mockResolvedValue(undefined);
    const replaceMessages = vi.fn();
    let transcript: AgentMessage[] = [user, errAssistant];

    const agent = {
      state: {
        get messages() {
          return transcript;
        },
        set messages(next: AgentMessage[]) {
          replaceMessages(next);
          transcript = next;
        },
      },
      continue: continueFn,
      waitForIdle,
    } as unknown as import('@earendil-works/pi-agent-core').Agent;

    await maybeRetryTurnAfterTransientLlmFailure(agent, {
      conversationId: 'sk',
      log: { warn: vi.fn() },
      maxContinues: 1,
      baseDelayMs: 0,
    });

    expect(replaceMessages).toHaveBeenCalledWith([user]);
    expect(continueFn).toHaveBeenCalledTimes(1);
    expect(waitForIdle).toHaveBeenCalledTimes(1);
  });

  it('does not continue a transient failure after cancellation', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('Aborted', 'AbortError'));
    const agent = {
      state: {
        messages: [{
          role: 'assistant',
          content: [],
          stopReason: 'error',
          errorMessage: 'fetch failed',
          timestamp: 1,
        }],
      },
      continue: vi.fn(),
      waitForIdle: vi.fn(),
    } as unknown as import('@earendil-works/pi-agent-core').Agent;

    await expect(maybeRetryTurnAfterTransientLlmFailure(agent, {
      conversationId: 'sk',
      log: { warn: vi.fn() },
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(agent.continue).not.toHaveBeenCalled();
  });

  it.each(['aborted', 'error'])('recovers provider %s while the host run is live', async (stopReason) => {
    const controller = new AbortController();
    const user = { role: 'user', content: 'Research', timestamp: 1 };
    const agent = { state: { messages: [user,
      { role: 'assistant', content: [], stopReason, errorMessage: 'Request was aborted' }] },
      continue: vi.fn(async () => { agent.state.messages.push({ role: 'assistant', content: [], stopReason: 'stop' } as any); }),
      waitForIdle: vi.fn() } as any;
    await maybeRetryTurnAfterTransientLlmFailure(agent, { conversationId: 'test', log: { warn: vi.fn() },
      signal: controller.signal, baseDelayMs: 0 });
    expect(agent.continue).toHaveBeenCalledTimes(1);
    expect(agent.state.messages).toEqual([user, { role: 'assistant', content: [], stopReason: 'stop' }]);
    expect(controller.signal.aborted).toBe(false);
  });

  it.each(['missing_signal', 'cancelled', 'pending_tool', 'partial_tool', 'budget_exhausted'])('does not recover an abort with %s', async (scenario) => {
    const controller = new AbortController();
    if (scenario === 'cancelled') controller.abort();
    const call = { type: 'toolCall', id: 'write', name: 'write_file', arguments: {} };
    const agent = { state: { messages: [
      { role: 'user', content: 'Research', timestamp: 1 },
      ...(scenario === 'pending_tool' ? [{ role: 'assistant', stopReason: 'toolUse', content: [call] }] : []),
      { role: 'assistant', content: scenario === 'partial_tool' ? [call] : [], stopReason: 'aborted', errorMessage: 'Request was aborted' },
    ] }, continue: vi.fn(), waitForIdle: vi.fn() } as any;
    await maybeRetryTurnAfterTransientLlmFailure(agent, { conversationId: 'test', log: { warn: vi.fn() }, baseDelayMs: 0,
      signal: scenario === 'missing_signal' ? undefined : controller.signal,
      budget: { continues: scenario === 'budget_exhausted' ? 2 : 0 } });
    expect(agent.continue).not.toHaveBeenCalled();
  });

  it('isAssistantTurnFailed reflects last assistant stopReason', () => {
    const user: AgentMessage = { role: 'user', content: 'hi', timestamp: 1 };
    const okAssistant: AgentMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      stopReason: 'stop',
      timestamp: 2,
    } as AgentMessage;
    const errAssistant: AgentMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      stopReason: 'error',
      timestamp: 3,
    } as AgentMessage;

    expect(
      isAssistantTurnFailed({
        state: { messages: [user, okAssistant] },
      } as unknown as import('@earendil-works/pi-agent-core').Agent),
    ).toBe(false);
    expect(
      isAssistantTurnFailed({
        state: { messages: [user, errAssistant] },
      } as unknown as import('@earendil-works/pi-agent-core').Agent),
    ).toBe(true);
  });

  it('getAssistantTurnErrorMessage returns errorMessage from failed assistant', () => {
    const user: AgentMessage = { role: 'user', content: 'hi', timestamp: 1 };
    const errAssistant: AgentMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      stopReason: 'error',
      errorMessage: '401 Authentication Fails',
      timestamp: 2,
    } as AgentMessage;

    expect(
      getAssistantTurnErrorMessage({
        state: { messages: [user, errAssistant] },
      } as unknown as import('@earendil-works/pi-agent-core').Agent),
    ).toBe('401 Authentication Fails');
  });

  it('isAssistantTurnAborted detects aborted assistant', () => {
    const user: AgentMessage = { role: 'user', content: 'hi', timestamp: 1 };
    const aborted: AgentMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      stopReason: 'aborted',
      timestamp: 2,
    } as AgentMessage;
    expect(
      isAssistantTurnAborted({
        state: { messages: [user, aborted] },
      } as unknown as import('@earendil-works/pi-agent-core').Agent),
    ).toBe(true);
  });
});
